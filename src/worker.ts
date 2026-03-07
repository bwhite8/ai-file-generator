import type { BusinessCaseJob } from "./db";
import { completeJob, failJob } from "./db";
import { generateBusinessCase } from "./generate";
import { uploadToBlob } from "./upload";
import { sendEmail } from "./email";

export async function processJob(job: BusinessCaseJob): Promise<void> {
  try {
    const { buffer, fileName, fileSize } = await generateBusinessCase(job);

    const blobUrl = await uploadToBlob(buffer, fileName);

    await completeJob(job.id, blobUrl, fileName, fileSize);

    try {
      await sendEmail(job.email, fileName, blobUrl);
    } catch (emailErr) {
      console.error(`[worker] job=${job.id} email failed:`, emailErr);
    }

    console.log(`[worker] job=${job.id} complete`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[worker] job=${job.id} failed:`, message);
    await failJob(job.id, message);
  }
}
