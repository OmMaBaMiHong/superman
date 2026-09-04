/**
 * DELETE /api/oauth/connections/:id —— 断开授权连接。
 *
 * MVP 只做本地删除：四家平台的远程撤销端点差异极大（部分根本没有），
 * `supportsRemoteRevoke` 已在 provider 能力表里预留，P2 再补远程调用。
 *
 * 安全：id 不存在与「存在但属于别人」返回同一个 404，避免被用来探测他人连接 id。
 */

import { requireApiSession } from '@/server/domains/auth/services/session';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError } from '@/server/infra/http/errors';
import { toAppError } from '@/server/integrations/oauth/oauthErrors';
import { revokeConnection } from '@/server/domains/oauth/services/oauthConnectionService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const { id } = await context.params;
    if (!id?.trim()) {
      return fail(new ValidationError('Invalid request', { id: '缺少连接 id' }));
    }

    const result = await revokeConnection(getPool(), session.userId, id.trim());
    return ok(result);
  } catch (err) {
    return fail(toAppError(err));
  }
}
