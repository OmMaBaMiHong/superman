import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError } from '@/server/infra/http/errors';
import { listBoards, createBoard } from '@/server/domains/boards/repositories/boardsRepo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createBoardBodySchema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  icon: z.string().max(10).optional(),
});

function zodIssuesToFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'body';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

export async function GET() {
  const session = await requireApiSession();
  if ('response' in session) return session.response;

  try {
    const pool = getPool();
    const boards = await listBoards(pool, session.userId);
    return ok(boards);
  } catch (err) {
    return fail(err);
  }
}

export async function POST(request: Request) {
  const session = await requireApiSession();
  if ('response' in session) return session.response;

  try {
    const json = await request.json().catch(() => null);
    const parsed = createBoardBodySchema.safeParse(json);
    if (!parsed.success) {
      return fail(new ValidationError('Invalid request body', zodIssuesToFields(parsed.error)));
    }

    const pool = getPool();
    const board = await createBoard(
      pool,
      session.userId,
      parsed.data.title,
      parsed.data.description,
      parsed.data.icon,
    );
    return ok(board);
  } catch (err) {
    return fail(err);
  }
}
