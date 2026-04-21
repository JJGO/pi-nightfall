import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { ThemeMode } from "./types.js";

const execFileAsync = promisify(execFile);
const DETECTION_TIMEOUT_MS = 1_500;

export type DarkNotifyWatcher = {
  stop: () => void;
};

let darkNotifyAvailable: boolean | undefined;

function normalizeMode(value: string): ThemeMode | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "dark") return "dark";
  if (trimmed === "light") return "light";
  return null;
}

export async function hasDarkNotify(): Promise<boolean> {
  if (darkNotifyAvailable !== undefined) return darkNotifyAvailable;
  try {
    await execFileAsync("dark-notify", ["-e"], { timeout: DETECTION_TIMEOUT_MS });
    darkNotifyAvailable = true;
  } catch {
    darkNotifyAvailable = false;
  }
  return darkNotifyAvailable;
}

export async function detectMacAppearance(): Promise<ThemeMode | null> {
  try {
    const { stdout } = await execFileAsync("/usr/bin/defaults", ["read", "-g", "AppleInterfaceStyle"], {
      timeout: DETECTION_TIMEOUT_MS,
      windowsHide: true,
    });
    return normalizeMode(stdout) ?? "light";
  } catch (error) {
    const stderr = typeof error === "object" && error !== null && "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "";
    if (stderr.toLowerCase().includes("does not exist")) return "light";
    return null;
  }
}

export function watchDarkNotify(
  onMode: (mode: ThemeMode) => void,
  onExit: () => void,
): DarkNotifyWatcher {
  const child = spawn("dark-notify", [], {
    stdio: ["ignore", "pipe", "ignore"],
  });

  let buffer = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) break;
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      const mode = normalizeMode(line);
      if (mode) onMode(mode);
    }
  });

  child.once("exit", () => {
    onExit();
  });

  return {
    stop: () => {
      child.removeAllListeners();
      child.stdout.removeAllListeners();
      if (!child.killed) child.kill();
    },
  };
}
