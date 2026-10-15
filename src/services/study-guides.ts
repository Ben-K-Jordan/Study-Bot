import { prisma } from "@/lib/db";
import { runTask, type GatewayContext } from "@/lib/ai/gateway";
import { AiTask } from "@/lib/ai/types";
import { getPrompt } from "@/lib/ai/prompt-registry";
import { createProvider } from "@/lib/ai/provider-factory";
import { logger } from "@/lib/logger";
import { sampleEvenly } from "@/lib/config";
import {
  guideTitle,
  isGuideType,
  normalizeGuideSections,
  type GuideSection,
  type GuideType,
} from "@/components/guides/guide-format";

export type { GuideSection, GuideType };

export interface StudyGuideData {
  id: string;
  user_id: string;
  course_name: string;
  exam_name: string | null;
  guide_type: GuideType;
  title: string;
  sections: GuideSection[];
  created_at: string;
}

/** Raised when a course (or exam) has no processed materials to write a guide from. */
export class NoGuideMaterialsError extends Error {
  readonly code = "NO_MATERIALS";
  constructor(courseName: string, examName?: string) {
    const scope = examName ? `${courseName} ${examName}` : courseName;
    super(`No finished ${scope} materials yet. Upload them on Plan, then generate the guide.`);
    this.name = "NoGuideMaterialsError";
  }
}

const GUIDE_MODEL = process.env.AI_MODEL_ANSWER || "gpt-4o-mini";

/** Parses the model's JSON. Sections are coerced to strings so a list or table never breaks rendering. */
export function parseGuideOutput(raw: unknown, guideType: GuideType, scopeName: string) {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sections = normalizeGuideSections(data.sections);
  if (sections.length === 0) throw new Error("The guide has no sections");
  return {
    guide_type: guideType,
    title: guideTitle(data.title, guideType, scopeName),
    sections,
  };
}

export async function generateStudyGuide(
  userId: string,
  courseName: string,
  examName: string | undefined,
  guideType: GuideType,
): Promise<StudyGuideData> {
  const docWhere: Record<string, unknown> = {
    userId,
    namespace: "COURSE",
    courseName,
    status: "PROCESSED",
  };
  if (examName) docWhere.examName = examName;

  // Count first so a large course never loads every chunk into memory.
  const totalChunks = await prisma.contentChunk.count({
    where: { document: { is: docWhere } },
  });
  if (totalChunks === 0) throw new NoGuideMaterialsError(courseName, examName);

  // Sample evenly across a capped fetch for representative coverage.
  const TARGET_SAMPLE = 20;
  const MAX_FETCH = 200;
  const [allChunks, sessions, earlier] = await Promise.all([
    prisma.contentChunk.findMany({
      where: { document: { is: docWhere } },
      orderBy: [{ documentId: "asc" }, { ordinal: "asc" }],
      select: { text: true },
      take: Math.min(totalChunks, MAX_FETCH),
    }),
    prisma.session.findMany({
      where: { userId, courseName, ...(examName ? { examName } : {}) },
      select: { objectives: true },
      take: 1,
      orderBy: { createdAt: "desc" },
    }),
    prisma.studyGuide.count({
      where: { userId, courseName, examName: examName || null, guideType },
    }),
  ]);

  const chunkTexts = sampleEvenly(allChunks, TARGET_SAMPLE).map((c) => c.text);

  let objectives: string[] | undefined;
  const stored = sessions[0]?.objectives;
  if (Array.isArray(stored)) {
    objectives = stored
      .map((o) => (o as { title?: unknown })?.title)
      .filter((t): t is string => typeof t === "string" && t.trim() !== "");
  }

  const ctx: GatewayContext = { userId, provider: createProvider() };
  const prompt = getPrompt(AiTask.GENERATE_STUDY_GUIDE);
  const scopeName = examName ? `${courseName} ${examName}` : courseName;

  // A second guide of the same format is a request for a new version, so
  // skip the cache that would return the same text again.
  const result = await runTask<ReturnType<typeof parseGuideOutput>>(
    ctx,
    {
      task: AiTask.GENERATE_STUDY_GUIDE,
      promptVersion: prompt.version,
      model: GUIDE_MODEL,
      input: { courseName, examName, guideType, chunkTexts, objectives },
      parseOutput: (raw: unknown) => parseGuideOutput(raw, guideType, scopeName),
    },
    { skipCache: earlier > 0 },
  );

  const guide = await prisma.studyGuide.create({
    data: {
      userId,
      courseName,
      examName: examName || null,
      guideType,
      title: result.output.title,
      // Round-trip through JSON to satisfy Prisma's InputJsonValue constraint
      content: JSON.parse(JSON.stringify(result.output.sections)),
    },
  });

  logger.info("study_guide.generated", {
    user_id: userId,
    guide_id: guide.id,
    guide_type: guideType,
    sections_count: result.output.sections.length,
  });

  return {
    id: guide.id,
    user_id: guide.userId,
    course_name: guide.courseName,
    exam_name: guide.examName,
    guide_type: guideType,
    title: guide.title,
    sections: result.output.sections,
    created_at: guide.createdAt.toISOString(),
  };
}

export async function listStudyGuides(
  userId: string,
  courseName?: string,
  examName?: string,
): Promise<StudyGuideData[]> {
  const where: Record<string, unknown> = { userId };
  if (courseName) where.courseName = courseName;
  if (examName) where.examName = examName;

  const guides = await prisma.studyGuide.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });

  return guides
    .filter((g) => isGuideType(g.guideType))
    .map((g) => {
      const type = g.guideType as GuideType;
      return {
        id: g.id,
        user_id: g.userId,
        course_name: g.courseName,
        exam_name: g.examName,
        guide_type: type,
        title: guideTitle(g.title, type, g.examName ? `${g.courseName} ${g.examName}` : g.courseName),
        // Stored JSON may predate validation: clean it on the way out.
        sections: normalizeGuideSections(g.content),
        created_at: g.createdAt.toISOString(),
      };
    });
}

/** Deletes a guide the user owns. Returns false when it doesn't exist or isn't theirs. */
export async function deleteStudyGuide(userId: string, guideId: string): Promise<boolean> {
  const { count } = await prisma.studyGuide.deleteMany({ where: { id: guideId, userId } });
  if (count > 0) logger.info("guide.deleted", { user_id: userId, guide_id: guideId });
  return count > 0;
}
