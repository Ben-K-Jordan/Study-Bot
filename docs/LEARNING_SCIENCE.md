# The learning science behind Study Bot

Study Bot is built on one claim. Students who work hard still fall short when
they use the default techniques (rereading, highlighting, passive review),
which are among the worst-performing strategies in the experimental
literature. The best-performing ones (retrieval practice, spacing,
interleaving) feel less effective than they are, so students rarely choose
them on their own.

This document lays out the evidence for that claim. Each section covers one
principle: the research (who showed it, when, and how big the effect is), how
Study Bot implements it, and the boundary conditions, meaning the situations
where the principle stops helping and the app deliberately doesn't apply it.
Most of these techniques have documented failure modes, so the boundary
conditions get as much space as the benefits.

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
delay, even though the restudy group *predicted* they would do better.
Dunlosky, Rawson, Marsh, Nathan & Willingham (2013, *Psychological Science in
the Public Interest*) rated practice testing one of only two "high utility"
techniques out of ten reviewed. Meta-analytically, Adesope, Trevisan &
Sundararajan (2017, *Review of Educational Research*; 272 effects across 188
experiments) found g = 0.61 overall, and +0.51 against restudy specifically.
The benefit is largest on *delayed* tests, and an exam is a delayed test.

**In Study Bot.** Retrieval is the default interaction everywhere. A study
session is a set of questions: free recall and multiple choice questions
generated from your uploaded course materials, with distractors built from
common misconceptions and from your own unresolved errors. When your
materials have fewer than two passages on the session's topics, or no AI
provider is set, the session uses deterministic question templates instead.
The answer is never shown before a committed attempt. There is no "flip to
reveal" without answering first, and the server withholds the answer key, the
model answer, and any passages from your materials until you submit. Unit
tests of the reveal gate, an integration test of the attempt response, and an
end-to-end test of what the browser receives before an answer check this
guardrail. Multiple choice practice without feedback teaches the distractors
as facts (Roediger & Marsh 2005; Butler & Roediger 2008, *Memory &
Cognition*), so every multiple choice miss closes with the correct answer. In
the modes that score right away, the feedback also explains why the option
you picked was tempting, when the question carries a note for it. In Exam
simulation, scoring is a required phase: the session doesn't finish until you
have scored every answer, and each multiple choice question shows its correct
answer there.

**Boundary conditions.** The testing effect shrinks when retrieval success is
very low, because failing over and over with no support isn't practice. Study
Bot works against this with adaptive difficulty (section 12), review
questions on due topics at the start of Retrieval and Interleaved practice
sessions, and worked examples (section 9) for first exposure to procedural
topics. Corrective feedback is treated as non-optional: there is no Skip, and
a question ends only after you answer it.

## 2. Deliberate practice and the feedback loop

**The research.** Ericsson, Krampe & Tesch-Römer (1993, *Psychological Review*
100(3), 363-406) defined deliberate practice as well-defined tasks slightly
beyond current ability, with informative feedback and opportunities for
repetition and error correction. The popularized "10,000 hours" framing drops
the load-bearing part: hours only count when structured as feedback-bearing
loops. On timing, Kulik & Kulik's (1988, *Review of Educational Research*
58(1), 79-97) meta-analysis of 53 studies found that in applied settings with
real materials, *immediate* feedback wins; the oft-cited lab advantage for
delayed feedback is largely a methodological artifact of artificial
list-learning paradigms. Corbett & Anderson's cognitive-tutor experiments
(CHI 2001) showed immediate feedback minimizes time-to-mastery at no cost to
final performance. Shute (2008, *Review of Educational Research* 78, 153-189)
adds the moderators: immediate feedback is most valuable for difficult tasks
and struggling learners, and feedback should come in small, focused units.

**In Study Bot.** Every question is a closed loop: a committed attempt, a
score, elaborated feedback on the same screen, and then a correction step
after a miss. A free recall miss asks you to write a correction rule in your
own words; a multiple choice miss records the correct answer as its rule
automatically. Either way, a repair question on the same point is added to
the end of the session (at most four per session, so the session stays
bounded), and missing a repair question adds another. Error repair sessions
skip this step, since every question in them already retests an error.
Feedback is generated and saved with each attempt, so it survives a page
refresh instead of being regenerated or lost. From the second scored answer
on, the runner also reorders the questions that are left by difficulty
(section 12), a rough working version of the "slightly beyond current
ability" condition.

**Boundary conditions.** Delayed feedback is used in exactly one place, Exam
simulation (`EXAM_SIM`). You answer every question first (the Answering
phase), then score each answer against its model answer (the Scoring phase).
That delay is there to simulate test conditions and to exercise
self-monitoring. The benefit delayed feedback shows in some studies looks
like spacing in disguise (Butler & Roediger 2008; Metcalfe, Kornell & Finn
2009), and Study Bot gets that benefit through immediate feedback on every
attempt plus scheduled returns to missed items: repair questions in the same
session, then repair questions and reviews of due topics in later sessions.

