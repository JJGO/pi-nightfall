import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { loadConfig } from "./config.js";
import { fileExists, readJsonFile, removeFile, writeJsonAtomic } from "./io.js";
import { loadLocation, loadOrRefreshLocation, refreshLocation } from "./location.js";
import { detectMacAppearance, hasDarkNotify, type DarkNotifyWatcher, watchDarkNotify } from "./macos.js";
import { heartbeatLock, readLock, releaseLock, tryAcquireLock } from "./lock.js";
import { detectSolarMode } from "./solar.js";
import { applyManagedTheme, getMissingThemeSources } from "./theme-files.js";
import type {
  Config,
  DetectionResult,
  LeaderRecord,
  OverrideMode,
  OverrideState,
  SharedState,
} from "./types.js";

class NightfallRuntime {
  private readonly runtimeId = randomUUID();
  private config: Config | null = null;
  private currentCtx: ExtensionContext | null = null;
  private leaderRecord: LeaderRecord | null = null;
  private leaderCheckTimer: ReturnType<typeof setInterval> | null = null;
  private leaderHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private nextTransitionTimer: ReturnType<typeof setTimeout> | null = null;
  private macPollTimer: ReturnType<typeof setInterval> | null = null;
  private darkNotifyWatcher: DarkNotifyWatcher | null = null;
  private reconcileInFlight = false;
  private warnedMissingSources = false;

  async start(ctx: ExtensionContext): Promise<void> {
    await this.stop();
    this.currentCtx = ctx;
    this.config = await loadConfig();
    if (!ctx.hasUI) return;

    try {
      await this.ensureManagedThemeReady();
      await this.enrollSystemTheme(ctx);
      await this.maybeBecomeLeader();
      this.startLeaderCheckLoop();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.notify(ctx, `Failed to start auto-theme runtime: ${message}`, "error");
    }
  }

  async stop(): Promise<void> {
    this.stopLeaderOnlyWork();
    if (this.leaderCheckTimer) {
      clearInterval(this.leaderCheckTimer);
      this.leaderCheckTimer = null;
    }
    if (this.config && this.leaderRecord) {
      await releaseLock(this.config, this.runtimeId);
    }
    this.leaderRecord = null;
    this.currentCtx = null;
  }

  async handleCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
    this.currentCtx = ctx;
    this.config ??= await loadConfig();

    try {
      const [subcommand, ...rest] = args.trim().split(/\s+/).filter(Boolean);
      const action = subcommand ?? "status";

      switch (action) {
        case "status":
          await this.showStatus(ctx);
          return;
        case "refresh":
          await this.ensureManagedThemeReady();
          await this.reconcileAndApply("command:refresh");
          this.notify(ctx, "Refreshed managed theme state.");
          return;
        case "locate": {
          const location = await refreshLocation(this.mustConfig(), ctx.signal);
          await this.reconcileAndApply("command:locate");
          this.notify(ctx, `Location updated to ${this.describeLocation(location)}.`);
          return;
        }
        case "override": {
          const value = rest[0]?.toLowerCase();
          if (value !== "dark" && value !== "light" && value !== "auto") {
            this.notify(ctx, "Usage: /auto-theme override dark|light|auto", "warning");
            return;
          }
          await this.writeOverride(value);
          await this.ensureManagedThemeReady();
          await this.reconcileAndApply("command:override");
          this.notify(ctx, value === "auto" ? "Returned to automatic theme management." : `Forced ${value} mode.`);
          return;
        }
        case "enroll":
          await this.ensureManagedThemeReady();
          await this.enrollSystemTheme(ctx, true);
          return;
        default:
          this.notify(ctx, `Unknown subcommand: ${action}`, "warning");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.notify(ctx, `auto-theme command failed: ${message}`, "error");
    }
  }

  getCommandCompletions(prefix: string): { value: string; label: string }[] | null {
    const items = [
      { value: "status", label: "status" },
      { value: "refresh", label: "refresh" },
      { value: "locate", label: "locate" },
      { value: "override dark", label: "override dark" },
      { value: "override light", label: "override light" },
      { value: "override auto", label: "override auto" },
      { value: "enroll", label: "enroll" },
    ];
    const matches = items.filter((item) => item.value.startsWith(prefix));
    return matches.length > 0 ? matches : null;
  }

  private mustConfig(): Config {
    if (!this.config) {
      throw new Error("Nightfall runtime has not been initialised");
    }
    return this.config;
  }

  private notify(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "info"): void {
    if (ctx.hasUI) {
      ctx.ui.notify(message, level);
      return;
    }
    const prefix = `[pi-nightfall][${level}]`;
    if (level === "error") console.error(prefix, message);
    else console.warn(prefix, message);
  }

