"use client";

import dynamic from "next/dynamic";

import { formatNumber, formatPercent, plural } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MIN_RATED, summarizeCalibration } from "./calibration";
import type { RatedAnswer } from "./types";

const CalibrationChart = dynamic(() => import("./calibration-chart"), {
  ssr: false,
  loading: () => <Skeleton aria-hidden="true" className="h-52 w-full rounded-2xl" />,
});

/**
 * The "Confidence" section of the results: how sure the student was against
 * how the answers scored, as plain sentences, a bar chart and a table.
 * Rule-based text, so no AI tag. Nothing is summarised from fewer than
 * MIN_RATED rated answers.
 */
export function CalibrationSection({
  answers,
  pretestCount,
}: {
  answers: readonly RatedAnswer[];
  pretestCount: number;
}) {
  const summary = summarizeCalibration(answers);

  return (
    <section aria-labelledby="confidence-title" className="flex flex-col gap-4">
      <h2 id="confidence-title" className="type-title-l font-bold text-lesson-on-surface">
        Confidence
      </h2>

      {summary.rated === 0 ? (
        <p className="type-body-l text-pretty text-lesson-on-surface">
          No answers were rated. Pick Guessing, Unsure, or Sure before you check an answer, and this section
          compares how sure you were with how you did.
        </p>
      ) : !summary.enough ? (
        <p className="type-body-l text-pretty text-lesson-on-surface">
          {plural(summary.rated, {
            one: "You rated how sure you were on # answer.",
            other: "You rated how sure you were on # answers.",
          })}{" "}
          {`Rate at least ${MIN_RATED} to compare your confidence with your results.`}
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2 type-body-l text-pretty text-lesson-on-surface">
            <p>
              {plural(summary.rated, {
                one: `Your confidence matched your result on ${formatNumber(summary.matched)} of # rated question.`,
                other: `Your confidence matched your result on ${formatNumber(summary.matched)} of # rated questions.`,
              })}
            </p>
            {summary.overconfident > 0 ? (
              <p>
                {plural(summary.overconfident, {
                  one: "Overconfident on # question: you marked it Sure and it wasn't fully correct.",
                  other: "Overconfident on # questions: you marked them Sure and they weren't fully correct.",
                })}{" "}
                Errors you marked Sure come first in Error repair.
              </p>
            ) : null}
            {summary.underconfident > 0 ? (
              <p>
                {plural(summary.underconfident, {
                  one: "Underconfident on # question: you marked it Guessing and it was correct.",
                  other: "Underconfident on # questions: you marked them Guessing and they were correct.",
                })}
              </p>
            ) : summary.guessedRight > 0 ? (
              <p>
                {plural(summary.guessedRight, {
                  one: "Correct on # question you marked Guessing.",
                  other: "Correct on # questions you marked Guessing.",
                })}
              </p>
            ) : null}
          </div>

          <figure className="flex flex-col gap-3">
            <figcaption className="type-title-s font-bold text-lesson-muted">
              How often you were correct, by how sure you were
            </figcaption>
            <CalibrationChart levels={summary.levels} />
          </figure>

          <Table>
            <caption className="sr-only">Correct answers by how sure you were</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">How sure</TableHead>
                <TableHead scope="col" className="text-right">Answers</TableHead>
                <TableHead scope="col" className="text-right">Correct</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.levels.map((level) => (
                <TableRow key={level.level}>
                  <TableHead scope="row">
                    {level.label}
                  </TableHead>
                  <TableCell className="text-right tabular-nums">{level.count}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {level.correctRate != null ? `${level.correct} (${formatPercent(level.correctRate)})` : "Not used"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}

      {(summary.rated > 0 && summary.unrated > 0) || pretestCount > 0 ? (
        <p className="type-body-m text-lesson-muted">
          {[
            summary.rated > 0 && summary.unrated > 0
              ? plural(summary.unrated, {
                  one: "# scored answer wasn't rated.",
                  other: "# scored answers weren't rated.",
                })
              : null,
            pretestCount > 0
              ? plural(pretestCount, {
                  one: "The pretest question isn't included.",
                  other: "Pretest questions aren't included.",
                })
              : null,
          ]
            .filter(Boolean)
            .join(" ")}
        </p>
      ) : null}
    </section>
  );
}
