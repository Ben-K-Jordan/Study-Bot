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

    // Create chunks from the full text (one chunk per section for research docs)
    // Summary chunk
    await prisma.contentChunk.create({
      data: {
        documentId: doc.id,
        ordinal: 0,
        text: `${paper.title}\n${paper.authors} (${paper.year})\n${paper.venue}\n\n${paper.summary}`,
        textHash: sha256(Buffer.from(paper.summary)),
        embeddingStatus: "PENDING",
      },
    });
    chunksCreated++;

    // One chunk per card (these are the key retrievable units)
    for (let i = 0; i < paper.cards.length; i++) {
      const card = paper.cards[i];
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

      await prisma.contentChunk.create({
        data: {
          documentId: doc.id,
          ordinal: i + 1,
          text: chunkText,
          textHash: sha256(Buffer.from(chunkText)),
          embeddingStatus: "PENDING",
        },
      });
      chunksCreated++;
    }

    // Create EvidencePaper + cards
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

    for (const card of paper.cards) {
      await prisma.evidenceCard.create({
        data: {
          evidencePaperId: evidencePaper.id,
          claim: card.claim,
          recommendation: card.recommendation,
          boundaryConditions: card.boundaryConditions,
          strength: card.strength,
          tags: card.tags,
        },
      });
      cardsCreated++;
    }

    console.log(`  ✓ ${paper.title} (${paper.cards.length} cards)`);
  }

  console.log(`\nDone: ${papersCreated} papers, ${cardsCreated} cards, ${documentsCreated} documents, ${chunksCreated} chunks`);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
