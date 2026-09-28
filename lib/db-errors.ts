// Thrown by a query-layer function when a caller-supplied foreign key
// (categoryId, accountId, ...) doesn't exist or isn't owned by the requesting
// user. Distinct from Prisma's own FK constraint violation, which only proves
// the row exists *somewhere* — not that this user owns it. Routes catch this
// to produce a precise 400 VALIDATION_FAILED field error instead of a bare 500.
export class InvalidReferenceError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "InvalidReferenceError";
    this.field = field;
  }
}

// Thrown by queryTransactions when the caller-supplied pagination cursor names
// no row the caller owns. The where clause is userId-scoped, so a foreign
// cursor never read another user's data — it made Prisma throw, which the
// route surfaced as a 500 on what is really a bad request. Routes catch this
// to produce a 400 INVALID_CURSOR.
export class InvalidCursorError extends Error {
  constructor(message = "Invalid pagination cursor.") {
    super(message);
    this.name = "InvalidCursorError";
  }
}
