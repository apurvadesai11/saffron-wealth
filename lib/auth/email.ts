import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;
const fromAddress =
  process.env.RESEND_FROM_EMAIL ?? "Saffron Wealth <noreply@example.com>";

let resendClient: Resend | null = null;
function client(): Resend {
  if (!resendClient) resendClient = new Resend(apiKey ?? "");
  return resendClient;
}

interface SendResult {
  ok: boolean;
  delivered: "resend" | "console";
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  firstName: string;
  resetUrl: string;
}): Promise<SendResult> {
  const subject = "Reset your Saffron Wealth password";
  const text =
    `Hi ${opts.firstName},\n\n` +
    `We received a request to reset your Saffron Wealth password.\n\n` +
    `Click this link within 15 minutes to choose a new one:\n${opts.resetUrl}\n\n` +
    `If you didn't request this, you can safely ignore this email — your password won't change.\n\n` +
    `— Saffron Wealth`;

  const html = `<!doctype html>
<html><body style="font-family: ui-sans-serif, system-ui, sans-serif; color: #111;">
<p>Hi ${escapeHtml(opts.firstName)},</p>
<p>We received a request to reset your Saffron Wealth password.</p>
<p><a href="${escapeHtml(opts.resetUrl)}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;">Reset password</a></p>
<p>This link expires in 15 minutes. If you didn't request this, you can safely ignore this email — your password won't change.</p>
<p>— Saffron Wealth</p>
</body></html>`;

  if (!apiKey) {
     
    console.log(
      `[email] (RESEND_API_KEY not set — printing instead) to=${opts.to} subject="${subject}"\n${text}`,
    );
    return { ok: true, delivered: "console" };
  }

  const result = await client().emails.send({
    from: fromAddress,
    to: opts.to,
    subject,
    text,
    html,
  });
  if (result.error) {
     
    console.error("[email] resend send failed", result.error);
    return { ok: false, delivered: "resend" };
  }
  return { ok: true, delivered: "resend" };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