## 3. Elaborated feedback

**The research.** What feedback *says* matters as much as when it arrives.
Van der Kleij, Feskens & Eggen's (2015, *Review of Educational Research*
85(4)) meta-analysis of computer-based learning found elaborated feedback
(explaining *why*) produced g = 0.49, versus 0.32 for showing the correct
answer and only 0.05 for bare right/wrong verification, roughly an order of
magnitude difference between explanation and verification. Shute (2008)
reaches the same conclusion. Kluger & DeNisi (1996, *Psychological Bulletin*
119, 254-284; 607 effect sizes) supply the critical warning: over a third of
feedback interventions *decrease* performance, reliably the ones that direct
attention to the self (praise, grades, person-level judgment) rather than the
task.

**In Study Bot.** A wrong or partly correct answer never gets a bare
"Incorrect." The sheet that slides up after the answer gives the verdict and
a one-line takeaway. Under the answered question, the feedback has an
explanation of the specific gap in your answer, labeled AI-written, with
citations to numbered sources from your own uploaded materials ("Source 2:
Lecture 5, page 3") and the cited passages listed below it. Short notes
follow when they apply (More context, Connection, Memory aid, Pattern), then
your own correction. A multiple choice miss also gets a note on why the
option you picked was tempting. When at least three of your recent errors in
the course share an error type, the Pattern note addresses that pattern
directly. The feedback prompts are task-focused by design: what was wrong,
why, and what to do differently, with no praise of the person and no
comparison with other students. A correct answer gets lighter treatment, a
short "Why it's correct" note and a connection to related ideas, instead of
a full explanation.

**Boundary conditions.** Elaboration's advantage is largest for conceptual,
higher-order material, so the explanation budget is spent on misses and
partial answers; confirming a correct simple fact does not trigger the full
apparatus. Feedback is grounded in retrieved excerpts from your materials and
cites them precisely so you can check the explanation against the source
rather than trusting generated text. That grounding depends on the search
finding a matching passage. When it finds none, the panel says your materials
don't cover the question and shows no sources, and no unsourced explanation
is presented as sourced.

## 4. Hypercorrection: confident errors are the highest-value corrections

**The research.** Butterfield & Metcalfe (2001, *JEP: Learning, Memory &
Cognition* 27, 1491-1494) found that errors committed with *high* confidence
are, after corrective feedback, better corrected than low-confidence errors:
the surprise of being confidently wrong captures attention and makes the
correction salient (Fazio & Marsh 2009). But there is a catch: Butler, Fazio
& Marsh (2011, *Psychonomic Bulletin & Review* 18, 1238-1244) showed that at
a delay, the original high-confidence errors tend to re-intrude, so a single
successful correction is not durable repair.

**In Study Bot.** Before you see the answer, the app asks "How sure are
you?" on a three-level scale: Guessing, Unsure, or Sure, stored as 1, 3, and
5. The rating is optional. Confidence is stored on the attempt and, when the
answer is wrong, on the resulting error log, and it feeds three mechanisms.
First, feedback framing: when you marked Sure and were wrong, the screen
shows a "Confident error" note, and the explanation opens by naming the
mismatch and gives the fullest correction, using the hypercorrection window
on purpose. A miss marked Guessing is framed as a gap to fill instead.
Second, prioritization: errors marked Sure come first in Error repair
sessions and in the repair questions added to later Retrieval and
Interleaved practice sessions. Third, the SM-2 mastery engine penalizes the
confident-but-wrong pattern (a "blind spot"). When a topic scores under 50%
in a session and your average confidence on it is above 3.4 on the 1 to 5
scale, its quality score drops by one, so the topic comes back sooner.

**Boundary conditions.** Because hypercorrected errors resurface at a delay,
a confident miss is never considered fixed after one correction. It enters
the same successive-relearning criterion as every other error (two correct
retrievals on different days, section 6), and its priority ordering means it
actually receives those re-encounters. Confidence is never fabricated: if you
skip the rating, no default is invented, because a made-up value would corrupt
both the confidence results (on the end screen and on Progress) and the
mastery adjustment.

## 5. Spacing (distributed practice)

**The research.** Distributed practice is the second of Dunlosky et al.'s
(2013) two "high utility" techniques. Cepeda, Pashler, Vul, Wixted & Rohrer's
(2006) meta-analysis found spaced practice beats massed practice across 254
studies. Cepeda et al. (2008, *Psychological Science*) established the
practical rule: the optimal gap between sessions is roughly 10 to 20% of the
desired retention interval, gaps that are too short cost more than gaps that
are too long, and if the test is within about a day,
compressed review actually wins.

**In Study Bot.** Spacing runs on an SM-2-style scheduler at the level of
topics (learning objectives). Each topic tracks an ease factor, an interval,
and a repetition count, updated at the end of every session from your
accuracy on that topic, with a confidence adjustment (section 11). The
scheduler is exam-aware and implements Cepeda's compression directly: with
more than two weeks to the exam, intervals are capped at about 20% of the
remaining days; inside two weeks the cap tightens to 3 days, inside a week to
2 days, and with 1 to 3 days left everything reviews daily. Topics that come
due return as review questions at the start of your next Retrieval or
Interleaved practice session in that course. Flashcard decks (including cards
generated from your errors) run their own SM-2 schedule under the same
exam-aware compression, with one addition: a card you rate Again comes back
in 10 minutes within the same sitting. The end screen of a session suggests
two follow-up Retrieval sessions spaced by that session's accuracy: below
70%, in 1 and 2 days; from 70% to 85%, in 2 and 4 days; above 85%, in 3 and 6
days. Add follow-ups to plan puts them into your plan's daily study hours and
skips any day that has passed or falls after the exam. A plan covers the
seven days from the day you create it, within your daily study hours, and
drops anything on or after exam day. When the exam falls inside that week,
the plan tapers the last two days before it: sessions in the final 48 hours
become Retrieval at 60% of their planned length, and the final 24 hours keep
a single Retrieval session of at most 25 minutes. None of the papers below
tested that taper; the rule is adapted from athletic training research.

**Boundary conditions.** Spacing is deliberately abandoned when it would
hurt: the exam-aware compression means that the night before a test the
scheduler stops stretching intervals and pulls everything into daily review,
because cramming wins for a test within about 24 hours. A gap so long that retrieval fails outright
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

**In Study Bot.** Errors follow a cross-day criterion: an error log is marked
resolved only after two correct retrievals on different days. Each error
tracks a correct streak and the date of its last success, counted in
calendar days in your time zone. A correct answer on the same day as the
previous one doesn't advance the streak, and a wrong answer on a repair
question resets it. Until it is resolved, the error keeps coming back: as a
repair question later in the same session, as one of up to two repair
questions at the start of later Retrieval and Interleaved practice sessions
in the course, in Error repair sessions, and as a flashcard generated from
it. Topic mastery has a similar bar: a topic shows as Mastered only after
three passing reviews in a row with an ease factor of at least 2.0.

**Boundary conditions.** Piling extra correct recalls into a *single* session
(overlearning) yields sharply diminishing returns (Rohrer & Taylor 2006), so
Study Bot doesn't drill an error to a high streak within one session. The
criterion is spread across days, where the payoff is. The same-day guard
exists precisely so you cannot "resolve" an error by answering it twice in
one sitting.

## 7. Interleaving

**The research.** Mixing related problem types during practice, instead of
blocking them (AAA-BBB-CCC), forces the learner to *choose* the right approach
rather than just execute the obvious one. Rohrer & Taylor (2007) found
interleaved math practice roughly doubled delayed test scores versus blocked
practice; a classroom randomized controlled trial (Rohrer, Dedrick, Hartwig &
Cheung 2020, *Journal of Educational Psychology*) found d = 0.83. Brunmair & Richter's (2019,
*Psychological Bulletin*) meta-analysis puts the overall effect at g = 0.42,
strongest for confusable, similar categories. Kornell & Bjork (2008,
*Psychological Science*) documented the trap: learners judge blocked practice
as more effective even while interleaving produces better learning.

