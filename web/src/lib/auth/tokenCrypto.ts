/**
 * AEAD encryption for OAuth refresh tokens at rest. AES-256-GCM via Node's
 * built-in `crypto` (no extra deps). The key comes from the `OAUTH_TOKEN_KEY`
 * env var — 32 raw bytes, supplied as a 64-char hex string. Generate with:
 *
 *   openssl rand -hex 32
 *
 * Wire format (DB columns):
 *   - `refresh_token_ciphertext` (bytea): the GCM ciphertext, no tag inside.
 *   - `refresh_token_iv` (bytea): 12 bytes random per-write.
 *   - `refresh_token_tag` (bytea): 16-byte GCM auth tag.
 *   - `refresh_token_key_version` (smallint): which key produced the row.
 *
 * We split the tag into its own column rather than appending it to the
 * ciphertext so future maintainers reading the table can tell the parts
 * apart without reading this comment. `keyVersion` is a small integer
 * (1, 2, 3, ...) that we bump whenever the key rotates — the env will
 * one day be `OAUTH_TOKEN_KEY` + `OAUTH_TOKEN_KEY_V2`, and decrypt picks
 * the right key by version. Today only version 1 exists.
 *
 * Failure mode contract:
 *   - `encryptToken` throws if `OAUTH_TOKEN_KEY` is missing or malformed.
 *     Boot-time env validation (`src/lib/env.ts`) catches this in practice.
 *   - `decryptToken` throws on tag-mismatch (tampered or wrong-key data)
 *     or on an unknown `keyVersion`. Callers MUST wrap in try/catch and
 *     fall back to forcing a fresh OAuth flow — never silently return a
 *     bogus plaintext. See the audit action `auth.token_decrypt_failed`.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { env } from '../env'

/**
 * Current key version stamped onto every new ciphertext. Bumped only when
 * a new key is added to the env (e.g. `OAUTH_TOKEN_KEY_V2`). Old rows keep
 * their original version and decrypt against their matching key — that's
 * how rotation works without a forced re-login.
 */
export const CURRENT_KEY_VERSION = 1

const ALGO = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32

export type Encrypted = {
  ciphertext: Buffer
  iv: Buffer
  tag: Buffer
  keyVersion: number
}

let _keyCache: { v: number; key: Buffer } | null = null

function keyForVersion(version: number): Buffer {
  // Only one key exists today. Future versions will read OAUTH_TOKEN_KEY_V2,
  // _V3, ... from env. We keep a tiny one-slot cache so repeated calls in
  // a hot loop don't re-hex-decode on every encrypt.
  if (_keyCache && _keyCache.v === version) return _keyCache.key
  if (version !== CURRENT_KEY_VERSION) {
    throw new Error(`OAUTH_TOKEN_KEY version ${version} not configured — cannot decrypt`)
  }
  if (!env.OAUTH_TOKEN_KEY) {
    throw new Error('OAUTH_TOKEN_KEY not set — refresh-token AEAD is disabled')
  }
  // Hex decode + length check. A 32-byte key is exactly 64 hex chars; we
  // refuse to silently truncate or pad — bad keys are a config bug, not
  // a runtime fallback.
  if (!/^[0-9a-fA-F]{64}$/.test(env.OAUTH_TOKEN_KEY)) {
    throw new Error('OAUTH_TOKEN_KEY must be exactly 64 hex chars (32 bytes)')
  }
  const key = Buffer.from(env.OAUTH_TOKEN_KEY, 'hex')
  if (key.length !== KEY_BYTES) {
    // Defense-in-depth — the regex above already enforces this.
    throw new Error(`OAUTH_TOKEN_KEY must decode to ${KEY_BYTES} bytes`)
  }
  _keyCache = { v: version, key }
  return key
}

/**
 * Encrypt a plaintext refresh token under the current key. The caller
 * persists all four returned fields verbatim to the DB columns described
 * at the top of this file.
 */
export function encryptToken(plaintext: string): Encrypted {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('encryptToken: plaintext must be a non-empty string')
  }
  const key = keyForVersion(CURRENT_KEY_VERSION)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  if (tag.length !== TAG_BYTES) {
    // Should never happen with aes-256-gcm; defensive.
    throw new Error(`unexpected GCM tag length ${tag.length}`)
  }
  return { ciphertext, iv, tag, keyVersion: CURRENT_KEY_VERSION }
}

/**
 * Decrypt a stored refresh token. Throws on tag-mismatch (tampered or
 * wrong-key data) or unknown key version — callers should catch and force
 * the user back through OAuth, while writing an audit row with action
 * `auth.token_decrypt_failed` so operators can detect a key rotation gone
 * wrong vs. an attacker tampering with the DB.
 */
export function decryptToken(input: Encrypted): string {
  const { ciphertext, iv, tag, keyVersion } = input
  if (!Buffer.isBuffer(ciphertext) || ciphertext.length === 0) {
    throw new Error('decryptToken: ciphertext must be a non-empty Buffer')
  }
  if (!Buffer.isBuffer(iv) || iv.length !== IV_BYTES) {
    throw new Error(`decryptToken: iv must be ${IV_BYTES} bytes`)
  }
  if (!Buffer.isBuffer(tag) || tag.length !== TAG_BYTES) {
    throw new Error(`decryptToken: tag must be ${TAG_BYTES} bytes`)
  }
  const key = keyForVersion(keyVersion)
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ])
  return plaintext.toString('utf8')
}
