# Saffron Wealth — Audit Remediation Plan

**Source:** full-repo code review, 2026-09-27 (code quality, architecture, security, usability)
**Scope:** 20 identified items, sequenced into 3 phases
**Status:** not started

---

## How to use this document

This plan is written to be executed in a **fresh conversation** with no memory of the
audit. Every item is self-contained: it names the files, quotes the defect, states the
fix, and gives acceptance criteria. You should not need to re-derive anything.

**To start a phase, open a new session and say:**

> Read `docs/audit-remediation-plan.md` and execute Phase 1. Work through the items in
> order, run the verification gate after each one, and stop to check in if an item turns
> out to be larger than described.

One phase per conversation is the right granularity. Phase 1 is five items and touches
security-sensitive code; don't bundle it with Phase 3's refactors.

### Verification gate — run after every item

```bash
npm run lint         # must exit 0
npm run typecheck    # must exit 0
npm test             # must be 610+ passing, 0 failing
```

`npm test` and the API route tests need a reachable Postgres (`DATABASE_URL` in `.env`).
Run `npm run test:e2e` before closing out a phase, not after every item — it boots its
own dev server on :3100 and takes minutes.

**Baseline as of 2026-09-27:** lint clean, typecheck clean, 50 test files / 610 tests
passing. Any regression against that baseline is a stop-and-fix, not a note-and-continue.

### Ground rules for the implementer

These are existing conventions in this codebase. Follow them rather than introducing
alternatives.

- **No Zod.** Validation is hand-rolled in `lib/*-validation.ts` returning
  `{ ok: true, value }` or `{ ok: false, fieldErrors }`. Match that shape.
- **Every query is `userId`-scoped.** `{ id, userId }` is the ownership check; a miss
  returns `null`/`false`, which the route maps to 404. Never trust an id alone.
- **Money is `Decimal(14,2)` in Postgres, JS `number` across the wire.** Do not convert
  the domain layer to `Decimal` as part of this plan — that's a larger decision, noted
  under "Explicitly out of scope" below.
- **One test file per module** in `lib/auth/`. One colocated `*.test.tsx` per component.
- **Comment the WHY, not the WHAT.** But see item 18: do not add more decision *history*
  to source comments.

`CLAUDE.md` at the repo root is 770 lines of project context and loads automatically in a
Claude Code session here. Read its **Testing** section and its **When you add a new
feature** section before writing any test — they hold the harness recipes summarized below.

### Testing patterns to follow

Most items in this plan require new tests. Use the existing harnesses rather than
inventing one.

**API route tests** — copy `app/api/profile/__tests__/route.test.ts`. The pattern is
`vi.hoisted` + `vi.mock("next/headers")` to supply the session cookie, plus a local
`helpers.ts` exporting `seedUser` / `seedSession` / `makeRequest`. These are **real
integration tests against Postgres**, not mocked Prisma — that's deliberate and worth
preserving.

> **Important gap:** `app/api/auth/__tests__/` **does not exist**. Login, register, logout,
> logout-all, `me`, the OAuth callback, and both password-reset routes currently have
> **zero** route-level tests. Items 1, 4, 6, and 7 all touch those routes, so the first of
> them to run must create that directory and its `helpers.ts`, modelled on
> `app/api/accounts/__tests__/helpers.ts` (which is itself a documented clone of the
> profile one). Budget for this — it is not a five-minute task, and no acceptance criterion
> elsewhere in this plan accounts for it.

**Component tests** — colocate `*.test.tsx`. Use `renderWithApp` from
`components/__tests__/test-utils.tsx` when the component reads `useApp()`; plain `render`
from Testing Library otherwise. Where colour or styling encodes state, assert on a
`data-*` attribute rather than a class name — `components/AccountRow.tsx:29,45` shows the
convention (`data-liability`, `data-balance-sign`).

**Pure-logic tests** — plain Vitest, no DOM. See `lib/budget-utils.test.ts` (462 lines)
and `lib/net-worth-history.test.ts` (379 lines) for the expected density.

**Browser-level verification** — several acceptance criteria below call for things that
read as manual QA (CSP console violations in item 5, keyboard-only modal walkthroughs in
item 14). Do these in Playwright instead of by hand, so they become regressions you keep:
`page.on("console", ...)` collects CSP report-only violations, and
`page.keyboard.press("Tab")` with `expect(page.locator(":focus"))` asserts focus
containment. `e2e/` already has five spec files to model on.

### Workflow

- **Confirm you're starting green** before touching anything: run the verification gate and
  confirm 610+ passing. The working tree had uncommitted `CLAUDE.md` and `README.md`
  changes at audit time, so don't assume a clean baseline — establish it.
- **One commit per item**, message referencing the item number (e.g.
  `Item 8: reject amount at the Decimal(14,2) boundary`). One PR per phase. Two acceptance
  criteria below ask for a measurement "recorded in the PR description" (items 11 and 12).
- **Branch per phase.** Current branch at audit time was `fix/pagination-and-balance-sign`.
  Use `git worktree` if you want isolation from other work.
- **Line numbers in this document are from 2026-09-27** and will drift as items land. They
  locate the code; they are not authoritative after the first edit to a given file. If a
  cited line doesn't match, search for the quoted snippet instead — every defect below
  quotes the actual code.

### Explicitly out of scope

Do not do these as part of this plan, even though they're adjacent:

- Converting money to `Decimal` end-to-end (schema → query layer → API → UI).
- Replacing the hand-rolled validators with a schema library.
- Adding dark mode (`globals.css` is light-mode only by design right now).
- Reworking the net-worth series algorithm in `lib/net-worth-history.ts` — it's correct;
  only its *rounding consistency* with `computeNetWorth` is in scope (item 20).
- Building any Phase 4+ product features from `docs/ROADMAP.md`.

---

## Phase overview

| Phase | Theme | Items | Why this grouping |
|-------|-------|-------|-------------------|
| **1** | Security & deployment blockers | 1–5 | Must land before any real deployment. Each is independently shippable. |
| **2** | Correctness & operational hardening | 6–10 | Real bugs, one user-visible. Depends on nothing in Phase 1. |
| **3** | Architecture, quality, UX | 11–20 | Larger refactors and polish. Safe to defer; benefits from 1–2 being done. |

### Cross-phase dependencies — read before starting Phase 1

Two items carry schema changes and **must** be sequenced after **item 2** (the migration
squash), or they'll add a migration on top of drift that was never captured:

| Item | Schema change | Blocked by |
|------|---------------|------------|
| **4** (verified email change) | `EmailChangeToken` model | Item 2 |
| **15a** (institution keywords → data) | `AccountNameRule` model or per-user config | Item 2 |

Everything else is independent and can be done in any order within its phase.

**One ordering note that runs the other way:** item 12 (extract `withApiHandler`) would
make item 7 (rate limiting) a one-line change instead of three. It is nonetheless in
Phase 3, because a refactor should not gate a security fix. Add the rate limits directly
in Phase 2 (~6 lines per route), then let item 12 consolidate them. Accept the brief
duplication.

### Where this plan may be wrong

Push back rather than forcing these. The plan is a starting position, not a spec:

- **Item 6** is the most delicate rewrite here. If the restructure can't preserve the
  concurrency invariant *and* the uniform-timing enumeration defense, stop and discuss
  rather than trading one away.
- **Item 15** is the largest. Splitting 15b/15c (correctness) from 15a (data modelling) is
  expected, not a failure.
- **Item 12** should be abandoned if it can't be done without editing route tests — needing
  to change those means behavior changed, which is the one outcome that refactor must not
  produce.

---

# Phase 1 — Security & deployment blockers

Five items. All five should land before the app is exposed to real users or real
financial data.

---

## Item 1 — Open redirect on the login page

**Severity:** High · **Category:** Security

**Files:** `app/(auth)/login/page.tsx:29,59`

### The defect

