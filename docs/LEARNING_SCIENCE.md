# The Learning Science Behind Study-Bot

Study-Bot is built on a specific claim: most studying fails not because students
don't work hard, but because the default techniques (rereading, highlighting,
passive review) are among the worst-performing strategies in the experimental
literature, while the best-performing ones (retrieval practice, spacing,
interleaving) feel worse than they work and so are rarely chosen voluntarily.

This document exists so you don't have to take that claim on faith. Each
section covers one principle: the research (who showed it, when, and how big
the effect is), how Study-Bot implements it at the feature level, and the
boundary conditions — the situations where the principle stops helping and
where the app deliberately does *not* apply it. The boundary conditions are
not fine print; most of these techniques have well-documented failure modes,
and a tool that ignores them implements the citation, not the finding.

Contents:

1. [Retrieval practice (the testing effect)](#1-retrieval-practice-the-testing-effect)
2. [Deliberate practice and the feedback loop](#2-deliberate-practice-and-the-feedback-loop)
3. [Elaborated feedback](#3-elaborated-feedback)
4. [Hypercorrection: confident errors are the highest-value corrections](#4-hypercorrection-confident-errors-are-the-highest-value-corrections)
5. [Spacing (distributed practice)](#5-spacing-distributed-practice)
6. [Successive relearning: one correct answer is not repair](#6-successive-relearning-one-correct-answer-is-not-repair)
7. [Interleaving](#7-interleaving)
8. [Pretesting](#8-pretesting)
9. [Worked examples with backward fading](#9-worked-examples-with-backward-fading)
10. [Self-explanation](#10-self-explanation)
11. [Calibration and metacognition](#11-calibration-and-metacognition)
12. [Desirable difficulties](#12-desirable-difficulties)
13. [A cognitive-load-minimal interface](#13-a-cognitive-load-minimal-interface)
14. [Honest limitations](#14-honest-limitations)

---

## 1. Retrieval practice (the testing effect)

**The research.** Actively recalling information strengthens memory far more
than re-exposure to it. Roediger & Karpicke (2006) showed practice testing
beat repeated studying by roughly 50% in relative retention at a one-week
delay — even though the restudy group *predicted* they would do better.
Dunlosky, Rawson, Marsh, Nathan & Willingham (2013, *Psychological Science in
the Public Interest*) rated practice testing one of only two "high utility"
techniques out of ten reviewed. Meta-analytically, Adesope, Trevisan &
Sundararajan (2017, *Review of Educational Research*; 272 effects across 188
experiments) found g = 0.61 overall, and +0.51 against restudy specifically.
The benefit is largest on *delayed* tests — which is what an exam is.

**In Study-Bot.** Retrieval is the default interaction everywhere. Study
sessions are decks of questions, not pages of notes: free-recall prompts and
multiple-choice questions generated from your uploaded course materials (with
misconception-based distractors), or deterministic prompt templates when no
materials are uploaded. The answer is never shown before a committed attempt —
there is no "flip to reveal" without answering first, and the runner's
no-leakage guardrail ensures no excerpts, hints, or citations from your
materials render before you submit (verified by an end-to-end test). Because
MCQ practice without feedback actively teaches the distractors as facts
(Roediger & Marsh 2005; Butler & Roediger 2008, *Memory & Cognition*), every
MCQ item closes with confirmation of the correct answer plus a rationale for
why the chosen distractor is wrong — including in exam simulation, where the
review phase is a forced step, not an optional screen.

**Boundary conditions.** The testing effect shrinks when retrieval success is
very low — failing constantly with no support is not practice, it's noise.
Study-Bot counteracts this with adaptive difficulty (section 12), warm-up
review of due material at session start, and worked examples (section 9) for
first exposure to procedural topics. Corrective feedback is treated as
non-optional: an unanswered or unconfirmed question never ends an item.

## 2. Deliberate practice and the feedback loop

**The research.** Ericsson, Krampe & Tesch-Römer (1993, *Psychological Review*
100(3), 363–406) defined deliberate practice as well-defined tasks slightly
beyond current ability, with informative feedback and opportunities for
repetition and error correction. The popularized "10,000 hours" framing drops
the load-bearing part: hours only count when structured as feedback-bearing
loops. On timing, Kulik & Kulik's (1988, *Review of Educational Research*
58(1), 79–97) meta-analysis of 53 studies found that in applied settings with
real materials, *immediate* feedback wins; the oft-cited lab advantage for
delayed feedback is largely a methodological artifact of artificial
list-learning paradigms. Corbett & Anderson's cognitive-tutor experiments
(CHI 2001) showed immediate feedback minimizes time-to-mastery at no cost to
final performance. Shute (2008, *Review of Educational Research* 78, 153–189)
adds the moderators: immediate feedback is most valuable for difficult tasks
and struggling learners, and feedback should come in small, focused units.

**In Study-Bot.** Every practice item is a closed loop: a committed attempt, a
score, elaborated feedback in the same interaction, and then an active
correction step — a miss requires you to write a correction rule in your own
words, and a variant question testing the same point is injected later into
the same session (capped at four injected variants per session so the deck
stays bounded). Feedback is generated and persisted per attempt, so it
survives page refresh instead of being regenerated or lost. Prompt selection
targets a difficulty band of roughly 70–85% success (section 12), which is
the "slightly beyond current ability" condition made operational.

**Boundary conditions.** Delayed feedback is used in exactly one place:
`EXAM_SIM` mode, where scoring is withheld until the review phase because the
point of that mode is simulating test conditions and exercising
self-monitoring — not because delay helps learning. The genuine benefit that
delayed feedback shows in some studies is spacing in disguise (Butler &
Roediger 2008; Metcalfe, Kornell & Finn 2009), and Study-Bot captures that
benefit the honest way: immediate feedback on every attempt *plus* scheduled
re-encounters of missed items (variants in-session, repair prompts and due
warm-ups in later sessions) rather than by withholding answers.

## 3. Elaborated feedback

**The research.** What feedback *says* matters as much as when it arrives.
Van der Kleij, Feskens & Eggen's (2015, *Review of Educational Research*
85(4)) meta-analysis of computer-based learning found elaborated feedback
(explaining *why*) produced g = 0.49, versus 0.32 for showing the correct
answer and only 0.05 for bare right/wrong verification — roughly an order of
magnitude difference between explanation and verification. Shute (2008)
reaches the same conclusion. Kluger & DeNisi (1996, *Psychological Bulletin*
119, 254–284; 607 effect sizes) supply the critical warning: over a third of
feedback interventions *decrease* performance, reliably the ones that direct
attention to the self (praise, grades, person-level judgment) rather than the
task.

**In Study-Bot.** A wrong or partial answer never gets a bare "incorrect."
The feedback panel stacks: cited excerpts retrieved from your own uploaded
course materials (with source and page), an explanation of the specific gap
in your answer, a key takeaway, a memory aid when the concept is easily
confused, and — for MCQ — the rationale for the specific distractor you chose.
If you show a repeated pattern of similar errors, the feedback addresses the
pattern directly. All templates are task-focused by design: what was wrong,
why, what to do differently — no personality praise, no normative comparison.
Correct answers get lighter treatment (brief reinforcement and a concept
connection) rather than a full explanation.

**Boundary conditions.** Elaboration's advantage is largest for conceptual,
higher-order material, so the explanation budget is spent on misses and
partial answers; confirming a correct simple fact does not trigger the full
apparatus. Feedback is grounded in retrieved excerpts from your materials and
cites them precisely so you can check the explanation against the source
rather than trusting generated text.

## 4. Hypercorrection: confident errors are the highest-value corrections

**The research.** Butterfield & Metcalfe (2001, *JEP: Learning, Memory &
Cognition* 27, 1491–1494) found that errors committed with *high* confidence
are, after corrective feedback, better corrected than low-confidence errors —
the surprise of being confidently wrong captures attention and makes the
correction salient (Fazio & Marsh 2009). But there is a catch: Butler, Fazio
& Marsh (2011, *Psychonomic Bulletin & Review* 18, 1238–1244) showed that at
a delay, the original high-confidence errors tend to re-intrude — a single
successful correction is not durable repair.

**In Study-Bot.** The app captures a 1–5 confidence rating before you see the
answer. Confidence is stored on the attempt and, when the answer is wrong, on
the resulting error log, and it flows through three mechanisms. First,
feedback framing: when you were confident (4–5) and wrong, the explanation
opens by explicitly flagging the mismatch and delivers the fullest, most
memorable correction — that is the hypercorrection window, used on purpose.
Low-confidence misses are framed as expected gap-filling instead. Second,
prioritization: confident misses are ordered first when building
`ERROR_REPAIR` decks and when the per-session variant cap forces a choice
about which errors get re-tested. Third, the SM-2 mastery engine penalizes
the confident-but-wrong pattern (a "blind spot") so the objective resurfaces
sooner.

**Boundary conditions.** Because hypercorrected errors resurface at a delay,
a confident miss is never considered fixed after one correction — it enters
the same successive-relearning criterion as every other error (two correct
retrievals on different days, section 6), and its priority ordering means it
actually receives those re-encounters. Confidence is never fabricated: if you
skip the rating, no default is invented, because a made-up value would corrupt
both the calibration dashboard and the mastery adjustment.

## 5. Spacing (distributed practice)

**The research.** Distributed practice is the second of Dunlosky et al.'s
(2013) two "high utility" techniques. Cepeda, Pashler, Vul, Wixted & Rohrer's
(2006) meta-analysis found spaced practice beats massed practice across 254
studies. Cepeda et al. (2008, *Psychological Science*) established the
practical rule: the optimal gap between sessions is roughly 10–20% of the
desired retention interval, gaps that are too short cost more than gaps that
are too long — and, importantly, if the test is within about a day,
compressed review actually wins.

**In Study-Bot.** Spacing runs on an SM-2-style scheduler at the level of
learning objectives: each objective tracks ease factor, interval, and
repetitions, updated from your per-objective accuracy after every run (with
confidence-weighted quality adjustment — see section 11). The scheduler is
exam-aware, implementing Cepeda's compression directly: with more than two
weeks to the exam, intervals are capped at ~20% of the remaining days; inside
two weeks the cap tightens to 3 days, inside a week to 2 days, and with 1–3
days left everything reviews daily. Objectives that come due resurface
automatically as warm-up prompts at the start of your next run. Flashcard
decks (including cards auto-generated from your errors) run their own SM-2
schedule under the same exam-aware compression policy, with one addition: a
failed card returns in 10 minutes within the same sitting. Each completed
session ends with concrete follow-up recommendations derived from the actual
SM-2 due dates of the objectives you just studied; when no mastery data
exists yet, they fall back to accuracy brackets (below 70%: return in 1 and 2
days; 70–85%: 2 and 4 days; above 85%: 3 and 6 days). The week planner
schedules sessions from the exam date backwards on the same logic.

**Boundary conditions.** Spacing is deliberately abandoned when it would
hurt: the exam-aware compression means that the night before a test the
scheduler stops stretching intervals and pulls everything into daily review —
cramming genuinely wins for a test within ~24 hours, and pretending otherwise
would be ideology, not science. A gap so long that retrieval fails outright
is wasted time unless followed by relearning, which is why failed reviews
reset to short intervals rather than continuing to stretch.

## 6. Successive relearning: one correct answer is not repair

**The research.** Rawson & Dunlosky (2011, *JEP: General*, "How much is
enough?") and Rawson, Dunlosky & Sciartelli (2013, *Educational Psychology
Review*) combined the two high-utility techniques into a single prescription:
retrieve each item to criterion, then *relearn* it to criterion in several
widely spaced sessions. In real course studies this produced gains on the
order of a letter grade on targeted exam content, at low added time cost.
The key insight is that mastery is defined by correct retrievals across
separate sessions, not by items seen or minutes spent.

**In Study-Bot.** Errors are governed by a cross-day criterion: an error log
is only marked resolved after **two correct retrievals on different days**.
Each error tracks a correct streak with the date of the last success; a
correct answer on the same calendar day as the previous one doesn't advance
the streak, and the streak resets if you miss the item again. Until resolved,
the error keeps feeding the repair machinery: an in-session variant question
after the initial miss, cross-session repair prompts prepended to later runs,
dedicated `ERROR_REPAIR` sessions, and an auto-generated flashcard. Objective
mastery similarly requires at least three successful spaced repetitions
before an objective is reported as mastered.

**Boundary conditions.** Piling extra correct recalls into a *single* session
(overlearning) yields sharply diminishing returns (Rohrer & Taylor 2006), so
Study-Bot does not demand within-session drilling to high streaks — the
criterion is deliberately spent across days, where the payoff is. The
same-day guard exists precisely so you cannot "resolve" an error by answering
it twice in one sitting.

## 7. Interleaving

**The research.** Mixing related problem types during practice, instead of
blocking them (AAA-BBB-CCC), forces the learner to *choose* the right approach
rather than just execute the obvious one. Rohrer & Taylor (2007) found
interleaved math practice roughly doubled delayed test scores versus blocked
practice; a classroom randomized controlled trial (Rohrer, Dedrick, Hartwig &
Cheung 2020, *JEP: Applied*) found d = 0.83. Brunmair & Richter's (2019,
*Psychological Bulletin*) meta-analysis puts the overall effect at g = 0.42,
strongest for confusable, similar categories. Kornell & Bjork (2008,
*Psychological Science*) documented the trap: learners judge blocked practice
as more effective even while interleaving produces better learning.

**In Study-Bot.** `INTERLEAVED_PRACTICE` mode distributes prompts round-robin
across the session's objectives using a deterministic seeded shuffle, with a
hard guarantee of no more than two consecutive prompts from the same objective
(when the session has two or more objectives). AI-generated decks — which
arrive grouped by objective and would otherwise be blocked practice — are
re-interleaved through the same machinery before the run starts, so the
guarantee holds regardless of how the deck was produced.

**Boundary conditions.** Interleaving helps discrimination between *similar*
categories and does nothing (or harms) for unrelated content, so Study-Bot
interleaves within a session's related objectives — it never shuffles across
unrelated courses. Expect interleaved sessions to feel harder and produce
lower in-session accuracy than blocked practice would; that is the mechanism
working, not the feature failing, and delayed retention is the metric that
matters.

## 8. Pretesting

**The research.** Attempting to answer questions *before* studying the
material — even when the guesses are wrong — improves subsequent learning
compared to spending the same time studying (Richland, Kornell & Kao 2009,
*JEP: Applied* 15, 243–257; Kornell, Hays & Bjork 2009, *JEP: LMC* 35,
989–998). The failed attempt appears to prime the learner for the correct
answer. The technique depends entirely on prompt corrective feedback:
errorful guessing without seeing the right answer is risky.

**In Study-Bot.** When a run includes objectives you have never studied, up
to two diagnostic pretest prompts are prepended to the deck, marked
internally as pretest items. Wrong answers on them are the expected outcome,
and they are treated accordingly — the item closes with the correct-answer
framing so the loop still ends on the right information.

**Boundary conditions.** Pretest items are **quarantined from grading**: they
do not require an error log (there is no misconception to repair in material
you've never seen), and they are excluded from the accuracy metrics that
drive adaptive difficulty and from the mastery/scheduling machinery. The
quarantine is enforced server-side against the stored prompt metadata, not
trusted from the client. Without this quarantine, pretesting would punish
exactly the productive errors it depends on — dragging difficulty down,
minting spurious flashcards, and teaching users that pretesting "hurts their
score," a misjudgment learners are already prone to (Pan & Sana 2021).

## 9. Worked examples with backward fading

**The research.** For novices learning procedures, studying a fully worked
solution beats solving the equivalent problem — the worked-example effect
(Sweller & Cooper 1985), a core prediction of cognitive load theory. Renkl,
Atkinson & Große (2002–2004) showed the best transition off examples is
*backward fading*: remove the final solution step first and have the learner
supply it, then the final two, and so on — rather than jumping abruptly from
example to full problem. Kalyuga, Ayres, Chandler & Sweller (2003,
*Educational Psychologist*) documented the expertise-reversal effect: the
same worked examples that help novices actively *hurt* learners with higher
prior knowledge, for whom retrieval and problem solving are superior.

**In Study-Bot.** `WORKED_EXAMPLES` mode generates example sets grounded in
your uploaded course materials. Each set follows the backward-fading sequence
in full: (1) a complete worked example with 3–5 ordered solution steps, each
stating both the action and the principle from the material that licenses it;
(2) a completion problem of the same structure with the *final* step missing;
(3) a completion problem with the final *two* steps missing; (4) a novel
near-transfer problem with no steps given, checked against a model answer.
Completion problems reuse the same problem structure with different surface
values, so what fades is support, not the concept. Steps pair with
self-explanation prompts (section 10), because passively read examples lose
most of their benefit.

**Boundary conditions.** Worked examples are a novice-phase tool, not a
review mode — this is the expertise-reversal boundary taken seriously. The
fading sequence itself walks you off the scaffolding within a single session,
ending at unaided problem solving; and once material has been studied,
retrieval-based modes remain the default for review. The mode targets
procedural and quantitative content, where the effect is established; it is
not used as a substitute for retrieval practice on declarative material.

## 10. Self-explanation

**The research.** Chi, Bassok, Lewis, Reimann & Glaser (1989, *Cognitive
Science*) found that the students who learned most from worked examples were
the ones who spontaneously explained each step to themselves; Chi et al.
(1994) showed that *prompting* self-explanation confers the benefit on
everyone else. Bisra, Liu, Nesbit, Salimi & Winne's (2018, *Educational
Psychology Review*) meta-analysis estimates g ≈ 0.55. Dunlosky et al. (2013)
rate it moderate utility — promising, with the caveat that it is
time-expensive.

**In Study-Bot.** The post-answer review panel invites two generative acts,
both persisted on the attempt: an explain-back ("restate the key concept as
if teaching a friend") and creating your own example of the concept. The
feedback for conceptual items also poses a Socratic follow-up question — and
it has an answer field, so the elaboration loop closes with your own words
rather than ending at a rhetorical question. In `WORKED_EXAMPLES` mode,
solution steps carry "why does this step follow?" prompts.

**Boundary conditions.** Self-explanation prompts are hidden until after the
attempt (an explanation you can copy from visible text is transcription, not
generation). Because the technique is time-expensive, it is positioned in the
review phase and kept optional — it is worth the minutes on conceptual
material and first-time errors, not on every flashcard flip.

## 11. Calibration and metacognition

**The research.** Students are systematically overconfident about what they
know, and it is not a harmless bias: Dunlosky & Rawson (2012, *Learning and
Instruction*, "Overconfidence produces underachievement") showed that lenient
self-scoring leads students to drop items too early and retain less.
Judgments of learning made immediately after study are inflated relative to
delayed ones (Nelson & Dunlosky 1991, *Psychological Science*), and the
weakest performers are the most miscalibrated (Kruger & Dunning 1999).
Self-scoring without an answer standard is systematically lenient.

**In Study-Bot.** Three mechanisms. First, confidence ratings are collected
*before* the answer is revealed, so the judgment cannot be contaminated by
hindsight. Second, generated prompts carry a model answer and explicit key
points, surfaced after your answer is committed and before you self-score —
you grade yourself against a standard, point by point, not against a feeling.
Third, the end-of-session screen includes a calibration dashboard comparing
your stated confidence to your actual accuracy, counting overconfident and
underconfident answers, so the gap is visible and trackable over time. The
gap also feeds the scheduler: confident-but-wrong objectives are penalized in
SM-2 quality (resurfacing sooner), and correct-but-unsure answers advance more
slowly, since hesitant knowledge is fragile knowledge.

**Boundary conditions.** Calibration data is only as honest as the inputs, so
the app refuses to invent a confidence value when you skip the rating. MCQ
attempts are graded by the server against the stored answer key rather than
self-scored at all. Self-scoring of free recall remains self-scoring — the
model-answer standard makes leniency harder, not impossible (see section 14).

## 12. Desirable difficulties

**The research.** Bjork & Bjork's desirable-difficulties framework (1992,
2011) holds that conditions that slow apparent learning — spacing,
interleaving, testing, generation — often improve long-term retention, while
conditions that feel fluent (rereading, blocked drill) inflate confidence
without durable learning. Roediger & Karpicke (2006) captured it directly:
the restudy group predicted better performance and did worse. Learners
misread effort as ineffectiveness and abandon what works (Kirk-Johnson,
Galla & Fraundorf 2019). Ericsson's difficulty condition (section 2) supplies
the target: practice slightly beyond current ability.

**In Study-Bot.** The app aims to keep you in a success band of roughly
70–85% — hard enough to be worth doing, achievable enough that feedback loops
close on success. When your running accuracy climbs past 85%, follow-up
sessions stretch further out; when it exceeds 80% in-session, the runner
swaps upcoming prompts for harder variants of the same objectives. Every
structural choice in the app — questions before notes, mixed rather than
blocked decks, gaps rather than cramming, generation rather than recognition
— is a difficulty chosen on purpose.

**Boundary conditions.** Difficulty is only desirable when the learner can
eventually succeed and gets feedback. When accuracy falls, the app eases off
rather than doubling down: below 70%, follow-up gaps compress to 1–2 days;
failed objectives reset to short intervals; warm-ups re-expose due material
before new questions; and worked examples exist precisely for the case where
retrieval-first would mean drowning. Difficulty caused by confusing materials
or near-zero success is not desirable — it is just failure.

## 13. A cognitive-load-minimal interface

**The research.** Working memory is small and fixed (Cowan 2001: ~4 chunks),
and cognitive load theory (Sweller 1988) partitions its use into load that
builds understanding and load that the interface wastes. Mayer's multimedia
principles quantify the waste: removing interesting-but-irrelevant material
helps learning with a median d = 0.86 (coherence principle); placing
explanations physically adjacent to what they explain, d = 0.79 (spatial
contiguity); visually cueing the essential structure, d = 0.46 (signaling).
Seductive-details meta-analyses (Rey 2012; Sundararajan & Adesope 2020)
show decorations and asides measurably reduce retention and transfer.

**In Study-Bot.** The practice screen is built around the question: one
prompt per screen, the question stem at the top of the visual hierarchy, a
thin progress indicator ("k of N" with a bar) at the edge, and no decorative
elements between question and answer. Feedback obeys spatial contiguity —
your answer, the model answer, the explanation, and the cited excerpts stack
in one vertical block in the same region, not in a modal or a separate
results page. The loop is built for repetition: answers submit from the
keyboard, progress persists after every attempt so a refresh or crash loses
nothing, and the next prompt follows without interstitials. Gamification
exists (XP, achievements, streak-based milestones) but is awarded at
completion boundaries — a finished session, a completed deck — and none of it
renders inside the question–answer loop, where it would compete for exactly
the attention retrieval needs.

**Boundary conditions.** Session-level structure that serves the pedagogy is
kept even though it adds elements: the preflight screen's closed-book
commitments, break screens on the Pomodoro-style protocols (work/break cycles
that gate attempt submission), and the end-of-session dashboard with score
breakdown and calibration — all deliberately placed *outside* the answer
loop, before or after, never during.

## 14. Honest limitations

A document like this earns trust by stating what the evidence and the
implementation do not support.

- **Effect sizes are averages.** The meta-analytic values quoted (g = 0.42 to
  0.86 depending on technique) are central tendencies across populations,
  materials, and delays. Your mileage will vary with course, prior knowledge,
  and honesty of use.
- **Free-recall self-scoring is still self-scoring.** The model-answer
  standard and calibration dashboard make lenient grading visible and harder,
  but a student determined to grade "correct" on a vague answer can. MCQ
  items are server-graded; free recall is not.
- **Generated content should be spot-checked.** Questions, model answers,
  worked-example steps, and feedback are grounded in retrieved excerpts from
  your uploaded materials and cite their sources precisely so you can verify
  them. Grounding sharply reduces, but does not eliminate, the possibility of
  a generated error — the citations exist so you never have to take the
  explanation's word for it.
- **The scheduler proposes; you dispose.** Spacing only works if the later
  sessions happen. The planner, calendar sync, and follow-up recommendations
  lower the friction of showing up on schedule, but no algorithm retrieves a
  memory on your behalf.
- **Two spacing engines coexist.** Objective-level mastery and flashcard
  scheduling share the same exam-aware compression policy but are tracked
  separately: a flashcard review does not currently advance the corresponding
  objective's mastery record. Fully unifying them is on the roadmap.

## References

Adesope, O. O., Trevisan, D. A., & Sundararajan, N. (2017). Rethinking the use of tests: A meta-analysis of practice testing. *Review of Educational Research*, 87(3).
Bisra, K., Liu, Q., Nesbit, J. C., Salimi, F., & Winne, P. H. (2018). Inducing self-explanation: A meta-analysis. *Educational Psychology Review*, 30.
Bjork, R. A., & Bjork, E. L. (1992; 2011). Desirable difficulties in theory and practice.
Brunmair, M., & Richter, T. (2019). Similarity matters: A meta-analysis of interleaved learning. *Psychological Bulletin*, 145(11).
Butler, A. C., Fazio, L. K., & Marsh, E. J. (2011). The hypercorrection effect persists over a week, but high-confidence errors return. *Psychonomic Bulletin & Review*, 18, 1238–1244.
Butler, A. C., & Roediger, H. L. (2008). Feedback enhances the positive effects and reduces the negative effects of multiple-choice testing. *Memory & Cognition*, 36, 604–616.
Butterfield, B., & Metcalfe, J. (2001). Errors committed with high confidence are hypercorrected. *JEP: Learning, Memory, and Cognition*, 27, 1491–1494.
Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., & Rohrer, D. (2006). Distributed practice in verbal recall tasks: A review and quantitative synthesis. *Psychological Bulletin*, 132(3).
Cepeda, N. J., Vul, E., Rohrer, D., Wixted, J. T., & Pashler, H. (2008). Spacing effects in learning: A temporal ridgeline of optimal retention. *Psychological Science*, 19(11).
Chi, M. T. H., Bassok, M., Lewis, M. W., Reimann, P., & Glaser, R. (1989). Self-explanations: How students study and use examples in learning to solve problems. *Cognitive Science*, 13.
Corbett, A. T., & Anderson, J. R. (2001). Locus of feedback control in computer-based tutoring. *Proceedings of CHI 2001*.
Dunlosky, J., & Rawson, K. A. (2012). Overconfidence produces underachievement. *Learning and Instruction*, 22.
Dunlosky, J., Rawson, K. A., Marsh, E. J., Nathan, M. J., & Willingham, D. T. (2013). Improving students' learning with effective learning techniques. *Psychological Science in the Public Interest*, 14(1).
Ericsson, K. A., Krampe, R. T., & Tesch-Römer, C. (1993). The role of deliberate practice in the acquisition of expert performance. *Psychological Review*, 100(3), 363–406.
Fazio, L. K., & Marsh, E. J. (2009). Surprising feedback improves later memory. *Psychonomic Bulletin & Review*, 16.
Kalyuga, S., Ayres, P., Chandler, P., & Sweller, J. (2003). The expertise reversal effect. *Educational Psychologist*, 38(1).
Kluger, A. N., & DeNisi, A. (1996). The effects of feedback interventions on performance. *Psychological Bulletin*, 119, 254–284.
Kornell, N., & Bjork, R. A. (2008). Learning concepts and categories: Is spacing the "enemy of induction"? *Psychological Science*, 19(6).
Kornell, N., Hays, M. J., & Bjork, R. A. (2009). Unsuccessful retrieval attempts enhance subsequent learning. *JEP: Learning, Memory, and Cognition*, 35, 989–998.
Kulik, J. A., & Kulik, C.-L. C. (1988). Timing of feedback and verbal learning. *Review of Educational Research*, 58(1), 79–97.
Metcalfe, J., Kornell, N., & Finn, B. (2009). Delayed versus immediate feedback in children's and adults' vocabulary learning. *Memory & Cognition*, 37, 1077–1087.
Nelson, T. O., & Dunlosky, J. (1991). The delayed-JOL effect. *Psychological Science*, 2(4).
Pan, S. C., & Sana, F. (2021). Pretesting versus posttesting: Comparing the pedagogical benefits of errorful generation and retrieval practice. *JEP: Applied*, 27(2).
Rawson, K. A., & Dunlosky, J. (2011). Optimizing schedules of retrieval practice for durable and efficient learning: How much is enough? *JEP: General*, 140(3).
Rawson, K. A., Dunlosky, J., & Sciartelli, S. M. (2013). The power of successive relearning. *Educational Psychology Review*, 25.
Renkl, A., Atkinson, R. K., & Große, C. S. (2002–2004). Backward fading of worked-out solution steps.
Richland, L. E., Kornell, N., & Kao, L. S. (2009). The pretesting effect: Do unsuccessful retrieval attempts enhance learning? *JEP: Applied*, 15, 243–257.
Roediger, H. L., & Karpicke, J. D. (2006). Test-enhanced learning: Taking memory tests improves long-term retention. *Psychological Science*, 17(3).
Roediger, H. L., & Marsh, E. J. (2005). The positive and negative consequences of multiple-choice testing. *JEP: Learning, Memory, and Cognition*, 31.
Rohrer, D., Dedrick, R. F., Hartwig, M. K., & Cheung, C.-N. (2020). A randomized controlled trial of interleaved mathematics practice. *JEP: Applied*, 26(1).
Rohrer, D., & Taylor, K. (2007). The shuffling of mathematics problems improves learning. *Instructional Science*, 35.
Shute, V. J. (2008). Focus on formative feedback. *Review of Educational Research*, 78, 153–189.
Sundararajan, N., & Adesope, O. (2020). Keep it coherent: A meta-analysis of the seductive details effect. *Educational Psychology Review*, 32.
Sweller, J. (1988). Cognitive load during problem solving. *Cognitive Science*, 12.
Sweller, J., & Cooper, G. A. (1985). The use of worked examples as a substitute for problem solving in learning algebra. *Cognition and Instruction*, 2(1).
Van der Kleij, F. M., Feskens, R. C. W., & Eggen, T. J. H. M. (2015). Effects of feedback in a computer-based learning environment on students' learning outcomes: A meta-analysis. *Review of Educational Research*, 85(4).
