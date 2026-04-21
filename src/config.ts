import os from "node:os";
import path from "node:path";
import { readJsonFile } from "./io.js";
import type { Config, ConfigOverrides } from "./types.js";

const MIN_LEADER_HEARTBEAT_MS = 5_000;
const MIN_LEADER_TTL_MS = 15_000;
const MIN_LEADER_CHECK_MS = 10_000;
const MIN_MAC_POLL_MS = 10_000;

function clamp(value: unknown, fallback: number, minimum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.round(value));
}

function asPath(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function asName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export function getDefaultConfig(): Config {
  const agentDir = path.join(os.homedir(), ".pi", "agent");
  const themesDir = path.join(agentDir, "themes");
  const systemThemeName = "system";
  return {
    systemThemeName,
    agentDir,
    themesDir,
    darkSourcePath: path.join(themesDir, `${systemThemeName}-dark.json`),
    lightSourcePath: path.join(themesDir, `${systemThemeName}-light.json`),
    activeThemePath: path.join(themesDir, `${systemThemeName}.json`),
    configPath: path.join(agentDir, "auto-theme-config.json"),
    locationPath: path.join(agentDir, "auto-theme-location.json"),
    overridePath: path.join(agentDir, "auto-theme-override.json"),
    statePath: path.join(agentDir, "auto-theme-state.json"),
    lockPath: path.join(agentDir, "auto-theme.lock"),
    leaderHeartbeatMs: 15_000,
    leaderTtlMs: 45_000,
    leaderCheckMs: 30_000,
    macPollMs: 60_000,
  };
}

export async function loadConfig(): Promise<Config> {
  const defaults = getDefaultConfig();
  const overrides = (await readJsonFile<ConfigOverrides>(defaults.configPath)) ?? {};
  const systemThemeName = asName(overrides.systemThemeName, defaults.systemThemeName);
  const darkSourcePath = asPath(overrides.darkSourcePath, path.join(defaults.themesDir, `${systemThemeName}-dark.json`));
  const lightSourcePath = asPath(overrides.lightSourcePath, path.join(defaults.themesDir, `${systemThemeName}-light.json`));
  const activeThemePath = asPath(overrides.activeThemePath, path.join(defaults.themesDir, `${systemThemeName}.json`));

  return {
    ...defaults,
    systemThemeName,
    darkSourcePath,
    lightSourcePath,
    activeThemePath,
    leaderHeartbeatMs: clamp(overrides.leaderHeartbeatMs, defaults.leaderHeartbeatMs, MIN_LEADER_HEARTBEAT_MS),
    leaderTtlMs: clamp(overrides.leaderTtlMs, defaults.leaderTtlMs, MIN_LEADER_TTL_MS),
    leaderCheckMs: clamp(overrides.leaderCheckMs, defaults.leaderCheckMs, MIN_LEADER_CHECK_MS),
    macPollMs: clamp(overrides.macPollMs, defaults.macPollMs, MIN_MAC_POLL_MS),
    agentDir: defaults.agentDir,
    themesDir: defaults.themesDir,
    configPath: defaults.configPath,
    locationPath: defaults.locationPath,
    overridePath: defaults.overridePath,
    statePath: defaults.statePath,
    lockPath: defaults.lockPath,
  };
}
