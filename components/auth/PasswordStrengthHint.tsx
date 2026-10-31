"use client";

import { isCommonPassword } from "@/lib/auth/blocklist";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from "@/lib/auth/password-rules";

interface Props {
  value: string;
}

export default function PasswordStrengthHint({ value }: Props) {
  if (value.length === 0) {
    return (
      <p className="text-xs text-fg-faint mt-1.5">
        Use {PASSWORD_MIN_LENGTH}–{PASSWORD_MAX_LENGTH} characters. Server also
        checks against breach databases on submit.
      </p>
    );
  }

  const tooShort = value.length < PASSWORD_MIN_LENGTH;
  const tooLong = value.length > PASSWORD_MAX_LENGTH;
  const common = !tooShort && !tooLong && isCommonPassword(value);

  if (tooShort) {
    return (
      <p className="text-xs text-warning mt-1.5">
        {PASSWORD_MIN_LENGTH - value.length} more characters needed.
      </p>
    );
  }
  if (tooLong) {
    return (
      <p className="text-xs text-danger-muted mt-1.5">
        Maximum {PASSWORD_MAX_LENGTH} characters.
      </p>
    );
  }
  if (common) {
    return (
      <p className="text-xs text-danger-muted mt-1.5">
        That password is on the common-password blocklist. Pick a more unique one.
      </p>
    );
  }
  return (
    <p className="text-xs text-gain mt-1.5">
      Looks good. Final breach check happens on submit.
    </p>
  );
}