  private describeLocation(location: { city?: string; region?: string; country?: string; timezone: string }): string {
    const area = [location.city, location.region, location.country].filter(Boolean).join(", ");
    return area.length > 0 ? `${area} (${location.timezone})` : location.timezone;
  }

  private async readOverride(): Promise<OverrideState | null> {
    return readJsonFile<OverrideState>(this.mustConfig().overridePath);
  }

  private async writeOverride(mode: OverrideMode): Promise<void> {
    const config = this.mustConfig();
    if (mode === "auto") {
      await removeFile(config.overridePath);
      return;
    }
    await writeJsonAtomic(config.overridePath, { mode, updatedAt: new Date().toISOString() } satisfies OverrideState);
  }

  private async ensureManagedThemeReady(): Promise<boolean> {
    const config = this.mustConfig();
    const activeThemeExists = await fileExists(config.activeThemePath);
    const missingSources = await getMissingThemeSources(config);
    if (missingSources.length > 0) {
      if (!this.warnedMissingSources && this.currentCtx) {
        this.notify(this.currentCtx, `Missing managed theme source files: ${missingSources.join(", ")}`, "warning");
      }
      this.warnedMissingSources = true;
      return activeThemeExists;
    }

    if (activeThemeExists) {
      this.warnedMissingSources = false;
      return true;
    }

    this.warnedMissingSources = false;
    const detection = await this.resolveDesiredMode();
    await applyManagedTheme(config, detection.mode);
    return true;
  }

  private async enrollSystemTheme(ctx: ExtensionContext, forceMessage = false): Promise<void> {
    const config = this.mustConfig();
    const ready = await this.ensureManagedThemeReady();
    if (!ready) return;
    if (ctx.ui.theme.name === config.systemThemeName) return;
    const result = ctx.ui.setTheme(config.systemThemeName);
    if (!result.success) {
      this.notify(ctx, `Failed to switch Pi to ${config.systemThemeName}: ${result.error ?? "unknown error"}`, "warning");
      return;
    }
    if (forceMessage) {
      this.notify(ctx, `Pi is now enrolled in the shared ${config.systemThemeName} theme.`);
    }
  }

  private startLeaderCheckLoop(): void {
    if (this.leaderCheckTimer) clearInterval(this.leaderCheckTimer);
    this.leaderCheckTimer = setInterval(() => {
      void this.maybeBecomeLeader();
    }, this.mustConfig().leaderCheckMs);
  }

  private async maybeBecomeLeader(): Promise<void> {
    const config = this.mustConfig();
    const acquired = await tryAcquireLock(config, this.runtimeId);
    if (!acquired.leader) {
      if (this.leaderRecord) {
        this.stopLeaderOnlyWork();
      }
      this.leaderRecord = null;
      return;
    }

    const firstLeadership = !this.leaderRecord;
    this.leaderRecord = acquired.lock ?? this.leaderRecord;
    if (firstLeadership) {
      this.startLeaderOnlyWork();
      await this.reconcileAndApply("leadership");
    }
  }

  private startLeaderOnlyWork(): void {
    this.stopLeaderOnlyWork();
    this.startHeartbeatLoop();
    if (process.platform === "darwin") {
      void this.startMacWatcherOrPoll();
    }
  }

  private stopLeaderOnlyWork(): void {
    if (this.leaderHeartbeatTimer) {
      clearInterval(this.leaderHeartbeatTimer);
      this.leaderHeartbeatTimer = null;
    }
    if (this.nextTransitionTimer) {
      clearTimeout(this.nextTransitionTimer);
      this.nextTransitionTimer = null;
    }
    if (this.macPollTimer) {
      clearInterval(this.macPollTimer);
      this.macPollTimer = null;
    }
    if (this.darkNotifyWatcher) {
      this.darkNotifyWatcher.stop();
      this.darkNotifyWatcher = null;
    }
  }

  private startHeartbeatLoop(): void {
    this.leaderHeartbeatTimer = setInterval(() => {
      void this.heartbeatLeaderLock();
    }, this.mustConfig().leaderHeartbeatMs);
  }

  private async heartbeatLeaderLock(): Promise<void> {
    if (!this.leaderRecord) return;
    const updated = await heartbeatLock(this.mustConfig(), this.leaderRecord);
    if (!updated) {
      this.stopLeaderOnlyWork();
      this.leaderRecord = null;
      return;
    }
    this.leaderRecord = updated;
  }

