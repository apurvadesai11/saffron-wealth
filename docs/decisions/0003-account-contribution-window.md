# 0003 — An account contributes to the net-worth series only inside its event window

**Status:** Accepted, twice amended · **Origin:** Ruling 3, net-worth phase 2–3 plan
**Code:** `computeNetWorthSeries` in `lib/net-worth-history.ts`

## Decision

On a sample date `D`, an account contributes its most recent balance at or
before `D`, and contributes nothing outside its window. The window opens at
`firstDate` — never before the account existed — and closes as follows:

- an **active** account has no upper bound; its last known balance carries
  forward to the end of the series;
- an **archived** account's window closes at `min(lastDate, dayBefore(archivedAt))`.

An account whose last balance event predates the imported file's max date is
created archived.

## Why

Without an upper bound, real imported history carries a frozen balance forward
forever: a paid-off mortgage and a liquidated stock plan both stop reporting
while sitting at a large non-zero value. Reading "most recent event at or
before D" with no bound puts a phantom mortgage into *today's* net worth, so
the chart's last point contradicts the summary card directly above it.

Every active account in the source export reports daily, which makes "last
event older than the file's max date" a reliable closure signal.

## Amendment 1 — the upper bound is `min(lastDate, dayBefore(archivedAt))`

`archiveAccount` never writes a closing balance event, so an account created
and archived on the same calendar day has a `lastDate` equal to its own
archive date. `date > lastDate` alone does not exclude that day, so the series
counted the account on the very day the live summary card already excluded it
unconditionally. In the ordinary case — an account that stopped reporting well
before a later import archived it — `archivedAtDate` is far later than
`lastDate` and this `min` is still just `lastDate`.

## Amendment 2 — an active account has no upper bound at all

Phase 1's `createAccount` writes exactly one opening-balance event, so a
hand-entered account's `lastDate` is its creation day. Closing its window
there would make it vanish from every later chart point, including today,
while it still counted in the live summary card. Carry-forward *inside* the
window applies regardless of archived state; only whether the window ever ends
depends on it.

## Cost if wrong

An account that is genuinely open but stopped syncing drops out of net worth
and lands archived. Visible, one click to restore, and a fresh export corrects
it automatically.
