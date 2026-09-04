import { requireApiSession } from '@/server/domains/auth/services/session';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError } from '@/server/infra/http/errors';
import {
  clearGithubToken,
  getGithubTokenStatus,
  setGithubToken,
} from '@/server/domains/github/services/githubTokenService';
import { probeRateLimit } from '@/server/integrations/github/githubClient';
import { isGithubApiError } from '@/server/integrations/github/githubErrors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GitHub PAT 形态：classic（ghp_/gho_/ghu_/ghs_/ghr_）与 fine-grained（github_pat_）。 */
const TOKEN_PATTERN = /^(gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})$/;

function readToken(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const token = (input as { token?: unknown }).token;
  return typeof token === 'string' ? token : '';
}

export async function GET() {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    // 只返回打码值 + 速率状态，明文永不出网。
    const status = await getGithubTokenStatus(getPool(), session.userId);
    return ok(status);
  } catch (err) {
    return fail(err);
  }
}

export async function PUT(request: Request) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const json = await request.json().catch(() => null);
    const token = readToken(json).trim();
    if (!token) {
      throw new ValidationError('Invalid GitHub token', { token: 'GitHub Token 不能为空' });
    }
    if (!TOKEN_PATTERN.test(token)) {
      throw new ValidationError('Invalid GitHub token', {
        token: 'Token 格式不正确，应以 ghp_ / github_pat_ 等前缀开头',
      });
    }

    // 保存前先做有效性探测：`/rate_limit` 不消耗配额，401 说明 Token 无效，不落库。
    try {
      await probeRateLimit({ token, userId: session.userId });
    } catch (probeError) {
      if (isGithubApiError(probeError) && probeError.kind === 'unauthorized') {
        throw new ValidationError('Invalid GitHub token', { token: 'invalid' });
      }
      throw probeError;
    }

    const pool = getPool();
    await setGithubToken(pool, session.userId, token);
    const status = await getGithubTokenStatus(pool, session.userId);
    return ok(status);
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE() {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const pool = getPool();
    await clearGithubToken(pool, session.userId);
    const status = await getGithubTokenStatus(pool, session.userId);
    return ok(status);
  } catch (err) {
    return fail(err);
  }
}
