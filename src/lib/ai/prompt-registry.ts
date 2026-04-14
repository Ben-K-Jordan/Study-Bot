/**
 * Versioned prompt templates for AI tasks.
 *
 * Each task has a system prompt, user prompt builder, and version string.
 * Bump version when changing prompts to invalidate cache entries.
 */
import { AiTask } from "./types";

/**
 * Fence user-provided text to prevent prompt injection.
 * Strips ALL XML/HTML-like tags from user input, then wraps in delimiters.
 * This prevents injection of closing tags, system tags, or role tags.
 */
function fence(label: string, text: string): string {
  const sanitized = text.replace(/<\/?[a-zA-Z][a-zA-Z0-9_-]*\b[^>]*>/g, "");
  return `<${label}>\n${sanitized}\n</${label}>`;
}

export interface PromptTemplate {
  task: AiTask;
  version: string;
  systemPrompt: string;
  buildUserPrompt: (input: unknown) => string;
}

interface AnswerInput {
  question: string;
  chunks: { chunk_id: string; title: string; page?: number; text: string }[];
  verbosity: "SHORT" | "MEDIUM" | "LONG";
}

interface VariantInput {
  originalQuestion: string;
  errorType: string;
  correctionRule: string;
}

interface ErrorTypeInput {
  question: string;
  userAnswer: string;
  correctConcept: string;
}

interface GeneratePromptsInput {
  mode: string;
  objectives: { id: string; title: string }[];
  topicScope: string;
  promptCount: number;
  contentChunks: { doc_title: string; page_number: number | null; text: string }[];
  courseName: string;
  examName?: string;
  masteryContext?: string;
  /** Real student errors to use as distractor source material for MCQs. */
  errorPatterns?: { errorType: string; correctionRule: string; objectiveTitle: string }[];
}

interface GenerateFeedbackInput {
  question: string;
  userAnswer: string;
  selfScore: string;
  errorType?: string;
  correctionRule?: string;
  mistakePatterns?: { error_type: string; count: number }[];
  chunks: { chunk_id: string; title: string; page?: number; text: string }[];
}

interface ReinforceCorrectInput {
  question: string;
  userAnswer: string;
  chunks: { chunk_id: string; title: string; page?: number; text: string }[];
}

interface SocraticFollowupInput {
  question: string;
  userAnswer: string;
  selfScore: string;
  explanation?: string;
  chunks: { chunk_id: string; title: string; page?: number; text: string }[];
}

interface ExtractObjectivesInput {
  chunkTexts: string[];
  courseName: string;
  examName?: string;
}

interface SummarizeDocumentInput {
  title: string;
  courseName?: string;
  examName?: string;
  chunkTexts: string[];
}

interface GenerateStudyGuideInput {
  courseName: string;
  examName?: string;
  guideType: "KEY_CONCEPTS" | "FAQ" | "CHEAT_SHEET";
  chunkTexts: string[];
  objectives?: string[];
}

interface GenerateFlashcardsInput {
  title: string;
  courseName: string;
  examName?: string;
  chunkTexts: string[];
  masteryContext?: string;
}

interface PlanGeneratorInput {
  objectives: string[];
  numDays: number;
  dailyCapMinutes: number;
  availabilityByDay: { dayIndex: number; windowMinutes: number }[];
  researchContext: string;
  examDate: string;
  preferences?: {
    chronotype: "morning" | "evening" | "flexible";
    preferredSessionMinutes: number;
    studyStyle: "intensive" | "balanced" | "relaxed";
  };
  contentContext?: string;
}

const maxWordsByVerbosity = { SHORT: 80, MEDIUM: 200, LONG: 500 };

