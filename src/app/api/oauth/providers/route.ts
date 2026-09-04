/**
 * GET /api/oauth/providers —— 列出四个平台的配置状态。
 *
 * 未配置的平台也会出现在列表里（呈「未配置」引导态），
 * 因此这是设置页唯一需要的一次拉取，不需要前端逐个探测。
 *
 * 安全：响应体来自 `getProviderConfigStatuses`，结构上只含 `maskedClientSecret`，
 * 不含 secret 明文或密文（安全红线 3）。
 */

import { requireApiSession } from '@/server/domains/auth/services/session';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { toAppError } from '@/server/integrations/oauth/oauthErrors';
import { getProviderConfigStatuses } from '@/server/domains/oauth/services/oauthConfigService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    // redirect_uri 依赖 Host / x-forwarded-*，必须把请求头透传给服务层（ADR-05）。
    const statuses = await getProviderConfigStatuses(getPool(), request.headers);
    return ok(statuses);
  } catch (err) {
    return fail(toAppError(err));
  }
}