  private async startMacWatcherOrPoll(): Promise<void> {
    if (await hasDarkNotify()) {
      this.darkNotifyWatcher = watchDarkNotify(
        (mode) => {
          void this.reconcileAndApply("macos-dark-notify", { mode, source: "macos-dark-notify" });
        },
        () => {
          this.darkNotifyWatcher = null;
          this.macPollTimer = setInterval(() => {
            void this.reconcileAndApply("macos-poll");
          }, this.mustConfig().macPollMs);
        },
      );
      return;
    }

    this.macPollTimer = setInterval(() => {
      void this.reconcileAndApply("macos-poll");
    }, this.mustConfig().macPollMs);
  }

  private async resolveDesiredMode(hint?: DetectionResult): Promise<DetectionResult> {
    const override = await this.readOverride();
    if (override && (override.mode === "dark" || override.mode === "light")) {
      return {
        mode: override.mode,
        source: "override",
      };
    }

    if (hint) return hint;

    if (process.platform === "darwin") {
      const macMode = await detectMacAppearance();
      if (macMode) {
        return {
          mode: macMode,
          source: "macos-defaults",
        };
      }
    }

    const location = await loadOrRefreshLocation(this.mustConfig());
    return detectSolarMode(location);
  }

  private async reconcileAndApply(reason: string, hint?: DetectionResult): Promise<void> {
    const config = this.mustConfig();
    if (this.reconcileInFlight) return;
    this.reconcileInFlight = true;

    try {
      const ready = await this.ensureManagedThemeReady();
      if (!ready) return;
      const detection = await this.resolveDesiredMode(hint);
      await applyManagedTheme(config, detection.mode);
      await this.writeSharedState(detection, reason);
      await this.enrollCurrentSessionIfNeeded();
      this.scheduleNextTransition(detection);
    } finally {
      this.reconcileInFlight = false;
    }
  }

  private scheduleNextTransition(detection: DetectionResult): void {
    if (this.nextTransitionTimer) {
      clearTimeout(this.nextTransitionTimer);
      this.nextTransitionTimer = null;
    }
    if (!this.leaderRecord) return;
    if (detection.source !== "solar" && detection.source !== "solar-polar") return;
    if (!detection.nextTransitionAt) return;

    const delayMs = Date.parse(detection.nextTransitionAt) - Date.now();
    if (!Number.isFinite(delayMs)) return;
    const boundedDelayMs = Math.max(1_000, delayMs);
    this.nextTransitionTimer = setTimeout(() => {
      void this.reconcileAndApply("solar-transition");
    }, boundedDelayMs);
  }

  private async enrollCurrentSessionIfNeeded(): Promise<void> {
    if (!this.currentCtx) return;
    await this.enrollSystemTheme(this.currentCtx);
  }

  private async writeSharedState(detection: DetectionResult, reason: string): Promise<void> {
    const leader = this.leaderRecord ?? (await readLock(this.mustConfig())) ?? undefined;
    const state: SharedState = {
      currentMode: detection.mode,
      source: detection.source,
      updatedAt: new Date().toISOString(),
      nextTransitionAt: detection.nextTransitionAt,
      leader,
      note: detection.note ? `${detection.note} [${reason}]` : `[${reason}]`,
    };
    await writeJsonAtomic(this.mustConfig().statePath, state);
  }

  private async showStatus(ctx: ExtensionCommandContext): Promise<void> {
    const config = this.mustConfig();
    const [override, location, state, lock, missingSources] = await Promise.all([
      this.readOverride(),
      loadLocation(config),
      readJsonFile<SharedState>(config.statePath),
      readLock(config),
      getMissingThemeSources(config),
    ]);

    const lines = [
      `theme=${ctx.ui.theme.name ?? "unknown"}`,
      `managedTheme=${config.systemThemeName}`,
      `leader=${this.leaderRecord ? "yes" : "no"}`,
      `leaderPid=${lock?.pid ?? "none"}`,
      `override=${override?.mode ?? "auto"}`,
      `mode=${state?.currentMode ?? "unknown"}`,
      `source=${state?.source ?? "unknown"}`,
      `nextTransition=${state?.nextTransitionAt ?? "none"}`,
      `location=${location ? this.describeLocation(location) : "missing"}`,
      `missingSources=${missingSources.length > 0 ? missingSources.join(", ") : "none"}`,
      `stateUpdated=${state?.updatedAt ?? "never"}`,
    ];

    this.notify(ctx, lines.join("\n"));
  }
}

export default function nightfallExtension(pi: ExtensionAPI): void {
  const runtime = new NightfallRuntime();

  pi.registerCommand("auto-theme", {
    description: "Manage the shared system theme alias",
    getArgumentCompletions: (prefix) => runtime.getCommandCompletions(prefix),
    handler: async (args, ctx) => {
      await runtime.handleCommand(args ?? "", ctx);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    await runtime.start(ctx);
  });

  pi.on("session_shutdown", async () => {
    await runtime.stop();
  });
}
