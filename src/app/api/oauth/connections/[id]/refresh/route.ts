/**
 * POST /api/oauth/connections/:id/refresh —— 手动续期访问令牌。
 *
 * 同步执行而非入队：续期是单次 HTTP 往返（秒级），
 * 且用户点了「续期」就期待立刻看到新的过期时间，走队列反而要轮询。
 *
 * 安全：
 * - 新 token 在服务层加密落库，响应体仍是无凭据的 `OAuthConnectionView`。
 * - 续期失败时服务层把连接置为 `expired` 而非删除，用户仍能看到「重新授权」出路。
 */

import { requireApiSession } from '@/server/domains/auth/services/session';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError } from '@/server/infra/http/errors';
import { toAppError } from '@/server/integrations/oauth/oauthErrors';
import { refreshConnection } from '@/server/domains/oauth/services/oauthConnectionService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const { id } = await context.params;
    if (!id?.trim()) {
      return fail(new ValidationError('Invalid request', { id: '缺少连接 id' }));
    }

    const view = await refreshConnection(getPool(), session.userId, id.trim());
    return ok(view);
  } catch (err) {
    return fail(toAppError(err));
  }
}