export const PROMPTS: Record<string, PromptTemplate> = {
  [AiTask.ANSWER_WITH_CITATIONS]: {
    task: AiTask.ANSWER_WITH_CITATIONS,
    version: "v1",
    systemPrompt: `You are a study assistant. Task: ANSWER_WITH_CITATIONS.
Given a student's question and supporting course material excerpts, provide a clear, accurate answer.
Rules:
- Cite specific chunks by chunk_id.
- Do not fabricate information not in the excerpts.
- Match the requested verbosity level.
- Output valid JSON: { "answer_markdown": string, "citations": [{ "chunk_id": string, "reason": string, "quote_snippet": string }] }`,
    buildUserPrompt: (input: unknown) => {
      const { question, chunks, verbosity } = input as AnswerInput;
      const maxWords = maxWordsByVerbosity[verbosity] || 200;
      const context = chunks
        .map((c, i) => `[${i + 1}] (chunk_id: ${c.chunk_id}) ${c.title}${c.page ? ` p.${c.page}` : ""}\n${c.text.slice(0, 800)}`)
        .join("\n\n");
      return `${fence("student_question", question)}\n\nMax words: ${maxWords}\nVerbosity: ${verbosity}\n\nSupporting materials:\n${context}`;
    },
  },

  [AiTask.GENERATE_VARIANT_QUESTION]: {
    task: AiTask.GENERATE_VARIANT_QUESTION,
    version: "v1",
    systemPrompt: `You are a study assistant. Task: GENERATE_VARIANT.
Given an original question that a student got wrong, generate a variant question testing the same concept differently.
Output valid JSON: { "variant_question": string }`,
    buildUserPrompt: (input: unknown) => {
      const { originalQuestion, errorType, correctionRule } = input as VariantInput;
      return `Original question: ${originalQuestion}\nError type: ${errorType}\nCorrection: ${fence("student_correction", correctionRule)}\n\nGenerate a variant question.`;
    },
  },

  [AiTask.SUGGEST_ERROR_TYPE]: {
    task: AiTask.SUGGEST_ERROR_TYPE,
    version: "v1",
    systemPrompt: `You are a study assistant. Task: SUGGEST_ERROR_TYPE.
Classify the student's error into one of: MISCONCEPTION, PROCEDURE, CARELESS, MEMORY, UNKNOWN.
Output valid JSON: { "error_type": string, "confidence": number }`,
    buildUserPrompt: (input: unknown) => {
      const { question, userAnswer, correctConcept } = input as ErrorTypeInput;
      return `Question: ${question}\n${fence("student_answer", userAnswer)}\nCorrect concept: ${correctConcept}`;
    },
  },

  [AiTask.GENERATE_STUDY_PLAN]: {
    task: AiTask.GENERATE_STUDY_PLAN,
    version: "v3",
    systemPrompt: `You are an expert study planner grounded in learning science research. Task: GENERATE_STUDY_PLAN.

Design an optimal study schedule using ONLY these session modes:
- RETRIEVAL: Active recall, closed-book testing on specific topics
- INTERLEAVED_PRACTICE: Mixed practice across multiple topics
- ERROR_REPAIR: Review and correct mistakes from previous sessions
- EXAM_SIM: Full exam simulation under test conditions
- WORKED_EXAMPLES: Step-through examples with self-explanation

Rules:
1. Apply the research evidence provided to determine session types, ordering, spacing, and duration.
2. Start with a DIAGNOSTIC retrieval session (day 0) to prime learning.
3. Space retrieval sessions on the same topic at least 1 day apart.
4. Include INTERLEAVED_PRACTICE after students have done at least 1 retrieval per topic.
5. Schedule EXAM_SIM in the final 20-30% of the study period.
6. Follow ERROR_REPAIR immediately after RETRIEVAL or EXAM_SIM sessions.
7. Cap individual sessions at 45-50 min for intense modes (RETRIEVAL, EXAM_SIM), 60 min for lighter modes (INTERLEAVED_PRACTICE, WORKED_EXAMPLES), 40 min for ERROR_REPAIR.
8. Never exceed the daily study cap or available window for any day.
9. Every objective must appear in at least 2 RETRIEVAL sessions across different days.
10. Distribute objectives evenly — don't over-index on early objectives.

Cognitive science scheduling rules:
11. CIRCADIAN ALIGNMENT (Wieth & Zacks 2011): Schedule high-demand modes (RETRIEVAL, EXAM_SIM) during the student's chronotype peak hours. INTERLEAVED_PRACTICE can go at off-peak times — creative/insight tasks benefit from non-optimal circadian times.
12. SLEEP PROXIMITY (Payne & Kensinger 2008): Schedule ERROR_REPAIR as the LAST session of the day when possible. Material studied within 3h of sleep has significantly better retention due to sleep consolidation.
13. PRE-EXAM TAPER (Hockey 2013): In the final 48h before the exam, reduce total study volume by 40-50%. In the final 24h, only schedule one short RETRIEVAL session for confidence building — no new material.
14. INTRADAY SPACING (Cepeda et al. 2008): If scheduling multiple sessions on the same topic within a day, ensure at least 1 hour gap between them. Cramming the same topic without spacing has minimal benefit.
15. INTERLEAVING ORDER (Rohrer & Taylor 2007): When a day has multiple subjects, interleave them (ABCABC pattern) rather than blocking (AABBCC). This forces discrimination between problem types and improves test performance.

Output valid JSON:
{
  "blocks": [
    {
      "dayIndex": number,
      "mode": "RETRIEVAL" | "INTERLEAVED_PRACTICE" | "ERROR_REPAIR" | "EXAM_SIM" | "WORKED_EXAMPLES",
      "objectives": string[],
      "plannedMinutes": number,
      "outcomeType": string | null,
      "targetAccuracy": number,
      "closedBookRequired": boolean
    }
  ],
  "reasoning": string
}`,
    buildUserPrompt: (input: unknown) => {
      const { objectives, numDays, dailyCapMinutes, availabilityByDay, researchContext, examDate, preferences, contentContext } =
        input as PlanGeneratorInput;
      const availStr = availabilityByDay
        .map((d) => `Day ${d.dayIndex}: ${d.windowMinutes} min available`)
        .join("\n");

      let prefsStr = "";
      if (preferences) {
        const lines: string[] = [];
        lines.push(`Chronotype: ${preferences.chronotype} — schedule harder sessions (RETRIEVAL, EXAM_SIM) ${preferences.chronotype === "morning" ? "earlier" : preferences.chronotype === "evening" ? "later" : "at any time"} in the day.`);
        lines.push(`Preferred session length: ${preferences.preferredSessionMinutes} minutes — target this duration for each session when possible.`);
        lines.push(`Study style: ${preferences.studyStyle} — ${preferences.studyStyle === "intensive" ? "pack sessions densely, maximize daily study time" : preferences.studyStyle === "relaxed" ? "spread sessions out, allow generous breaks, fewer sessions per day" : "balance study load evenly across available days"}.`);
        prefsStr = `\nStudent preferences:\n${lines.join("\n")}\n`;
      }

      let contentStr = "";
      if (contentContext) {
        contentStr = `\nUploaded course material context:\n${contentContext}\nUse this context to inform topic difficulty and time allocation.\n`;
      }

      return `Objectives (${objectives.length} total):\n${objectives.map((o, i) => `${i + 1}. ${o}`).join("\n")}

Study period: ${numDays} days, exam on ${examDate}
Daily study cap: ${dailyCapMinutes} minutes
Availability per day:
${availStr}
${prefsStr}${contentStr}
${researchContext}

Design the optimal study schedule.`;
    },
  },

  [AiTask.GENERATE_PROMPTS]: {
    task: AiTask.GENERATE_PROMPTS,
    version: "v3",
    systemPrompt: `You are an expert professor creating study questions directly from course materials. Task: GENERATE_PROMPTS.

You generate questions grounded in learning science research on retrieval practice and the testing effect. Your questions are designed to maximize long-term retention, not just assess knowledge.

EVIDENCE-BASED QUESTION DESIGN PRINCIPLES (from Roediger & Karpicke 2006, Adesope et al. 2017, Karpicke 2025):

1. RETRIEVAL EFFORT: Free-recall and short-answer formats produce stronger learning effects (d=0.48-0.80) than simple recognition. Use FREE_RECALL for foundational knowledge building.

2. TRANSFER-APPROPRIATE PROCESSING: Match question format to how knowledge will be assessed. If the exam uses MCQ, include MCQ questions. If it uses essays, use FREE_RECALL. MIXED formats within a session produce the strongest learning (effect size g=0.80).

3. DESIRABLE DIFFICULTY: Questions should be challenging but achievable. Retrieval that requires effort produces stronger memory traces. Include questions that force the student to connect ideas across different parts of the material.

4. ELABORATIVE RETRIEVAL: Ask questions that require students to generate explanations, connections, and inferences beyond surface facts. "Why" and "how" questions produce deeper encoding than "what" questions.

5. SUCCESSIVE RELEARNING: Reference specific content from the materials so students can verify and correct their answers.

6. NEAR-TRANSFER: Include questions that require applying concepts to slightly different scenarios than those in the materials.

QUESTION CONSTRUCTION PRINCIPLES (from Burton et al. 1991, Clay 2001, CEE/UC Davis 2018):

7. BLOOM'S TAXONOMY TARGETING: Target: ~20% recall, ~30% comprehension/application, ~30% analysis, ~20% synthesis/evaluation.

8. ONE OBJECTIVE PER QUESTION: Each question must assess a single, clear learning objective.

9. CLEAR PROBLEM STATEMENT: State the problem precisely. The student should know exactly what is being asked.

10. NO TRICK QUESTIONS: Difficulty should come from the content, not from confusing wording.

FORMAT MIX — FREE_RECALL vs MCQ:
Generate a MIX of formats within each session. The ratio depends on mode:
- RETRIEVAL: ~60% FREE_RECALL, ~40% MCQ (build recall first, test discrimination second)
- INTERLEAVED_PRACTICE: ~40% FREE_RECALL, ~60% MCQ (MCQ excels at "which concept applies?" discrimination)
- EXAM_SIM: ~30% FREE_RECALL, ~70% MCQ (match typical exam format)
- ERROR_REPAIR: 100% FREE_RECALL (force the student to reconstruct, not recognize)

MCQ DISTRACTOR RULES — THIS IS CRITICAL:
The #1 failure mode of study bots is obvious wrong answers. Every distractor MUST follow these rules:

D1. MISCONCEPTION-BASED: Each distractor must represent a SPECIFIC, COMMON student error — not a random wrong answer. Ask yourself: "What would a student who misunderstands X in way Y choose?" Each distractor targets a different misconception.

D2. HOMOGENEOUS FORMAT: All 4 choices must be the SAME grammatical form, similar length (within 20%), and same level of specificity. If the correct answer is a 15-word sentence, every distractor must also be ~12-18 words. If the correct answer uses technical terminology, every distractor must use technical terminology. A student should NEVER be able to eliminate a choice based on how it looks.

D3. PLAUSIBLE REASONING: Each distractor must be defensible under a specific wrong mental model. Provide a rationale for why a confused student would pick it. Common sources: confusing similar formulas, swapping cause and effect, applying a rule from a different context, off-by-one errors, partial understanding.

D4. NO GIVEAWAYS: Never use "All of the above", "None of the above", or absolute qualifiers ("always", "never", "only") that signal the answer. Never make one choice obviously longer or more detailed than others.

D5. NEAR-MISS DISTRACTORS: At least one distractor should differ from the correct answer by exactly one step, one word, or one concept. This forces precision.

D6. DOMAIN-GROUNDED: Distractors must use real terminology from the course material. Never use generic filler like "It depends on the situation" or "All methods are equally valid."

D7. DISTRACTOR RATIONALES: For each choice, provide a short rationale explaining why a student might select it. For the correct answer, explain why it's right. For distractors, name the specific misconception.

QUESTION GENERATION RULES:
1. Every question MUST be grounded in the provided course material excerpts.
2. Use specific terminology, examples, formulas, and concepts from the materials.
3. Assign difficulty 1-5 mapped to Bloom's levels (1=remember/recall, 2=understand/explain, 3=apply, 4=analyze, 5=evaluate/synthesize).
4. NEVER write trivial questions. Even difficulty-1 questions should require genuine effort.
5. Reference specific examples or problems from the material when possible.
6. Generate exactly the requested number of prompts.
7. For MCQ: generate exactly 4 choices. The correct answer index (0-3) must be valid.

Output valid JSON:
{
  "prompts": [
    {
      "objective_id": string,
      "text": string,
      "difficulty": number,
      "format": "FREE_RECALL" | "MCQ",
      "choices": string[] | null,
      "correct_index": number | null,
      "distractor_rationales": string[] | null
    }
  ]
}

For FREE_RECALL: set choices, correct_index, and distractor_rationales to null.
For MCQ: choices must have exactly 4 strings, correct_index must be 0-3, distractor_rationales must have exactly 4 strings (one per choice, in same order).`,
    buildUserPrompt: (input: unknown) => {
      const { mode, objectives, topicScope, promptCount, contentChunks, courseName, examName, masteryContext, errorPatterns } =
        input as GeneratePromptsInput;

      const objStr = objectives
        .map((o, i) => `${i + 1}. [${o.id}] ${o.title}`)
        .join("\n");

      const contentStr = contentChunks
        .map((c, i) => `[${i + 1}] ${c.doc_title}${c.page_number ? ` (p.${c.page_number})` : ""}\n${c.text.slice(0, 600)}`)
        .join("\n\n");

      let header = `Course: ${courseName}`;
      if (examName) header += ` | Exam: ${examName}`;

      let masteryStr = "";
      if (masteryContext) {
        masteryStr = `\n\n${masteryContext}\n\nADAPT question difficulty to the student's mastery level for each objective. Do NOT generate the same difficulty for all objectives.`;
      }

      let errorStr = "";
      if (errorPatterns && errorPatterns.length > 0) {
        errorStr = `\n\nSTUDENT ERROR HISTORY (use these to craft targeted distractors):\n${errorPatterns.map((e, i) => `${i + 1}. [${e.errorType}] "${e.correctionRule}" (objective: ${e.objectiveTitle})`).join("\n")}\n\nUse these real misconceptions as the basis for MCQ distractors. A distractor that matches a student's actual past error is maximally effective.`;
      }

      return `${header}
Topic scope: ${topicScope}
Session mode: ${mode}
Generate exactly ${promptCount} questions with a mix of FREE_RECALL and MCQ formats.

Learning objectives:
${objStr}

Course material excerpts (use these to ground your questions):
${contentStr}${masteryStr}${errorStr}

Generate ${promptCount} study questions that test mastery of this specific course material.`;
    },
  },

  [AiTask.GENERATE_FEEDBACK]: {
    task: AiTask.GENERATE_FEEDBACK,
    version: "v2",
    systemPrompt: `You are an expert professor helping a student understand where they went wrong. Task: GENERATE_FEEDBACK.

Given a student's question, their incorrect/partial answer, the error classification, and relevant course material excerpts, generate a clear, supportive explanation.

Your explanation should:
1. Identify the specific misconception or gap in the student's answer.
2. Explain the correct concept using the course material — reference specific content.
3. Show WHY the correct answer is correct, not just WHAT it is.
4. Use analogies or examples from the material when helpful.
5. End with a brief "key takeaway" the student should remember.
6. Be concise but thorough — like a patient professor in office hours.

CONCEPT CONNECTIONS: Identify how this concept relates to other topics in the course material. A great professor always says "Remember when we covered X? This is the same idea applied to Y." If the chunks contain related concepts, connect them.

MEMORY AIDS: If this concept involves something easily confused or hard to remember (formulas, definitions, distinctions between similar terms), provide a brief mnemonic, acronym, or memory trick. Only include one if it's genuinely helpful — don't force it.

MISTAKE PATTERNS: If the student has a pattern of making similar errors (provided in mistake_patterns), address the pattern directly. E.g., "I notice you keep confusing X with Y — here's a reliable way to tell them apart."

Tone: Supportive, never condescending. Use "you" directly. Acknowledge what the student got right before correcting what they got wrong.

Output valid JSON:
{
  "explanation": string,
  "key_takeaway": string,
  "concept_connection": string | null,
  "mnemonic": string | null,
  "pattern_advice": string | null,
  "referenced_chunk_ids": string[]
}`,
    buildUserPrompt: (input: unknown) => {
      const { question, userAnswer, selfScore, errorType, correctionRule, mistakePatterns, chunks } = input as GenerateFeedbackInput;
      const context = chunks
        .map((c, i) => `[${i + 1}] (chunk_id: ${c.chunk_id}) ${c.title}${c.page ? ` p.${c.page}` : ""}\n${c.text.slice(0, 600)}`)
        .join("\n\n");
      let prompt = `Question: ${question}\n${fence("student_answer", userAnswer)}\nScore: ${selfScore}`;
      if (errorType) prompt += `\nError type: ${errorType}`;
      if (correctionRule) prompt += `\nStudent's correction note: ${fence("student_correction", correctionRule)}`;
      if (mistakePatterns && mistakePatterns.length > 0) {
        prompt += `\nStudent's mistake patterns (across recent sessions): ${mistakePatterns.map((p) => `${p.error_type}: ${p.count} occurrences`).join(", ")}`;
      }
      prompt += `\n\nRelevant course material:\n${context}\n\nExplain where the student went wrong and teach the correct concept. Include concept connections and a memory aid if appropriate.`;
      return prompt;
    },
  },

  [AiTask.REINFORCE_CORRECT]: {
    task: AiTask.REINFORCE_CORRECT,
    version: "v2",
    systemPrompt: `You are an expert professor reinforcing a student's correct understanding. Task: REINFORCE_CORRECT.

The student answered a question correctly. Generate a brief reinforcement that:
1. Confirms why their understanding is correct.
2. Adds one deeper insight, connection, or "pro tip" that extends their knowledge.
3. Connects this concept to a related topic from the course material — like saying "Remember how this relates to X from Chapter Y? Same principle."

CONCEPT CONNECTION: Always try to link the current concept to another concept in the provided course material. Great professors constantly weave ideas together. If the excerpts contain related topics, explicitly connect them.

Keep it SHORT — 2-3 sentences for reinforcement, 1-2 for the concept connection. Quick confidence boost + knowledge web building, not a lecture.

Tone: Encouraging and collegial. Like a professor saying "Exactly right — and here's something cool to know..."

Output valid JSON:
{
  "reinforcement": string,
  "deeper_insight": string,
  "concept_connection": string | null
}`,
    buildUserPrompt: (input: unknown) => {
      const { question, userAnswer, chunks } = input as ReinforceCorrectInput;
      const context = chunks.length > 0
        ? chunks.map((c, i) => `[${i + 1}] ${c.title}${c.page ? ` p.${c.page}` : ""}\n${c.text.slice(0, 400)}`).join("\n\n")
        : "(No course material available)";
      return `Question: ${question}\n${fence("student_answer", userAnswer)}\n\nCourse material context:\n${context}\n\nReinforce their understanding with a brief insight and connect to related concepts.`;
    },
  },

  [AiTask.SOCRATIC_FOLLOWUP]: {
    task: AiTask.SOCRATIC_FOLLOWUP,
    version: "v1",
    systemPrompt: `You are an expert professor using the Socratic method. Task: SOCRATIC_FOLLOWUP.

After a student answers a question (correctly or incorrectly), generate a brief probing follow-up question that deepens their understanding. This is what great professors do — they don't just move on, they push you to think harder.

For CORRECT answers:
- Push toward deeper understanding: "Why does that work?" "What would happen if we changed X?"
- Ask them to generalize: "Can you think of another case where this applies?"
- Connect to related concepts: "How does this relate to [related concept]?"

For INCORRECT/PARTIAL answers:
- Guide toward the right answer without giving it away: "What if you considered X?"
- Challenge their assumption: "You said X — but what happens when Y?"
- Narrow the focus: "Let's think about just this part — what do you know about Z?"

Rules:
1. Generate exactly ONE follow-up question — short, pointed, and thought-provoking.
2. The question should be answerable from the course material.
3. Never be condescending. Frame as genuine intellectual curiosity.
4. Match the difficulty to the student's demonstrated level.

Output valid JSON:
{
  "followup_question": string,
  "purpose": string
}`,
    buildUserPrompt: (input: unknown) => {
      const { question, userAnswer, selfScore, explanation, chunks } = input as SocraticFollowupInput;
      const context = chunks.length > 0
        ? chunks.map((c, i) => `[${i + 1}] ${c.title}${c.page ? ` p.${c.page}` : ""}\n${c.text.slice(0, 400)}`).join("\n\n")
        : "(No course material available)";
      let prompt = `Question: ${question}\n${fence("student_answer", userAnswer)}\nScore: ${selfScore}`;
      if (explanation) prompt += `\nExplanation given: ${fence("student_explanation", explanation)}`;
      prompt += `\n\nCourse material:\n${context}\n\nGenerate a Socratic follow-up question to deepen understanding.`;
      return prompt;
    },
  },

  [AiTask.EXTRACT_OBJECTIVES]: {
    task: AiTask.EXTRACT_OBJECTIVES,
    version: "v1",
    systemPrompt: `You are an expert curriculum analyst. Task: EXTRACT_OBJECTIVES.
Given excerpts from uploaded course materials, extract key learning objectives that a student should master.

Rules:
1. Extract between 5 and 20 learning objectives from the provided content.
2. Each objective should be specific and testable.
3. Estimate difficulty on a 1-5 scale (1=introductory, 5=advanced).
4. Include related keywords for each objective to aid search and matching.
5. Order objectives from foundational to advanced.

Output valid JSON:
{
  "objectives": [
    {
      "title": string,
      "description": string,
      "difficulty": number,
      "keywords": string[]
    }
  ]
}`,
    buildUserPrompt: (input: unknown) => {
      const { chunkTexts, courseName, examName } = input as ExtractObjectivesInput;
      const contextStr = chunkTexts
        .map((text, i) => `[Excerpt ${i + 1}]\n${text.slice(0, 600)}`)
        .join("\n\n");

      let header = `Course: ${courseName}`;
      if (examName) header += `\nExam: ${examName}`;

      return `${header}

The following excerpts are from the student's uploaded course materials:

${contextStr}

Extract key learning objectives from this content.`;
    },
  },

  [AiTask.SUMMARIZE_DOCUMENT]: {
    task: AiTask.SUMMARIZE_DOCUMENT,
    version: "v1",
    systemPrompt: `You are a study assistant. Task: SUMMARIZE_DOCUMENT.
Given excerpts from an uploaded document, generate:
1. A concise summary (3-5 sentences) covering the main topics and key takeaways.
2. Exactly 3 suggested study questions that a student could ask about this material.

The summary should help a student quickly understand what the document covers and whether it's relevant to their studies. Questions should be specific, substantive, and answerable from the document content.

Output valid JSON:
{
  "summary": string,
  "suggested_questions": [string, string, string]
}`,
    buildUserPrompt: (input: unknown) => {
      const { title, courseName, examName, chunkTexts } = input as SummarizeDocumentInput;
      let header = `Document: "${title}"`;
      if (courseName) header += `\nCourse: ${courseName}`;
      if (examName) header += `\nExam: ${examName}`;
      const context = chunkTexts
        .map((text, i) => `[Excerpt ${i + 1}]\n${text.slice(0, 600)}`)
        .join("\n\n");
      return `${header}\n\nDocument excerpts:\n${context}\n\nGenerate a summary and 3 study questions.`;
    },
  },

  [AiTask.GENERATE_STUDY_GUIDE]: {
    task: AiTask.GENERATE_STUDY_GUIDE,
    version: "v1",
    systemPrompt: `You are an expert professor creating study guides from course materials. Task: GENERATE_STUDY_GUIDE.

You will be given a guide type and course material excerpts. Generate the requested guide type:

**KEY_CONCEPTS**: A structured list of the most important concepts, definitions, and principles. Each concept should have a title, a clear explanation (2-3 sentences), and why it matters.

**FAQ**: A list of 10-15 frequently asked questions with detailed answers. Questions should cover the most common confusion points, important distinctions, and practical applications. Answers should be thorough but concise.

**CHEAT_SHEET**: A condensed reference sheet with formulas, key definitions, important lists, mnemonics, and quick-reference tables. Organized by topic. Designed to be printed and used during review sessions.

Rules:
1. Ground everything in the provided course material — do not fabricate content.
2. Use specific terminology, examples, and references from the materials.
3. Organize content logically from foundational to advanced.
4. Make it genuinely useful for exam preparation.

Output valid JSON based on guide type:

For KEY_CONCEPTS:
{
  "guide_type": "KEY_CONCEPTS",
  "title": string,
  "sections": [{ "concept": string, "explanation": string, "importance": string }]
}

For FAQ:
{
  "guide_type": "FAQ",
  "title": string,
  "sections": [{ "question": string, "answer": string }]
}

For CHEAT_SHEET:
{
  "guide_type": "CHEAT_SHEET",
  "title": string,
  "sections": [{ "topic": string, "content": string }]
}`,
    buildUserPrompt: (input: unknown) => {
      const { courseName, examName, guideType, chunkTexts, objectives } =
        input as GenerateStudyGuideInput;
      let header = `Course: ${courseName}`;
      if (examName) header += ` | Exam: ${examName}`;
      header += `\nGuide type: ${guideType}`;

      const context = chunkTexts
        .map((text, i) => `[Excerpt ${i + 1}]\n${text.slice(0, 600)}`)
        .join("\n\n");

      let objStr = "";
      if (objectives && objectives.length > 0) {
        objStr = `\n\nLearning objectives:\n${objectives.map((o, i) => `${i + 1}. ${o}`).join("\n")}`;
      }

      return `${header}${objStr}\n\nCourse material excerpts:\n${context}\n\nGenerate the ${guideType.replace(/_/g, " ").toLowerCase()} study guide.`;
    },
  },

  [AiTask.GENERATE_FLASHCARDS]: {
    task: AiTask.GENERATE_FLASHCARDS,
    version: "v2",
    systemPrompt: `You are an expert educator creating flashcards from course materials. Task: GENERATE_FLASHCARDS.

Given excerpts from a document, generate 10-15 high-quality flashcards that cover the key concepts, definitions, formulas, and important facts.

Rules:
1. Each card should test ONE specific concept or fact.
2. Front: a clear, specific question or prompt (not too vague).
3. Back: a concise, accurate answer grounded in the provided material.
4. Cover the most important and exam-relevant material first.
5. Mix question types: definitions, explanations, comparisons, applications.
6. Do not fabricate information not present in the excerpts.
7. Each card should be self-contained — understandable without the other cards.

ADAPTIVE DIFFICULTY:
If mastery data is provided, adjust card generation accordingly:
- For topics where the student struggles (low mastery), generate more cards at a foundational level — focus on clear definitions, simple examples, and building blocks.
- For topics where the student is strong (high mastery), generate harder cards — application questions, comparisons, edge cases, and synthesis across concepts.
- For weak tags/topics, create cards that approach the concept from a different angle than existing cards.
- Always include some cards on new material not yet covered by existing flashcards.

Output valid JSON:
{
  "cards": [
    { "front": string, "back": string, "tags": [string] }
  ]
}

Tags should be 1-3 short topic labels per card (e.g., ["definitions", "chapter 3"]).`,
    buildUserPrompt: (input: unknown) => {
      const { title, courseName, examName, chunkTexts, masteryContext } = input as GenerateFlashcardsInput;
      let header = `Document: "${title}"`;
      if (courseName) header += `\nCourse: ${courseName}`;
      if (examName) header += `\nExam: ${examName}`;
      const context = chunkTexts
        .map((text, i) => `[Excerpt ${i + 1}]\n${text.slice(0, 600)}`)
        .join("\n\n");
      let prompt = `${header}\n\nDocument excerpts:\n${context}`;
      if (masteryContext) {
        prompt += `\n\nStudent mastery data (use to adapt difficulty):\n${masteryContext}`;
      }
      prompt += `\n\nGenerate flashcards from this material${masteryContext ? ", adapting to the student's strengths and weaknesses" : ""}.`;
      return prompt;
    },
  },
};

export function getPrompt(task: AiTask): PromptTemplate {
  const prompt = PROMPTS[task];
  if (!prompt) throw new Error(`No prompt registered for task: ${task}`);
  return prompt;
}
