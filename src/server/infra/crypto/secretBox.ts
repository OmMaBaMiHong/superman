import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * 对称密钥信封（AES-256-GCM）。
 *
 * 密文格式：`v1:<iv_b64url>:<tag_b64url>:<ciphertext_b64url>`
 * - 自带版本前缀，便于未来算法/密钥轮换时无损识别历史密文。
 * - 三段一律 base64url，不含 `:` `+` `/` `=`，可安全存进 text 列与日志上下文。
 * - GCM 自带完整性校验：密文或 authTag 被篡改时 `open()` 抛错，绝不返回垃圾明文。
 *
 * 首个接入方是 GitHub Token（`user_settings.github_token_encrypted`），
 * 后续 `ai_api_key` / `translation_api_key` / `fever_accounts.api_key` 可复用同一套实现。
 */

/** 当前密文格式版本。轮换算法时新增 `v2` 并保留 `v1` 的解密路径。 */
export const SECRET_BOX_VERSION = 'v1';

/** AES-256 要求的密钥长度（字节）。 */
export const SECRET_KEY_BYTES = 32;

const ALGORITHM = 'aes-256-gcm';
/** GCM 推荐 96-bit IV，性能与安全性最佳。 */
const IV_BYTES = 12;
/** GCM authTag 固定 128-bit。 */
const AUTH_TAG_BYTES = 16;
const SEGMENT_SEPARATOR = ':';
const SEGMENT_COUNT = 4;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/;
const HEX_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export type SecretBoxErrorCode =
  | 'invalid_key'
  | 'invalid_format'
  | 'unsupported_version'
  | 'decrypt_failed';

/** secretBox 的统一错误类型，便于调用方按 `code` 分流而不用匹配错误文案。 */
export class SecretBoxError extends Error {
  readonly code: SecretBoxErrorCode;

  constructor(code: SecretBoxErrorCode, message: string) {
    super(message);
    this.name = 'SecretBoxError';
    this.code = code;
  }
}

function assertValidKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.byteLength !== SECRET_KEY_BYTES) {
    throw new SecretBoxError(
      'invalid_key',
      `Secret key must be exactly ${SECRET_KEY_BYTES} bytes`,
    );
  }
}

function encodeSegment(value: Buffer): string {
  return value.toString('base64url');
}

function decodeSegment(value: string, label: string): Buffer {
  if (!BASE64URL_PATTERN.test(value)) {
    throw new SecretBoxError('invalid_format', `Malformed ${label} segment`);
  }

  return Buffer.from(value, 'base64url');
}

/** 生成一把全新的 32 字节随机密钥。 */
export function generateSecretKey(): Buffer {
  return randomBytes(SECRET_KEY_BYTES);
}

/** 把密钥编码成可持久化 / 可写进环境变量的 hex 字符串。 */
export function encodeSecretKey(key: Buffer): string {
  assertValidKey(key);
  return key.toString('hex');
}

/**
 * 把密钥材料（hex 64 字符 或 base64/base64url）解码成 32 字节 Buffer。
 *
 * 两种编码都要求解码后恰好 32 字节，长度不符一律拒绝——
 * 宁可启动失败，也不能用一把错误长度的密钥静默加密数据。
 */
export function decodeSecretKey(material: string): Buffer {
  const normalized = material.trim();
  if (normalized.length === 0) {
    throw new SecretBoxError('invalid_key', 'Secret key material is empty');
  }

  if (HEX_KEY_PATTERN.test(normalized)) {
    return Buffer.from(normalized, 'hex');
  }

  // Buffer.from(x, 'base64') 会静默忽略非法字符，必须先做字符集校验。
  const base64Candidate = normalized.replace(/-/g, '+').replace(/_/g, '/');
  if (BASE64_PATTERN.test(base64Candidate)) {
    const decoded = Buffer.from(base64Candidate, 'base64');
    if (decoded.byteLength === SECRET_KEY_BYTES) {
      return decoded;
    }
  }

  throw new SecretBoxError(
    'invalid_key',
    `Secret key must decode to ${SECRET_KEY_BYTES} bytes (hex or base64)`,
  );
}

/**
 * 判断一个字符串是否是本模块产出的密文。
 *
 * 用于区分「已加密的历史值」与「空串 / 明文遗留值」，
 * 调用方应先 `isSealed()` 再 `open()`。
 */
export function isSealed(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }

  const segments = value.split(SEGMENT_SEPARATOR);
  if (segments.length !== SEGMENT_COUNT) {
    return false;
  }

  const [version, iv, tag, ciphertext] = segments;
  if (version !== SECRET_BOX_VERSION) {
    return false;
  }

  if (
    !BASE64URL_PATTERN.test(iv) ||
    !BASE64URL_PATTERN.test(tag) ||
    !BASE64URL_PATTERN.test(ciphertext)
  ) {
    return false;
  }

  return (
    Buffer.from(iv, 'base64url').byteLength === IV_BYTES &&
    Buffer.from(tag, 'base64url').byteLength === AUTH_TAG_BYTES
  );
}

/**
 * 加密。每次调用都会生成全新的随机 IV，因此同一明文两次 seal 的结果不同。
 *
 * @param plaintext 明文（允许空串，语义由调用方决定）
 * @param key 32 字节密钥，通常来自 `resolveSecretKey()`
 */
export function seal(plaintext: string, key: Buffer): string {
  assertValidKey(key);

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    SECRET_BOX_VERSION,
    encodeSegment(iv),
    encodeSegment(authTag),
    encodeSegment(ciphertext),
  ].join(SEGMENT_SEPARATOR);
}

/**
 * 解密。密文被篡改、authTag 不匹配或密钥错误时一律抛 `SecretBoxError`，
 * 绝不会返回被篡改的内容。
 */
export function open(sealed: string, key: Buffer): string {
  assertValidKey(key);

  if (typeof sealed !== 'string' || sealed.length === 0) {
    throw new SecretBoxError('invalid_format', 'Sealed value is empty');
  }

  const segments = sealed.split(SEGMENT_SEPARATOR);
  if (segments.length !== SEGMENT_COUNT) {
    throw new SecretBoxError(
      'invalid_format',
      'Sealed value must have 4 colon-separated segments',
    );
  }

  const [version, ivSegment, tagSegment, ciphertextSegment] = segments;
  if (version !== SECRET_BOX_VERSION) {
    throw new SecretBoxError(
      'unsupported_version',
      `Unsupported secret box version: ${version}`,
    );
  }

  const iv = decodeSegment(ivSegment, 'iv');
  const authTag = decodeSegment(tagSegment, 'authTag');
  const ciphertext = decodeSegment(ciphertextSegment, 'ciphertext');

  if (iv.byteLength !== IV_BYTES) {
    throw new SecretBoxError('invalid_format', 'Invalid iv length');
  }

  if (authTag.byteLength !== AUTH_TAG_BYTES) {
    throw new SecretBoxError('invalid_format', 'Invalid authTag length');
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  } catch {
    // 不透传底层 OpenSSL 错误文案，避免泄漏内部实现细节。
    throw new SecretBoxError(
      'decrypt_failed',
      'Failed to decrypt sealed value (wrong key or tampered ciphertext)',
    );
  }
}

/** 常量时间比较两把密钥，用于判断密钥是否发生轮换。 */
export function isSameSecretKey(left: Buffer, right: Buffer): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }

  return timingSafeEqual(left, right);
}