```ts
const next = searchParams.get("next") ?? "/";   // :29
...
router.push(next);                              // :59
```

`next` is attacker-controlled and unvalidated. Both `?next=https://evil.com` and
`?next=//evil.com` (protocol-relative) navigate off-origin immediately after a successful
sign-in. `proxy.ts:86` sets this parameter legitimately during the auth redirect, so a
malicious value is indistinguishable from a real one by shape.

On a finance app's login page this is a ready-made credential-phishing primitive: the
victim sees the genuine domain, genuinely authenticates, and lands on the attacker's page.

### The fix

Validate that `next` is a site-relative path before using it. A single leading slash not
followed by a second slash, and no scheme:

```ts
function safeNext(raw: string | null): string {
  if (!raw) return "/";
  // Must be site-relative: exactly one leading slash, no scheme, no protocol-relative.
  if (!/^\/(?!\/)/.test(raw)) return "/";
  return raw;
}
```

Apply at `:29`. Check whether `register/page.tsx` and the password-reset pages read
`next` too — at audit time only `login/page.tsx` did, but confirm rather than assume.

### Acceptance criteria

- [ ] `?next=https://evil.com` lands on `/` after sign-in
- [ ] `?next=//evil.com` lands on `/`
- [ ] `?next=/transactions` still lands on `/transactions`
- [ ] `?next=javascript:alert(1)` lands on `/`
- [ ] New unit test for `safeNext` covering all four cases
- [ ] E2E assertion in `e2e/auth-middleware.spec.ts` that the redirect stays on-origin

---

## Item 2 — Prisma migrations cannot build the current schema

**Severity:** High · **Category:** Deployment

**Files:** `prisma/migrations/20260430043115_init_auth/migration.sql`, `prisma/schema.prisma`

### The defect

The only migration creates **6** tables: `User`, `Session`, `OAuthAccount`,
`PasswordResetToken`, `FailedLogin`, `AuthEvent`.

`schema.prisma` defines **11** models. These five have no migration at all:

- `Account`
- `AccountBalanceEvent`
- `Category`
- `Transaction`
- `Budget`

Consequence: `prisma migrate deploy` produces a database the application cannot run
against. Only `prisma db push` works, which is what CI relies on
(`.github/workflows/ci.yml:47`, `npx prisma db push --skip-generate`). There is no
reproducible path from an empty database to a working one, and no migration history for
the five tables holding all the financial data.

### The fix

Generate a migration capturing the drift, then make `migrate deploy` the deployment path.

```bash
# Against a scratch database, NOT your dev DB:
createdb saffron_migrate_check
DATABASE_URL="postgresql://localhost:5432/saffron_migrate_check" \
  npx prisma migrate dev --name add_financial_domain --create-only
```

Review the generated SQL by hand before applying. Confirm it includes:

- All five tables with `Decimal(14,2)` on every money column
- `@db.Date` on `Transaction.date` and `AccountBalanceEvent.asOf`
- `@@unique([userId, name])` on `Category`
- `@@unique([userId, externalHash])` on `Transaction`
- `@@unique([userId, categoryId, period])` on `Budget`
- The three `AccountBalanceEvent` indexes (`userId`; `accountId, recordedAt`;
  `accountId, asOf`) and **no** `@@unique([accountId, asOf])` — the schema comment
  explains at length why that constraint must not exist
- Correct `onDelete` behavior: `Cascade` on the user relations, `SetNull` on
  `Transaction.accountId`

Then verify round-trip on a clean database:

```bash
dropdb saffron_migrate_check && createdb saffron_migrate_check
DATABASE_URL="postgresql://localhost:5432/saffron_migrate_check" \
  npx prisma migrate deploy
DATABASE_URL="postgresql://localhost:5432/saffron_migrate_check" \
  npx prisma migrate status   # must report no drift
```

Finally switch CI from `db push` to `migrate deploy` so drift can never silently
reappear.

### Acceptance criteria

- [ ] `prisma migrate deploy` on an empty database produces a schema the app runs against
- [ ] `prisma migrate status` reports no drift against `schema.prisma`
- [ ] `.github/workflows/ci.yml` uses `migrate deploy`, not `db push`
- [ ] CI is green on the new path
- [ ] README/CLAUDE.md setup instructions updated if they still say `db push` for fresh installs

---

## Item 3 — Google OAuth cannot work as documented

**Severity:** High · **Category:** Configuration / functional

**Files:** `lib/auth/google-oauth.ts:33,51-52`, `.env.example:6-8`, `CLAUDE.md:717,723`

### The defect

The code and the documentation disagree on every Google variable name:

| Read by code | Documented in `.env.example` / `CLAUDE.md` |
|---|---|
| `GOOGLE_CLIENT_ID` | `GOOGLE_OAUTH_CLIENT_ID` |
| `GOOGLE_CLIENT_SECRET` | `GOOGLE_OAUTH_CLIENT_SECRET` |
| `NEXTAUTH_URL` (undocumented in `.env.example`) | `GOOGLE_OAUTH_REDIRECT_URI` (never read) |
| `AUDIT_RETENTION_DAYS` (undocumented in `.env.example`) | — |

Anyone following the setup instructions gets `/login?oauth=unconfigured`. The redirect URI
is derived at runtime by `googleCallbackRedirectUri()` (`google-oauth.ts:99-102`) from
`NEXTAUTH_URL` or the request origin, so the documented `GOOGLE_OAUTH_REDIRECT_URI` is
dead configuration.

This also means the OAuth callback path — including the account-linking logic in item 4 —
is very likely unexercised in practice. Unexercised is not the same as safe.

### The fix

Pick one naming convention and apply it everywhere. Recommendation: rename the **code** to
the documented `GOOGLE_OAUTH_*` names, because they're more descriptive and `NEXTAUTH_URL`
is a misleading leftover in an app that deliberately does not use Auth.js
(`google-oauth.ts:1-4` says so explicitly).

1. `google-oauth.ts` → read `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`.
   Update the error strings at `:34` and `:54` to match.
2. Rename `NEXTAUTH_URL` → `APP_BASE_URL` in `google-oauth.ts:100` and
   `app/api/auth/password-reset/request/route.ts:77` (both read it). Add it to
   `.env.example`.
3. Either honor `GOOGLE_OAUTH_REDIRECT_URI` when set (preferred — it's what you register
   in the Google console) or delete it from `.env.example`. Don't leave it documented and
   ignored.
4. Add `AUDIT_RETENTION_DAYS` to `.env.example` with its default of 365 and minimum of 30
   (`app/api/cron/sweep-audit-events/route.ts:20-26`).
5. Update the `CLAUDE.md` env table (around `:709-724`) to match.

### Acceptance criteria

- [ ] `grep -rhoE "process\.env\.[A-Z_0-9]+" app components lib proxy.ts scripts | sort -u`
      matches `.env.example` exactly, modulo `NODE_ENV`
- [ ] Google sign-in completes end-to-end with only the documented variables set
- [ ] `CLAUDE.md` env table matches `.env.example`
- [ ] Consider a startup assertion that logs a clear warning when a partially-configured
      OAuth set is detected (id present, secret missing)

---

## Item 4 — Account-takeover chain: unverified email change + OAuth email trust

**Severity:** High · **Category:** Security

**Files:** `app/api/profile/route.ts:116-138`, `app/api/auth/oauth/google/callback/route.ts:114-140`

### The defect

Two individually-defensible decisions combine into a takeover primitive.

**Half one** — `profile/route.ts:116-138` changes a user's email with no verification of
the new address and no notification to the old one. It correctly rejects an email already
owned by another user (`:101-112`) and revokes sessions (`:134-136`), but never proves the
user controls the address they're claiming.

**Half two** — `oauth/google/callback/route.ts:114-140` links a Google identity to any
existing user whose `emailNormalized` matches, with no proof the person initiating the
link controls that existing account:

