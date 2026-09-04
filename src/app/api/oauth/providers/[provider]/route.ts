/**
 * PUT    /api/oauth/providers/:provider —— 保存平台应用配置。
 * DELETE /api/oauth/providers/:provider —— 清除平台应用配置。
 *
 * 安全：
 * - `clientSecret` 明文只在请求体里出现一次，服务层 `seal()` 后落库，
 *   本路由不打印、不回显、不放进任何日志（安全红线 1 / 3）。
 * - 两个方法的响应体统一是 `OAuthProviderConfigStatus`，只含打码值。
 */

import { z } from 'zod';
import { requireApiSession } from '@/server/domains/auth/services/session';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError } from '@/server/infra/http/errors';
import { toAppError } from '@/server/integrations/oauth/oauthErrors';
import { isOAuthProviderId } from '@/server/integrations/oauth/oauthProviderTypes';
import {
  clearProviderConfig,
  saveProviderConfig,
} from '@/server/domains/oauth/services/oauthConfigService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const putBodySchema = z.object({
  clientId: z.string().trim().min(1).max(255),
  /**
   * 省略表示保留原 secret（用户只想改 clientId 时无需重填 secret）；
   * 传空串表示显式清空。故这里**不能**用 `.min(1)`。
   */
  clientSecret: z.string().max(512).optional(),
  enabled: z.boolean().optional(),
});

function zodIssuesToFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'body';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

export async function PUT(request: Request, context: { params: Promise<{ provider: string }> }) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const { provider } = await context.params;
    if (!isOAuthProviderId(provider)) {
      return fail(new ValidationError('Invalid request', { provider: '不支持的平台' }));
    }

    const json = await request.json().catch(() => null);
    const parsed = putBodySchema.safeParse(json);
    if (!parsed.success) {
      return fail(new ValidationError('Invalid request body', zodIssuesToFields(parsed.error)));
    }

    const status = await saveProviderConfig(
      getPool(),
      {
        provider,
        clientId: parsed.data.clientId,
        ...(parsed.data.clientSecret === undefined
          ? {}
          : { clientSecret: parsed.data.clientSecret }),
        ...(parsed.data.enabled === undefined ? {} : { enabled: parsed.data.enabled }),
      },
      request.headers,
    );

    return ok(status);
  } catch (err) {
    return fail(toAppError(err));
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  const session = await requireApiSession();
  if (session && 'response' in session) {
    return session.response;
  }

  try {
    const { provider } = await context.params;
    if (!isOAuthProviderId(provider)) {
      return fail(new ValidationError('Invalid request', { provider: '不支持的平台' }));
    }

    // 清除配置不级联删连接：已授权的连接仍可继续用，直到用户主动断开。
    const status = await clearProviderConfig(getPool(), provider, request.headers);
    return ok(status);
  } catch (err) {
    return fail(toAppError(err));
  }
}
