/**
 * Structured logger for observability.
 * Outputs JSON lines to stdout for easy ingestion by log aggregators.
 * In test environment, logs are suppressed unless LOG_LEVEL=debug.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getMinLevel(): LogLevel {
  if (process.env.LOG_LEVEL) {
    const normalized = process.env.LOG_LEVEL.toLowerCase();
    if (normalized in LEVEL_ORDER) return normalized as LogLevel;
    return "info";
  }
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