```ts
const byEmail = await prisma.user.findUnique({
  where: { emailNormalized },
  select: { id: true, profilePicture: true },
});
if (byEmail) {
  userId = byEmail.id;
  didLinkExisting = true;
  await prisma.oAuthAccount.create({ ... });   // silent link, full session issued below
}
```

**The chain:** attacker registers normally, then PATCHes their email to
`victim@corp.com` — which succeeds as long as the victim has no account yet. Later the
victim signs in with Google. The callback finds no linked OAuth account, matches by email,
and links the victim's Google identity to the **attacker's** user row, issuing the victim
a session on it. The victim proceeds to enter their financial data into an account the
attacker still holds password access to.

The comment at `callback/route.ts:63-67` shows the author reasoned carefully about
*unverified Google* emails. The gap is the unverified email on *our* side.

### The fix

Close both halves. Either alone breaks the chain; both is correct.

**Half one — verified email change.** Don't mutate `User.email` on PATCH. Instead:

1. Add an `EmailChangeToken` model (mirror `PasswordResetToken`: `tokenHash` as SHA-256,
   `expiresAt`, `consumedAt`, plus the `newEmail` and `newEmailNormalized` being claimed).
   This needs a migration — sequence it after item 2.
2. `PATCH /api/profile` with a changed email creates a token and emails a confirmation
   link to the **new** address. Respond with "check your new inbox", and leave
   `User.email` untouched.
3. Add `POST /api/auth/email-change/confirm` that consumes the token, re-checks the
   uniqueness constraint at confirm time (another user may have claimed it in the
   interim), applies the change, revokes sessions, and issues a fresh one — reuse the
   existing pattern in `password-reset/confirm/route.ts:92-103`.
4. Send a notification to the **old** address too. An email change the user didn't
   initiate should be visible to them.
5. Reuse `lib/auth/email.ts`; add a `sendEmailChangeConfirmation` alongside
   `sendPasswordResetEmail`. Note it no-ops to console when `RESEND_API_KEY` is unset.
6. Record `email_change` audit events at both request and confirm. `AuthEventType` in
   `lib/types.ts:74-84` already has `email_change`; add a `email_change_requested`
   variant.

**Half two — no silent OAuth linking.** In `callback/route.ts`, when `byEmail` matches
but no OAuth account is linked, do **not** link and do **not** issue a session. Redirect
to `/login?oauth=link_required` with a message explaining that an account with this email
already exists and they should sign in with their password first, then link Google from
the profile page. Linking then becomes an authenticated, deliberate action.

If you'd rather keep the frictionless path, the minimum bar is: require the Google email
to be verified (already checked at `:68`) **and** send a notification to the account's
address on every link, **and** record the link as an audit event the user can see. The
redirect approach is stronger and simpler to reason about.

### Acceptance criteria

- [ ] `PATCH /api/profile` with a new email does not change `User.email` until confirmed
- [ ] Confirmation link expires (15 min, matching password reset) and is single-use
- [ ] Old address receives a notification on email change
- [ ] Uniqueness is re-checked at confirm time, not just at request time
- [ ] Google sign-in against an existing password account does **not** silently link
- [ ] Tests: the full chain above is attempted and fails at the email-change step
- [ ] Tests: OAuth callback with an email matching an existing unlinked user issues no session
- [ ] `app/api/profile/__tests__/route.test.ts` updated for the new PATCH contract

---

## Item 5 — No security headers

**Severity:** Medium · **Category:** Security

**Files:** `next.config.ts` (currently the untouched scaffold)

### The defect

```ts
const nextConfig: NextConfig = {
  /* config options here */
};
```

No CSP, no `X-Frame-Options` / `frame-ancestors`, no `Referrer-Policy`, no
`Permissions-Policy`. For an app that renders account balances and net worth, clickjacking
protection and a CSP are table stakes. Vercel supplies HSTS; nothing else is set.

### The fix

Add a `headers()` block. Start report-only on the CSP so you can find violations without
breaking the app, then enforce.

```ts
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Start as Content-Security-Policy-Report-Only, then flip the key name.
  { key: "Content-Security-Policy-Report-Only", value: CSP },
];
```

CSP notes specific to this app:

- Next.js App Router needs `'unsafe-inline'` for styles, or a nonce-based setup. Tailwind
  emits a stylesheet, but Next injects inline styles for fonts.
- `next/font` (`app/layout.tsx:5-13`, Geist via `next/font/google`) self-hosts at build
  time, so no `fonts.googleapis.com` allowance is needed.
- `img-src` must permit Vercel Blob (`*.public.blob.vercel-storage.com`) and
  `lh3.googleusercontent.com` — Google OAuth profile pictures are stored as remote URLs
  and rendered with `unoptimized` in `components/auth/ProfilePictureUploader.tsx:67-74`.
- `connect-src 'self'` is enough; all fetches are same-origin.
- Set `frame-ancestors 'none'` in the CSP as well as `X-Frame-Options` for older browsers.

Verify with `curl -sI https://localhost:3000/ | grep -i -E 'content-security|x-frame'`
and check the browser console for report-only violations across every page before
enforcing.

### Acceptance criteria

- [ ] All five headers present on both page and API responses
- [ ] CSP runs report-only with zero violations across login, register, password reset,
      monthly review, transactions (incl. CSV import), net worth (incl. chart), profile
      (incl. avatar upload) — collect these in a Playwright spec via
      `page.on("console", msg => …)` filtering for CSP reports, so it stays a regression
      test rather than a one-time manual sweep
- [ ] CSP flipped to enforcing after the clean report-only pass
- [ ] Avatar images still render from both Vercel Blob and Google
- [ ] E2E suite still green (Playwright will catch a CSP that breaks hydration)

---

# Phase 2 — Correctness & operational hardening

Five items. Real bugs, one of them user-visible. Independent of Phase 1.

---

## Item 6 — Argon2 inside the login transaction, and a second pooled connection

**Severity:** Medium · **Category:** Correctness / robustness

**Files:** `app/api/auth/login/route.ts:65-117`, `lib/auth/exponential-backoff.ts:28-71`

### The defect

Two coupled problems in the login path.

**6a — the hash runs inside the transaction.** `login/route.ts:65-117` wraps the entire
credential check inside `prisma.$transaction`, including `verifyPassword` at
m=64 MB / t=3 / p=4 (`lib/auth/password.ts:19-24`). A DB connection and a per-email
advisory lock are held for the full hash duration (~100 ms+). Prisma's **5 s default
interactive-transaction timeout is not raised here** — notable, because both import routes
deliberately raise theirs (`transactions/import/route.ts:20` at 20 s,
`accounts/balance-history/route.ts:22` at 30 s). Under concurrency this throws P2028 and
surfaces to the user as a 500 on an otherwise valid login.

**6b — `getBackoffStatus` ignores the transaction client.** Its own doc comment
(`exponential-backoff.ts:7-10`) says:

> this function MUST be called inside a transaction that has acquired a Postgres advisory
> lock keyed on the email

But the function body uses the **module-level `prisma`** at `:31` and `:44`, not a `tx`.
And `login/route.ts:68` calls it as `getBackoffStatus(emailNormalized)` with no client
argument.

Mutual exclusion still holds — a concurrent request blocks on `pg_advisory_xact_lock`
regardless of which connection reads the counters — so this is **not** a backoff bypass.
The hazard is pool arithmetic: the interactive transaction holds one connection while
`getBackoffStatus` requests a second. With `connection_limit=1`, a common Vercel +
pgbouncer setting, that self-deadlocks until the transaction times out.

### The fix

1. Add a `client: Prisma.TransactionClient | PrismaClient = prisma` parameter to
   `getBackoffStatus`, matching the existing `AccountDbClient` pattern in
   `lib/accounts.ts:176` and `TransactionDbClient` in `lib/transactions.ts:205`. Pass `tx`
   from the login route.
