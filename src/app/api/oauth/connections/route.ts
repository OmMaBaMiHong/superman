/**
 * GET /api/oauth/connections —— 列出当前用户的已授权连接。
 *
 * 安全：
 * - 服务层 SQL 全部带 `user_id` 谓词，越权在数据层就失败（安全红线 9）。
 * - `OAuthConnectionView` 结构性无 token 字段，响应体不可能带出凭据（安全红线 3）。
 */

import { requireApiSession } from '@/server/domains/auth/services/session';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { toAppError } from '@/server/integrations/oauth/oauthErrors';
import { listConnections } from '@/server/domains/oauth/services/oauthConnectionService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const connections = await listConnections(getPool(), session.userId);
    return ok(connections);
  } catch (err) {
    return fail(toAppError(err));
  }
}
