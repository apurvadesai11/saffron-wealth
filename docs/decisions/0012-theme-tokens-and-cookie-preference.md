# 0012 — Colours are theme tokens; the theme preference is a server-read cookie

**Status:** Accepted (supersedes the light-only "Fix: Dark mode CSS removed" in the Monthly Budget PRD log)
**Code:** `lib/theme-tokens.ts`, `tailwind.config.ts`, `lib/theme.ts`, `app/layout.tsx`, `components/ThemeSelector.tsx`
**Guards:** `components/__tests__/no-raw-colors.test.ts`, `lib/theme-tokens.test.ts`, `e2e/theme.spec.ts`, `npm run test:visual`

## Decision

1. **Components name colour roles, not shades.** `text-fg-muted`, `bg-surface`,
   `bg-accent-solid` — never `text-gray-500`. Every token is an
   `rgb(var(--c-<token>) / <alpha>)` colour whose values live in
   `lib/theme-tokens.ts`, one set per theme.
2. **Tailwind's default palette is replaced, not extended.** A raw shade
   produces no CSS. The exception is the categorical palette: `Category.color`
   is a Tailwind class name stored in Postgres, so those exact names stay
   defined.
3. **The preference is a plain `sw_theme` cookie** (`light` | `dark` |
   `system`), read by the root layout, which sets `<html data-theme>` only for an
   explicit choice. With no choice, a `prefers-color-scheme` media query decides.

## Why

The first dark mode was removed because `globals.css` had dark variables while
every component hardcoded light classes, so a dark OS got a mismatched page. A
dark mode that depends on every author remembering a `dark:` variant on every
colour class fails the same way, one class at a time. With tokens, a theme is
one block of values, and the backstop test fails when a raw colour comes back.

Replacing the palette makes a raw shade inert. On its own that fails silently:
an unknown class renders unstyled. The test is the loud half, and it also
rejects misspelled token names.

## Why a cookie the server reads

- **Not a `User` column.** It's a display preference. Storing it on `User`
  would cost a migration and an API field, and the server would still need a
  cookie to render the first paint correctly.
- **Not an inline `<head>` script** (the next-themes approach). The usual
  reason for a script is to keep pages static, but `proxy.ts` already gives every
  HTML response a per-request CSP nonce, so no page is static here. A script
  would have needed that nonce plumbed through `headers()` and
  `suppressHydrationWarning` on `<html>`, and would have gained nothing.
- **No CSRF.** Setting the cookie changes nothing on the server and carries no
  authority. It's written by client JS: not HttpOnly, `SameSite=Lax`.

## Consequences

- Light values were copied 1:1 from the shades they replaced. The conversion
  was proven visually neutral with screenshots captured on `main` and compared
  with `threshold: 0` (Playwright's default per-pixel tolerance hides small
  colour changes).
- Dark is designed, not inverted. Elevation reverses (the page is darkest and
  each layer above it is lighter), and text and status colours move up their
  ramps. Fills that carry white text keep their light-mode contrast.
  `lib/theme-tokens.test.ts` enforces both rules.
- Text tokens and button-fill tokens are separate (`accent` vs `accent-solid`),
  because on a dark surface text has to lighten while a fill under white text
  has to stay dark.
- The preference is per browser, not per user. Another open tab picks a change
  up on its next load. Mobile browser chrome (`themeColor`) follows the OS, not
  the override, because the viewport API only accepts media queries.

## Rejected alternatives

- `dark:` variants on every colour class: roughly 700 edits that every future
  component must repeat. This is the failure mode that removed the first dark
  mode.
- Remapping Tailwind's `gray` scale to variables: fewer edits, but `gray-900`
  would mean "light" in dark mode, and white, black and the accent hues would
  still need separate handling.