**In Study Bot.** Interleaved practice (`INTERLEAVED_PRACTICE`) deals the
session's questions round-robin across its topics, after a deterministic
seeded shuffle within each topic. When the questions come from templates and
the session has two or more topics, no two questions in a row share a topic.
AI-generated question sets arrive grouped by topic and would otherwise be
blocked practice, so they go through the same round-robin before the session
starts. Topics alternate until the smaller ones run out, so when the
generator returns more questions for one topic than for the others, the
extras end up together at the end. The review, pretest and repair questions
added at the start sit outside the rotation. When adaptive difficulty swaps
in a different question (section 12), it prefers one whose topic differs from
the question before it.

**Boundary conditions.** Interleaving helps discrimination between *similar*
categories and does nothing (or harms) for unrelated content, so Study Bot
interleaves only among a session's own topics, which all come from one
course. Expect interleaved sessions to feel harder and produce
lower in-session accuracy than blocked practice would; that is the mechanism
working, not the feature failing, and delayed retention is the metric that
matters.

## 8. Pretesting

**The research.** Attempting to answer questions *before* studying the
material, even when the guesses are wrong, improves subsequent learning
compared to spending the same time studying (Richland, Kornell & Kao 2009,
*JEP: Applied* 15, 243-257; Kornell, Hays & Bjork 2009, *JEP: LMC* 35,
989-998). The failed attempt appears to prime the learner for the correct
answer. The technique depends entirely on prompt corrective feedback:
errorful guessing without seeing the right answer is risky.

