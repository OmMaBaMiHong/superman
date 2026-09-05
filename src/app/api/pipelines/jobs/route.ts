import { requireApiSession } from '@/server/domains/auth/services/session';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError } from '@/server/infra/http/errors';
import { getPool } from '@/server/infra/db/pool';
import { listPipelineJobs } from '@/server/domains/pipelines/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS = new Set(['rewrite', 'voiceover', 'video']);
const STATUSES = new Set(['queued', 'running', 'succeeded', 'failed']);

function parsePositiveInt(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(request: Request) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const url = new URL(request.url);
    const kind = url.searchParams.get('kind');
    if (kind !== null && !KINDS.has(kind)) {
      throw new ValidationError('kind 取值非法', { kind: '仅支持 rewrite/voiceover/video' });
    }
    const status = url.searchParams.get('status');
    if (status !== null && !STATUSES.has(status)) {
      throw new ValidationError('status 取值非法', { status: '仅支持 queued/running/succeeded/failed' });
    }

    const result = await listPipelineJobs(getPool(), {
      userId: session.userId,
      kind: kind as 'rewrite' | 'voiceover' | 'video' | undefined ?? undefined,
      status: status as 'queued' | 'running' | 'succeeded' | 'failed' | undefined ?? undefined,
      page: parsePositiveInt(url.searchParams.get('page')) ?? 1,
      pageSize: parsePositiveInt(url.searchParams.get('pageSize')) ?? 20,
    });
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}
