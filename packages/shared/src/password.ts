import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Operator password hashing with Node's built-in scrypt (memory-hard KDF).
 * Format: `scrypt$<N>$<r>$<p>$<salt b64url>$<hash b64url>`.
 * Parameters are stored with each hash so they can be raised later.
 */

const DEFAULT_PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;

function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

function maxmemFor(N: number, r: number): number {
  return 128 * N * r * 2;
}

export function validatePasswordStrength(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Passwords must be at most ${MAX_PASSWORD_LENGTH} characters.`;
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const problem = validatePasswordStrength(password);
  if (problem) throw new Error(problem);
  const { N, r, p } = DEFAULT_PARAMS;
  const salt = randomBytes(SALT_LENGTH);
  const key = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, { N, r, p, maxmem: maxmemFor(N, r) });
  return ["scrypt", N, r, p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0) || N > 2 ** 20 || r > 32 || p > 16) return false;
  const salt = Buffer.from(parts[4]!, "base64url");
  const expected = Buffer.from(parts[5]!, "base64url");
  if (password.length > MAX_PASSWORD_LENGTH) return false;
  const actual = await scrypt(password.normalize("NFKC"), salt, expected.length, { N, r, p, maxmem: maxmemFor(N, r) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * A precomputed hash used to spend equivalent time when a username does not
 * exist, so login timing does not reveal which operator accounts exist.
 */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(24).toString("base64url"));
  return dummyHash;
}
