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
});
