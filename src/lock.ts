import os from "node:os";
import { open, readFile, writeFile } from "node:fs/promises";
import { removeFile } from "./io.js";
import type { Config, LeaderRecord, LockAcquireResult } from "./types.js";

function buildRecord(runtimeId: string): LeaderRecord {
  const now = new Date().toISOString();
  return {
    runtimeId,
    pid: process.pid,
    hostname: os.hostname(),
    startedAt: now,
    heartbeatAt: now,
  };
}

export async function readLock(config: Config): Promise<LeaderRecord | null> {
  try {
    const raw = await readFile(config.lockPath, "utf8");
    return JSON.parse(raw) as LeaderRecord;
  } catch {
    return null;
  }
}

function isStale(config: Config, record: LeaderRecord): boolean {
  const heartbeat = Date.parse(record.heartbeatAt);
  if (!Number.isFinite(heartbeat)) return true;
  return Date.now() - heartbeat > config.leaderTtlMs;
}

export async function tryAcquireLock(config: Config, runtimeId: string): Promise<LockAcquireResult> {
  const record = buildRecord(runtimeId);
  try {
    const handle = await open(config.lockPath, "wx");
    await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
    await handle.close();
    return { leader: true, lock: record };
  } catch {
    const current = await readLock(config);
    if (!current || isStale(config, current)) {
      await removeFile(config.lockPath);
      return tryAcquireLock(config, runtimeId);
    }
    if (current.runtimeId === runtimeId) {
      return { leader: true, lock: current };
    }
    return { leader: false, lock: current };
  }
}

export async function heartbeatLock(config: Config, record: LeaderRecord): Promise<LeaderRecord | null> {
  const current = await readLock(config);
  if (!current || current.runtimeId !== record.runtimeId) return null;
  const next: LeaderRecord = { ...record, heartbeatAt: new Date().toISOString() };
  await writeFile(config.lockPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export async function releaseLock(config: Config, runtimeId: string): Promise<void> {
  const current = await readLock(config);
  if (current?.runtimeId === runtimeId) {
    await removeFile(config.lockPath);
  }
}
