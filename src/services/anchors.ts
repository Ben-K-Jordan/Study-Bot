import { prisma } from "@/lib/db";
import { searchChunks } from "@/lib/search";
import { logger } from "@/lib/logger";

/**
 * Build objective anchors by running FTS for each objective title and
 * storing the top-K chunk matches. Idempotent via upsert.
 *
 * Searches run in parallel, then all upserts are batched in a single
 * transaction to avoid N+1 query overhead.
 */
export async function buildObjectiveAnchors(
  userId: string,
  courseName: string,
  examName: string | undefined,
  objectives: { id: string; title: string }[]
): Promise<{ anchors_created: number }> {
  // Run all searches in parallel instead of sequentially
  const searchResults = await Promise.all(
    objectives.map((obj) =>
      searchChunks({
        userId,
        q: obj.title,
        namespace: "COURSE",
        courseName,
        examName,
        topK: 5,
      }).then((results) => ({ objectiveId: obj.id, results }))
    )
  );

  // Build all upsert operations
  const upserts = searchResults.flatMap(({ objectiveId, results }) =>
    results.map((r, i) =>
      prisma.objectiveAnchor.upsert({
        where: {
          userId_courseName_examName_objectiveId_chunkId: {
            userId,
            courseName,
            examName: examName ?? "",
            objectiveId,
            chunkId: r.chunk_id,
          },
        },
        create: {
          userId,
          courseName,
          examName: examName ?? "",
          objectiveId,
          chunkId: r.chunk_id,
          rank: i + 1,
        },
        update: {
          rank: i + 1,
        },
      })
    )
  );

  // Execute all upserts in a single transaction
  if (upserts.length > 0) {
    await prisma.$transaction(upserts);
  }

  logger.info("anchors.built", {
    user_id: userId,
    course_name: courseName,
    objective_count: objectives.length,
    anchors_created: upserts.length,
  });

  return { anchors_created: upserts.length };
}
