/**
 * PKCE（RFC 7636）与 state 生成工具（见 docs/arch-oauth-hub.md §3.2 / ADR-04）。
 *
 * 硬约束：
 * - 0 新增依赖，全部基于 `node:crypto`。
 * - 只支持 S256，**禁止** `plain`（安全红线第 5 条）。
 * - 所有随机值使用 `randomBytes` 而非 `Math.random`。
 */

import { createHash, randomBytes } from 'node:crypto';

/** RFC 7636 §4.1 要求 code_verifier 长度在 43~128 之间。 */
export const CODE_VERIFIER_MIN_LENGTH = 43;
export const CODE_VERIFIER_MAX_LENGTH = 128;

/** 本项目固定采用 64 字节熵 → base64url 后 86 字符，落在合法区间内。 */
const CODE_VERIFIER_ENTROPY_BYTES = 64;

/** state 采用 32 字节熵 → base64url 后 43 字符，足够抗猜测。 */
const STATE_ENTROPY_BYTES = 32;

/** 仅支持的 challenge 方法（ADR-04）。 */
export const CODE_CHALLENGE_METHOD = 'S256' as const;

export type CodeChallengeMethod = typeof CODE_CHALLENGE_METHOD;

/** RFC 7636 §4.1 定义的 unreserved 字符集。 */
const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]+$/;

function toBase64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * 生成一次性 state。
 * 用作 `oauth_auth_states` 主键，回调时以 `DELETE ... RETURNING` 原子消费。
 */
export function createState(): string {
  return toBase64Url(randomBytes(STATE_ENTROPY_BYTES));
}

/** 生成符合 RFC 7636 的 code_verifier（base64url，86 字符）。 */
export function createCodeVerifier(): string {
  return toBase64Url(randomBytes(CODE_VERIFIER_ENTROPY_BYTES));
}

/** 校验 code_verifier 是否合法（长度 + 字符集）。 */
export function isValidCodeVerifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= CODE_VERIFIER_MIN_LENGTH &&
    value.length <= CODE_VERIFIER_MAX_LENGTH &&
    CODE_VERIFIER_PATTERN.test(value)
  );
}

/**
 * 由 code_verifier 推导 S256 challenge：`BASE64URL(SHA256(ASCII(verifier)))`。
 *
 * @throws {TypeError} 当 verifier 不满足 RFC 7636 长度或字符集要求时。
 */
export function deriveCodeChallenge(codeVerifier: string): string {
  if (!isValidCodeVerifier(codeVerifier)) {
    throw new TypeError('code_verifier 不符合 RFC 7636 要求（长度 43~128 且仅含 unreserved 字符）');
  }

  return toBase64Url(createHash('sha256').update(codeVerifier, 'ascii').digest());
}

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: CodeChallengeMethod;
}

/**
 * 一次性生成 PKCE 组合。
 * 仅在 provider 的 `capabilities.supportsPkce === true` 时调用。
 */
export function createPkcePair(): PkcePair {
  const codeVerifier = createCodeVerifier();
  return {
    codeVerifier,
    codeChallenge: deriveCodeChallenge(codeVerifier),
    codeChallengeMethod: CODE_CHALLENGE_METHOD,
  };
}
