// crypto.ts — AES-256-GCM session encryption with PBKDF2 key derivation
// v0.9.0 FM-8: protect session files at rest

import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm" as const;
const KEY_LENGTH = 32;        // 256 bits
const IV_LENGTH = 12;         // 96 bits (GCM recommended)
const SALT_LENGTH = 32;       // 256 bits
const AUTH_TAG_LENGTH = 16;   // 128 bits
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_DIGEST = "sha256";

// Payload layout (binary): salt(32) || iv(12) || authTag(16) || ciphertext(n) — base64-encoded
const HEADER_LENGTH = SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH; // 60 bytes

export function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);
}

export function encryptSession(plaintext: string, passphrase: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([salt, iv, authTag, encrypted]);
  return payload.toString("base64");
}

export function decryptSession(ciphertext: string, passphrase: string): string {
  const payload = Buffer.from(ciphertext, "base64");
  if (payload.length < HEADER_LENGTH) {
    throw new Error("Invalid encrypted session: payload too short");
  }
  const salt = payload.subarray(0, SALT_LENGTH);
  const iv = payload.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = payload.subarray(SALT_LENGTH + IV_LENGTH, HEADER_LENGTH);
  const encrypted = payload.subarray(HEADER_LENGTH);
  const key = deriveKey(passphrase, salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  try {
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf-8");
  } catch {
    throw new Error("Session decryption failed: invalid key or corrupted data");
  }
}

export function getEncryptionKey(): string | undefined {
  const val = process.env.JARVIS_BROWSER_ENCRYPTION_KEY;
  return val && val.length > 0 ? val : undefined;
}
