/**
 * Passwords of the accounts and the key that seals each account's edu-ID credentials, the way password managers do it:
 * Argon2id stretches the password into a master key; two independent keys are derived from it (HKDF). The first is the
 * verifier stored in the database, the second seals the credentials (AES-256-GCM) and is never stored. The database
 * alone therefore proves a password without being able to open what it sealed.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { argon2id } from "hash-wasm";

export interface Kdf {
  /** Memory in KiB. */
  m: number;
  /** Iterations. */
  t: number;
  /** Parallelism. */
  p: number;
}

/** 64 MiB, 3 passes, 4 lanes: the defaults of Bitwarden, above the OWASP minimum. */
export const DEFAULT_KDF: Kdf = { m: 65_536, t: 3, p: 4 };
export const MIN_PASSWORD_LENGTH = 12;
export const GENERATED_PASSWORD_LENGTH = 18;

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

async function keys(password: string, salt: Buffer, kdf: Kdf): Promise<{ verifier: Buffer; vaultKey: Buffer }> {
  const master = await argon2id({ password: password.normalize("NFKC"), salt, memorySize: kdf.m, iterations: kdf.t, parallelism: kdf.p, hashLength: 32, outputType: "binary" });
  const derive = (purpose: string) => Buffer.from(hkdfSync("sha256", master, salt, `heig-kit ${purpose}`, 32));
  return { verifier: derive("password verifier"), vaultKey: derive("credentials vault") };
}

/** The text stored for a password (`argon2id$m=…,t=…,p=…$salt$verifier`), and the key that seals the credentials. */
export async function hashPassword(password: string, kdf: Kdf = DEFAULT_KDF): Promise<{ hash: string; vaultKey: Buffer }> {
  const salt = randomBytes(16);
  const { verifier, vaultKey } = await keys(password, salt, kdf);
  return { hash: `argon2id$m=${kdf.m},t=${kdf.t},p=${kdf.p}$${b64(salt)}$${b64(verifier)}`, vaultKey };
}

function parse(hash: string): { kdf: Kdf; salt: Buffer; verifier: Buffer } | undefined {
  const match = /^argon2id\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(hash);
  if (!match) return undefined;
  return { kdf: { m: Number(match[1]), t: Number(match[2]), p: Number(match[3]) }, salt: Buffer.from(match[4], "base64url"), verifier: Buffer.from(match[5], "base64url") };
}

/** A hash nobody knows the password of: checked when the account does not exist, so both cases take the same time. */
const DECOY = `argon2id$m=${DEFAULT_KDF.m},t=${DEFAULT_KDF.t},p=${DEFAULT_KDF.p}$${b64(randomBytes(16))}$${b64(randomBytes(32))}`;

/** The vault key when the password is the right one, undefined otherwise. */
export async function verifyPassword(password: string, hash: string | null | undefined): Promise<Buffer | undefined> {
  const parsed = parse(hash ?? "") ?? parse(DECOY)!;
  const { verifier, vaultKey } = await keys(password, parsed.salt, parsed.kdf);
  const same = verifier.length === parsed.verifier.length && timingSafeEqual(verifier, parsed.verifier);
  return same && hash ? vaultKey : undefined;
}

/** nonce (12) | ciphertext | tag (16) */
export function seal(key: Buffer, text: string): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  return Buffer.concat([nonce, cipher.update(text, "utf-8"), cipher.final(), cipher.getAuthTag()]);
}

/** The sealed text, or undefined with another key or an altered seal. */
export function unseal(key: Buffer, sealed: Buffer): string | undefined {
  if (sealed.length < 28) return undefined;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, 12));
    decipher.setAuthTag(sealed.subarray(sealed.length - 16));
    return Buffer.concat([decipher.update(sealed.subarray(12, sealed.length - 16)), decipher.final()]).toString("utf-8");
  } catch {
    return undefined;
  }
}

/** Letters and digits that cannot be confused when copied by hand (no 0/O, 1/l/I), and a few signs. */
const ALPHABET = { lower: "abcdefghijkmnopqrstuvwxyz", upper: "ABCDEFGHJKLMNPQRSTUVWXYZ", digit: "23456789", sign: "-_!?+=" };

/** A random first password: 18 characters, at least one of each kind. */
export function generatePassword(length = GENERATED_PASSWORD_LENGTH): string {
  const all = Object.values(ALPHABET).join("");
  for (;;) {
    const text = Array.from({ length }, () => all[randomInt(all.length)]).join("");
    if (Object.values(ALPHABET).every((group) => [...text].some((c) => group.includes(c)))) return text;
  }
}

/** Why a password chosen by a user is refused, or undefined when it is acceptable. */
export function passwordProblem(password: string, about: { email?: string; previous?: string } = {}): string | undefined {
  if (password.length < MIN_PASSWORD_LENGTH) return `Le mot de passe doit avoir au moins ${MIN_PASSWORD_LENGTH} caractères.`;
  if (password.length > 200) return "Le mot de passe est trop long.";
  if (new Set(password).size < 5) return "Le mot de passe est trop répétitif.";
  if (about.previous !== undefined && password === about.previous) return "Le nouveau mot de passe doit être différent de l'ancien.";
  const local = about.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && password.toLowerCase().includes(local)) return "Le mot de passe ne doit pas contenir votre adresse.";
  return undefined;
}
