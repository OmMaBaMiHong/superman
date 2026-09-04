/**
 * GET /api/oauth/callback/:provider —— 平台授权回调。
 *
 * **本路由永远返回 302，绝不返回 JSON**：浏览器是被平台整页跳转过来的，
 * 返回 JSON 会让用户停在一个白屏的接口页面上。所有成功 / 失败结果都通过
 * query 参数（`?settings=oauth&oauth=...&provider=...&reason=...`）带回站内，
 * 由 `ReaderLayout` 读取后弹 toast 并打开设置抽屉。
 *
 * 安全：
 * - 未登录同样 302（回登录页），不泄漏「这个 state 是否存在」。
 * - `reason` 只放 `OAuthErrorKind` 枚举值，不放平台原始错误文案（安全红线 3）。
 * - state 无论校验成败都已被服务层原子消费，重放必然失败。
 */

import { NextResponse } from 'next/server';
import { requireApiSession } from '@/server/domains/auth/services/session';
import { getPool } from '@/server/infra/db/pool';
import {
  buildCallbackRedirectUrl,
  DEFAULT_RETURN_TO,
  type OAuthCallbackOutcome,
} from '@/server/domains/oauth/redirectUri';
import {
  handleCallback,
  normalizeCallbackError,
  resolveCallbackReturnTo,
} from '@/server/domains/oauth/services/oauthCallbackService';
import { isOAuthProviderId, type OAuthProviderId } from '@/server/integrations/oauth/oauthProviderTypes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 统一出口：把任何结果都变成 302。 */
function redirectBack(
  request: Request,
  input: {
    returnTo: string;
    provider: OAuthProviderId;
    outcome: OAuthCallbackOutcome;
    reason?: string | null;
  },
): NextResponse {
  const url = buildCallbackRedirectUrl(
    {
      returnTo: input.returnTo,
      provider: input.provider,
      outcome: input.outcome,
      reason: input.reason ?? null,
    },
    request.headers,
  );
  return NextResponse.redirect(url, 302);
}

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider: rawProvider } = await context.params;

  // 平台标识非法时不可能有对应的 state，直接回首页并标记失败。
  if (!isOAuthProviderId(rawProvider)) {
    const url = new URL(DEFAULT_RETURN_TO, request.url);
    url.searchParams.set('settings', 'oauth');
    url.searchParams.set('oauth', 'failed');
    url.searchParams.set('reason', 'invalid_state');
    return NextResponse.redirect(url.toString(), 302);
  }

  const provider: OAuthProviderId = rawProvider;

  const session = await requireApiSession();
  if (session && 'response' in session) {
    // 会话已过期：不返回 401 JSON，把用户送回站内（中间件会引导登录）。
    return redirectBack(request, {
      returnTo: DEFAULT_RETURN_TO,
      provider,
      outcome: 'failed',
      reason: 'invalid_state',
    });
  }

  const query = new URL(request.url).searchParams;

  try {
    const result = await handleCallback(getPool(), {
      userId: session.userId,
      provider,
      code: query.get('code'),
      state: query.get('state'),
      error: query.get('error'),
    });

    return redirectBack(request, {
      returnTo: resolveCallbackReturnTo(result),
      provider,
      outcome: 'success',
    });
  } catch (err) {
    const oauthError = normalizeCallbackError(err);
    // 用户主动取消不是错误，单独用 denied 让前端弹中性提示而非红色报错。
    const outcome: OAuthCallbackOutcome = oauthError.kind === 'user_denied' ? 'denied' : 'failed';

    return redirectBack(request, {
      returnTo: DEFAULT_RETURN_TO,
      provider,
      outcome,
      reason: outcome === 'failed' ? oauthError.kind : null,
    });
  }
}
