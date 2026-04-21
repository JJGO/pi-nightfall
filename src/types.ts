export type ThemeMode = "dark" | "light";
export type OverrideMode = ThemeMode | "auto";

export type DetectionSource =
  | "override"
  | "macos-dark-notify"
  | "macos-defaults"
  | "solar"
  | "solar-polar";

export type Config = {
  systemThemeName: string;
  agentDir: string;
  themesDir: string;
  darkSourcePath: string;
  lightSourcePath: string;
  activeThemePath: string;
  configPath: string;
  locationPath: string;
  overridePath: string;
  statePath: string;
  lockPath: string;
  leaderHeartbeatMs: number;
  leaderTtlMs: number;
  leaderCheckMs: number;
  macPollMs: number;
};

export type ConfigOverrides = Partial<{
  systemThemeName: string;
  darkSourcePath: string;
  lightSourcePath: string;
  activeThemePath: string;
  leaderHeartbeatMs: number;
  leaderTtlMs: number;
  leaderCheckMs: number;
  macPollMs: number;
}>;

export type LocationCache = {
  latitude: number;
  longitude: number;
  timezone: string;
  city?: string;
  region?: string;
  country?: string;
  source: "ipinfo";
  fetchedAt: string;
};

export type OverrideState = {
  mode: OverrideMode;
  updatedAt: string;
};

export type LeaderRecord = {
  runtimeId: string;
  pid: number;
  hostname: string;
  startedAt: string;
  heartbeatAt: string;
};

export type SharedState = {
  currentMode?: ThemeMode;
  source?: DetectionSource;
  updatedAt?: string;
  nextTransitionAt?: string;
  leader?: LeaderRecord;
  note?: string;
};

export type DetectionResult = {
  mode: ThemeMode;
  source: DetectionSource;
  nextTransitionAt?: string;
  note?: string;
};

export type LockAcquireResult = {
  leader: boolean;
  lock?: LeaderRecord;
};
