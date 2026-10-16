import { describe, it, expect } from "vitest";
import { fillMessage, skippedText } from "@/components/session/followup-copy";

/**
 * Why follow-up days fall away: one whole sentence per plural form, with the
 * exam name filled in after the plural is chosen.
 */
const ZONE = "America/New_York";
const day = (date: string) => ({ date, at: `${date}T16:00:00.000Z`, days_from_now: null });

describe("skippedText", () => {
  it("names one skipped day in a singular sentence", () => {
    const text = skippedText({ exam_name: "Prelim 2", items: [day("2026-10-18")], skipped: [day("2026-10-21")] }, ZONE);
    expect(text).toBe("Wed, Oct 21 falls after Prelim 2, so it isn't added.");
  });

  it("lists several skipped days in a plural sentence", () => {
    const text = skippedText(
      { exam_name: "Prelim 2", items: [day("2026-10-18")], skipped: [day("2026-10-21"), day("2026-10-24")] },
      ZONE
    );
    expect(text).toBe("Wed, Oct 21 and Sat, Oct 24 fall after Prelim 2, so they aren't added.");
  });

  it("says there's nothing to add when every day is skipped", () => {
    expect(skippedText({ exam_name: null, items: [], skipped: [day("2026-10-21")] }, ZONE)).toBe(
      "The follow-up date falls after your exam, so there's nothing to add."
    );
    expect(
      skippedText({ exam_name: "Final", items: [], skipped: [day("2026-10-21"), day("2026-10-24")] }, ZONE)
    ).toBe("The follow-up dates fall after Final, so there's nothing to add.");
  });

  it("says a passed day has passed, not that it falls after the exam", () => {
    const past = { ...day("2026-10-14"), reason: "past" as const };
    expect(skippedText({ exam_name: "Prelim 2", items: [day("2026-10-18")], skipped: [past] }, ZONE)).toBe(
      "Wed, Oct 14 has passed, so it isn't added."
    );
    expect(skippedText({ exam_name: "Prelim 2", items: [], skipped: [past, { ...day("2026-10-16"), reason: "past" }] }, ZONE)).toBe(
      "The follow-up dates have passed, so there's nothing to add."
    );
  });

  it("gives each reason its own sentence", () => {
    const text = skippedText(
      {
        exam_name: "Prelim 2",
        items: [],
        skipped: [{ ...day("2026-10-14"), reason: "past" }, { ...day("2026-10-21"), reason: "past_exam" }],
      },
      ZONE
    );
    expect(text).toBe("Wed, Oct 21 falls after Prelim 2, so it isn't added. Wed, Oct 14 has passed, so it isn't added.");
  });

  it("keeps a # in the exam name", () => {
    const text = skippedText({ exam_name: "Prelim #2", items: [day("2026-10-18")], skipped: [day("2026-10-21")] }, ZONE);
    expect(text).toBe("Wed, Oct 21 falls after Prelim #2, so it isn't added.");
  });
});

describe("fillMessage", () => {
  it("fills each placeholder once and leaves unknown ones", () => {
    expect(fillMessage("{a} and {b}", { a: "{b}" })).toBe("{b} and {b}");
  });
});
