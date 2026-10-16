import { describe, it, expect } from "vitest";
import { createPlanSchema } from "@/lib/validation";

const validInput = {
  course_name: "CS 2110",
  exam_name: "Prelim 1",
  exam_date: "2024-03-15",
  objectives: ["Loops", "Recursion", "Linked Lists"],
  availability: Array.from({ length: 7 }, () => ({ start: "09:00", end: "17:00" })),
  daily_study_cap_minutes: 180,
  break_protocol_default: "50_10" as const,
};

describe("createPlanSchema", () => {
  it("accepts valid input", () => {
    const result = createPlanSchema.parse(validInput);
    expect(result.course_name).toBe("CS 2110");
    expect(result.objectives).toHaveLength(3);
  });

  it("applies defaults for optional fields", () => {
    const { daily_study_cap_minutes, break_protocol_default, ...rest } = validInput;
    const result = createPlanSchema.parse(rest);
    expect(result.daily_study_cap_minutes).toBe(180);
    expect(result.break_protocol_default).toBe("50_10");
    // No default here: createPlan falls back to the user's timezone setting
    expect(result.timezone).toBeUndefined();
  });

  it("rejects fewer than 3 objectives", () => {
    expect(() =>
      createPlanSchema.parse({ ...validInput, objectives: ["A", "B"] })
    ).toThrow();
  });

  it("rejects invalid exam_date format", () => {
    expect(() =>
      createPlanSchema.parse({ ...validInput, exam_date: "March 15" })
    ).toThrow();
  });

  it("rejects availability with end before start", () => {
    const badAvail = Array.from({ length: 7 }, () => ({
      start: "17:00",
      end: "09:00",
    }));
    expect(() =>
      createPlanSchema.parse({ ...validInput, availability: badAvail })
    ).toThrow();
  });

  it("rejects wrong number of availability days", () => {
    expect(() =>
      createPlanSchema.parse({
        ...validInput,
        availability: [{ start: "09:00", end: "17:00" }],
      })
    ).toThrow();
  });

  it("rejects daily cap below 30", () => {
    expect(() =>
      createPlanSchema.parse({ ...validInput, daily_study_cap_minutes: 10 })
    ).toThrow();
  });

  it("rejects daily cap above 600", () => {
    expect(() =>
      createPlanSchema.parse({ ...validInput, daily_study_cap_minutes: 700 })
    ).toThrow();
  });

  it("rejects invalid break protocol", () => {
    expect(() =>
      createPlanSchema.parse({ ...validInput, break_protocol_default: "invalid" })
    ).toThrow();
  });
});

describe("createPlanSchema messages and replace fields", () => {
  function issues(input: unknown) {
    const result = createPlanSchema.safeParse(input);
    expect(result.success).toBe(false);
    return result.success ? [] : result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  }

  it("names the field and the fix for each rule", () => {
    expect(issues({ ...validInput, course_name: "   " })).toContainEqual({
      path: "course_name",
      message: "Enter a course name.",
    });
    expect(issues({ ...validInput, exam_date: "" })).toContainEqual({
      path: "exam_date",
      message: "Choose the exam date.",
    });
    expect(
      issues({ ...validInput, availability: Array.from({ length: 7 }, () => ({ start: "17:00", end: "09:00" })) })
    ).toContainEqual({ path: "availability", message: "Choose an end time after the start time." });
    expect(issues({ ...validInput, objectives: ["A"] })).toContainEqual({
      path: "objectives",
      message: "Upload materials or type at least 3 topics, one per line.",
    });
  });

  it("trims names and accepts a plan to replace", () => {
    const result = createPlanSchema.parse({
      ...validInput,
      course_name: "  CS 2110 ",
      replace_plan_id: "plan-1",
      remove_replaced_calendar_events: true,
    });
    expect(result.course_name).toBe("CS 2110");
    expect(result.replace_plan_id).toBe("plan-1");
    expect(result.remove_replaced_calendar_events).toBe(true);
  });

  it("does not remove calendar events unless asked", () => {
    expect(createPlanSchema.parse(validInput).remove_replaced_calendar_events).toBe(false);
  });
});
