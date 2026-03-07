import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY!);

export async function sendEmail(
  to: string,
  fileName: string,
  blobUrl: string
): Promise<void> {
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to,
    subject: "Your Business Case Presentation is Ready",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 20px;">
        <p style="font-size: 16px; color: #1a1a1a; line-height: 1.6;">
          Your business case deck is ready to download.
        </p>
        <a href="${blobUrl}"
           style="display: inline-block; margin: 24px 0; padding: 12px 24px; background: #1a1a1a; color: #fff; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 500;">
          Download ${fileName}
        </a>
        <p style="font-size: 13px; color: #666; line-height: 1.5;">
          This link is permanent and won't expire.
        </p>
      </div>
    `,
  });
}