**In Study Bot.** When a Retrieval or Interleaved practice session covers
topics you have never studied (no mastery record yet), up to two pretest
questions on them go at the front of the session, marked as pretest items on
the server. Pretests, reviews of due topics and repair questions share a
budget inside the session's question count (about a quarter of it, at most
three), and repairs win when it's tight. The question screen says wrong
answers are expected and don't count toward accuracy. Afterwards the result
reads "Pretest done" in place of a score. When the question has a model
answer, the screen points you to it; otherwise the correct information comes
from the sourced feedback under the question, as long as your materials
cover the topic.

**Boundary conditions.** Pretest items are **quarantined from grading**: they
do not require an error log (there is no misconception to repair in material
you've never seen), and they are excluded from the accuracy metrics that
drive adaptive difficulty and from the mastery/scheduling machinery. The
quarantine is enforced server-side against the stored prompt metadata, not
trusted from the client. Without this quarantine, pretesting would punish
exactly the productive errors it depends on: dragging difficulty down,
minting spurious flashcards, and teaching users that pretesting "hurts their
score," a misjudgment learners are already prone to (Pan & Sana 2021).

## 9. Worked examples with backward fading

**The research.** For novices learning procedures, studying a fully worked
solution beats solving the equivalent problem. This is the worked-example effect
(Sweller & Cooper 1985), a core prediction of cognitive load theory. Renkl,
Atkinson and colleagues (2002, 2004) showed the best transition off examples is
*backward fading*: remove the final solution step first and have the learner
supply it, then the final two, and so on, instead of jumping abruptly from
example to full problem. Kalyuga, Ayres, Chandler & Sweller (2003,
*Educational Psychologist*) documented the expertise-reversal effect: the
same worked examples that help novices actively *hurt* learners with higher
prior knowledge, for whom retrieval and problem solving are superior.

**In Study Bot.** The Worked examples mode (`WORKED_EXAMPLES`) generates
example sets grounded in your uploaded course materials, up to three sets per
session. Each set follows the backward-fading sequence
in full: (1) a complete worked example with 3 to 5 ordered solution steps, each
stating both the action and the principle from the material that licenses it;
(2) a completion problem of the same structure with the *final* step missing;
(3) a completion problem with the final *two* steps missing; (4) a novel
near-transfer problem with no steps given, checked against a model answer.
Completion problems reuse the same problem structure with different surface
values, so what fades is support, not the concept. Steps pair with
self-explanation prompts (section 10), because passively read examples lose
most of their benefit. Without an AI provider, or when your materials have
fewer than two passages on the session's topics, the mode falls back to
Retrieval questions so the session still runs.

**Boundary conditions.** Worked examples are a novice-phase tool. The
expertise-reversal effect is why they are not a review mode. The
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
rate it moderate utility: promising, but time-expensive.

**In Study Bot.** Under the feedback, a link reads "Explain it in your own
words." It opens optional fields that are saved with the attempt when you
move on: your explanation of the idea "as if you were teaching it," an answer
to a follow-up question written for the item (shown as "Question to
consider" and labeled AI-written), and, after a correct answer, your own
example of a case where the idea applies. The follow-up question has its own
answer field, so the elaboration ends in your own words. In Worked examples,
each step states why it follows, the study problem asks why the last step
follows from the ones before it, and each completion problem asks you to say
why the steps you write follow.

**Boundary conditions.** Self-explanation prompts are hidden until after the
attempt (an explanation you can copy from visible text is transcription, not
generation). Because the technique is time-expensive, it sits behind one
link after the feedback and stays optional. It is worth the minutes on
conceptual material and first-time errors, and flashcard reviews don't ask
for it.

## 11. Calibration and metacognition

**The research.** Students are systematically overconfident about what they
know, and it is not a harmless bias: Dunlosky & Rawson (2012, *Learning and
Instruction*, "Overconfidence produces underachievement") showed that lenient
self-scoring leads students to drop items too early and retain less.
Judgments of learning made immediately after study are inflated relative to
delayed ones (Nelson & Dunlosky 1991, *Psychological Science*), and the
weakest performers are the most miscalibrated (Kruger & Dunning 1999).
Self-scoring without an answer standard is systematically lenient.

**In Study Bot.** Three mechanisms. First, confidence ratings are collected
*before* the answer is revealed, so hindsight can't contaminate the
judgment. Second, generated free recall questions carry a model answer and a
list of "Points to check," shown after your answer is committed and before
you score yourself, so you grade against a written standard point by point.
Third, the end screen has a Confidence section that charts how often you
were right at each level. An answer marked Sure that wasn't fully correct
counts as overconfident, and Unsure never counts as a mismatch. Correct
answers marked Guessing count as underconfidence only as a pattern (at least
three guesses, half or more of them right), since one lucky guess shows
nothing. The section summarizes nothing until at least three answers are
rated; Progress charts the same comparison week by week. The gap also feeds
the scheduler. A topic you got mostly wrong while leaning Sure loses a point of
SM-2 quality and comes back sooner. A topic you got mostly right while mostly
guessing (an average rating under 2.2) also loses a point, but never below a
passing grade, so it advances more slowly instead of resetting, since
hesitant knowledge is fragile knowledge.

**Boundary conditions.** Calibration data is only as honest as the inputs, so
the app refuses to invent a confidence value when you skip the rating.
Outside Exam simulation, the server grades multiple choice answers against
the stored answer key, so they aren't self-scored at all. In Exam simulation
the key reaches the browser only after your last answer is saved, and the
scoring screen marks each saved pick against it. Self-scoring of free recall
remains self-scoring: the model-answer standard makes leniency harder but
still possible (see section 14).

## 12. Desirable difficulties

**The research.** Bjork & Bjork's desirable-difficulties framework (1992,
2011) holds that conditions that slow apparent learning (spacing,
interleaving, testing, generation) often improve long-term retention, while
conditions that feel fluent (rereading, blocked drill) inflate confidence
without durable learning. Roediger & Karpicke (2006) captured it directly:
the restudy group predicted better performance and did worse. Learners
misread effort as ineffectiveness and abandon what works (Kirk-Johnson,
Galla & Fraundorf 2019). Ericsson's difficulty condition (section 2) supplies
the target: practice slightly beyond current ability.

**In Study Bot.** Sessions from a plan or a follow-up carry a target
accuracy, 80% (70% for Exam simulation), which the start screen shows: hard
enough to be worth doing, achievable enough that feedback loops close on
success. Two mechanisms push toward it. Inside a session, from the second
scored answer on, the runner reorders the questions that are left by their
difficulty rating: harder ones when your running accuracy is 80% or above,
middling ones from 50% to 80%, and easier ones below 50%. It only moves
questions the session already has, and Exam simulation keeps its order.
Across sessions, follow-ups stretch further out as accuracy rises (3 and 6
days above 85%). The app's structural choices are difficulties picked on
purpose: questions before notes, mixed topics over blocked ones, gaps over
cramming, and generation over recognition.

**Boundary conditions.** Difficulty is only desirable when the learner can
eventually succeed and gets feedback. When accuracy falls, the app eases off:
below 50% the runner moves easier questions forward, below 70% follow-ups
come back after 1 and 2 days, failed topics reset to a 1-day interval,
reviews bring due topics back before new questions, and worked examples
exist precisely for the case where retrieval first would mean drowning.
Difficulty caused by confusing materials or near-zero success is just
failure.

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

**In Study Bot.** The question screen is built around the question. There is
one question per screen, and it is the page heading and the largest text on
it. The app navigation goes away during a session. What's left is a close
button, a progress bar with "Question 3 of 12," and the question, with
nothing decorative between question and answer. Feedback follows spatial
contiguity: the answered question stays on screen, the verdict slides up
from the bottom in a short sheet, and your answer, the model answer, the
explanation and its numbered sources read in one column under the question,
with no modal and no separate results page. The loop is built for
repetition: answers submit from the keyboard, progress is saved after every
attempt so a refresh or crash loses nothing, and the next question follows
without interstitials. XP, achievements and streaks exist, but none of them
render inside the question and answer loop, where they would compete for the
attention retrieval needs. A session's XP is awarded when it finishes. A
flashcard review earns a little per card, and the total shows only in the
summary at the end of the review.

**Boundary conditions.** Some session structure serves the pedagogy and stays
even though it adds elements. The start screen lists the questions, the
planned time, the target accuracy, and the rule that notes stay closed until
you check each answer. Sessions with a break pattern show a break screen
between work blocks, and an answer can't be submitted until the break ends.
The end screen shows accuracy, the score breakdown, and the Confidence
section. All of it sits before, between, or after questions, never inside
one.

## 14. Honest limitations

A document like this earns trust by stating what the evidence and the
implementation do not support.

- **Effect sizes are averages.** The meta-analytic values quoted (g = 0.42 to
  0.86 depending on technique) are central tendencies across populations,
  materials, and delays. Your mileage will vary with course, prior knowledge,
  and honesty of use.
- **Free-recall self-scoring is still self-scoring.** The model-answer
  standard and the Confidence section make lenient grading visible and harder,
  but a student determined to grade "correct" on a vague answer can.
  Multiple choice is graded against the answer key; free recall is not.
- **Generated content should be spot-checked.** Questions, model answers,
  worked-example steps, and feedback are written from passages of your
  uploaded materials. Model answers and feedback carry an AI-written label,
  and feedback explanations cite their passages as numbered sources so you
  can check them; questions and model answers don't list sources on screen.
  Grounding lowers the chance of a generated error without ruling one out,
  and the numbered sources let you check an explanation against the passage
  it came from.
- **The scheduler proposes; you dispose.** Spacing only works if the later
  sessions happen. The planner, calendar sync, and follow-up recommendations
  lower the friction of showing up on schedule, but no algorithm retrieves a
  memory on your behalf.
- **Two spacing engines coexist.** Objective-level mastery and flashcard
  scheduling share the same exam-aware compression policy but are tracked
  separately: a flashcard review does not currently advance the corresponding
  objective's mastery record. Fully unifying them is on the roadmap.

## References

Links point to each paper's DOI. Book chapters without a DOI are cited
without a link.

- Adesope, O. O., Trevisan, D. A., & Sundararajan, N. (2017). Rethinking the use of tests: A meta-analysis of practice testing. *Review of Educational Research*, 87(3), 659-701. https://doi.org/10.3102/0034654316689306
- Bisra, K., Liu, Q., Nesbit, J. C., Salimi, F., & Winne, P. H. (2018). Inducing self-explanation: A meta-analysis. *Educational Psychology Review*, 30(3), 703-725. https://doi.org/10.1007/s10648-018-9434-x
- Bjork, E. L., & Bjork, R. A. (2011). Making things hard on yourself, but in a good way: Creating desirable difficulties to enhance learning. In M. A. Gernsbacher, R. W. Pew, L. M. Hough, & J. R. Pomerantz (Eds.), *Psychology and the real world* (pp. 56-64). Worth.
- Bjork, R. A., & Bjork, E. L. (1992). A new theory of disuse and an old theory of stimulus fluctuation. In A. F. Healy, S. M. Kosslyn, & R. M. Shiffrin (Eds.), *From learning processes to cognitive processes: Essays in honor of William K. Estes* (Vol. 2, pp. 35-67). Erlbaum.
- Brunmair, M., & Richter, T. (2019). Similarity matters: A meta-analysis of interleaved learning and its moderators. *Psychological Bulletin*, 145(11), 1029-1052. https://doi.org/10.1037/bul0000209
- Butler, A. C., Fazio, L. K., & Marsh, E. J. (2011). The hypercorrection effect persists over a week, but high-confidence errors return. *Psychonomic Bulletin & Review*, 18(6), 1238-1244. https://doi.org/10.3758/s13423-011-0173-y
- Butler, A. C., & Roediger, H. L. (2008). Feedback enhances the positive effects and reduces the negative effects of multiple-choice testing. *Memory & Cognition*, 36(3), 604-616. https://doi.org/10.3758/MC.36.3.604
- Butterfield, B., & Metcalfe, J. (2001). Errors committed with high confidence are hypercorrected. *Journal of Experimental Psychology: Learning, Memory, and Cognition*, 27(6), 1491-1494. https://doi.org/10.1037/0278-7393.27.6.1491
- Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., & Rohrer, D. (2006). Distributed practice in verbal recall tasks: A review and quantitative synthesis. *Psychological Bulletin*, 132(3), 354-380. https://doi.org/10.1037/0033-2909.132.3.354
- Cepeda, N. J., Vul, E., Rohrer, D., Wixted, J. T., & Pashler, H. (2008). Spacing effects in learning: A temporal ridgeline of optimal retention. *Psychological Science*, 19(11), 1095-1102. https://doi.org/10.1111/j.1467-9280.2008.02209.x
- Chi, M. T. H., Bassok, M., Lewis, M. W., Reimann, P., & Glaser, R. (1989). Self-explanations: How students study and use examples in learning to solve problems. *Cognitive Science*, 13(2), 145-182. https://doi.org/10.1207/s15516709cog1302_1
- Chi, M. T. H., de Leeuw, N., Chiu, M.-H., & LaVancher, C. (1994). Eliciting self-explanations improves understanding. *Cognitive Science*, 18(3), 439-477. https://doi.org/10.1207/s15516709cog1803_3
- Corbett, A. T., & Anderson, J. R. (2001). Locus of feedback control in computer-based tutoring: Impact on learning rate, achievement and attitudes. *Proceedings of the SIGCHI Conference on Human Factors in Computing Systems (CHI 2001)*, 245-252. https://doi.org/10.1145/365024.365111
- Cowan, N. (2001). The magical number 4 in short-term memory: A reconsideration of mental storage capacity. *Behavioral and Brain Sciences*, 24(1), 87-114. https://doi.org/10.1017/S0140525X01003922
- Dunlosky, J., & Rawson, K. A. (2012). Overconfidence produces underachievement: Inaccurate self evaluations undermine students' learning and retention. *Learning and Instruction*, 22(4), 271-280. https://doi.org/10.1016/j.learninstruc.2011.08.003
- Dunlosky, J., Rawson, K. A., Marsh, E. J., Nathan, M. J., & Willingham, D. T. (2013). Improving students' learning with effective learning techniques: Promising directions from cognitive and educational psychology. *Psychological Science in the Public Interest*, 14(1), 4-58. https://doi.org/10.1177/1529100612453266
- Ericsson, K. A., Krampe, R. T., & Tesch-Römer, C. (1993). The role of deliberate practice in the acquisition of expert performance. *Psychological Review*, 100(3), 363-406. https://doi.org/10.1037/0033-295X.100.3.363
- Fazio, L. K., & Marsh, E. J. (2009). Surprising feedback improves later memory. *Psychonomic Bulletin & Review*, 16(1), 88-92. https://doi.org/10.3758/PBR.16.1.88
- Kalyuga, S., Ayres, P., Chandler, P., & Sweller, J. (2003). The expertise reversal effect. *Educational Psychologist*, 38(1), 23-31. https://doi.org/10.1207/S15326985EP3801_4
- Kirk-Johnson, A., Galla, B. M., & Fraundorf, S. H. (2019). Perceiving effort as poor learning: The misinterpreted-effort hypothesis of how experienced effort and perceived learning relate to study strategy choice. *Cognitive Psychology*, 115, 101237. https://doi.org/10.1016/j.cogpsych.2019.101237
- Kluger, A. N., & DeNisi, A. (1996). The effects of feedback interventions on performance: A historical review, a meta-analysis, and a preliminary feedback intervention theory. *Psychological Bulletin*, 119(2), 254-284. https://doi.org/10.1037/0033-2909.119.2.254
- Kornell, N., & Bjork, R. A. (2008). Learning concepts and categories: Is spacing the "enemy of induction"? *Psychological Science*, 19(6), 585-592. https://doi.org/10.1111/j.1467-9280.2008.02127.x
- Kornell, N., Hays, M. J., & Bjork, R. A. (2009). Unsuccessful retrieval attempts enhance subsequent learning. *Journal of Experimental Psychology: Learning, Memory, and Cognition*, 35(4), 989-998. https://doi.org/10.1037/a0015729
- Kruger, J., & Dunning, D. (1999). Unskilled and unaware of it: How difficulties in recognizing one's own incompetence lead to inflated self-assessments. *Journal of Personality and Social Psychology*, 77(6), 1121-1134. https://doi.org/10.1037/0022-3514.77.6.1121
- Kulik, J. A., & Kulik, C.-L. C. (1988). Timing of feedback and verbal learning. *Review of Educational Research*, 58(1), 79-97. https://doi.org/10.3102/00346543058001079
- Metcalfe, J., Kornell, N., & Finn, B. (2009). Delayed versus immediate feedback in children's and adults' vocabulary learning. *Memory & Cognition*, 37(8), 1077-1087. https://doi.org/10.3758/MC.37.8.1077
- Nelson, T. O., & Dunlosky, J. (1991). When people's judgments of learning (JOLs) are extremely accurate at predicting subsequent recall: The "delayed-JOL effect." *Psychological Science*, 2(4), 267-271. https://doi.org/10.1111/j.1467-9280.1991.tb00147.x
- Pan, S. C., & Sana, F. (2021). Pretesting versus posttesting: Comparing the pedagogical benefits of errorful generation and retrieval practice. *Journal of Experimental Psychology: Applied*, 27(2), 237-257. https://doi.org/10.1037/xap0000345
- Rawson, K. A., & Dunlosky, J. (2011). Optimizing schedules of retrieval practice for durable and efficient learning: How much is enough? *Journal of Experimental Psychology: General*, 140(3), 283-302. https://doi.org/10.1037/a0023956
- Rawson, K. A., Dunlosky, J., & Sciartelli, S. M. (2013). The power of successive relearning: Improving performance on course exams and long-term retention. *Educational Psychology Review*, 25(4), 523-548. https://doi.org/10.1007/s10648-013-9240-4
- Renkl, A., Atkinson, R. K., & Große, C. S. (2004). How fading worked solution steps works: A cognitive load perspective. *Instructional Science*, 32(1-2), 59-82. https://doi.org/10.1023/B:TRUC.0000021815.74806.f6
- Renkl, A., Atkinson, R. K., Maier, U. H., & Staley, R. (2002). From example study to problem solving: Smooth transitions help learning. *The Journal of Experimental Education*, 70(4), 293-315. https://doi.org/10.1080/00220970209599510
- Rey, G. D. (2012). A review of research and a meta-analysis of the seductive detail effect. *Educational Research Review*, 7(3), 216-237. https://doi.org/10.1016/j.edurev.2012.05.003
- Richland, L. E., Kornell, N., & Kao, L. S. (2009). The pretesting effect: Do unsuccessful retrieval attempts enhance learning? *Journal of Experimental Psychology: Applied*, 15(3), 243-257. https://doi.org/10.1037/a0016496
- Roediger, H. L., & Karpicke, J. D. (2006). Test-enhanced learning: Taking memory tests improves long-term retention. *Psychological Science*, 17(3), 249-255. https://doi.org/10.1111/j.1467-9280.2006.01693.x
- Roediger, H. L., & Marsh, E. J. (2005). The positive and negative consequences of multiple-choice testing. *Journal of Experimental Psychology: Learning, Memory, and Cognition*, 31(5), 1155-1159. https://doi.org/10.1037/0278-7393.31.5.1155
- Rohrer, D., Dedrick, R. F., Hartwig, M. K., & Cheung, C.-N. (2020). A randomized controlled trial of interleaved mathematics practice. *Journal of Educational Psychology*, 112(1), 40-52. https://doi.org/10.1037/edu0000367
- Rohrer, D., & Taylor, K. (2006). The effects of overlearning and distributed practise on the retention of mathematics knowledge. *Applied Cognitive Psychology*, 20(9), 1209-1224. https://doi.org/10.1002/acp.1266
- Rohrer, D., & Taylor, K. (2007). The shuffling of mathematics problems improves learning. *Instructional Science*, 35(6), 481-498. https://doi.org/10.1007/s11251-007-9015-8
- Shute, V. J. (2008). Focus on formative feedback. *Review of Educational Research*, 78(1), 153-189. https://doi.org/10.3102/0034654307313795
- Sundararajan, N., & Adesope, O. (2020). Keep it coherent: A meta-analysis of the seductive details effect. *Educational Psychology Review*, 32(3), 707-734. https://doi.org/10.1007/s10648-020-09522-4
- Sweller, J. (1988). Cognitive load during problem solving: Effects on learning. *Cognitive Science*, 12(2), 257-285. https://doi.org/10.1207/s15516709cog1202_4
- Sweller, J., & Cooper, G. A. (1985). The use of worked examples as a substitute for problem solving in learning algebra. *Cognition and Instruction*, 2(1), 59-89. https://doi.org/10.1207/s1532690xci0201_3
- Van der Kleij, F. M., Feskens, R. C. W., & Eggen, T. J. H. M. (2015). Effects of feedback in a computer-based learning environment on students' learning outcomes: A meta-analysis. *Review of Educational Research*, 85(4), 475-511. https://doi.org/10.3102/0034654314564881

### Further reading

The text above does not cite these papers, but `scripts/seed-research.ts`
summarizes them for the plan generator's research context.

- Agarwal, P. K., Nunes, L. D., & Blunt, J. R. (2021). Retrieval practice consistently benefits student learning: A systematic review of applied research in schools and classrooms. *Educational Psychology Review*, 33(4), 1409-1453. https://doi.org/10.1007/s10648-021-09595-9
- Gollwitzer, P. M. (1999). Implementation intentions: Strong effects of simple plans. *American Psychologist*, 54(7), 493-503. https://doi.org/10.1037/0003-066X.54.7.493
- Gollwitzer, P. M., & Brandstätter, V. (1997). Implementation intentions and effective goal pursuit. *Journal of Personality and Social Psychology*, 73(1), 186-199. https://doi.org/10.1037/0022-3514.73.1.186
- Karpicke, J. D. (2025). Retrieval-based learning. In *Learning and memory: A comprehensive reference* (3rd ed., pp. 411-441). Elsevier. https://doi.org/10.1016/B978-0-443-15754-7.00074-2
- Karpicke, J. D., & Blunt, J. R. (2011). Retrieval practice produces more learning than elaborative studying with concept mapping. *Science*, 331(6018), 772-775. https://doi.org/10.1126/science.1199327
- Pan, S. C., & Rickard, T. C. (2018). Transfer of test-enhanced learning: Meta-analytic review and synthesis. *Psychological Bulletin*, 144(7), 710-756. https://doi.org/10.1037/bul0000151
- Steel, P. (2007). The nature of procrastination: A meta-analytic and theoretical review of quintessential self-regulatory failure. *Psychological Bulletin*, 133(1), 65-94. https://doi.org/10.1037/0033-2909.133.1.65
- Zimmerman, B. J. (2002). Becoming a self-regulated learner: An overview. *Theory Into Practice*, 41(2), 64-70. https://doi.org/10.1207/s15430421tip4102_2
