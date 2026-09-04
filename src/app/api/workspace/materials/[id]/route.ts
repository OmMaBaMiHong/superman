import { requireApiSession } from '@/server/domains/auth/services/session';
import { z } from 'zod';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { NotFoundError, ValidationError } from '@/server/infra/http/errors';
import {
  deleteWorkspaceMaterial,
  getWorkspaceMaterial,
} from '@/server/services/workspace/material';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.coerce.number().int().positive();

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }
  const userId = Number(session.userId);

  const { id: rawId } = await params;
  const parsed = idSchema.safeParse(rawId);
  if (!parsed.success) {
    return fail(new ValidationError('无效的素材 ID', { id: '必须提供有效的素材 ID' }));
  }

  try {
    const material = await getWorkspaceMaterial(parsed.data, userId);
    if (!material) {
      return fail(new NotFoundError('未找到该素材'));
    }
    return ok(material);
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }
  const userId = Number(session.userId);

  const { id: rawId } = await params;
  const parsed = idSchema.safeParse(rawId);
  if (!parsed.success) {
    return fail(new ValidationError('无效的素材 ID', { id: '必须提供有效的素材 ID' }));
  }

  try {
    const material = await getWorkspaceMaterial(parsed.data, userId);
    if (!material) {
      return fail(new NotFoundError('未找到该素材'));
    }

    // 先删数据库记录，再清理磁盘文件（避免残留孤儿文件）
    const deleted = await deleteWorkspaceMaterial(parsed.data, userId);
    if (!deleted) {
      return fail(new NotFoundError('未找到该素材'));
    }
    if (material.filePath && existsSync(material.filePath)) {
      await fs.unlink(material.filePath).catch(() => {});
    }

    return ok({ id: parsed.data });
  } catch (err) {
    return fail(err);
  }
}
