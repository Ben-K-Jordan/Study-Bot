#!/usr/bin/env tsx
/**
 * Background job worker.
 *
 * Polls the job_queue table using SELECT FOR UPDATE SKIP LOCKED.
 * Run: npx tsx scripts/worker.ts
 *
 * Environment:
 *   JOB_WORKER_CONCURRENCY — max concurrent jobs (default: 2)
 *   JOB_POLL_INTERVAL_MS   — poll interval in ms (default: 2000)
 *   AI_PROVIDER            — "mock" for testing, "openai" for production
 */
import { claimJobs, succeedJob, failJob, type ClaimedJob } from "../src/lib/jobs/queue";
import { handleEmbedChunkBatch } from "../src/lib/jobs/handlers/embed-chunks";
import { createProvider } from "../src/lib/ai/provider-factory";

const CONCURRENCY = parseInt(process.env.JOB_WORKER_CONCURRENCY || "2", 10);
const POLL_INTERVAL_MS = parseInt(process.env.JOB_POLL_INTERVAL_MS || "2000", 10);
const WORKER_ID = `worker-${process.pid}-${Date.now()}`;

let running = true;

const provider = createProvider();

async function processJob(job: ClaimedJob): Promise<void> {
  console.log(`[${WORKER_ID}] Processing job ${job.id} (type=${job.type}, attempt=${job.attempts}/${job.maxAttempts})`);

  try {
    switch (job.type) {
      case "EMBED_CHUNK_BATCH":
        await handleEmbedChunkBatch(job.payload, provider);
        break;
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }

    await succeedJob(job.id);
    console.log(`[${WORKER_ID}] Job ${job.id} succeeded`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[${WORKER_ID}] Job ${job.id} failed: ${errorMsg}`);
    await failJob(job.id, errorMsg, job.attempts, job.maxAttempts);
  }
}

async function pollLoop(): Promise<void> {
  console.log(`[${WORKER_ID}] Starting worker (concurrency=${CONCURRENCY}, poll=${POLL_INTERVAL_MS}ms)`);

  while (running) {
    try {
      const jobs = await claimJobs(WORKER_ID, CONCURRENCY);

      if (jobs.length > 0) {
        await Promise.allSettled(jobs.map(processJob));
      }
    } catch (err) {
      console.error(`[${WORKER_ID}] Poll error:`, err);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  console.log(`[${WORKER_ID}] Worker stopped`);
}

// Graceful shutdown
process.on("SIGINT", () => {
  console.log(`[${WORKER_ID}] SIGINT received, stopping...`);
  running = false;
});
process.on("SIGTERM", () => {
  console.log(`[${WORKER_ID}] SIGTERM received, stopping...`);
  running = false;
});

pollLoop().catch((err) => {
  console.error("Worker fatal error:", err);
  process.exit(1);
});
