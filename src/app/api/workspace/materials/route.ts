import { requireApiSession } from '@/server/domains/auth/services/session';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { listWorkspaceMaterials } from '@/server/services/workspace/material';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }
  const userId = Number(session.userId);

  try {
    const materials = await listWorkspaceMaterials(userId);
    return ok(materials);
  } catch (err) {
    return fail(err);
  }
}