2. Restructure the login route so the hash is **outside** the lock. Suggested shape:
   - Transaction 1 (locked): acquire advisory lock, read backoff status, read the user row
     including `passwordHash`. Return early on backoff.
   - Outside: run `verifyPassword` against the real or dummy hash.
   - Transaction 2 (locked): re-acquire the lock, then record the failure or clear the
     failure rows.
   - Keep the dummy-hash uniform-timing behavior intact (`:88-92`) — it's the
     enumeration defense and must not regress.
3. Set an explicit `timeout` on the login transactions rather than relying on the 5 s
   default, so the value is a decision rather than an accident.
4. Delete the redundant `clearFailedLoginsForUser` at `:158`. The comment concedes it
   duplicates the in-transaction `deleteMany` at `:105`; with the restructure it's just
   noise.

Take care here: this is the most security-sensitive rewrite in the plan. The invariant to
preserve is *two concurrent attempts on the same email cannot both read "OK to attempt"*.
**Write the concurrency test before the refactor**, and confirm it passes against the
current code — a test that only passes after your change hasn't proven anything about the
invariant you were trying to preserve.

There is no existing test to copy for this. `app/api/auth/__tests__/` does not exist (see
**Testing patterns to follow** above), and no test in the repo exercises concurrent route
invocations. The shape you need:

```ts
// Seed a user with a known password, then fire two wrong-password logins with no await
// between them so both are in flight before either commits.
const [a, b] = await Promise.all([
  POST(makeRequest({ method: "POST", body: { email, password: "wrong-one" }, csrfToken })),
  POST(makeRequest({ method: "POST", body: { email, password: "wrong-two" }, csrfToken })),
]);
const statuses = [a.status, b.status].sort();

// Lock WORKING   → [401, 429] and exactly ONE FailedLogin row.
// Lock BYPASSED  → [401, 401] and TWO rows, because both requests read the counter
//                  as 0 before either wrote to it.
expect(statuses).toEqual([401, 429]);
expect(await prisma.failedLogin.count({ where: { emailNormalized } })).toBe(1);
```

