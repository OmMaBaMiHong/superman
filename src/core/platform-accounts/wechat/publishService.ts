/**
 * 公众号发布服务（P2e-1）：把洗稿成稿（accepted draft）推到公众号草稿箱，
 * 并自动登记 published_posts（接 P2d 表现追踪——公众号抓取等 P2e-2/3，
 * 登记先行，draft_id/post 关联已就位）。
 *
 * markdown → 公众号 HTML：复用 lib/markdown 的 renderMarkdownToSafeHtml
 * （marked + sanitize-html 白名单，LLM 半可信输出已过消毒），
 * 再包一层公众号编辑器友好的 section 容器。
 */
import type { Pool, PoolClient } from 'pg';
import { ConflictError, NotFoundError, ValidationError } from '@/server/infra/http/errors';
import { normalizeUserId } from '@/server/domains/users/userScope';
import { renderMarkdownToSafeHtml } from '@/lib/markdown/renderMarkdown';
import { getDraftDetail } from '@/core/pipelines/repository';
import { insertPublishedPost } from '@/core/publish-tracking/repository';
import {
  getDecryptedCredential,
  getPlatformAccount,
  type PlatformAccountView,
} from '@/core/platform-accounts/repository';
import {
  createWechatMpClient,
  WechatMpError,
  type WechatMpClient,
  type WechatMpCredential,
} from '@/core/platform-accounts/wechat/mpClient';

type DbClient = Pool | PoolClient;

/** markdown → 公众号正文 HTML（消毒后包 section 容器）。 */
export function markdownToMpHtml(markdown: string): string {
  const safe = renderMarkdownToSafeHtml(markdown);
  return (
    '<section style="font-size:16px;line-height:1.75;color:#3f3f3f;' +
    'font-family:-apple-system,BlinkMacSystemFont,\'Helvetica Neue\',Helvetica,sans-serif;">' +
    safe +
    '</section>'
  );
}

export interface PublishDraftResult {
  mediaId: string;
  publishedPostId: string;
  /** 草稿箱没有公开 URL，用合成 URL 占位（published_posts.post_url not null）。 */
  postUrl: string;
}

export interface PublishDraftDeps {
  mpClientFactory?: () => WechatMpClient;
}

function parseCredential(plaintext: string): WechatMpCredential {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(plaintext) as Record<string, unknown>;
  } catch {
    throw new ValidationError('公众号凭据格式非法', { credential: '需要 JSON {appid, secret}' });
  }
  const appid = typeof parsed.appid === 'string' ? parsed.appid.trim() : '';
  const secret = typeof parsed.secret === 'string' ? parsed.secret.trim() : '';
  if (!appid || !secret) {
    throw new ValidationError('公众号凭据不完整', { credential: '需要 appid 与 secret 字段' });
  }
  return { appid, secret };
}

/** verify 链路：实测 gettoken。 */
export async function verifyWechatAccount(
  db: DbClient,
  account: PlatformAccountView,
  deps?: PublishDraftDeps,
): Promise<void> {
  const decrypted = await getDecryptedCredential(db, account.id, account.userId);
  if (!decrypted) throw new NotFoundError('账号不存在或凭据缺失');
  const client = (deps?.mpClientFactory ?? createWechatMpClient)();
  await client.verifyCredential(parseCredential(decrypted.credentialPlaintext));
}

export async function publishDraftToWechat(
  db: DbClient,
  input: { draftId: string; accountId: string; userId?: string },
  deps?: PublishDraftDeps,
): Promise<PublishDraftResult> {
  const scopedUserId = normalizeUserId(input.userId);

  const draft = await getDraftDetail(db, input.draftId, scopedUserId);
  if (!draft) throw new NotFoundError('草稿不存在');
  if (draft.status !== 'accepted') {
    throw new ConflictError(`只有已确认（accepted）的草稿可以发布，当前状态：${draft.status}`);
  }
  if (!draft.body.trim()) {
    throw new ValidationError('草稿正文为空', { body: '无法发布空草稿' });
  }

  const account = await getPlatformAccount(db, input.accountId, scopedUserId);
  if (!account) throw new NotFoundError('平台账号不存在');
  if (account.platform !== 'wechat' || account.credKind !== 'app_secret') {
    throw new ValidationError('账号类型不匹配', { accountId: '需要公众号（wechat / app_secret）账号' });
  }

  const decrypted = await getDecryptedCredential(db, account.id, scopedUserId);
  if (!decrypted) throw new NotFoundError('账号凭据缺失');

  const client = (deps?.mpClientFactory ?? createWechatMpClient)();
  let mediaId: string;
  try {
    mediaId = await client.addDraft(parseCredential(decrypted.credentialPlaintext), {
      title: draft.title.slice(0, 64),
      digest: (draft.articleSummary ?? '').slice(0, 120),
      content: markdownToMpHtml(draft.body),
      contentSourceUrl: draft.articleLink ?? '',
    });
  } catch (err) {
    if (err instanceof WechatMpError) {
      // 错误消息只含 errcode/errmsg，绝不含 appid/secret（mpClient 已保证）。
      throw new ConflictError(`公众号发布失败：${err.message}`);
    }
    throw err;
  }

  // 自动登记表现追踪（P2d 联动）：草稿箱无公开 URL，用合成 URL 占位。
  const postUrl = `wechat-mp-draft://media/${mediaId}`;
  const post = await insertPublishedPost(db, {
    userId: scopedUserId,
    draftId: draft.id,
    articleId: draft.articleId,
    platform: 'wechat',
    accountName: account.accountName,
    postUrl,
    title: draft.title,
    publishedAt: new Date().toISOString(),
  });

  return { mediaId, publishedPostId: post.id, postUrl };
}
