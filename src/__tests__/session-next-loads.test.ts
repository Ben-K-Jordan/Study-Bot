import { describe, it, expect } from "vitest";
import { nextLoads } from "@/components/session/next-loads";

/**
 * After an answer is saved: feedback never waits on the next question,
 * except in exam answering, which shows no feedback.
 */
describe("nextLoads", () => {
  it("loads the next question in the background after an answer with feedback", () => {
    expect(nextLoads({ completed: false, index: 3, promptCount: 8, phase: "ACTIVE", previousPhase: "ACTIVE" })).toEqual({
      nextIndex: 3,
      awaitNext: false,
      scoringBegins: false,
      deckFallback: false,
    });
  });

  it("waits for the next question while answering an exam simulation", () => {
    expect(nextLoads({ completed: false, index: 3, promptCount: 8, phase: "EXAM", previousPhase: "EXAM" })).toEqual({
      nextIndex: 3,
      awaitNext: true,
      scoringBegins: false,
      deckFallback: true,
    });
  });

  it("starts scoring after the last exam answer without waiting", () => {
    expect(nextLoads({ completed: false, index: 0, promptCount: 8, phase: "REVIEW", previousPhase: "EXAM" })).toEqual({
      nextIndex: 0,
      awaitNext: false,
      scoringBegins: true,
      deckFallback: false,
    });
  });

  it("loads nothing once the run is done with questions", () => {
    expect(nextLoads({ completed: true, index: 7, promptCount: 8, phase: "COMPLETE", previousPhase: "ACTIVE" }).nextIndex).toBeNull();
    expect(nextLoads({ completed: false, index: 8, promptCount: 8, phase: "ACTIVE", previousPhase: "ACTIVE" })).toEqual({
      nextIndex: null,
      awaitNext: false,
      scoringBegins: false,
      deckFallback: false,
    });
  });

  // The start-time deck has no answer keys, and adaptation can swap the
  // question the server grades, so it may stand in for a failed load only
  // while answering an exam simulation.
  it("never falls back to the start-time deck outside exam answering", () => {
    const scoring = nextLoads({ completed: false, index: 1, promptCount: 8, phase: "REVIEW", previousPhase: "REVIEW" });
    expect(scoring.deckFallback).toBe(false);
    const retrieval = nextLoads({ completed: false, index: 4, promptCount: 8, phase: "ACTIVE", previousPhase: "ACTIVE" });
    expect(retrieval.deckFallback).toBe(false);
    const exam = nextLoads({ completed: false, index: 4, promptCount: 8, phase: "EXAM", previousPhase: "EXAM" });
    expect(exam).toMatchObject({ awaitNext: true, deckFallback: true });
  });
});
