/**
 * Job queue operations — enqueue jobs and claim them for processing.
 *
 * Uses Postgres SELECT FOR UPDATE SKIP LOCKED for safe concurrent workers.
 */
import { prisma } from "../db";
import type { PrismaClient } from "../../../generated/prisma/client";

export type JobType = "EMBED_CHUNK_BATCH";

export interface EnqueueOptions {
  priority?: number;
  maxAttempts?: number;
  runAfter?: Date;
}

/**
 * Enqueue a job for background processing.
 */
export async function enqueueJob(
  type: JobType,
  payload: unknown,
  opts: EnqueueOptions = {},
  tx?: Pick<PrismaClient, "jobQueue">,
): Promise<string> {
  const db = tx ?? prisma;
  const job = await db.jobQueue.create({
    data: {
      type,
      payload: payload as never,
      priority: opts.priority ?? 100,
      maxAttempts: opts.maxAttempts ?? 5,
      runAfter: opts.runAfter ?? new Date(),
    },
  });
  return job.id;
}

/**
 * Claim the next N available jobs using SELECT FOR UPDATE SKIP LOCKED.
 * Returns claimed job records with status set to RUNNING.
 */
export async function claimJobs(
  workerId: string,
  batchSize: number = 1,
  types?: JobType[],
): Promise<ClaimedJob[]> {
  // Build parameterized query — type filter uses $3 array param if provided
  const hasTypeFilter = types && types.length > 0;
  const typeClause = hasTypeFilter ? `AND type = ANY($3)` : "";

  const params: unknown[] = [workerId, batchSize];
  if (hasTypeFilter) params.push(types);

  const jobs = await prisma.$queryRawUnsafe<RawJob[]>(
    `UPDATE job_queue
     SET status = 'RUNNING', locked_at = NOW(), locked_by = $1, attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM job_queue
       WHERE status IN ('PENDING', 'RETRY')
         AND run_after <= NOW()
         ${typeClause}
       ORDER BY priority ASC, run_after ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $2
     )
     RETURNING id, type, payload, attempts, max_attempts`,
    ...params,
  );

  return jobs.map((j) => ({
    id: j.id,
    type: j.type as JobType,
    payload: j.payload,
    attempts: j.attempts,
    maxAttempts: j.max_attempts,
  }));
}

interface RawJob {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
}

export interface ClaimedJob {
  id: string;
  type: JobType;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
}

/**
 * Mark a job as succeeded.
 */
export async function succeedJob(jobId: string): Promise<void> {
  await prisma.jobQueue.update({
    where: { id: jobId },
    data: {
      status: "SUCCEEDED",
      lockedAt: null,
      lockedBy: null,
    },
  });
}

/**
 * Mark a job as failed. If attempts < maxAttempts, schedule for retry with exponential backoff.
 */
export async function failJob(jobId: string, error: string, attempts: number, maxAttempts: number): Promise<void> {
  const canRetry = attempts < maxAttempts;
  const backoffMs = Math.min(1000 * Math.pow(2, attempts), 300_000);

  await prisma.jobQueue.update({
    where: { id: jobId },
    data: {
      status: canRetry ? "RETRY" : "FAILED",
      lastError: error.slice(0, 1000),
      lockedAt: null,
      lockedBy: null,
      ...(canRetry && { runAfter: new Date(Date.now() + backoffMs) }),
    },
  });
}
