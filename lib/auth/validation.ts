// Hand-rolled input validators (no Zod — matches existing house style in
// components/TransactionForm.tsx and components/BudgetEditModal.tsx).

const NAME_MAX_LENGTH = 60;
const EMAIL_MAX_LENGTH = 254;

// Pragmatic email pattern: not RFC 5321 compliant on purpose — we just need
// "shape vaguely email-like" because real verification happens by sending mail.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface FieldError {
  field: string;
  message: string;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateEmail(raw: string): FieldError | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { field: "email", message: "Email is required." };
  if (trimmed.length > EMAIL_MAX_LENGTH) {
    return { field: "email", message: "Email is too long." };
  }
  if (!EMAIL_PATTERN.test(trimmed)) {
    return { field: "email", message: "Enter a valid email address." };
  }
  return null;
}

export function validateName(
  raw: string,
  field: "firstName" | "lastName",
): FieldError | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { field, message: `${field === "firstName" ? "First" : "Last"} name is required.` };
  }
  if (trimmed.length > NAME_MAX_LENGTH) {
    return { field, message: `Maximum ${NAME_MAX_LENGTH} characters.` };
  }
  return null;
}

export interface RegisterInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

export function parseRegisterBody(body: unknown): RegisterInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (
    typeof b.firstName !== "string" ||
    typeof b.lastName !== "string" ||
    typeof b.email !== "string" ||
    typeof b.password !== "string"
  ) {
    return null;
  }
  return {
    firstName: b.firstName,
    lastName: b.lastName,
    email: b.email,
    password: b.password,
  };
}

export interface LoginInput {
  email: string;
  password: string;
}

export function parseLoginBody(body: unknown): LoginInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.email !== "string" || typeof b.password !== "string") return null;
  return { email: b.email, password: b.password };
}
