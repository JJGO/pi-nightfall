import { readJsonFile, writeJsonAtomic } from "./io.js";
import type { Config, LocationCache } from "./types.js";

type IpInfoResponse = {
  city?: unknown;
  region?: unknown;
  country?: unknown;
  loc?: unknown;
  timezone?: unknown;
};

function parseLocation(response: IpInfoResponse): LocationCache {
  if (typeof response.loc !== "string") {
    throw new Error("ipinfo response did not include loc");
  }
  if (typeof response.timezone !== "string" || response.timezone.trim().length === 0) {
    throw new Error("ipinfo response did not include timezone");
  }

  const [latRaw, lonRaw] = response.loc.split(",", 2);
  const latitude = Number.parseFloat(latRaw ?? "");
  const longitude = Number.parseFloat(lonRaw ?? "");
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error(`invalid ipinfo coordinates: ${response.loc}`);
  }

  return {
    latitude,
    longitude,
    timezone: response.timezone.trim(),
    city: typeof response.city === "string" && response.city.trim().length > 0 ? response.city.trim() : undefined,
    region: typeof response.region === "string" && response.region.trim().length > 0 ? response.region.trim() : undefined,
    country: typeof response.country === "string" && response.country.trim().length > 0 ? response.country.trim() : undefined,
    source: "ipinfo",
    fetchedAt: new Date().toISOString(),
  };
}

export async function loadLocation(config: Config): Promise<LocationCache | null> {
  return readJsonFile<LocationCache>(config.locationPath);
}

export async function refreshLocation(config: Config, signal?: AbortSignal): Promise<LocationCache> {
  const response = await fetch("https://ipinfo.io/json", {
    headers: { accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    throw new Error(`ipinfo lookup failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as IpInfoResponse;
  const location = parseLocation(payload);
  await writeJsonAtomic(config.locationPath, location);
  return location;
}

export async function loadOrRefreshLocation(config: Config, signal?: AbortSignal): Promise<LocationCache> {
  const cached = await loadLocation(config);
  if (cached) return cached;
  return refreshLocation(config, signal);
}
