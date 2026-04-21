import { getSolarPosition, getSunrise, getSunset } from "sunrise-sunset-js";
import type { DetectionResult, LocationCache, ThemeMode } from "./types.js";

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

type CalendarDay = Pick<ZonedParts, "year" | "month" | "day">;

type SunTimes = {
  sunrise: Date | null;
  sunset: Date | null;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timezone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    formatterCache.set(timezone, formatter);
  }
  return formatter;
}

function getZonedParts(date: Date, timezone: string): ZonedParts {
  const parts = getFormatter(timezone).formatToParts(date);
  const values = new Map<string, string>();
  for (const part of parts) {
    values.set(part.type, part.value);
  }
  return {
    year: Number.parseInt(values.get("year") ?? "0", 10),
    month: Number.parseInt(values.get("month") ?? "0", 10),
    day: Number.parseInt(values.get("day") ?? "0", 10),
    hour: Number.parseInt(values.get("hour") ?? "0", 10),
    minute: Number.parseInt(values.get("minute") ?? "0", 10),
    second: Number.parseInt(values.get("second") ?? "0", 10),
  };
}

function shiftDay(day: CalendarDay, days: number): CalendarDay {
  const shifted = new Date(Date.UTC(day.year, day.month - 1, day.day + days, 12, 0, 0));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function getTimezoneOffsetHours(date: Date, timezone: string): number {
  const parts = getZonedParts(date, timezone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return (asUtc - date.getTime()) / 3_600_000;
}

function getRepresentativeInstant(day: CalendarDay): Date {
  return new Date(Date.UTC(day.year, day.month - 1, day.day, 12, 0, 0));
}

function getBaseDate(day: CalendarDay): Date {
  return new Date(day.year, day.month - 1, day.day, 12, 0, 0);
}

function getSunTimesForDay(location: LocationCache, day: CalendarDay): SunTimes {
  const representativeInstant = getRepresentativeInstant(day);
  const timezone = getTimezoneOffsetHours(representativeInstant, location.timezone);
  const baseDate = getBaseDate(day);
  return {
    sunrise: getSunrise(location.latitude, location.longitude, baseDate, { timezone }),
    sunset: getSunset(location.latitude, location.longitude, baseDate, { timezone }),
  };
}

function getCurrentModeFromSolarPosition(location: LocationCache, now: Date): ThemeMode {
  const parts = getZonedParts(now, location.timezone);
  const wallClockDate = new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const timezone = getTimezoneOffsetHours(now, location.timezone);
  const position = getSolarPosition(location.latitude, location.longitude, wallClockDate, { timezone });
  return position && position.elevation > 0 ? "light" : "dark";
}

function findNextTransition(location: LocationCache, now: Date, currentMode: ThemeMode, day: CalendarDay): Date | undefined {
  for (let offset = 0; offset <= 370; offset += 1) {
    const candidateDay = shiftDay(day, offset);
    const times = getSunTimesForDay(location, candidateDay);
    const candidate = currentMode === "dark" ? times.sunrise : times.sunset;
    if (candidate && candidate.getTime() > now.getTime()) {
      return candidate;
    }
  }
  return undefined;
}

export function detectSolarMode(location: LocationCache, now: Date = new Date()): DetectionResult {
  const today = getZonedParts(now, location.timezone);
  const todayDay: CalendarDay = { year: today.year, month: today.month, day: today.day };
  const todayTimes = getSunTimesForDay(location, todayDay);

  if (todayTimes.sunrise && todayTimes.sunset) {
    if (now.getTime() < todayTimes.sunrise.getTime()) {
      return {
        mode: "dark",
        source: "solar",
        nextTransitionAt: todayTimes.sunrise.toISOString(),
      };
    }

    if (now.getTime() < todayTimes.sunset.getTime()) {
      return {
        mode: "light",
        source: "solar",
        nextTransitionAt: todayTimes.sunset.toISOString(),
      };
    }

    const tomorrowTimes = getSunTimesForDay(location, shiftDay(todayDay, 1));
    return {
      mode: "dark",
      source: "solar",
      nextTransitionAt: tomorrowTimes.sunrise?.toISOString(),
    };
  }

  const mode = getCurrentModeFromSolarPosition(location, now);
  const nextTransition = findNextTransition(location, now, mode, todayDay);
  return {
    mode,
    source: "solar-polar",
    nextTransitionAt: nextTransition?.toISOString(),
    note: "Using solar elevation because this latitude does not have both sunrise and sunset today.",
  };
}
