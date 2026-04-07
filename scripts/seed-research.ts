/**
 * Research Knowledge Base: Learning Science Evidence
 *
 * Structured summaries of key learning science papers, encoded as
 * EvidencePaper + EvidenceCard records. Each card captures a specific
 * research claim, actionable recommendation, boundary conditions, and
 * evidence strength.
 *
 * These are used by the plan generator to make evidence-based scheduling
 * decisions (spacing, interleaving, retrieval practice timing, etc.)
 *
 * Usage: npx tsx scripts/seed-research.ts
 */
import { prisma } from "../src/lib/db";
import { sha256 } from "../src/lib/storage";
import { enqueueJob } from "../src/lib/jobs/queue";
import type { EmbedChunkBatchPayload } from "../src/lib/jobs/handlers/embed-chunks";

const SYSTEM_USER_ID = "__system__";

interface PaperSeed {
  title: string;
  authors: string;
  year: number;
  venue: string;
  tags: string[];
  summary: string;
  cards: {
    claim: string;
    recommendation: string;
    boundaryConditions: string;
    strength: "WEAK" | "MODERATE" | "STRONG";
    tags: string[];
  }[];
}

const PAPERS: PaperSeed[] = [
  // ── Spaced Repetition / Distributed Practice ──────────────────
  {
    title: "Distributed Practice in Verbal Recall Tasks: A Review and Quantitative Synthesis",
    authors: "Cepeda, Pashler, Vul, Wixted, Rohrer",
    year: 2006,
    venue: "Psychological Bulletin",
    tags: ["spacing", "distributed-practice", "meta-analysis"],
    summary:
      "Meta-analysis of 254 studies on the spacing effect. Distributing study over time produces substantially better long-term retention than massing practice. The optimal inter-study interval increases with the desired retention interval. For a test 1 week away, spacing sessions 1-2 days apart is optimal. For a test 1 month away, spacing of 1 week is optimal.",
    cards: [
      {
        claim: "Distributing study sessions over time produces 10-30% better retention than massing the same total study time into a single session.",
        recommendation: "Never schedule more than one study session on the same topic per day. Space retrieval sessions on the same topic at least 1 day apart for exams within 1 week, and at least 2-3 days apart for exams further out.",
        boundaryConditions: "Effect is strongest for factual/declarative knowledge. Procedural skills show smaller spacing benefits. Very short retention intervals (minutes) may not benefit from spacing.",
        strength: "STRONG",
        tags: ["spacing", "scheduling", "session-gap"],
      },
      {
        claim: "The optimal spacing interval is approximately 10-20% of the desired retention interval.",
        recommendation: "For an exam 7 days away, space review sessions 1-2 days apart. For an exam 30 days away, space them 3-5 days apart. Adjust the plan's inter-topic gap based on days until exam.",
        boundaryConditions: "This ratio is approximate and varies with material difficulty. More difficult material may benefit from shorter initial gaps that expand over time (expanding retrieval).",
        strength: "STRONG",
        tags: ["spacing", "scheduling", "optimal-gap"],
      },
    ],
  },

  // ── Retrieval Practice / Testing Effect ────────────────────────
  {
    title: "Test-Enhanced Learning: Taking Memory Tests Improves Long-Term Retention",
    authors: "Roediger, Karpicke",
    year: 2006,
    venue: "Psychological Science",
    tags: ["retrieval-practice", "testing-effect"],
    summary:
      "Demonstrated that taking a test on material produces better long-term retention than additional study of the same material. Students who were tested recalled 80% after 1 week vs 36% for re-study. The testing effect is one of the most robust findings in cognitive psychology.",
    cards: [
      {
        claim: "Practicing retrieval (testing) produces 40-80% better long-term retention compared to re-reading or re-studying the same material for equivalent time.",
        recommendation: "Always start study sessions with a retrieval attempt (closed-book questions) before providing study material. Prioritize RETRIEVAL mode sessions over passive review. At least 50% of total study time should involve active retrieval.",
        boundaryConditions: "Initial retrieval attempts may feel harder and produce lower immediate performance. Students may perceive re-reading as more effective even when testing produces superior long-term outcomes.",
        strength: "STRONG",
        tags: ["retrieval-practice", "session-mode", "active-learning"],
      },
      {
        claim: "Retrieval practice with feedback is more effective than retrieval practice without feedback, which is still more effective than re-study.",
        recommendation: "After each retrieval attempt, provide immediate corrective feedback showing the correct answer and explanation. Use ERROR_REPAIR sessions after RETRIEVAL sessions to address incorrect answers.",
        boundaryConditions: "Delayed feedback (given hours later) can sometimes be as effective as immediate feedback for simpler material.",
        strength: "STRONG",
        tags: ["retrieval-practice", "feedback", "error-repair"],
      },
    ],
  },

  // ── Interleaving ──────────────────────────────────────────────
  {
    title: "The Shuffling of Mathematics Problems Improves Learning",
    authors: "Rohrer, Taylor",
    year: 2007,
    venue: "Instructional Science",
    tags: ["interleaving", "mixed-practice"],
    summary:
      "Showed that interleaving different types of problems during practice leads to better test performance than blocking practice by problem type. Interleaving forces learners to discriminate between problem types, strengthening the ability to select appropriate strategies.",
    cards: [
      {
        claim: "Interleaving different topics or problem types during practice produces 20-50% better transfer performance compared to blocked practice, despite feeling harder during learning.",
        recommendation: "After initial learning of 2+ topics, schedule INTERLEAVED_PRACTICE sessions that mix questions from multiple topics. Place interleaved sessions after at least one dedicated retrieval session per topic.",
        boundaryConditions: "Interleaving is most effective after some initial learning has occurred. Very early in learning, brief blocked practice may be necessary to establish basic competence. Interleaving works best when the topics share surface similarity but require different solutions.",
        strength: "STRONG",
        tags: ["interleaving", "session-mode", "topic-mixing"],
      },
      {
        claim: "Interleaving improves discriminative contrast — the ability to identify which strategy applies to which problem type.",
        recommendation: "In interleaved sessions, include at least 3 different topics. Present them in random order, not in predictable rotation. Include 'near-miss' topics that are easily confused with each other.",
        boundaryConditions: "If topics are completely unrelated, interleaving benefits are smaller. The greatest benefit comes from interleaving related but distinct concepts.",
        strength: "MODERATE",
        tags: ["interleaving", "discriminative-contrast"],
      },
    ],
  },

  // ── Desirable Difficulties ────────────────────────────────────
  {
    title: "Making Things Hard on Yourself, But in a Good Way: Creating Desirable Difficulties to Enhance Learning",
    authors: "Bjork, Bjork",
    year: 2011,
    venue: "Psychology and the Real World",
    tags: ["desirable-difficulties", "metacognition"],
    summary:
      "Framework describing how conditions that make learning feel slower or harder during practice often enhance long-term retention. Key desirable difficulties include spacing, interleaving, testing, and generation (producing answers rather than recognizing them).",
    cards: [
      {
        claim: "Conditions that slow down learning and increase errors during practice (desirable difficulties) reliably enhance long-term retention and transfer, provided the learner can successfully engage with the difficulty.",
        recommendation: "Set initial target accuracy to 60-80%, not 90-100%. If a student scores above 85% consistently, increase difficulty by adding more topics to interleaving, reducing hints, or requiring more elaboration. Avoid making sessions feel 'easy'.",
        boundaryConditions: "Difficulties are only 'desirable' if the learner has sufficient prior knowledge to engage with them. For complete beginners, excessive difficulty leads to frustration and disengagement, not learning.",
        strength: "STRONG",
        tags: ["difficulty", "target-accuracy", "adaptive"],
      },
      {
        claim: "Generation — producing an answer before seeing it — is more effective than recognition (multiple choice) or passive review.",
        recommendation: "Prefer open-ended retrieval questions (short answer, explain concept) over multiple-choice where possible. Use closed_book_required=true for retrieval sessions. Only use recognition-based questions as scaffolding for very difficult material.",
        boundaryConditions: "Generation can be too difficult if the learner has no basis for generating an answer. In initial diagnostic sessions, multiple choice may be appropriate.",
        strength: "MODERATE",
        tags: ["generation", "question-type", "closed-book"],
      },
    ],
  },

  // ── Dunlosky Meta-Analysis ────────────────────────────────────
  {
    title: "Improving Students' Learning With Effective Learning Techniques: Promising Directions From Cognitive and Educational Psychology",
    authors: "Dunlosky, Rawson, Marsh, Nathan, Willingham",
    year: 2013,
    venue: "Psychological Science in the Public Interest",
    tags: ["meta-analysis", "technique-effectiveness"],
    summary:
      "Comprehensive review of 10 learning techniques. Rated practice testing and distributed practice as HIGH utility. Interleaved practice, elaborative interrogation, and self-explanation as MODERATE utility. Highlighting, summarization, rereading, keyword mnemonic, and imagery as LOW utility.",
    cards: [
      {
        claim: "Practice testing (retrieval practice) and distributed practice are the only two techniques rated as HIGH utility across a wide range of learning conditions, student populations, and material types.",
        recommendation: "Build every study plan around two core pillars: (1) active retrieval practice with feedback, and (2) distributed/spaced scheduling. These two techniques should account for at least 60% of total study time. Avoid scheduling plans that rely on rereading, highlighting, or summarization as primary study methods.",
        boundaryConditions: "Both techniques require sufficient time before the exam to distribute practice. For exams less than 2 days away, massed practice with retrieval testing is still better than passive review.",
        strength: "STRONG",
        tags: ["technique-ranking", "high-utility", "core-pillars"],
      },
      {
        claim: "Elaborative interrogation (asking 'why' and 'how' questions about facts) is moderately effective, especially for factual learning.",
        recommendation: "Include elaborative prompts in retrieval sessions: 'Why is this true?', 'How does this relate to X?', 'What would happen if Y changed?'. These are especially useful in ERROR_REPAIR sessions after incorrect answers.",
        boundaryConditions: "Elaborative interrogation requires sufficient prior knowledge to generate explanations. Less effective for completely novel material.",
        strength: "MODERATE",
        tags: ["elaboration", "question-type"],
      },
      {
        claim: "Self-explanation (explaining steps of a solution to oneself) is moderately effective and enhances transfer to novel problems.",
        recommendation: "In WORKED_EXAMPLES sessions, prompt students to explain each step. After exam simulations, require students to explain their reasoning for both correct and incorrect answers.",
        boundaryConditions: "Training on how to self-explain improves its effectiveness. Without guidance, students may generate superficial or incorrect explanations.",
        strength: "MODERATE",
        tags: ["self-explanation", "worked-examples"],
      },
    ],
  },

  // ── Testing Effect & Exam Simulation ──────────────────────────
  {
    title: "The Critical Importance of Retrieval for Learning",
    authors: "Karpicke, Roediger",
    year: 2008,
    venue: "Science",
    tags: ["retrieval-practice", "testing-effect", "study-strategies"],
    summary:
      "Demonstrated that repeated testing with feedback produces dramatically better retention than repeated studying, even when students perceive studying as more effective. Students who studied once and tested three times recalled 80% a week later; students who studied three times and tested once recalled only 36%.",
    cards: [
      {
        claim: "Multiple retrieval attempts produce better retention than multiple study sessions, even with the same total time. Three tests + one study > one test + three studies.",
        recommendation: "For each topic, schedule at least 2-3 retrieval sessions across different days before the exam. Reduce passive study sessions in favor of more retrieval attempts. The ratio should be approximately 3:1 retrieval-to-study.",
        boundaryConditions: "The first retrieval attempt benefits from some prior study or exposure. Complete retrieval without any prior exposure is frustrating and unproductive.",
        strength: "STRONG",
        tags: ["retrieval-practice", "session-count", "scheduling"],
      },
    ],
  },

  // ── Successive Relearning ────────────────────────────────────
  {
    title: "Successive Relearning Improves Performance on a High-Stakes Exam",
    authors: "Rawson, Dunlosky, Sciartelli",
    year: 2013,
    venue: "Journal of Experimental Psychology: Applied",
    tags: ["successive-relearning", "spaced-retrieval"],
    summary:
      "Demonstrated that successive relearning — combining retrieval practice with spaced restudy of missed items — produces superior exam performance compared to standard study methods. Students who used successive relearning scored a full letter grade higher.",
    cards: [
      {
        claim: "Successive relearning (retrieve → identify errors → restudy errors → retrieve again in a later session) produces the best outcomes by combining retrieval practice with targeted error correction across spaced sessions.",
        recommendation: "After each retrieval session, immediately follow with an ERROR_REPAIR session targeting only the items that were incorrect. Then schedule another retrieval session 1-2 days later that re-tests those previously missed items alongside new items.",
        boundaryConditions: "Requires tracking which specific items were missed so they can be re-tested. The error repair session should happen soon after the retrieval (same day), while the re-test should be spaced.",
        strength: "STRONG",
        tags: ["successive-relearning", "error-repair", "scheduling-sequence"],
      },
    ],
  },

  // ── Time-of-Day Effects ──────────────────────────────────────
  {
    title: "Time of Day Effects on Learning and Memory",
    authors: "Hasher, Goldstein, May",
    year: 2005,
    venue: "Psychonomic Bulletin & Review",
    tags: ["time-of-day", "circadian", "scheduling"],
    summary:
      "Research on circadian effects on cognition shows that analytical/focused tasks are performed best during peak alertness (typically morning for most people), while creative/insight tasks may benefit from off-peak times. Memory encoding is generally better during peak hours.",
    cards: [
      {
        claim: "Cognitively demanding tasks (analytical reasoning, focused study, new learning) are performed 10-20% better during peak alertness hours compared to off-peak hours.",
        recommendation: "Schedule the most difficult study sessions (new material, diagnostic retrieval, exam simulation) during the student's preferred peak hours (morning by default). Schedule lighter review and interleaved practice for later in the day.",
        boundaryConditions: "Individual chronotype varies significantly. Morning preference is more common but not universal. The effect is smaller for highly motivated students or very engaging material.",
        strength: "MODERATE",
        tags: ["time-of-day", "difficulty-ordering", "scheduling"],
      },
    ],
  },

  // ── Session Duration & Breaks ─────────────────────────────────
  {
    title: "The Role of Deliberate Practice in the Acquisition of Expert Performance",
    authors: "Ericsson, Krampe, Tesch-Romer",
    year: 1993,
    venue: "Psychological Review",
    tags: ["deliberate-practice", "session-duration", "breaks"],
    summary:
      "Research on expert performance found that effective deliberate practice sessions rarely exceed 60-90 minutes without a break, and total daily practice rarely exceeds 4 hours even for elite performers. Quality of practice degrades significantly after 60-90 minutes of intense focus.",
    cards: [
      {
        claim: "Focused study quality degrades significantly after 50-90 minutes of continuous effort. Most effective learners limit individual sessions to 50-90 minutes with breaks.",
        recommendation: "Cap individual study blocks at 50-60 minutes for focused retrieval/exam simulation. Use the 50/10 break protocol (50 min work, 10 min break) as default. For easier review sessions, 90/15 is acceptable. Never schedule continuous study blocks longer than 90 minutes.",
        boundaryConditions: "Engaging, varied practice may sustain attention longer than monotonous repetition. Very short sessions (<20 min) may not allow sufficient depth.",
        strength: "MODERATE",
        tags: ["session-duration", "breaks", "break-protocol"],
      },
      {
        claim: "Total daily deliberate practice rarely exceeds 3-4 hours even among elite performers, with diminishing returns beyond 2-3 hours.",
        recommendation: "Set daily study cap to 120-180 minutes by default. Warn users who set daily caps above 240 minutes that research shows diminishing returns. Distribute practice across the day with breaks between sessions.",
        boundaryConditions: "This applies to high-intensity deliberate practice. Light review or passive reading can be sustained longer but is less effective for learning.",
        strength: "MODERATE",
        tags: ["daily-cap", "total-practice-time"],
      },
    ],
  },

  // ── Pre-Testing / Diagnostic Assessment ───────────────────────
  {
    title: "Unsuccessful Retrieval Attempts Enhance Subsequent Learning",
    authors: "Kornell, Hays, Bjork",
    year: 2009,
    venue: "Journal of Experimental Psychology: Learning, Memory, and Cognition",
    tags: ["pretesting", "diagnostic", "productive-failure"],
    summary:
      "Showed that attempting to answer questions before studying the material (pretesting) enhances subsequent learning, even when the pretest answers are wrong. The act of trying to retrieve primes the learner to better encode the correct answer when it's later presented.",
    cards: [
      {
        claim: "Taking a pretest before studying material improves later retention by 10-25%, even when pretest performance is near zero. Failed retrieval attempts prime subsequent encoding.",
        recommendation: "Always begin a new topic with a DIAGNOSTIC retrieval session before any teaching or review. Set target accuracy expectations low (30-50%) for diagnostic sessions. The purpose is priming, not assessment.",
        boundaryConditions: "Pre-testing is most effective when followed relatively quickly (within the same session or day) by study of the correct answers. Pre-testing without subsequent feedback has little benefit.",
        strength: "STRONG",
        tags: ["pretesting", "diagnostic", "session-ordering"],
      },
    ],
  },

  // ── Exam Simulation & Transfer ────────────────────────────────
  {
    title: "Transfer-Appropriate Processing and the Testing Effect",
    authors: "Morris, Bransford, Franks",
    year: 1977,
    venue: "Journal of Verbal Learning and Verbal Behavior",
    tags: ["transfer-appropriate", "exam-simulation"],
    summary:
      "Established the transfer-appropriate processing framework: memory performance is best when the cognitive processes used during study match those required during the test. Studying in a format similar to the exam produces better exam performance.",
    cards: [
      {
        claim: "Practice conditions that match the format, difficulty, and cognitive demands of the actual exam produce the best exam performance (transfer-appropriate processing).",
        recommendation: "Schedule EXAM_SIM sessions in the final 20-30% of the study period that replicate real exam conditions: timed, closed-book, same question format, same difficulty level. Include at least 2 full exam simulations before the real exam.",
        boundaryConditions: "Transfer-appropriate processing works best when the exam format is known. For unpredictable exam formats, varied practice across multiple formats is better.",
        strength: "STRONG",
        tags: ["exam-simulation", "transfer", "scheduling-placement"],
      },
    ],
  },
  // ── Karpicke 2025 — Retrieval-Based Learning Review ────────────
  {
    title: "Retrieval-Based Learning: A Comprehensive Review",
    authors: "Karpicke",
    year: 2025,
    venue: "Learning and Memory: A Comprehensive Reference (Elsevier)",
    tags: ["retrieval-practice", "testing-effect", "spacing", "transfer", "review"],
    summary:
      "Comprehensive review of retrieval-based learning research from 2006-2023. Establishes that retrieval practice effects are most robust when initial retrieval success exceeds 75% and retrieval still requires effort. Repeated retrieval virtually eliminates forgetting, and benefits generalize across materials, contexts, and learner populations.",
    cards: [
      {
        claim: "Retrieval practice effects are most robust when initial retrieval success is above 75% and retrieval still requires effort (e.g., spaced rather than massed).",
        recommendation: "Design study sessions so retrieval attempts are spaced (not immediately after study) but material is well enough encoded that at least 75% can be successfully recalled. If initial recall is too low, provide a brief restudy before attempting retrieval again.",
        boundaryConditions: "The conundrum is that conditions increasing retrieval success (more cues, shorter delays) also reduce retrieval effort, which is essential for the learning benefit.",
        strength: "STRONG",
        tags: ["retrieval-practice", "retrieval-effort", "retrieval-success", "spacing"],
      },
      {
        claim: "Massed retrieval immediately after study produces very little learning relative to spaced retrieval.",
        recommendation: "Space retrieval practice away from initial study. Do not test immediately after reading — wait at least some interval before the first retrieval attempt to ensure effortful retrieval.",
        boundaryConditions: "Applies broadly; supported by multiple studies. Immediate testing feels productive but produces less durable learning.",
        strength: "STRONG",
        tags: ["spacing", "retrieval-effort", "massed-vs-spaced"],
      },
      {
        claim: "Repeated retrieval virtually eliminates forgetting. Subjects who repeatedly recalled at increasing intervals showed little or no forgetting over 2 months.",
        recommendation: "Schedule repeated retrieval practice sessions at expanding intervals to create a nearly flat forgetting curve for critical material.",
        boundaryConditions: "Demonstrated with geometric line drawings and prose passages. Generalized widely across materials and contexts.",
        strength: "STRONG",
        tags: ["retrieval-practice", "repeated-testing", "forgetting-curve", "expanding-retrieval"],
      },
    ],
  },

  // ── Karpicke & Blunt 2011 — Retrieval vs Concept Mapping ─────
  {
    title: "Retrieval Practice Produces More Learning than Elaborative Studying with Concept Mapping",
    authors: "Karpicke, Blunt",
    year: 2011,
    venue: "Science",
    tags: ["retrieval-practice", "concept-mapping", "elaborative-study"],
    summary:
      "Found that retrieval practice (recall-restudy-recall cycle) produces substantially more learning than elaborative concept mapping when tested one week later. Retrieval group scored 67% vs 45% for concept mapping. The advantage held for both direct recall and inference questions.",
    cards: [
      {
        claim: "Retrieval practice (recall-restudy-recall cycle) produces substantially more learning than elaborative studying with concept mapping (67% vs 45% one week later, r = 0.602).",
        recommendation: "When studying complex material, prefer active recall (writing out what you remember) over elaborative techniques like concept mapping. A study-recall-restudy-recall cycle is more effective than spending equivalent time on concept mapping.",
        boundaryConditions: "Tested with prose passages and undergraduate participants. The advantage held for both factual recall and inference questions, suggesting retrieval promotes meaningful learning.",
        strength: "STRONG",
        tags: ["retrieval-practice", "concept-mapping", "elaborative-study", "session-mode"],
      },
    ],
  },

  // ── Adesope et al. 2017 — Practice Testing Meta-Analysis ─────
  {
    title: "Rethinking the Use of Tests: A Meta-Analysis of Practice Testing",
    authors: "Adesope, Trevisan, Sundararajan",
    year: 2017,
    venue: "Review of Educational Research",
    tags: ["retrieval-practice", "testing-effect", "meta-analysis", "feedback", "test-format"],
    summary:
      "Meta-analysis of 118 articles (272 effect sizes, 15,427 participants). Practice testing vs restudying yields g = 0.51. Effects are larger at 1-6 day delays (g = 0.82). Mixed-format tests produce the largest effects (g = 0.80). Testing without feedback is also effective.",
    cards: [
      {
        claim: "Practice testing produces a moderate, robust benefit over restudying (g = 0.51, k = 195 studies). Even when total study time is held constant, testing is superior.",
        recommendation: "Replace rereading with self-testing as the primary study strategy. Simply replace some restudy time with testing — no extra time needed.",
        boundaryConditions: "Effect is robust across classroom and laboratory settings, across education levels, and across retention and transfer outcomes.",
        strength: "STRONG",
        tags: ["retrieval-practice", "meta-analysis", "restudy-comparison", "study-efficiency"],
      },
      {
        claim: "Testing effects are larger at longer retention intervals. Effect sizes peak at 1-6 day delays (g = 0.82) compared to same-day delays (g = 0.56).",
        recommendation: "Schedule retrieval practice sessions at least 1 day before the target assessment to maximize the testing effect. The benefit of practice testing is most pronounced at delays of 1-6 days.",
        boundaryConditions: "The 1-6 day peak may reflect the mix of studies at that interval rather than a true decline at longer intervals.",
        strength: "STRONG",
        tags: ["retrieval-practice", "retention-interval", "spacing", "scheduling"],
      },
      {
        claim: "Multiple-choice practice tests produced large effect sizes (g = 0.70), comparable to free recall (g = 0.62). Mixed-format tests produced the largest effects (g = 0.80).",
        recommendation: "Use mixed-format practice tests when possible. Multiple-choice practice is a viable and effective option when free-recall testing is impractical.",
        boundaryConditions: "The advantage of multiple-choice may partly reflect lower cognitive load. Other studies suggest free recall may be superior for long-term retention.",
        strength: "MODERATE",
        tags: ["retrieval-practice", "test-format", "multiple-choice"],
      },
      {
        claim: "Transfer-appropriate processing matters: testing effects are stronger when practice and final test formats match (g = 0.63) than when they differ (g = 0.53), but cross-format effects still exist.",
        recommendation: "When possible, match the format of practice tests to the expected exam format. However, any form of practice testing is beneficial even when formats differ.",
        boundaryConditions: "Both conditions showed substantial positive effects. The difference was statistically significant but practically modest.",
        strength: "STRONG",
        tags: ["retrieval-practice", "test-format", "transfer-appropriate-processing"],
      },
    ],
  },

  // ── Brunmair & Richter 2019 — Interleaving Meta-Analysis ─────
  {
    title: "Similarity Matters: A Meta-Analysis of Interleaved Learning and Its Moderators",
    authors: "Brunmair, Richter",
    year: 2019,
    venue: "Psychological Bulletin",
    tags: ["interleaving", "meta-analysis", "category-learning", "similarity"],
    summary:
      "Meta-analysis of 59 studies (238 effect sizes) on interleaving for inductive learning. Found a moderate overall effect (g = 0.42), but benefits vary by material type: strongest for visual materials (g = 0.67), moderate for math (g = 0.34), reversed for word-based categories. Interleaving is most effective when categories are highly similar.",
    cards: [
      {
        claim: "Interleaving produces a moderate overall benefit for inductive learning (g = 0.42), but depends heavily on material type: visual materials g = 0.67, math g = 0.34, words g = -0.39 (blocking better).",
        recommendation: "Use interleaved practice for discriminating between similar categories (problem types, visual classifications). Do not assume interleaving is universally beneficial — for word-based learning, blocking may be better.",
        boundaryConditions: "Best for tasks requiring discrimination between categories. Reversed for word-based categories where within-category similarity matters more.",
        strength: "STRONG",
        tags: ["interleaving", "meta-analysis", "material-type", "discrimination-training"],
      },
      {
        claim: "Interleaving is most effective when categories are highly similar to each other (low discriminability). Blocking is better when categories are highly dissimilar.",
        recommendation: "When study material involves distinguishing between things that look or feel similar (e.g., math problem types requiring different formulas), interleave. When identifying common features within diverse examples, consider blocking.",
        boundaryConditions: "Consistent with the sequential attention theory. Interleaving highlights differences; blocking highlights similarities.",
        strength: "STRONG",
        tags: ["interleaving", "similarity", "discrimination", "category-learning"],
      },
    ],
  },

  // ── Pan & Rickard 2018 — Transfer of Test-Enhanced Learning ───
  {
    title: "Transfer of Test-Enhanced Learning: Meta-Analytic Review and Synthesis",
    authors: "Pan, Rickard",
    year: 2018,
    venue: "Psychological Bulletin",
    tags: ["retrieval-practice", "testing-effect", "transfer", "meta-analysis", "feedback"],
    summary:
      "Meta-analysis of 192 effect sizes (N = 10,382) on transfer of practice testing benefits. Found moderate transfer (d = 0.40), strongly conditional on three factors: response congruency, elaborated retrieval practice, and initial test performance. When all three are present, transfer rises to d = 0.78.",
    cards: [
      {
        claim: "Practice testing yields moderate transferable learning (d = 0.40), but when response congruency, elaborated retrieval, and adequate initial performance are all present, transfer rises to d = 0.78.",
        recommendation: "Design practice tests to maximize transfer: test the same underlying concepts (response congruency), provide elaborative feedback with explanations, and calibrate difficulty so initial accuracy exceeds 50%.",
        boundaryConditions: "When none of the three favorable factors are present, transfer may be near zero or negative.",
        strength: "STRONG",
        tags: ["retrieval-practice", "transfer", "meta-analysis", "difficulty-calibration"],
      },
      {
        claim: "Elaborated retrieval practice (combining testing with free recall followed by restudy, or elaborative feedback with explanations) significantly enhances transfer (d increase of 0.22).",
        recommendation: "After retrieval attempts, provide elaborative feedback that includes explanations or context, not just correct/incorrect. Pair retrieval with a restudy opportunity.",
        boundaryConditions: "Without elaborated retrieval and response congruency, transfer estimate drops to only d = 0.21.",
        strength: "STRONG",
        tags: ["retrieval-practice", "feedback", "transfer", "elaborative-retrieval"],
      },
    ],
  },

  // ── Agarwal et al. 2021 — Classroom Retrieval Practice Review ─
  {
    title: "Retrieval Practice Consistently Benefits Student Learning: A Systematic Review of Applied Research in Schools and Classrooms",
    authors: "Agarwal, Nunes, Blunt",
    year: 2021,
    venue: "Educational Psychology Review",
    tags: ["retrieval-practice", "classroom-research", "systematic-review", "feedback"],
    summary:
      "Systematic review of 50 classroom experiments (n = 5,374). 57% showed medium or large effects (d > 0.50). Only 3 of 49 effect sizes were negative. Benefits held across K-12, undergraduate, medical school, and multiple content areas regardless of retrieval format.",
    cards: [
      {
        claim: "Retrieval practice consistently benefits learning in real classroom settings, with 57% of experiments showing medium or large effects and only 3 of 49 being negative.",
        recommendation: "Incorporate retrieval practice into regular study routines. Benefits are robust across education levels, content areas, and implementation formats.",
        boundaryConditions: "94% of studies were in WEIRD countries. Limited data for mathematics and humanities specifically.",
        strength: "STRONG",
        tags: ["retrieval-practice", "classroom-research", "applied-research"],
      },
      {
        claim: "Retrieval practice is effective at a variety of timings: single sessions, weekly, or every 2-3 weeks. No clear optimal timing emerged — doing it at all matters more than exact frequency.",
        recommendation: "Provide retrieval practice at whatever frequency is feasible. The exact timing matters less than actually doing it.",
        boundaryConditions: "Most common timing was weekly (k = 19) or every 2-3 weeks (k = 15). Single-session retrieval (k = 10) was also effective.",
        strength: "MODERATE",
        tags: ["retrieval-practice", "timing", "scheduling", "flexibility"],
      },
      {
        claim: "Immediate feedback after retrieval was associated with a range of effect sizes (small to large). Studies without feedback resulted in mostly small effects.",
        recommendation: "Provide feedback after retrieval practice, ideally immediately. Retrieval without any feedback is less effective.",
        boundaryConditions: "34 of 50 experiments used immediate feedback. Unable to determine optimal feedback type from available data.",
        strength: "MODERATE",
        tags: ["retrieval-practice", "feedback", "classroom-research"],
      },
    ],
  },

  // ── Gollwitzer 1999 — Implementation Intentions ──────────────
  {
    title: "Implementation Intentions: Strong Effects of Simple Plans",
    authors: "Gollwitzer",
    year: 1999,
    venue: "American Psychologist",
    tags: ["implementation-intentions", "goal-setting", "self-regulation", "habit-formation"],
    summary:
      "Implementation intentions ('When situation X, I will do Y') dramatically increase goal completion from 22-32% to 62-71%. They delegate behavioral control to situational cues, creating 'instant habits' that trigger goal-directed behavior automatically. Effects are robust across populations including clinical groups.",
    cards: [
      {
        claim: "Implementation intentions ('When situation X, I will do Y') increase completion of difficult goals from ~22-32% to ~62-71%.",
        recommendation: "When scheduling study sessions, form explicit implementation intentions specifying exactly when and where you will study (e.g., 'When I finish dinner on Tuesday, I will go to my desk and study Chapter 5 for 45 minutes').",
        boundaryConditions: "Works primarily for difficult-to-implement goals. Easy goals already have ~80% completion and show minimal additional benefit. Requires strong underlying goal commitment.",
        strength: "STRONG",
        tags: ["implementation-intentions", "goal-setting", "session-scheduling", "habit-formation"],
      },
      {
        claim: "Implementation intentions create 'instant habits' — a single mental act of linking a situation to a behavior produces automatic action initiation equivalent to repeated behavioral practice.",
        recommendation: "Rather than relying on willpower to start studying, pre-decide the exact time, place, and first action of each study session. This creates automatic initiation similar to habitual behavior.",
        boundaryConditions: "Commitment matters — telling yourself 'I strongly intend to follow this plan' enhances the effect. Effects fade within 48 hours if the goal intention is abandoned.",
        strength: "STRONG",
        tags: ["implementation-intentions", "automaticity", "habit-formation", "session-structure"],
      },
      {
        claim: "Distraction-inhibiting implementation intentions ('When distraction X arises, I will ignore it') outperform task-facilitating ones for protecting goal pursuit.",
        recommendation: "For study sessions, form distraction-inhibiting intentions like 'When I feel the urge to check my phone, I will ignore it' rather than effort-increasing intentions.",
        boundaryConditions: "Task-facilitating intentions can backfire when motivation is already high. Distraction-inhibiting intentions work regardless of motivation level.",
        strength: "MODERATE",
        tags: ["implementation-intentions", "distraction-management", "session-structure"],
      },
    ],
  },

  // ── Gollwitzer & Brandstatter 1997 — Implementation Intentions Experimental ─
  {
    title: "Implementation Intentions and Effective Goal Pursuit",
    authors: "Gollwitzer, Brandstatter",
    year: 1997,
    venue: "Journal of Personality and Social Psychology",
    tags: ["implementation-intentions", "goal-setting", "procrastination-prevention", "action-initiation"],
    summary:
      "Three studies establishing that implementation intentions dramatically increase goal completion rates. Difficult goals with implementation intentions were completed 3x more often (62% vs 22%). 83% of completers acted on the exact day specified in their plan. Lab study showed faster seizing of goal-relevant opportunities.",
    cards: [
      {
        claim: "For difficult-to-implement goals, forming implementation intentions tripled the completion rate (62% vs 22% in Study 1; 71% vs 32% in Study 2).",
        recommendation: "For challenging study tasks, always specify the exact day, time, and location you will begin. This simple planning step can triple the likelihood of actually completing the task.",
        boundaryConditions: "Effect is strongest for difficult goals. Easy routine tasks already show ~80% completion. The effect was independent of goal importance and anticipated obstacles.",
        strength: "STRONG",
        tags: ["implementation-intentions", "goal-completion", "procrastination-prevention"],
      },
      {
        claim: "83% of implementation intention participants who completed the task did so on the exact day they had specified in their plan.",
        recommendation: "When planning study sessions, commit to a specific time slot and location. The act of committing binds execution to that exact context, making follow-through nearly automatic.",
        boundaryConditions: "Demonstrated in field experiment with assigned goals. Works for both self-set and externally assigned implementation intentions.",
        strength: "STRONG",
        tags: ["implementation-intentions", "scheduling", "time-management"],
      },
    ],
  },

  // ── Zimmerman 2002 — Self-Regulated Learning ─────────────────
  {
    title: "Becoming a Self-Regulated Learner: An Overview",
    authors: "Zimmerman",
    year: 2002,
    venue: "Theory Into Practice",
    tags: ["self-regulation", "goal-setting", "metacognition", "self-efficacy", "study-strategies"],
    summary:
      "Presents a three-phase cyclical model of self-regulated learning: forethought (goal setting, strategic planning), performance (self-control, self-observation), and self-reflection (self-evaluation, causal attribution). Experts differ from novices in how they apply these processes. Setting specific proximal goals leads to superior achievement.",
    cards: [
      {
        claim: "Setting specific, proximal goals leads to superior achievement and greater self-efficacy compared to vague or distal goals.",
        recommendation: "Break study goals into specific, near-term targets (e.g., 'memorize 20 vocabulary words by Thursday' rather than 'study for the exam'). Each study session should have a concrete, measurable objective.",
        boundaryConditions: "The principle applies broadly across academic tasks. Specific goal types may vary by domain.",
        strength: "STRONG",
        tags: ["goal-setting", "self-regulation", "session-structure", "self-efficacy"],
      },
      {
        claim: "Self-regulated learning follows a three-phase cycle (forethought, performance, self-reflection) and students who engage in all three phases show high correlations with academic achievement.",
        recommendation: "Structure each study session with all three phases: (1) set goals and plan strategy before starting, (2) use self-control and self-monitor during the session, (3) self-evaluate and reflect on what worked afterward.",
        boundaryConditions: "Students at different skill levels need different levels of social support and scaffolding.",
        strength: "STRONG",
        tags: ["self-regulation", "session-structure", "metacognition", "study-strategies"],
      },
      {
        claim: "Attributing poor performance to controllable processes (e.g., wrong strategy) sustains motivation, while attributing it to fixed ability damages motivation.",
        recommendation: "When study sessions yield poor results, frame the outcome as a strategy problem ('I need a different approach') rather than an ability problem. Study systems should encourage strategy-focused reflection after each session.",
        boundaryConditions: "Part of the self-reflection phase. Demonstrated across multiple studies in academic contexts.",
        strength: "STRONG",
        tags: ["self-regulation", "causal-attribution", "motivation", "self-reflection"],
      },
    ],
  },

  // ── Steel 2007 — Procrastination Meta-Analysis ───────────────
  {
    title: "The Nature of Procrastination: A Meta-Analytic and Theoretical Review of Quintessential Self-Regulatory Failure",
    authors: "Steel",
    year: 2007,
    venue: "Psychological Bulletin",
    tags: ["procrastination", "self-regulation", "meta-analysis", "temporal-discounting", "self-efficacy"],
    summary:
      "Meta-analysis of 691 correlations establishing that procrastination is best predicted by task aversiveness, temporal distance of deadlines, low self-efficacy, and impulsiveness. Supports Temporal Motivation Theory: task utility increases hyperbolically as deadlines approach. 80-95% of college students procrastinate.",
    cards: [
      {
        claim: "Task aversiveness is a strong predictor of procrastination. The effect interacts with temporal distance — distant deadlines on aversive tasks produce the most procrastination.",
        recommendation: "Begin study plans with or interleave the most aversive tasks with more enjoyable ones. Break large unpleasant tasks into smaller chunks. Pair aversive material with pleasant environments.",
        boundaryConditions: "Individual perception of aversiveness varies. Task aversiveness alone predicts avoidance; it requires temporal distance to produce procrastination.",
        strength: "STRONG",
        tags: ["procrastination", "task-aversiveness", "session-structure", "scheduling"],
      },
      {
        claim: "Temporal distance of deadlines is a fundamental driver of procrastination. Per Temporal Motivation Theory, task utility increases hyperbolically as the deadline approaches.",
        recommendation: "Create artificial proximal deadlines and immediate rewards for study tasks. Break semester-long projects into weekly milestones. Schedule study sessions close to when material will be tested.",
        boundaryConditions: "The effect is modulated by individual sensitivity to delay (impulsiveness). People can learn to counteract this tendency.",
        strength: "STRONG",
        tags: ["procrastination", "temporal-discounting", "scheduling", "deadline-management"],
      },
      {
        claim: "Low self-efficacy is a strong predictor of procrastination, creating a potential failure spiral (procrastination → poor performance → lower self-efficacy → more procrastination).",
        recommendation: "Build self-efficacy by scheduling early, achievable study wins before tackling harder material. Start sessions with review of previously mastered content to build confidence.",
        boundaryConditions: "Self-efficacy is domain-specific. The failure spiral can be broken by strategy attribution.",
        strength: "STRONG",
        tags: ["procrastination", "self-efficacy", "session-structure", "motivation"],
      },
      {
        claim: "Impulsiveness (not neuroticism or anxiety) is a strong predictor of procrastination. Impulsive individuals are more sensitive to immediate gratification and distractions.",
        recommendation: "For highly impulsive students, structure environments to minimize distractions: remove phones, use website blockers. Use shorter study sessions with more frequent breaks.",
        boundaryConditions: "Impulsiveness has a trait component but is modifiable through environmental control. Neuroticism showed only weak associations, contrary to popular belief.",
        strength: "STRONG",
        tags: ["procrastination", "impulsiveness", "distraction-management", "session-duration"],
      },
    ],
  },

  // ── Bloom's Taxonomy & Question Design ──────────────────────
  {
    title: "A Taxonomy for Learning, Teaching, and Assessing: A Revision of Bloom's Taxonomy of Educational Objectives",
    authors: "Anderson, Krathwohl, Airasian, Cruikshank, Mayer, Pintrich, Rathis, Wittrock",
    year: 2001,
    venue: "Longman",
    tags: ["question-design", "blooms-taxonomy", "higher-order-thinking"],
    summary:
      "Revised Bloom's taxonomy organizes cognitive processes into six levels: Remember, Understand, Apply, Analyze, Evaluate, Create. Questions targeting higher levels (Apply and above) produce better transfer and deeper understanding than lower-level recall questions, though recall questions are appropriate for initial learning stages.",
    cards: [
      {
        claim: "Questions at the Apply, Analyze, and Evaluate levels of Bloom's taxonomy produce better transfer to novel problems than Remember-level questions, even when both are equally difficult.",
        recommendation: "Generate practice questions across multiple Bloom's levels. Start sessions with Remember/Understand questions, then progress to Apply/Analyze. At least 40% of retrieval questions should be at Apply level or above. For exam simulation sessions, match the Bloom's level distribution to the expected exam.",
        boundaryConditions: "Lower-level questions are necessary scaffolding for beginners. Jumping to Analyze-level questions without foundational knowledge is counterproductive. The optimal distribution depends on the subject — STEM benefits more from Apply/Analyze, humanities from Evaluate/Create.",
        strength: "STRONG",
        tags: ["question-design", "blooms-taxonomy", "question-difficulty", "transfer"],
      },
      {
        claim: "Questions that require generation (producing an answer from memory) produce stronger memory traces than recognition-based questions (selecting from options), even when recognition questions are harder.",
        recommendation: "Prefer short-answer and free-recall question formats over multiple-choice for retrieval practice. Use multiple-choice only as scaffolding for very difficult material or for diagnostic sessions. When multiple-choice is used, include plausible distractors based on common misconceptions.",
        boundaryConditions: "Multiple-choice can be effective when distractors are designed to target specific misconceptions. The generation advantage is smaller for very complex material where students lack sufficient knowledge to generate any answer.",
        strength: "STRONG",
        tags: ["question-design", "generation-effect", "question-format", "retrieval-practice"],
      },
    ],
  },

  // ── Elaborative Interrogation ───────────────────────────────
  {
    title: "Using Elaborative Interrogation to Help Students Learn",
    authors: "Pressley, McDaniel, Turnure, Wood, Ahmad",
    year: 1987,
    venue: "Journal of Educational Psychology",
    tags: ["elaborative-interrogation", "question-design", "why-questions"],
    summary:
      "Elaborative interrogation — prompting learners to generate explanations for why stated facts are true — significantly enhances learning compared to reading alone or even reading with provided explanations. The 'why' prompt forces deeper processing and connection to prior knowledge.",
    cards: [
      {
        claim: "'Why is this true?' and 'How does this work?' questions produce 30-50% better retention than factual recall questions alone, by forcing learners to connect new information to existing knowledge.",
        recommendation: "After initial retrieval questions on a topic, follow up with elaborative 'why' and 'how' questions. For every 3 factual recall questions, include 1-2 elaborative questions. Use elaborative interrogation especially in ERROR_REPAIR sessions to deepen understanding of corrected answers.",
        boundaryConditions: "Elaborative interrogation requires sufficient prior knowledge to generate explanations. For completely novel domains, provide some initial context before asking 'why' questions. Most effective for factual and conceptual learning; less studied for procedural skills.",
        strength: "STRONG",
        tags: ["question-design", "elaborative-interrogation", "why-questions", "deep-processing"],
      },
      {
        claim: "Self-generated explanations are more effective than provided explanations, even when the provided explanations are more accurate.",
        recommendation: "When generating practice questions, prefer open-ended 'explain why' formats over providing explanations for the student to read. After a student answers incorrectly, ask them to explain why the correct answer is right rather than just showing the explanation.",
        boundaryConditions: "Students may generate incorrect explanations. Follow self-explanation with corrective feedback. The generation advantage decreases when students have very low prior knowledge.",
        strength: "MODERATE",
        tags: ["question-design", "self-explanation", "generation-effect"],
      },
    ],
  },

  // ── Error-Focused Question Design ───────────────────────────
  {
    title: "Learning from Errors",
    authors: "Metcalfe",
    year: 2017,
    venue: "Annual Review of Psychology",
    tags: ["error-correction", "question-design", "misconceptions", "feedback"],
    summary:
      "Research on learning from errors shows that errors committed with high confidence are corrected more effectively than low-confidence errors (the hypercorrection effect). Questions designed to elicit and then correct specific misconceptions produce stronger and more durable learning than questions that avoid errors.",
    cards: [
      {
        claim: "High-confidence errors are corrected more effectively than low-confidence errors (hypercorrection effect). When students are confidently wrong, the surprise of correction creates a stronger memory trace.",
        recommendation: "Design questions that target common misconceptions head-on rather than avoiding them. Include 'trap' questions that expose common errors. After a confident wrong answer, provide immediate corrective feedback with explanation. Track confidence levels to prioritize high-confidence errors for review.",
        boundaryConditions: "The hypercorrection effect requires immediate or near-immediate feedback. Delayed feedback weakens the correction. Effect is strongest for factual knowledge; less clear for complex procedural errors.",
        strength: "STRONG",
        tags: ["question-design", "error-correction", "hypercorrection", "misconceptions", "feedback"],
      },
      {
        claim: "Questions that elicit errors followed by corrective feedback produce better long-term retention than questions calibrated to produce only correct answers, provided feedback is given.",
        recommendation: "Don't make all practice questions easy. Target 60-80% accuracy during retrieval practice. Include deliberately challenging questions that expose gaps. Always pair error-producing questions with immediate, elaborative feedback.",
        boundaryConditions: "Errors without feedback can reinforce incorrect knowledge. This approach requires reliable corrective feedback. For very early learning stages, excessive errors can reduce motivation.",
        strength: "STRONG",
        tags: ["question-design", "desirable-difficulties", "error-correction", "target-accuracy"],
      },
    ],
  },

  // ── Question Sequencing & Adaptive Difficulty ───────────────
  {
    title: "Optimizing Learning Using Flashcards: Spacing Is More Effective Than Cramming",
    authors: "Kornell",
    year: 2009,
    venue: "Applied Cognitive Psychology",
    tags: ["question-sequencing", "adaptive-difficulty", "spacing", "flashcards"],
    summary:
      "Research on optimal question sequencing shows that interleaving question topics, spacing repetitions of the same question, and adapting difficulty based on performance all contribute to more efficient learning. Items answered incorrectly should be re-tested sooner than items answered correctly.",
    cards: [
      {
        claim: "Adaptive spacing — re-testing missed items sooner and correctly answered items later — produces more efficient learning than fixed spacing schedules.",
        recommendation: "After each retrieval session, immediately re-test items that were answered incorrectly. Items answered correctly should be spaced at increasing intervals. Use a simple algorithm: wrong → re-test same session or next day; right → re-test in 2-3 days; right twice → re-test in 5-7 days.",
        boundaryConditions: "Requires item-level tracking of correct/incorrect responses. The optimal expanding schedule varies by material difficulty and individual learner. Fixed spacing still works — adaptive just optimizes efficiency.",
        strength: "STRONG",
        tags: ["question-sequencing", "adaptive-difficulty", "spacing", "error-tracking"],
      },
      {
        claim: "Interleaving question topics within a practice session forces discrimination between problem types and improves the ability to select appropriate strategies on exams.",
        recommendation: "Mix questions from different topics within each practice session rather than grouping by topic. Include at least 3 different topics per interleaved session. Interleave similar-but-distinct topics that students commonly confuse.",
        boundaryConditions: "Interleaving is most beneficial after initial learning of each topic. Very early in learning, brief blocked practice may be needed. Interleaving works best for topics that share surface similarity but require different solutions.",
        strength: "STRONG",
        tags: ["question-sequencing", "interleaving", "discrimination-training"],
      },
    ],
  },
];

