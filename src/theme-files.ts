import { readFile } from "node:fs/promises";
import { fileExists, writeTextAtomic } from "./io.js";
import type { Config, ThemeMode } from "./types.js";

function getSourcePath(config: Config, mode: ThemeMode): string {
  return mode === "dark" ? config.darkSourcePath : config.lightSourcePath;
}

export async function getMissingThemeSources(config: Config): Promise<string[]> {
  const missing: string[] = [];
  if (!(await fileExists(config.darkSourcePath))) missing.push(config.darkSourcePath);
  if (!(await fileExists(config.lightSourcePath))) missing.push(config.lightSourcePath);
  return missing;
}

export async function applyManagedTheme(
  config: Config,
  mode: ThemeMode,
): Promise<{ changed: boolean; sourcePath: string; targetPath: string }> {
  const sourcePath = getSourcePath(config, mode);
  const raw = await readFile(sourcePath, "utf8");
  const theme = JSON.parse(raw) as Record<string, unknown>;
  theme.name = config.systemThemeName;
  const nextContent = `${JSON.stringify(theme, null, 2)}\n`;

  let currentContent: string | null = null;
  try {
    currentContent = await readFile(config.activeThemePath, "utf8");
  } catch {
    currentContent = null;
  }

  if (currentContent === nextContent) {
    return { changed: false, sourcePath, targetPath: config.activeThemePath };
  }

  await writeTextAtomic(config.activeThemePath, nextContent);
  return { changed: true, sourcePath, targetPath: config.activeThemePath };
}