Note the direction of that assertion, because it is counterintuitive and easy to get
backwards. `delayForFailureCount` (`exponential-backoff.ts:12-19`) indexes
`DELAY_TABLE_SECONDS = [0, 1, 2, 4, 8, 16, 32, 60]` **by failure count**, and index 0 is
reachable only via the `failures <= 0` guard — so a *single* recorded failure already
yields a 1-second delay. The second request therefore serializes behind the advisory lock,
reads `failures: 1`, finds `retryAfter` hasn't elapsed, and returns `429
TOO_MANY_FAILED_ATTEMPTS` via the `kind: "backoff"` branch (`login/route.ts:119-132`) —
which records an audit event but **no** `FailedLogin` row. Two rows is the failure signal,
not the success signal.

One practical note: `getDummyHash()` (`lib/auth/password.ts:44-52`) caches a promise at
module scope, so the first call in a test file pays the full Argon2 cost. Warm it in
`beforeAll`, or the response-time comparison in the acceptance criteria below will be too
noisy to mean anything.

### Acceptance criteria

- [ ] `verifyPassword` no longer runs inside an interactive transaction
- [ ] `getBackoffStatus` accepts and uses a transaction client; the login route passes `tx`
- [ ] Explicit `timeout` on login transactions
- [ ] `app/api/auth/__tests__/` created with a `helpers.ts`, since it does not exist today
- [ ] New test: two concurrent wrong-password logins for the same email yield `[401, 429]`
      and exactly one `FailedLogin` row — see the recipe and the assertion-direction note
      above, and confirm it passes against the *current* code before refactoring
- [ ] Existing backoff tests in `lib/auth/exponential-backoff.test.ts` still pass
- [ ] Wrong-password and unknown-email response times remain indistinguishable
- [ ] Manual check: works with `?connection_limit=1` appended to `DATABASE_URL`

---

## Item 7 — Rate limiting reaches only 4 of 21 routes

**Severity:** Medium · **Category:** Security / availability

**Files:** `app/api/transactions/import/route.ts`, `app/api/accounts/balance-history/route.ts`, `app/api/profile/picture/route.ts`, `app/api/profile/change-password/route.ts`, `lib/auth/rate-limit.ts`

### The defect

`rateLimit()` is called from exactly four routes: login, register, and both
password-reset endpoints. Uncovered and expensive:

| Route | Cost per request |
|---|---|
| `POST /api/accounts/balance-history` | 20 MB CSV fully buffered, ~34k rows, 30 s interactive transaction |
| `POST /api/transactions/import` | 10 MB CSV, ~7.6k rows, 20 s transaction |
| `POST /api/profile/picture` | sharp decode + resize + WebP re-encode |
| `POST /api/profile/change-password` | Argon2 verify — an unlimited current-password oracle for a stolen session |

All are authenticated, so the blast radius is one account's own resources. But a single
user can trivially exhaust serverless function concurrency and the DB connection pool, and
the change-password route lets anyone holding a hijacked session brute-force the current
password offline-style with no throttle.

### The fix

Add `rateLimit()` to those four routes using the existing helper. Current limits are a
single global `LIMIT = 5` per `WINDOW_MS = 60_000` (`rate-limit.ts:19-20`), which is
wrong for imports (a legitimate preview-then-commit is 2 requests, but 5/min is tight for
retries) and too loose for change-password.

Make the limits per-scope:

```ts
// lib/auth/rate-limit.ts
const SCOPE_LIMITS: Record<string, { limit: number; windowMs: number }> = {
  login:            { limit: 5,  windowMs: 60_000 },
  register:         { limit: 5,  windowMs: 60_000 },
  "password-reset": { limit: 5,  windowMs: 60_000 },
  "change-password":{ limit: 5,  windowMs: 900_000 },  // 5 per 15 min
  import:           { limit: 10, windowMs: 600_000 },  // 10 per 10 min
  picture:          { limit: 10, windowMs: 600_000 },
};
```

Two things to get right:

1. **`UpstashRateLimiter` currently bakes the window into its constructor**
   (`rate-limit.ts:58-63`, `Ratelimit.slidingWindow(LIMIT, "60 s")`). Per-scope limits
   need one limiter instance per scope, memoized in a `Map`. Don't rebuild it per request.
2. **Key these by `session.user.id`, not IP.** These are authenticated routes, and IP is
   spoofable (see item 10). Keying by user id is both more accurate and immune to that
   bypass. Keep IP keying for the pre-auth routes, which have no user id available.

Also split the `password-reset` scope — request and confirm currently share one bucket, so
5 combined requests exhaust both.

### Acceptance criteria

- [ ] All four routes return 429 with a `RATE_LIMITED` code past their limit
- [ ] Authenticated routes are keyed by user id; pre-auth routes by IP
- [ ] Per-scope limits configured; Upstash limiter instances memoized per scope
- [ ] `password-reset` request and confirm have separate scopes
- [ ] `lib/auth/rate-limit.test.ts` created (it does not exist today — see item 16),
      covering per-scope limits and the memory fallback
- [ ] Legitimate preview-then-commit import flow is not throttled

---

## Item 8 — `1e12` boundary overflows the money column

**Severity:** Medium · **Category:** Correctness

**Files:** `lib/transaction-validation.ts:15,33,175`, `lib/account-validation.ts:16,43`

### The defect

Both validators cap at `1e12` with a **strict** comparison, so exactly `1e12` passes:

```ts
const AMOUNT_MAX = 1e12;                                    // transaction-validation.ts:15
if (raw > AMOUNT_MAX) return { field: "amount", ... };       // :33  — 1e12 passes
```

```ts
const BALANCE_MAX = 1e12;                                    // account-validation.ts:16
if (Math.abs(raw) > BALANCE_MAX) { ... }                     // :43  — 1e12 passes
```

The column is `Decimal(14, 2)` — 12 integer digits, max `999999999999.99`. Verified
against Postgres:

```
$ psql -c "SELECT 1e12::numeric(14,2);"
ERROR:  numeric field overflow
DETAIL:  A field with precision 14, scale 2 must round to an absolute value less than 10^12.
```

So `POST /api/transactions` with `amount: 1000000000000` returns **500 INTERNAL_ERROR**
instead of a clean 400 with a field error. Same for `POST`/`PATCH /api/accounts`.

### The fix

Change both to `>=`. Three call sites: `transaction-validation.ts:33`,
`transaction-validation.ts:175` (`readNumberParam`, used by the query-param filters), and
`account-validation.ts:43`.

Consider renaming the constants to `AMOUNT_LIMIT_EXCLUSIVE` or setting them to
`999_999_999_999.99` with `>` — either makes the boundary self-documenting. The comment at
both sites already says "keeps values inside the Decimal(14, 2) column headroom", which is
the right intent, just off by one.

### Acceptance criteria

- [ ] `amount: 1e12` returns 400 with a field error, not 500
- [ ] `balance: 1e12` and `balance: -1e12` both return 400
- [ ] `amount: 999999999999.99` still succeeds
- [ ] `amountMin`/`amountMax` query params reject `1e12` with 400
- [ ] Boundary tests added to `lib/transaction-validation.test.ts` and
      `lib/account-validation.test.ts`

---

## Item 9 — Net-worth chart and summary cards disagree after an account edit

**Severity:** Medium · **Category:** Correctness (user-visible)

**Files:** `components/NetWorthClient.tsx:55-134,161-163`

### The defect

`NetWorthClient` keeps `accounts` in local state and updates it optimistically in three
handlers — `handleSave` (`:78-80`), `handleDelete` (`:104-105`), `handleRestore`
(`:129-130`). That state drives `NetWorthSummaryCards` at `:163`.

But `series` is a **prop** computed server-side in `app/(app)/net-worth/page.tsx:30` and
passed straight through to `NetWorthChart` at `:161`. Nothing refreshes it. Only the
import path calls `router.refresh()` (`:205`).

So: edit a balance, archive an account, or restore one, and the chart's most recent point
contradicts the summary card directly above it until the user manually reloads. On a
net-worth tracker, two different net-worth numbers on one screen is a trust problem, not
a cosmetic one.

The comment at `:31-44` explains why `series` must not be recomputed client-side — that
reasoning is correct and should be preserved. The fix is to re-run the server component,
not to derive the series in the browser.

### The fix

Call `router.refresh()` after a successful mutation in all three handlers. `router` is
already in scope (`:24`).

Sequencing matters — the local state update should still happen first so the UI responds
immediately, with the refresh reconciling behind it. Verify the prop-sync effects at
`:45-50` don't fight the optimistic update; they adopt `initialAccounts` unconditionally,
so a refresh landing mid-edit could briefly show stale data. If that shows up in testing,
the `beginRefresh()` machinery in `lib/app-context.tsx:152-175` solves exactly this
problem and the pattern is worth mirroring — but don't add it preemptively. This page has
no `AppProvider` and no second component mutating the same state, which the comment at
`:38-44` correctly identifies as why the simpler approach was chosen.

### Acceptance criteria

- [ ] Editing a balance updates both the summary card and the chart's last point
- [ ] Archiving an account removes it from both the totals and the chart's current value
- [ ] Restoring an account restores it to both
- [ ] No visible flicker or stale-value flash during the refresh
- [ ] `components/NetWorthClient.test.tsx` created (does not exist today — see item 16)
      asserting `router.refresh` is called after each of the three mutations

---

## Item 10 — `clientIp` trusts the first `X-Forwarded-For` entry

**Severity:** Medium · **Category:** Security

**Files:** `lib/auth/request-info.ts:6-13`

### The defect

```ts
export function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();     // fully client-controlled
    if (first) return first;
  }
  return req.headers.get("x-real-ip");
}
```

`X-Forwarded-For` is append-only: the **left-most** entry is whatever the original client
claimed, and the **right-most** is what your trusted proxy observed. Taking `[0]` means
every IP-keyed rate limit (login, register, password reset) is bypassable by rotating a
header value, and every `ipAddress` in the audit log and `FailedLogin` table is
attacker-controlled fiction.

The comment at `:3-5` names the correct fix — "for production behind a single trusted
proxy (Vercel, NGINX), pin to the expected header instead of falling through" — without
doing it.

### The fix

On Vercel, read `x-vercel-forwarded-for`, which the platform sets and overwrites, so it
cannot be spoofed by the client. Fall back to the right-most `X-Forwarded-For` entry for
other deployments, and treat the whole thing as untrusted in development.

```ts
export function clientIp(req: NextRequest): string | null {
  // Platform-set and overwritten by Vercel's edge — not client-controllable.
  const vercel = req.headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",").pop()?.trim() ?? null;

  // Generic reverse proxy: the RIGHT-most entry is the one our proxy observed.
  // The left-most is whatever the client claimed and must never be trusted.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",").pop()?.trim() ?? null;

  return req.headers.get("x-real-ip");
}
```

If the deployment ever sits behind more than one proxy, the right-most entry becomes the
*inner* proxy rather than the client, and you'd need to skip a known number of trusted
hops. Document the assumption in the comment so the next reader knows the invariant.

Note the interaction with item 7: once authenticated routes key their limits by user id,
the surface this protects shrinks to the pre-auth routes — which are the ones that matter
most for credential stuffing.

### Acceptance criteria

- [ ] A spoofed `X-Forwarded-For: 1.2.3.4` does not change the rate-limit key on Vercel
- [ ] `x-vercel-forwarded-for` is preferred when present
- [ ] `lib/auth/request-info.test.ts` created (does not exist today — see item 16) covering
      spoofed left-most entries, multi-hop chains, and the no-header case
- [ ] Audit-log IPs are still populated in local dev (where no proxy header exists)

---

# Phase 3 — Architecture, quality, UX

Ten items. Larger refactors and polish. Safe to defer, and easier once Phases 1–2 are in.

---

## Item 11 — `AppProvider` has no memoization

**Severity:** Medium · **Category:** Performance

**Files:** `lib/app-context.tsx:315-327`, `lib/budget-utils.ts:123-138`

### The defect

`AppProvider` builds a fresh context value object and five fresh closures
(`ensureTransactionsFrom`, `saveBudgets`, `addTransaction`, `deleteTransaction`,
`beginRefresh`) on **every** render. Every `useApp()` consumer therefore re-renders
whenever the provider does, regardless of whether the data it reads changed.

Compounding it: `getCurrentPeriodSpend` (`budget-utils.ts:131-137`) filters the entire
hydrated transaction array once **per category**. With a 13-month hydration window after a
Monarch import (~1,000+ rows) and ~40 categories, that's ~40k iterations per render pass —
repeated on every keystroke in any consumer.

`MonthlyReviewWidget` and `lib/use-alert-state.ts` do memoize correctly. The provider is
the leak.

### The fix

1. Wrap the context value in `useMemo` with an explicit dependency list.
2. Wrap all five callbacks in `useCallback`. `ensureTransactionsFrom` needs care — it
   closes over `windowFrom` at `:195` and `:201`, so a stale closure would compute the
   wrong gap boundary. Use a ref for the window value, or include it in the dependency
   list and confirm the in-flight map at `:189` still dedups correctly.
3. Restructure the per-category spend calculation to bucket transactions by category
   **once** (a single `Map<categoryId, Transaction[]>`) instead of re-filtering per
   category. Keep `getCurrentPeriodSpend`'s signature for its existing callers and tests;
   add a batched variant alongside it.

Measure before and after with React DevTools Profiler on the Monthly Review page with an
imported dataset — this should be a before/after number, not an assertion.

### Acceptance criteria

- [ ] Context value and all five callbacks memoized
- [ ] `ensureTransactionsFrom` still dedups concurrent calls for the same range and
      computes the correct gap; `lib/app-context.test.tsx` still passes
- [ ] Per-category spend is O(transactions + categories), not O(transactions × categories)
- [ ] Measured render-count reduction recorded in the PR description
- [ ] `lib/budget-utils.test.ts` (462 lines) passes unchanged

---

## Item 12 — Extract `withApiHandler` and `handleCsvImport`

**Severity:** Low · **Category:** Architecture / maintainability

**Files:** all 21 files under `app/api/**/route.ts`; `lib/transactions.ts:10-16`; `lib/accounts.ts:14-20`

### The defect

Measured duplication:

- **13** copies of `function err(code, message, status, fieldErrors?)`
- **9** copies of `interface ErrorBody`
- `transactions/import/route.ts` and `accounts/balance-history/route.ts` are ~95%
  identical: content-length guard → `formData()` → mode check → file check → size check →
  `parseCsv` → `validateHeader` → preview-or-commit branch. They differ only in two
  constants and which pipeline function they call.
- `dateStringToUtcDate` / `utcDateToDateString` defined identically in `lib/transactions.ts`
  and `lib/accounts.ts`

Every cross-cutting change — the rate limits in item 7, a new error field, a logging
change — currently means editing a dozen files and hoping none were missed.

### The fix

1. `lib/api/handler.ts` — a `withApiHandler` wrapper taking options for whether the route
   requires a session, requires CSRF, and which rate-limit scope applies. It provides the
   session, the error envelope helpers, and the top-level try/catch that currently appears
   verbatim in all 21 files.
2. `lib/api/errors.ts` — one `ErrorBody` type and one `err()`.
3. `lib/api/csv-import.ts` — a `handleCsvImport({ maxBytes, requiredColumns, timeoutMs, pipeline })`
   that both import routes call.
4. `lib/date-utils.ts` — the shared UTC date helpers. Both current copies carry the same
   explanatory comment about local-midnight drift; keep one canonical copy of it.

Do this **incrementally**, one route at a time, with the full test suite green between
each. The route tests are integration tests against real Postgres, so they'll catch a
behavior change in the envelope immediately. Do not change any status code, error code
string, or response body shape — the client reads `data.error.message` and
`data.error.fieldErrors` in several places, and E2E tests assert on user-visible messages.

### Acceptance criteria

- [ ] One `err()` and one `ErrorBody` in the codebase
- [ ] Both import routes are thin config over one shared handler
- [ ] One copy of the UTC date helpers
- [ ] Zero changes to any status code, error code, or response shape
- [ ] All route tests pass without modification — if a test needs editing, the refactor
      changed behavior and should be reconsidered
- [ ] Net line count reduced; record the number

---

## Item 13 — Mock financial data is reachable from the production provider

**Severity:** Medium · **Category:** Correctness / trust

**Files:** `lib/app-context.tsx:13,85,87,90`

### The defect

```ts
const [transactions, setTransactions] = useState<Transaction[]>(
  seedTransactions ?? MOCK_TRANSACTIONS,     // :85
);
const [budgets, setBudgets] = useState<Budget[]>(seedBudgets ?? MOCK_BUDGETS);  // :87
const categories = seedCategories ?? MOCK_CATEGORIES;                            // :90
```

The comment at `:58-62` calls this "a safety net for stray test callers, never exercised
in production." Nothing enforces that. The README now states it as fact — *"Production
never falls back to it: the `(app)` layout always passes real (possibly empty) arrays"* —
which makes it a documented invariant with no runtime guard.

In a wealth tracker, a regression that drops a seed prop renders **fabricated balances
indistinguishable from real ones**. The user has no way to tell. This is the highest-trust
failure mode in the app and the cheapest one to foreclose.

### The fix

Make the fallback impossible outside tests. Two options, in order of preference:

**Preferred:** make the seed props required. `AppProvider` takes `seedCategories`,
`seedTransactions`, `seedBudgets` as non-optional. Test callers already go through
`renderWithApp` (`components/__tests__/test-utils.tsx`), so point that helper at the mock
data explicitly. The type system then guarantees the invariant and `MOCK_*` never appears
in `app-context.tsx` at all.

**Fallback if that ripples too far:** keep the props optional but throw when a seed is
missing and `process.env.NODE_ENV !== "test"`.

Either way, `lib/mock-data.ts` stays — it's legitimately used by `renderWithApp` and
`e2e/fixtures.ts:6`. The goal is that production code cannot reach it.

### Acceptance criteria

- [ ] `MOCK_*` is unreachable from `lib/app-context.tsx` in a non-test environment
- [ ] `grep -n "MOCK_" lib/app-context.tsx` returns nothing (preferred option)
- [ ] `renderWithApp` still supplies fixture data; all component tests pass
- [ ] `e2e/fixtures.ts` unaffected
- [ ] README's persistence claim is now enforced by code, not just asserted

---

## Item 14 — Account delete has no confirmation, and its control fails contrast

**Severity:** Medium · **Category:** Usability / accessibility

**Files:** `components/AccountRow.tsx:50-56`; `components/AccountEditModal.tsx`, `BudgetEditModal.tsx`, `MonarchImportModal.tsx`, `BalanceHistoryImportModal.tsx`

### The defect

**14a — no confirmation.**

```tsx
<button
  onClick={onDelete}
  className="text-gray-300 hover:text-red-400 transition-colors text-xs"
  aria-label={`Delete ${account.name}`}
