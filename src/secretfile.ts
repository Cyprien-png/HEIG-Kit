/**
 * Files that grant access to someone's school account: the cookies of an edu-ID session, the Cyberlearn token, a
 * login waiting for its two-step code, the cached timetable. On a personal installation they are plain files readable
 * by their owner only. A shared server encrypts them with a key of its own (derived from HEIG_JWT_SECRET, never
 * written next to them): a copy or a backup of its cache folder gives nothing without the server's settings.
 */
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { seal, unseal } from "./accounts/password.js";

/** Marks an encrypted file; a plain one (JSON) never starts with it. */
const MAGIC = Buffer.from("HEIGKIT-SEALED-1\n");

let key: Buffer | undefined;

/** From now on these files are written encrypted with this key (32 bytes), and plain ones are encrypted when read. */
export function setSecretFileKey(value: Buffer | undefined): void {
  if (value && value.length !== 32) throw new Error("the key of the secret files must be 32 bytes");
  key = value;
}

export const secretFilesEncrypted = (): boolean => key !== undefined;

async function write(file: string, bytes: Buffer): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  // Written beside, then moved: a reader never sees half a file, and a crash leaves the previous one.
  const partial = `${file}.${process.pid}.partial`;
  await writeFile(partial, bytes, { mode: 0o600 });
  await chmod(partial, 0o600);
  await rename(partial, file);
}

/** Writes the text, encrypted when the process has a key; readable by the current user only either way. */
export async function writeSecretFile(file: string, text: string): Promise<void> {
  await write(file, key ? Buffer.concat([MAGIC, seal(key, text)]) : Buffer.from(text, "utf-8"));
}

/**
 * The text of the file. Throws when it is missing, or encrypted with another key (the server's secret changed: the
 * file is as good as gone, and the account logs in again). A plain file found by a process that has a key (written
 * before the encryption existed) is encrypted on the spot.
 */
export async function readSecretFile(file: string): Promise<string> {
  const bytes = await readFile(file);
  if (bytes.subarray(0, MAGIC.length).equals(MAGIC)) {
    const text = key ? unseal(key, bytes.subarray(MAGIC.length)) : undefined;
    if (text === undefined) throw new Error(`${path.basename(file)} is encrypted with another key`);
    return text;
  }
  const text = bytes.toString("utf-8");
  if (key) await writeSecretFile(file, text).catch(() => undefined);
  return text;
}
