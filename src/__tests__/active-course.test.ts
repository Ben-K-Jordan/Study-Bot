import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  };
}

async function loadWith(storage: ReturnType<typeof memoryStorage> | { getItem: () => never }) {
  vi.resetModules();
  vi.stubGlobal("window", {
    localStorage: storage,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  return import("@/hooks/use-active-course");
}

describe("course keys", () => {
  it("joins and splits Course||Exam", async () => {
    const { courseKey, parseCourseKey } = await import("@/hooks/use-active-course");
    expect(courseKey("CS 2110", "Prelim 1")).toBe("CS 2110||Prelim 1");
    expect(courseKey("CS 2110", null)).toBe("CS 2110");
    expect(parseCourseKey("CS 2110||Prelim 1")).toEqual({ courseName: "CS 2110", examName: "Prelim 1" });
    expect(parseCourseKey("CS 2110")).toEqual({ courseName: "CS 2110", examName: null });
  });
});

describe("stored active course", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("migrates the old key once and removes it", async () => {
    const storage = memoryStorage({ study_bot_active_course: "Bio||Midterm" });
    const mod = await loadWith(storage);
    expect(mod.getStoredActiveCourse()).toBe("Bio||Midterm");
    expect(storage.dump()).toEqual({
      [mod.ACTIVE_COURSE_KEY]: JSON.stringify({ course: "Bio||Midterm" }),
    });
  });

  it("prefers the versioned key over the old one", async () => {
    const storage = memoryStorage({
      "study-bot:active-course:v1": JSON.stringify({ course: "CS 2110" }),
      study_bot_active_course: "Old course",
    });
    const mod = await loadWith(storage);
    expect(mod.getStoredActiveCourse()).toBe("CS 2110");
  });

  it("writes through the setter and clears with null", async () => {
    const storage = memoryStorage();
    const mod = await loadWith(storage);
    mod.storeActiveCourse("Chem||Final");
    expect(mod.getStoredActiveCourse()).toBe("Chem||Final");
    expect(JSON.parse(storage.getItem(mod.ACTIVE_COURSE_KEY)!)).toEqual({ course: "Chem||Final" });
    mod.storeActiveCourse(null);
    expect(storage.getItem(mod.ACTIVE_COURSE_KEY)).toBeNull();
  });

  it("survives blocked or corrupt storage", async () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    const mod = await loadWith(blocked);
    expect(mod.getStoredActiveCourse()).toBeNull();

    const corrupt = memoryStorage({ "study-bot:active-course:v1": "{not json" });
    const again = await loadWith(corrupt);
    expect(again.getStoredActiveCourse()).toBeNull();
  });
});