>
  ✕
</button>
```

Fires immediately. It's a soft archive with a working Restore path, so it's recoverable —
but it sits at a ~10px hit target immediately adjacent to the row's edit button
(`:32-42`), which makes a misclick likely rather than theoretical.

**14b — contrast failure.** `text-gray-300` on white is roughly **1.5:1**. WCAG 2.1
SC 1.4.11 requires **3:1** for non-text UI controls. The `aria-label` is correct, so
screen-reader users are actually better served here than sighted mouse users.

**14c — no focus trap in any modal.** All four modals have `role="dialog"`,
`aria-modal="true"`, `aria-labelledby`, Escape-to-close, and autofocus — genuinely good.
None traps Tab within the dialog or restores focus to the triggering element on close, so
keyboard users tab straight out into the page behind the overlay.

### The fix

1. Add a confirmation step before archiving. A small inline confirm on the row ("Archive?
   Yes / Cancel") is less disruptive than a modal for a recoverable action, and avoids
   nesting a dialog inside the page. Name the consequence accurately — it's "Archive", not
   "Delete", and the button label and `aria-label` should say so, since `archiveAccount`
   (`lib/accounts.ts:164-170`) never removes the row.
2. Darken to at least `text-gray-500` (≈4.6:1) and enlarge the hit target to 24×24 CSS
   pixels minimum. Check `components/TransactionList.tsx:41`, which has the same
   delete-button pattern and likely the same contrast problem.
3. Add focus management to all four modals. Write it once as a `useFocusTrap(ref)` hook in
   `lib/use-focus-trap.ts` — cycle Tab/Shift+Tab within the dialog, and restore focus to
   `document.activeElement` as captured on open. Apply to all four rather than one.

### Acceptance criteria

- [ ] Archiving an account requires an explicit confirm
- [ ] Wording says "archive", not "delete", and matches the actual behavior
- [ ] Control contrast ≥ 3:1; hit target ≥ 24×24px
- [ ] `TransactionList.tsx` delete control audited for the same issues
- [ ] Tab and Shift+Tab stay within an open modal in all four
- [ ] Focus returns to the triggering element on close
- [ ] `components/AccountRow.test.tsx` updated for the confirm flow
- [ ] Focus containment asserted in Playwright, not walked by hand: press `Tab` past the
      last focusable element and assert `:focus` is still inside the dialog, then close and
      assert `:focus` is back on the trigger. One spec covering all four modals.
- [ ] Contrast checked with a computed-value assertion or an axe run, not by eye

---

## Item 15 — Single-user heuristics hard-coded as product logic

**Severity:** Medium · **Category:** Architecture

**Files:** `lib/monarch-transform.ts:22-25,109-137,150-166`

### The defect

**15a — one person's institutions in a source constant.** `ASSET_TYPE_RULES:109-137`
contains `"sapphire"`, `"bankamericard"`, `"circle card"`, `"red card"`, `"citi"`,
`"discover"`, `"amex"`. `NON_ACCOUNT_NAMES:22-25` is two literal rows from one specific
insurance export. Neither generalizes to a second user.

**15b — substring matching misfires.** `lower.includes(keyword)` means `"citi"` matches
`"Citibank Checking"` and `"visa"` matches `"Visa Debit Checking"` — both classified as
`credit_card`, moving a cash asset into the debt bucket and inverting its sign in the
net-worth calculation.

**15c — unknown defaults to an asset.** The catch-all at `:165` returns `"cash"`. Any
unrecognized account becomes an asset and **silently inflates net worth**. For a net-worth
tracker that's the wrong direction to fail in: an unknown account should be visible as
unknown, not quietly counted as money you have.

The rule-ordering comment at `:104-108` is good and should survive whatever replaces this.

### The fix

1. Move the keyword table out of source into user-editable mapping data — a table
   (`AccountNameRule`) or a JSON config per user, so a new institution is a data change.
   This needs a migration; sequence after item 2.
2. Replace substring matching with word-boundary matching, and confirm the ordering
   constraints in the `:104-108` comment still hold (`"roth 401"` must beat `"401k"`,
   `"health savings"` must beat `"savings"`, `"rsu"` must beat `"individual"`).
3. Add an explicit `uncategorized` state instead of defaulting to `"cash"`. An
   uncategorized account should be **excluded from net-worth totals** and surfaced in the
   import preview for the user to classify. The import preview already has the right
   pattern for this — `upsertAccountsFromBalanceHistory` (`lib/accounts.ts:282`) reports
   `typeConflict` to the user rather than resolving it silently, and the comment at
   `:269-277` explains why the previous silent-override behavior was wrong. Reuse that
   shape.
4. `NON_ACCOUNT_NAMES` becomes a user-managed exclusion list, seeded empty.

This is the largest item in the plan. If it needs splitting, do 15b and 15c first — they
are correctness fixes and independently valuable — and treat 15a as a follow-on.

### Acceptance criteria

- [ ] No institution names in source constants
- [ ] `"Citibank Checking"` classifies as `cash`, not `credit_card`; add a regression test
- [ ] Unrecognized accounts classify as `uncategorized`, excluded from net-worth totals
- [ ] Import preview surfaces uncategorized accounts for user classification
- [ ] Existing rule-precedence tests in `lib/monarch-transform.test.ts` (204 lines) pass
- [ ] Re-importing a file after classifying accounts does not re-classify them

---

## Item 16 — Test gaps against the project's own stated bar

**Severity:** Low · **Category:** Code quality

**Files:** see list below

### The defect

`CLAUDE.md:745` states of `lib/auth/`:

> The bar in this directory is "one test file per module."

Modules in `lib/auth/` with **no** test file:

- `validation.ts` — owns email normalization, which item 4's takeover chain runs through
- `rate-limit.ts` — needed by item 7
- `request-info.ts` — needed by item 10
- `session-cookie.ts`, `server.ts`, `audit-log.ts`, `email.ts`, `password-rules.ts`
- `csrf-client.ts`, `csrf-shared.ts`, `blocklist-data.ts` (trivial; judgement call)

Also untested directly:

- `lib/transaction-import.ts` (266 lines) and `lib/balance-history-import.ts` (290 lines) —
  the two largest pipelines, covered only indirectly through route tests
- `components/NetWorthClient.tsx` (210 lines, all four mutation handlers, including
  item 9's bug)
- 14 other components: `AccountBucketGroup`, `AlertPanel`, `AlertsButton`,
  `BudgetCategoryList`, `CashflowCard`, `Sidebar`, `SidebarNavItem`, `TopHeader`,
  `auth/AuthCard`, `auth/AuthFormError`, `auth/AvatarFallback`,
  `auth/GoogleSignInButton`, `auth/PasswordStrengthHint`, `auth/ProfilePictureUploader`

### The fix

Prioritize by risk, not by coverage percentage:

1. **First** (and largely written as part of Phases 1–2): `validation.ts`,
   `rate-limit.ts`, `request-info.ts`, `NetWorthClient.tsx`
2. **Second:** `server.ts`, `session-cookie.ts` — session-cookie naming differs between
   production (`__Host-sw_session`) and dev (`sw_session`), which is exactly the kind of
   environment-dependent branch tests should pin
3. **Third:** direct unit tests for the two import pipelines, focused on the transform and
   dedup logic rather than re-testing the DB path the route tests already cover
4. **Last, optional:** the presentational components. `AvatarFallback` has real logic
   (`colorForName`, initials derivation) and is worth a test; `TopHeader` is six lines of
   static markup and is not.

Don't chase a coverage number. The goal is that the security-relevant modules have pinned
behavior.

### Acceptance criteria

- [ ] Every non-trivial module in `lib/auth/` has a test file
- [ ] `NetWorthClient.tsx` has a test file
- [ ] Both import pipelines have direct unit tests for transform and dedup
- [ ] If any module is deliberately left untested, `CLAUDE.md`'s stated bar is amended to
      say so — don't leave the convention and the reality disagreeing

---

## Item 17 — CI doesn't typecheck

**Severity:** Low · **Category:** CI / quality

**Files:** `.github/workflows/ci.yml`

### The defect

CI runs lint → build → unit tests → e2e. `npm run typecheck` (`tsc --noEmit`) appears only
in `.githooks/pre-push`, which any `git push --no-verify` skips.

`next build` catches most type errors in application code but not those in test files, and
`tsconfig.json` includes `**/*.ts` and `**/*.mts`, so there's real surface `next build`
never sees.

### The fix

Add a step after `Generate Prisma client` (it must run after `prisma generate`, since
types depend on the generated client) and before `Build`:

```yaml
      - name: Typecheck
        run: npm run typecheck
