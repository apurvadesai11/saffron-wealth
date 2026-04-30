// Client-safe password rules. Splitting these out lets client components
// (e.g. PasswordStrengthHint) reuse the constants without dragging in the
// server-only argon2 native binding.

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export interface PasswordRuleResult {
  ok: boolean;
  errors: string[];
}

export function validatePasswordRules(plain: string): PasswordRuleResult {
  const errors: string[] = [];
  if (plain.length < PASSWORD_MIN_LENGTH) {
    errors.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  if (plain.length > PASSWORD_MAX_LENGTH) {
    errors.push(`Password must be at most ${PASSWORD_MAX_LENGTH} characters.`);
  }
  return { ok: errors.length === 0, errors };
}
