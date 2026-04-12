import { prisma } from "@/lib/db";
import { runTask, type GatewayContext } from "@/lib/ai/gateway";
import { AiTask } from "@/lib/ai/types";
import { getPrompt } from "@/lib/ai/prompt-registry";
import { createProvider } from "@/lib/ai/provider-factory";
import { logger } from "@/lib/logger";

export type GuideType = "KEY_CONCEPTS" | "FAQ" | "CHEAT_SHEET";

interface GuideSection {
  // KEY_CONCEPTS
  concept?: string;
  explanation?: string;
  importance?: string;
  // FAQ
  question?: string;
  answer?: string;
  // CHEAT_SHEET
  topic?: string;
  content?: string;
}

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

const GUIDE_MODEL = process.env.AI_MODEL_ANSWER || "gpt-4o-mini";

export async function generateStudyGuide(
  userId: string,
  courseName: string,
  examName: string | undefined,
  guideType: GuideType,
): Promise<StudyGuideData> {
  // Fetch course chunks directly from DB for comprehensive coverage
  const docFilter: Record<string, unknown> = {
    userId,
    namespace: "COURSE",
    courseName,
    status: "PROCESSED",
  };
  if (examName) docFilter.examName = examName;

  const allChunks = await prisma.contentChunk.findMany({
    where: { document: docFilter },
    orderBy: [{ documentId: "asc" }, { ordinal: "asc" }],
    select: { text: true },
  });

  if (allChunks.length === 0) {
    throw new Error("No course materials found. Upload documents first.");
  }

  // Sample evenly across the corpus (max 20 chunks to stay within token budget)
  const MAX_CHUNKS = 20;
  let sampled: { text: string }[];
  if (allChunks.length <= MAX_CHUNKS) {
    sampled = allChunks;
  } else {
    const step = allChunks.length / MAX_CHUNKS;
    sampled = Array.from({ length: MAX_CHUNKS }, (_, i) =>
      allChunks[Math.floor(i * step)]
    );
  }

  const chunkTexts = sampled.map((c) => c.text);

  // Fetch objectives if available
  let objectives: string[] | undefined;
  const sessions = await prisma.session.findMany({
    where: { userId, courseName, ...(examName ? { examName } : {}) },
    select: { objectives: true },
    take: 1,
    orderBy: { createdAt: "desc" },
  });
  if (sessions.length > 0 && sessions[0].objectives) {
    const objs = sessions[0].objectives as { title: string }[];
    objectives = objs.map((o) => o.title);
  }

  const ctx: GatewayContext = { userId, provider: createProvider() };
  const prompt = getPrompt(AiTask.GENERATE_STUDY_GUIDE);

  const result = await runTask<{
    guide_type: string;
    title: string;
    sections: GuideSection[];
  }>(ctx, {
    task: AiTask.GENERATE_STUDY_GUIDE,
    promptVersion: prompt.version,
    model: GUIDE_MODEL,
    input: {
      courseName,
      examName,
      guideType,
      chunkTexts,
      objectives,
    },
    parseOutput: (raw: unknown) => {
      const data = raw as Record<string, unknown>;
      return {
        guide_type: (data.guide_type as string) || guideType,
        title: (data.title as string) || `${guideType.replace(/_/g, " ")} Guide`,
        sections: (data.sections as GuideSection[]) || [],
      };
    },
  });

  // Persist the guide
  const guide = await prisma.studyGuide.create({
    data: {
      userId,
      courseName,
      examName: examName || null,
      guideType,
      title: result.output.title,
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

  return guides.map((g) => ({
    id: g.id,
    user_id: g.userId,
    course_name: g.courseName,
    exam_name: g.examName,
    guide_type: g.guideType as GuideType,
    title: g.title,
    sections: g.content as unknown as GuideSection[],
    created_at: g.createdAt.toISOString(),
  }));
}

export async function getStudyGuide(
  userId: string,
  guideId: string,
): Promise<StudyGuideData | null> {
  const guide = await prisma.studyGuide.findUnique({
    where: { id: guideId },
  });

  if (!guide || guide.userId !== userId) return null;

  return {
    id: guide.id,
    user_id: guide.userId,
    course_name: guide.courseName,
    exam_name: guide.examName,
    guide_type: guide.guideType as GuideType,
    title: guide.title,
    sections: guide.content as unknown as GuideSection[],
    created_at: guide.createdAt.toISOString(),
  };
}
