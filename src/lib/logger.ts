/**
 * Structured logger for observability.
 * Outputs JSON lines to stdout for easy ingestion by log aggregators.
 *
 * An explicit LOG_LEVEL always wins. Without one, vitest runs are silent
 * (expected-failure tests would otherwise flood the output), other test
 * runs log errors only, and everything else logs info and up.
 */

type LogLevel = "debug" | "info" | "warn" | "error";
type MinLevel = LogLevel | "silent";

const LEVEL_ORDER: Record<MinLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

function getMinLevel(): MinLevel {
  if (process.env.LOG_LEVEL) {
    const normalized = process.env.LOG_LEVEL.toLowerCase();
    if (normalized in LEVEL_ORDER) return normalized as MinLevel;
    return "info";
  }
  if (process.env.VITEST) return "silent";
  if (process.env.NODE_ENV === "test") return "error";
  return "info";
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[getMinLevel()];
}

interface LogEntry {
  level: LogLevel;
  event: string;
  timestamp: string;
  [key: string]: unknown;
}

function emit(entry: LogEntry) {
  const line = JSON.stringify(entry);
  if (entry.level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug(event: string, data?: Record<string, unknown>) {
    if (!shouldLog("debug")) return;
    emit({ level: "debug", event, timestamp: new Date().toISOString(), ...data });
  },
  info(event: string, data?: Record<string, unknown>) {
    if (!shouldLog("info")) return;
    emit({ level: "info", event, timestamp: new Date().toISOString(), ...data });
  },
  warn(event: string, data?: Record<string, unknown>) {
    if (!shouldLog("warn")) return;
    emit({ level: "warn", event, timestamp: new Date().toISOString(), ...data });
  },
  error(event: string, data?: Record<string, unknown>) {
    if (!shouldLog("error")) return;
    emit({ level: "error", event, timestamp: new Date().toISOString(), ...data });
  },
};