```

While there, consider:

- A `concurrency` block to cancel superseded runs on the same branch
- Splitting lint/typecheck into a job that runs in parallel with build/test, since neither
  needs Postgres — the current single job has a 25-minute timeout and serializes everything
- Switching `db push` to `migrate deploy` — that's item 2, and they touch the same file, so
  doing them together avoids a second pass

### Acceptance criteria

- [ ] `npm run typecheck` runs in CI and fails the build on a type error
- [ ] Verified by pushing a deliberate type error on a scratch branch and confirming red
- [ ] Step ordering is correct (after `prisma generate`)

---

## Item 18 — Residual documentation drift

**Severity:** Low · **Category:** Documentation

**Files:** `README.md` (Project Structure), `lib/types.ts:122`, `lib/accounts.ts`, `lib/net-worth-history.ts`

### The defect

The README was substantially rewritten on 2026-09-27, after the audit. Its feature list and
persistence-model sections are now accurate. **What remains:**

**18a — stale structure entry.** `README.md` Project Structure still lists:

```
  providers.tsx              Client component shim wrapping AppProvider
```

`app/providers.tsx` does not exist. `AppProvider` is mounted directly in
`app/(app)/layout.tsx:41`.

**18b — the domain's canonical type comment contradicts the code.**

```ts
balance: number;      // dollars; positive — liabilities are the amount owed
```

Commit `e681064` ("Stop clamping balance signs; report type disagreements instead of acting
on them") deliberately made "positive" false. `lib/account-utils.ts:82-88` and
`lib/account-validation.ts:34-38` both now explain at length that either sign is valid. A
stale comment in the type file every other module imports from is the worst place for one.

**18c — source comments have become a changelog.** `lib/accounts.ts` and
`lib/net-worth-history.ts` are roughly 45% comment, much of it decision *history* rather
than current behavior:

- `accounts.ts:269` — "This replaces Ruling 7 … which was wrong twice over"
- `accounts.ts:213-224` — "An earlier version wrote a zero-balance event…"
- `accounts.ts:543` — "see Task 8's report for the exact EXPLAIN ANALYZE output"
- `net-worth-history.ts:81-86` — "an earlier version of this file claimed…"

The reasoning is genuinely valuable and should not be deleted. The problem is placement:
"Ruling 3", "Ruling 9", "Task 5", and "Task 8's report" are not defined in the files that
cite them, so these comments are only fully legible to someone who has read the phase plans
in `docs/`. A future reader hits a reference they can't resolve.

### The fix

1. Remove the `providers.tsx` line from the README structure block; verify the rest of that
   block against the actual tree while you're there.
2. Fix `lib/types.ts:122` to state that either sign is valid and point at
   `lib/account-utils.ts`'s `describeAccountBalance` for the display convention.
3. Create `docs/decisions/` and move the numbered rulings there — one short ADR per ruling,
   with the context and the rejected alternative. Then reduce each source comment to the
   *current invariant* plus a link:

   ```ts
   // AccountBalanceEvent.balance is the signed contribution to net worth; the
   // account's bucket is applied once at write time, never at read time.
   // See docs/decisions/0003-sign-at-write-time.md.
   ```

   This keeps the *why* discoverable while making the code readable top-to-bottom. It also
   gives the "Ruling N" numbering an actual home.

### Acceptance criteria

- [ ] README Project Structure matches the real tree
- [ ] `lib/types.ts:122` matches the code
- [ ] `docs/decisions/` exists with one ADR per referenced ruling
- [ ] No source comment references an undefined "Ruling N" or "Task N"
- [ ] Comment-to-code ratio in `lib/accounts.ts` and `lib/net-worth-history.ts` materially
      reduced with no loss of reasoning
- [ ] `CLAUDE.md` points at `docs/decisions/`

---

## Item 19 — Old avatars are never deleted

**Severity:** Low · **Category:** Security / storage

**Files:** `lib/auth/picture-storage.ts:17-36`, `app/api/profile/picture/route.ts:71-74`

### The defect

`uploadAvatar` writes a new blob per upload with a fresh `randomUUID()` filename, and the
route overwrites `User.profilePicture` with the new URL. The previous blob is never
deleted.

Two consequences: unbounded storage growth, and every avatar a user has ever uploaded
remains at a public (unguessable but permanent) URL indefinitely. A user who uploads a
photo and then replaces it reasonably expects the first one to be gone. It isn't.

### The fix

Delete the prior blob after the new one is successfully stored and the DB pointer updated.

```ts
// In the route, after the successful prisma.user.update:
const previous = /* User.profilePicture read before the update */;
if (previous) await deleteAvatar(previous).catch(() => {
  // Non-fatal: an orphaned blob is better than a failed upload.
});
```

Details that matter:

- Order is: upload new → update DB → delete old. Never delete before the pointer moves,
  or a mid-flight failure leaves the user with a broken image.
- Delete failures must not fail the request. Log and continue, the same way
  `recordAuthEvent` (`lib/auth/audit-log.ts:12-28`) treats audit-write failures.
- Add a matching `deleteAvatar` to `picture-storage.ts` handling both backends: Vercel
  Blob via `del()` from `@vercel/blob`, and local `public/uploads/avatars/` via `unlink`.
- **Do not delete Google-hosted URLs.** OAuth users get `profile.picture`, an
  `lh3.googleusercontent.com` URL we don't own
  (`oauth/google/callback/route.ts:135-140,150`). Guard on the URL being one we wrote.
- A one-off cleanup script for existing orphans is optional; note it if you skip it.

### Acceptance criteria

- [ ] Replacing an avatar deletes the previous blob
- [ ] Delete failures are logged and non-fatal
- [ ] Google-hosted URLs are never passed to the delete path
- [ ] Works on both the Vercel Blob and local-filesystem backends
- [ ] `lib/auth/picture-storage.test.ts` covers the delete path and the Google-URL guard

---

## Item 20 — Remaining small correctness items

**Severity:** Low · **Category:** Correctness

Four independent items, grouped because each is a few lines.

### 20a — Unvalidated pagination cursor

**File:** `lib/transactions.ts:138`

```ts
...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
```

The client-supplied cursor goes straight into Prisma's `cursor:`. The `where` clause
includes `userId`, so there's **no cross-tenant read** — but a foreign or stale id yields a
500 rather than a clean 400.

**Fix:** verify the cursor row exists and belongs to `userId` before the query, returning a
400 `INVALID_CURSOR` if not. Or catch the Prisma error and map it. The ownership check is
cheap and more explicit.

### 20b — Uncapped `categoryIds` filter

**File:** `lib/transaction-validation.ts:208-215`

```ts
const ids = categoryIds.split(",").map(s => s.trim()).filter(s => s.length > 0);
if (ids.length > 0) value.categoryIds = ids;
```

No length cap, so an arbitrarily large `IN (...)` reaches Postgres. Bounded in practice by
URL length, but that's incidental rather than intentional.

**Fix:** cap at a sensible maximum (100 is well past any real category count) and return a
field error beyond it. Every other field in this file has an explicit bound — this one
just got missed.

### 20c — Inconsistent money rounding

**Files:** `lib/account-utils.ts:105-116`, `lib/net-worth-history.ts:192`

`computeNetWorthSeries` rounds each point to the cent, with a thorough comment at
`:185-191` explaining why — including the `|| 0` guard against `-0` rendering as
`"-$0.00"`. `computeNetWorth` sums floats with no rounding at all. Same money, two
conventions, and the chart's last point can differ from the summary card by a rounding step.

**Fix:** apply the same rounding in `computeNetWorth` for `totalAssets`,
`totalLiabilities`, and `netWorth`. Extract the round-to-cent helper (including the `-0`
guard) into one shared function both call, so the convention can't drift again.
`groupAccountsByBucket`'s `bucketTotal` (`:128`) has the same issue.

### 20d — Mixed date conventions

**Files:** `lib/transactions.ts:10-16`, `lib/accounts.ts:14-20` (UTC) vs `lib/budget-utils.ts:20-23` (local)

`transactions.ts` and `accounts.ts` are rigorously UTC, each with a comment explaining why
local midnight is unsafe. `budget-utils.ts` is rigorously **local**, with a comment
explaining why UTC is unsafe. Both are internally correct, and the `"YYYY-MM-DD"` string
pivot keeps round-trips consistent today — so **this is not currently a bug**.

It's a maintenance hazard: a future author reading one file will get the other wrong.
Also `lib/transaction-validation.ts:49` uses local-date construction for a validity check
inside a file that otherwise deals in UTC strings.

**Fix:** document the boundary explicitly rather than unifying the code. Add a short
section to `CLAUDE.md` (and the ADR set from item 18) stating: persistence and query layers
are UTC; period/calendar math in `budget-utils.ts` is local; `"YYYY-MM-DD"` strings are the
interchange format across that boundary. Unifying would mean choosing one convention and
breaking the reasoning behind the other — not worth it.

### Acceptance criteria

- [ ] Invalid or foreign cursor returns 400, not 500
- [ ] `categoryIds` capped with a field error beyond the cap
- [ ] `computeNetWorth`, `groupAccountsByBucket`, and `computeNetWorthSeries` all use one
      shared round-to-cent helper
- [ ] Chart's last point equals the summary card's net worth for the same data; regression
      test added
- [ ] Date-convention boundary documented in `CLAUDE.md`
- [ ] Tests added for the cursor and cap cases

---

# Closing out

After each phase:

```bash
npm run lint && npm run typecheck && npm test && npm run test:e2e
```

Update the **Status** line at the top of this document as phases complete, and check off
acceptance criteria in place so a later reader can see what actually shipped versus what
was planned.

Sequencing constraints and the items most likely to need renegotiation are documented up
front, under **Cross-phase dependencies** and **Where this plan may be wrong** — read
those before starting a phase, not after.
