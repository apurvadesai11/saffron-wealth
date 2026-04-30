import { hash, verify } from "@node-rs/argon2";
import { randomBytes } from "node:crypto";

export {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  validatePasswordRules,
  type PasswordRuleResult,
} from "./password-rules";

// Argon2id parameters per security spec: m=64MB, t=3, p=4.
const MEMORY_COST_KIB = 65536;
const TIME_COST = 3;
const PARALLELISM = 4;
// @node-rs/argon2 ships `Algorithm` as a const enum, which TS rejects under
// `isolatedModules`. Inlined: Algorithm.Argon2id === 2.
const ALGORITHM_ARGON2ID = 2 as const;

const ARGON2_OPTIONS = {
  algorithm: ALGORITHM_ARGON2ID,
  memoryCost: MEMORY_COST_KIB,
  timeCost: TIME_COST,
  parallelism: PARALLELISM,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(
  plainCandidate: string,
  storedHash: string,
): Promise<boolean> {
  try {
    return await verify(storedHash, plainCandidate);
  } catch {
    return false;
  }
}

// Cached dummy hash used during login when the email doesn't match a user.
// Running argon2 verify against this keeps response time uniform with
// real-user paths, foreclosing on existence-leaking timing attacks.
let dummyHashCache: Promise<string> | null = null;

export function getDummyHash(): Promise<string> {
  if (dummyHashCache === null) {
    const random = randomBytes(32).toString("base64url");
    dummyHashCache = hash(random, ARGON2_OPTIONS);
  }
  return dummyHashCache!;
}
