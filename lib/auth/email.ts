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

/**
 * Sends the confirmation link to the address being claimed.
 *
 * This is what makes the change verified: the link only reaches someone who
 * actually receives mail at the new address. Without it, a PATCH could move an
 * account onto any address at all, including one whose real owner has not
 * signed up yet.
 */
export async function sendEmailChangeConfirmation(opts: {
  to: string;
  firstName: string;
  confirmUrl: string;
}): Promise<SendResult> {
  const subject = "Confirm your new Saffron Wealth email address";
  const text =
    `Hi ${opts.firstName},\n\n` +
    `Someone asked to use this address for a Saffron Wealth account.\n\n` +
    `Click this link within 15 minutes to confirm it:\n${opts.confirmUrl}\n\n` +
    `If that wasn't you, ignore this email. Nothing changes unless the link is used.\n\n` +
    `— Saffron Wealth`;

  const html = `<!doctype html>
<html><body style="font-family: ui-sans-serif, system-ui, sans-serif; color: #111;">
<p>Hi ${escapeHtml(opts.firstName)},</p>
<p>Someone asked to use this address for a Saffron Wealth account.</p>
<p><a href="${escapeHtml(opts.confirmUrl)}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;">Confirm this address</a></p>
<p>This link expires in 15 minutes. If that wasn't you, ignore this email — nothing changes unless the link is used.</p>
<p>— Saffron Wealth</p>
</body></html>`;

  return deliver({ to: opts.to, subject, text, html });
}

/**
 * Tells the CURRENT address that a change was requested.
 *
 * The old address is the one the legitimate owner still reads, so it is the
 * only channel that reaches them if someone else initiated this. Sent on
 * request rather than only on confirm, so there is still time to act.
 */
export async function sendEmailChangeNotice(opts: {
  to: string;
  firstName: string;
  newEmail: string;
}): Promise<SendResult> {
  const subject = "A change to your Saffron Wealth email was requested";
  const text =
    `Hi ${opts.firstName},\n\n` +
    `We received a request to change your Saffron Wealth email address to ` +
    `${opts.newEmail}. It is not active yet — it takes effect only when the ` +
    `new address is confirmed.\n\n` +
    `If you requested this, no action is needed.\n\n` +
    `If you did NOT request this, someone may have access to your account. ` +
    `Sign in and change your password now.\n\n` +
    `— Saffron Wealth`;

  const html = `<!doctype html>
<html><body style="font-family: ui-sans-serif, system-ui, sans-serif; color: #111;">
<p>Hi ${escapeHtml(opts.firstName)},</p>
<p>We received a request to change your Saffron Wealth email address to <strong>${escapeHtml(opts.newEmail)}</strong>. It is not active yet — it takes effect only when the new address is confirmed.</p>
<p>If you requested this, no action is needed.</p>
<p>If you did <strong>not</strong> request this, someone may have access to your account. Sign in and change your password now.</p>
<p>— Saffron Wealth</p>
</body></html>`;

  return deliver({ to: opts.to, subject, text, html });
}

/**
 * Tells an account holder that a Google identity was linked to their account.
 *
 * Google sign-in links to an existing account matched by email without the
 * person proving they control that account, so this notice is what makes the
 * link visible to its owner rather than silent.
 */
export async function sendOauthLinkNotice(opts: {
  to: string;
  firstName: string;
  provider: string;
  linkedEmail: string;
}): Promise<SendResult> {
  const subject = `${opts.provider} sign-in was linked to your Saffron Wealth account`;
  const text =
    `Hi ${opts.firstName},\n\n` +
    `A ${opts.provider} account (${opts.linkedEmail}) was just linked to your ` +
    `Saffron Wealth account, and can now be used to sign in.\n\n` +
    `If that was you, no action is needed.\n\n` +
    `If it wasn't, change your password immediately and sign out all devices ` +
    `from your profile page.\n\n` +
    `— Saffron Wealth`;

  const html = `<!doctype html>
<html><body style="font-family: ui-sans-serif, system-ui, sans-serif; color: #111;">
<p>Hi ${escapeHtml(opts.firstName)},</p>
<p>A ${escapeHtml(opts.provider)} account (<strong>${escapeHtml(opts.linkedEmail)}</strong>) was just linked to your Saffron Wealth account, and can now be used to sign in.</p>
<p>If that was you, no action is needed.</p>
<p>If it wasn't, change your password immediately and sign out all devices from your profile page.</p>
<p>— Saffron Wealth</p>
</body></html>`;

  return deliver({ to: opts.to, subject, text, html });
}

// Shared send path: console-logs when RESEND_API_KEY is absent so local dev
// can read the link out of the terminal, exactly as sendPasswordResetEmail
// has always done.
async function deliver(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<SendResult> {
  if (!apiKey) {

    console.log(
      `[email] (RESEND_API_KEY not set — printing instead) to=${opts.to} subject="${opts.subject}"\n${opts.text}`,
    );
    return { ok: true, delivered: "console" };
  }

  const result = await client().emails.send({
    from: fromAddress,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
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
