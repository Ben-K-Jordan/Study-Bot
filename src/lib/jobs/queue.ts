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
  const typeFilter = types?.length ? `AND type IN (${types.map((t) => `'${t}'`).join(",")})` : "";

  // Use raw query for SKIP LOCKED semantics
  const jobs = await prisma.$queryRawUnsafe<RawJob[]>(
    `UPDATE job_queue
     SET status = 'RUNNING', locked_at = NOW(), locked_by = $1, attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM job_queue
       WHERE status IN ('PENDING', 'RETRY')
         AND run_after <= NOW()
         ${typeFilter}
       ORDER BY priority ASC, run_after ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $2
     )
     RETURNING id, type, payload, attempts, max_attempts`,
    workerId,
    batchSize,
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
  if (attempts < maxAttempts) {
    const backoffMs = Math.min(1000 * Math.pow(2, attempts), 300_000); // max 5 min
    const runAfter = new Date(Date.now() + backoffMs);
    await prisma.jobQueue.update({
      where: { id: jobId },
      data: {
        status: "RETRY",
        lastError: error.slice(0, 1000),
        lockedAt: null,
        lockedBy: null,
        runAfter,
      },
    });
  } else {
    await prisma.jobQueue.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        lastError: error.slice(0, 1000),
        lockedAt: null,
        lockedBy: null,
      },
    });
  }
}
