import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("logger", () => {
  const originalLogLevel = process.env.LOG_LEVEL;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalLogLevel !== undefined) {
      process.env.LOG_LEVEL = originalLogLevel;
    } else {
      delete process.env.LOG_LEVEL;
    }
  });

  it("emits structured JSON with required fields", async () => {
    process.env.LOG_LEVEL = "debug";
    const { logger } = await import("@/lib/logger");
    logger.info("test.event", { user_id: "u1", run_id: "r1" });

    expect(console.log).toHaveBeenCalledOnce();
    const logged = JSON.parse((console.log as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(logged.level).toBe("info");
    expect(logged.event).toBe("test.event");
    expect(logged.timestamp).toBeDefined();
    expect(logged.user_id).toBe("u1");
    expect(logged.run_id).toBe("r1");
  });

  it("emits errors to console.error", async () => {
    process.env.LOG_LEVEL = "error";
    const { logger } = await import("@/lib/logger");
    logger.error("test.error", { message: "boom" });

    expect(console.error).toHaveBeenCalledOnce();
    const logged = JSON.parse((console.error as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(logged.level).toBe("error");
    expect(logged.event).toBe("test.error");
  });

  it("treats uppercase LOG_LEVEL=INFO as info and still logs errors", async () => {
    process.env.LOG_LEVEL = "INFO";
    const { logger } = await import("@/lib/logger");
    logger.error("test.uppercase.error");
    logger.info("test.uppercase.info");
    logger.debug("test.uppercase.debug");

    expect(console.error).toHaveBeenCalledOnce();
    const logged = JSON.parse((console.error as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(logged.event).toBe("test.uppercase.error");
    // info is at or above the min level, debug is below it
    expect(console.log).toHaveBeenCalledOnce();
    const infoLogged = JSON.parse((console.log as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(infoLogged.event).toBe("test.uppercase.info");
  });

  it("falls back to info for unrecognized LOG_LEVEL values", async () => {
    process.env.LOG_LEVEL = "garbage";
    const { logger } = await import("@/lib/logger");
    logger.error("test.garbage.error");
    logger.info("test.garbage.info");
    logger.debug("test.garbage.debug");

    expect(console.error).toHaveBeenCalledOnce();
    const logged = JSON.parse((console.error as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(logged.event).toBe("test.garbage.error");
    // info still logs, debug is suppressed by the info fallback
    expect(console.log).toHaveBeenCalledOnce();
    const infoLogged = JSON.parse((console.log as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(infoLogged.event).toBe("test.garbage.info");
  });
});
