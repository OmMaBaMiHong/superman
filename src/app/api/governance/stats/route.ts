import { requireApiSession } from '@/server/domains/auth/services/session';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { getPool } from '@/server/infra/db/pool';
import { getGovernanceStats } from '@/server/domains/governance/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const stats = await getGovernanceStats(getPool(), session.userId);
    return ok(stats);
  } catch (err) {
    return fail(err);
  }
}
