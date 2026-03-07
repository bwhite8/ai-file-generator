import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

export interface BusinessCaseJob {
  id: string;
  status: string;
  email: string;
  description: string;
  blob_url: string | null;
  file_name: string | null;
  file_size: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export async function claimNextJob(): Promise<BusinessCaseJob | null> {
  const rows = await sql`
    UPDATE business_case_jobs
    SET status = 'processing', updated_at = now()
    WHERE id = (
      SELECT id FROM business_case_jobs
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `;
  return (rows[0] as BusinessCaseJob) ?? null;
}

export async function completeJob(
  id: string,
  blobUrl: string,
  fileName: string,
  fileSize: number
): Promise<void> {
  await sql`
    UPDATE business_case_jobs
    SET status = 'complete', blob_url = ${blobUrl}, file_name = ${fileName},
        file_size = ${fileSize}, completed_at = now(), updated_at = now()
    WHERE id = ${id}
  `;
}

export async function failJob(id: string, error: string): Promise<void> {
  await sql`
    UPDATE business_case_jobs
    SET status = 'failed', error = ${error}, updated_at = now()
    WHERE id = ${id}
  `;
}
