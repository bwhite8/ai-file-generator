import { put } from "@vercel/blob";

export async function uploadToBlob(
  buffer: Buffer,
  fileName: string
): Promise<string> {
  const blob = await put(fileName, buffer, {
    access: "public",
    contentType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    token: process.env.BLOB_READ_WRITE_TOKEN!,
  });
  return blob.url;
}