// ── Seed Script ─────────────────────────────────────────────────

async function seed() {
  console.log("Seeding research knowledge base...\n");

  let papersCreated = 0;
  let cardsCreated = 0;
  let documentsCreated = 0;
  let chunksCreated = 0;

  for (const paper of PAPERS) {
    // Build full-text content for the document/chunk system
    const fullText = [
      `# ${paper.title}`,
      `Authors: ${paper.authors} (${paper.year})`,
      `Venue: ${paper.venue}`,
      `Tags: ${paper.tags.join(", ")}`,
      "",
      "## Summary",
      paper.summary,
      "",
      ...paper.cards.flatMap((card, i) => [
        `## Finding ${i + 1} [${card.strength}]`,
        `Claim: ${card.claim}`,
        "",
        `Recommendation: ${card.recommendation}`,
        "",
        `Boundary Conditions: ${card.boundaryConditions}`,
        "",
      ]),
    ].join("\n");

    const contentHash = sha256(Buffer.from(fullText));

    // Check if already seeded (idempotent)
    const existing = await prisma.contentDocument.findUnique({
      where: {
        userId_contentHash: { userId: SYSTEM_USER_ID, contentHash },
      },
    });

    if (existing) {
      console.log(`  ↳ Already seeded: ${paper.title}`);
      continue;
    }

    // Create content document
    const doc = await prisma.contentDocument.create({
      data: {
        userId: SYSTEM_USER_ID,
        namespace: "RESEARCH",
        title: paper.title,
        originalFilename: `${paper.authors.split(",")[0].trim().toLowerCase()}-${paper.year}.txt`,
        mimeType: "text/plain",
        storageKey: `__system__/research/${contentHash.slice(0, 12)}.txt`,
        contentHash,
        status: "PROCESSED",
      },
    });
    documentsCreated++;

    // Create chunks in batch (summary + one per card)
    const summaryText = `${paper.title}\n${paper.authors} (${paper.year})\n${paper.venue}\n\n${paper.summary}`;
    const chunkDataList = [
      {
        documentId: doc.id,
        ordinal: 0,
        text: summaryText,
        textHash: sha256(Buffer.from(paper.summary)),
        embeddingStatus: "PENDING",
      },
      ...paper.cards.map((card, i) => {
        const chunkText = [
          `Source: ${paper.title} (${paper.authors}, ${paper.year})`,
          `Evidence Strength: ${card.strength}`,
          "",
          `Claim: ${card.claim}`,
          "",
          `Recommendation: ${card.recommendation}`,
          "",
          `Boundary Conditions: ${card.boundaryConditions}`,
        ].join("\n");
        return {
          documentId: doc.id,
          ordinal: i + 1,
          text: chunkText,
          textHash: sha256(Buffer.from(chunkText)),
          embeddingStatus: "PENDING",
        };
      }),
    ];
    await prisma.contentChunk.createMany({ data: chunkDataList });
    chunksCreated += chunkDataList.length;

    // Create EvidencePaper + cards in batch
    const evidencePaper = await prisma.evidencePaper.create({
      data: {
        userId: SYSTEM_USER_ID,
        title: paper.title,
        authors: paper.authors,
        year: paper.year,
        venue: paper.venue,
        documentId: doc.id,
        tags: paper.tags,
      },
    });
    papersCreated++;

    await prisma.evidenceCard.createMany({
      data: paper.cards.map((card) => ({
        evidencePaperId: evidencePaper.id,
        claim: card.claim,
        recommendation: card.recommendation,
        boundaryConditions: card.boundaryConditions,
        strength: card.strength,
        tags: card.tags,
      })),
    });
    cardsCreated += paper.cards.length;

    console.log(`  ✓ ${paper.title} (${paper.cards.length} cards)`);
  }

  console.log(`\nDone: ${papersCreated} papers, ${cardsCreated} cards, ${documentsCreated} documents, ${chunksCreated} chunks`);

  // Enqueue embedding jobs for all PENDING system research chunks
  if (process.env.AI_PROVIDER === "mock") {
    console.log("\nSkipping embedding queue (AI_PROVIDER=mock)");
  } else {
    const pendingChunks = await prisma.contentChunk.findMany({
      where: {
        embeddingStatus: "PENDING",
        document: { userId: SYSTEM_USER_ID },
      },
      select: { id: true },
    });

    if (pendingChunks.length > 0) {
      const BATCH_SIZE = 15;
      let jobsEnqueued = 0;
      for (let i = 0; i < pendingChunks.length; i += BATCH_SIZE) {
        const batch = pendingChunks.slice(i, i + BATCH_SIZE);
        const payload: EmbedChunkBatchPayload = {
          chunkIds: batch.map((c) => c.id),
          userId: SYSTEM_USER_ID,
        };
        await enqueueJob("EMBED_CHUNK_BATCH", payload);
        jobsEnqueued++;
      }
      console.log(`\nQueued ${pendingChunks.length} chunks for embedding (${jobsEnqueued} jobs)`);
    } else {
      console.log("\nNo pending chunks to embed");
    }
  }
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
