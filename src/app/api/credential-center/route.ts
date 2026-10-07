import { requireApiSession } from '@/server/domains/auth/services/session';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { getPool } from '@/server/infra/db/pool';
import { listCredentialCenter } from '@/core/credentials/center';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/credential-center —— 授权与凭证中心：按平台聚合发布授权 + 采集 Cookie。 */
export async function GET() {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    return ok(await listCredentialCenter(getPool(), session.userId));
  } catch (err) {
    return fail(err);
  }
}
