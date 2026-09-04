/**
 * POST /api/oauth/authorize —— 发起授权，返回平台授权页 URL。
 *
 * 为什么返回 JSON 而不是直接 302：
 * 设置页是抽屉里的局部交互，服务端 302 会让 `fetch` 跟随重定向到平台域名并触发 CORS，
 * 拿到 URL 后由前端 `location.assign` 才是可控的整页跳转。
 *
 * 安全：
 * - `redirect_uri` 由服务端单向推导，**不接受**前端传入（否则等于开放重定向 + 凭据劫持）。
 * - `returnTo` 只允许站内相对路径，服务层 `sanitizeReturnTo` 已兜底，这里只做长度限制。
 */

import { z } from 'zod';
import { requireApiSession } from '@/server/domains/auth/services/session';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError } from '@/server/infra/http/errors';
import { toAppError } from '@/server/integrations/oauth/oauthErrors';
import { OAUTH_PROVIDER_IDS } from '@/server/integrations/oauth/oauthProviderTypes';
import { startAuthorization } from '@/server/domains/oauth/services/oauthAuthorizeService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  provider: z.enum(OAUTH_PROVIDER_IDS),
  returnTo: z.string().max(2048).nullable().optional(),
});

function zodIssuesToFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'body';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return fail(new ValidationError('Invalid request body', zodIssuesToFields(parsed.error)));
    }

    const result = await startAuthorization(getPool(), {
      userId: session.userId,
      provider: parsed.data.provider,
      returnTo: parsed.data.returnTo ?? null,
      headers: request.headers,
    });

    return ok(result);
  } catch (err) {
    // 未配置的平台在这里以 400 + oauth_not_configured 返回，前端据此提示去填凭据。
    return fail(toAppError(err));
  }
}
