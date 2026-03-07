import { claimNextJob } from "./db";
import { processJob } from "./worker";

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || "10000", 10);
let processing = false;

async function tick() {
  if (processing) return;
  processing = true;

  try {
    const job = await claimNextJob();
    if (job) {
      await processJob(job);
    }
  } catch (err) {
    console.error("[poll] error:", err);
  } finally {
    processing = false;
  }
}

console.log(`[worker] polling every ${POLL_INTERVAL}ms`);
setInterval(tick, POLL_INTERVAL);
tick();
