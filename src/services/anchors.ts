import { prisma } from "@/lib/db";
import { searchChunks } from "@/lib/search";
import { logger } from "@/lib/logger";

/**
 * Build objective anchors by running FTS for each objective title and
 * storing the top-K chunk matches. Idempotent via upsert.
 */
export async function buildObjectiveAnchors(
  userId: string,
  courseName: string,
  examName: string | undefined,
  objectives: { id: string; title: string }[]
): Promise<{ anchors_created: number }> {
  let totalCreated = 0;

  for (const obj of objectives) {
    const results = await searchChunks({
      userId,
      q: obj.title,
      namespace: "COURSE",
      courseName,
      examName,
      topK: 5,
    });

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      await prisma.objectiveAnchor.upsert({
        where: {
          userId_courseName_examName_objectiveId_chunkId: {
            userId,
            courseName,
            examName: examName ?? "",
            objectiveId: obj.id,
            chunkId: r.chunk_id,
          },
        },
        create: {
          userId,
          courseName,
          examName: examName ?? "",
          objectiveId: obj.id,
          chunkId: r.chunk_id,
          rank: i + 1,
        },
        update: {
          rank: i + 1,
        },
      });
      totalCreated++;
    }
  }

  logger.info("anchors.built", {
    user_id: userId,
    course_name: courseName,
    objective_count: objectives.length,
    anchors_created: totalCreated,
  });

  return { anchors_created: totalCreated };
}
