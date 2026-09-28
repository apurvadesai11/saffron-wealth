/**
 * Post-sign-in redirect validation.
 *
 * `proxy.ts` sets `?next=` legitimately when it bounces an unauthenticated
 * request to /login, so the parameter has to keep working — but its value is
 * attacker-controlled and indistinguishable by shape from a real one. Handing
 * it to `router.push()` unchecked turns the genuine login page of a finance app
 * into a credential-phishing primitive: the victim sees the real domain, really
 * authenticates, and lands wherever the attacker chose.
 */

/**
 * Narrows an untrusted `next` value to a same-origin path, falling back to "/".
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw) return "/";

  // Browsers strip tabs and newlines before resolving a URL, so "/\t/evil.com"
  // arrives at the navigator as "//evil.com". Validate what the browser will
  // actually see, not what we were handed.
  const candidate = raw.replace(/[\t\n\r]/g, "");

  // Must be site-relative: one leading slash, no scheme. A second slash is
  // protocol-relative ("//evil.com"); a backslash is the same hole spelled
  // differently, since browsers normalize it to a slash.
  if (!/^\/(?![/\\])/.test(candidate)) return "/";

  return candidate;
}
