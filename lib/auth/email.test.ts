// The four transactional emails. What matters here is not the copy but two
// things the module is silently responsible for:
//
//   1. It interpolates user-controlled values — firstName, and in two cases an
//      email address — into an HTML body. escapeHtml is the only thing between
//      a chosen display name and markup in someone's inbox.
//   2. A delivery failure must never throw, because every caller sends
//      best-effort inside an auth flow that has already committed. The profile
//      route wraps its two sends in Promise.allSettled for that reason.
//
// Both were untested. The console fallback is also pinned, since local dev
// reads reset links out of the terminal and a regression there is invisible
// until someone needs a link.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mocks.send };
  },
}));

async function loadWithKey(key: string | undefined) {
  if (key === undefined) vi.stubEnv("RESEND_API_KEY", "");
  else vi.stubEnv("RESEND_API_KEY", key);
  vi.resetModules();
  return import("./email");
}

/** The HTML body of the single send that happened. */
function sentHtml(): string {
  expect(mocks.send).toHaveBeenCalledTimes(1);
  return mocks.send.mock.calls[0][0].html as string;
}

beforeEach(() => {
  mocks.send.mockReset().mockResolvedValue({ data: { id: "e1" }, error: null });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("HTML escaping of user-controlled values", () => {
  const HOSTILE = '<script>alert("x")</script>';

  it("escapes a display name in the password-reset email", async () => {
    const { sendPasswordResetEmail } = await loadWithKey("re_test");

    await sendPasswordResetEmail({
      to: "a@b.com",
      firstName: HOSTILE,
      resetUrl: "https://app.test/reset/tok",
    });

    const html = sentHtml();
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  // The reset URL lands in an href. A quote that survives unescaped would
  // break out of the attribute.
  it("escapes the reset URL into its href", async () => {
    const { sendPasswordResetEmail } = await loadWithKey("re_test");

    await sendPasswordResetEmail({
      to: "a@b.com",
      firstName: "Ada",
      resetUrl: 'https://app.test/reset/x" onmouseover="alert(1)',
    });

    const html = sentHtml();
    expect(html).not.toContain('onmouseover="alert(1)"');
    expect(html).toContain("&quot;");
  });

  it("escapes the display name in the email-change confirmation", async () => {
    const { sendEmailChangeConfirmation } = await loadWithKey("re_test");

    await sendEmailChangeConfirmation({
      to: "new@b.com",
      firstName: HOSTILE,
      confirmUrl: "https://app.test/email-change/tok",
    });

    expect(sentHtml()).not.toContain("<script>");
  });

  // This one interpolates an address the *attacker* chose: the notice goes to
  // the old inbox and names the requested new address.
  it("escapes the requested new address in the change notice", async () => {
    const { sendEmailChangeNotice } = await loadWithKey("re_test");

    await sendEmailChangeNotice({
      to: "old@b.com",
      firstName: "Ada",
      newEmail: '<img src=x onerror="alert(1)">@evil.test',
    });

    const html = sentHtml();
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("escapes the provider and linked address in the OAuth link notice", async () => {
    const { sendOauthLinkNotice } = await loadWithKey("re_test");

    await sendOauthLinkNotice({
      to: "a@b.com",
      firstName: "Ada",
      provider: "<b>Google</b>",
      linkedEmail: "<i>a@b.com</i>",
    });

    const html = sentHtml();
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<i>");
  });

  // The plain-text alternative is not HTML and must NOT be escaped — a user
  // named O'Brien should not read "O&#39;Brien" in a text client.
  it("leaves the plain-text body unescaped", async () => {
    const { sendPasswordResetEmail } = await loadWithKey("re_test");

    await sendPasswordResetEmail({
      to: "a@b.com",
      firstName: "O'Brien",
      resetUrl: "https://app.test/reset/tok",
    });

    const text = mocks.send.mock.calls[0][0].text as string;
    expect(text).toContain("O'Brien");
    expect(text).not.toContain("&#39;");
  });
});

describe("console fallback when RESEND_API_KEY is unset", () => {
  it("prints the message and reports delivered:console without calling Resend", async () => {
    const { sendPasswordResetEmail } = await loadWithKey(undefined);

    const result = await sendPasswordResetEmail({
      to: "a@b.com",
      firstName: "Ada",
      resetUrl: "https://app.test/reset/tok",
    });

    expect(result).toEqual({ ok: true, delivered: "console" });
    expect(mocks.send).not.toHaveBeenCalled();
    // The link has to be in the printed output or local dev cannot complete a
    // password reset.
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("https://app.test/reset/tok"),
    );
  });

  it("falls back for the other three senders too", async () => {
    const mod = await loadWithKey(undefined);

    const results = await Promise.all([
      mod.sendEmailChangeConfirmation({ to: "a@b.com", firstName: "A", confirmUrl: "u" }),
      mod.sendEmailChangeNotice({ to: "a@b.com", firstName: "A", newEmail: "n@b.com" }),
      mod.sendOauthLinkNotice({ to: "a@b.com", firstName: "A", provider: "Google", linkedEmail: "a@b.com" }),
    ]);

    for (const r of results) expect(r).toEqual({ ok: true, delivered: "console" });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe("delivery failures", () => {
  // Every caller sends best-effort after the state change has already
  // committed. A throw here would roll a successful operation into a 500.
  it("returns ok:false rather than throwing when Resend reports an error", async () => {
    mocks.send.mockResolvedValue({ data: null, error: { message: "domain not verified" } });
    const { sendPasswordResetEmail } = await loadWithKey("re_test");

    const result = await sendPasswordResetEmail({
      to: "a@b.com",
      firstName: "Ada",
      resetUrl: "u",
    });

    expect(result).toEqual({ ok: false, delivered: "resend" });
    expect(console.error).toHaveBeenCalled();
  });

  it("sends from the configured address", async () => {
    vi.stubEnv("RESEND_FROM_EMAIL", "Saffron <hello@saffron.test>");
    const { sendPasswordResetEmail } = await loadWithKey("re_test");

    await sendPasswordResetEmail({ to: "a@b.com", firstName: "Ada", resetUrl: "u" });

    expect(mocks.send.mock.calls[0][0].from).toBe("Saffron <hello@saffron.test>");
  });
});
