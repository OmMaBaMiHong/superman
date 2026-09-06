import { describe, expect, it } from 'vitest';
import { createWechatMpClient, WechatMpError, type MpJsonFetcher } from '@/core/platform-accounts/wechat/mpClient';
import { markdownToMpHtml } from '@/core/platform-accounts/wechat/publishService';

const CRED = { appid: 'wx_fake_appid', secret: 'wx_fake_secret' };

function fetcherSequence(steps: Array<{ status: number; json: Record<string, unknown> | null }>) {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  let i = 0;
  const fetcher: MpJsonFetcher = async (input) => {
    calls.push(input);
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    return step;
  };
  return { fetcher, calls };
}

describe('wechat mpClient', () => {
  it('gettoken 成功并缓存（同一 appid 第二次不发请求）', async () => {
    const { fetcher, calls } = fetcherSequence([
      { status: 200, json: { access_token: 'token-1', expires_in: 7200 } },
    ]);
    const client = createWechatMpClient(fetcher);
    expect(await client.getAccessToken(CRED)).toBe('token-1');
    expect(await client.getAccessToken(CRED)).toBe('token-1');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('cgi-bin/token');
    expect(calls[0].url).toContain('appid=wx_fake_appid');
  });

  it('假凭证：errcode 40013 → token_failed，错误消息不含 secret', async () => {
    const { fetcher } = fetcherSequence([
      { status: 200, json: { errcode: 40013, errmsg: 'invalid appid rid: abc' } },
    ]);
    const client = createWechatMpClient(fetcher);
    const err = await client.getAccessToken(CRED).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WechatMpError);
    expect((err as WechatMpError).code).toBe('token_failed');
    expect((err as WechatMpError).errcode).toBe(40013);
    expect((err as WechatMpError).message).toContain('invalid appid');
    expect((err as WechatMpError).message).not.toContain(CRED.secret);
  });

  it('errcode -1 系统繁忙同样映射 token_failed；网络异常映射 network_error', async () => {
    const { fetcher } = fetcherSequence([{ status: 200, json: { errcode: -1, errmsg: 'system error' } }]);
    const client = createWechatMpClient(fetcher);
    await expect(client.getAccessToken(CRED)).rejects.toMatchObject({ code: 'token_failed' });

    const failing: MpJsonFetcher = async () => { throw new Error('ETIMEDOUT'); };
    const client2 = createWechatMpClient(failing);
    await expect(client2.getAccessToken(CRED)).rejects.toMatchObject({ code: 'network_error' });
  });

  it('draft/add 成功返回 media_id；body 结构符合公众号草稿格式', async () => {
    const { fetcher, calls } = fetcherSequence([
      { status: 200, json: { access_token: 'token-1', expires_in: 7200 } },
      { status: 200, json: { media_id: 'MEDIA_ID_XYZ' } },
    ]);
    const client = createWechatMpClient(fetcher);
    const mediaId = await client.addDraft(CRED, { title: '成稿标题', content: '<p>正文</p>', digest: '摘要' });
    expect(mediaId).toBe('MEDIA_ID_XYZ');
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain('cgi-bin/draft/add?access_token=token-1');
    const body = calls[1].body as { articles: Array<Record<string, unknown>> };
    expect(body.articles[0]).toMatchObject({
      title: '成稿标题',
      content: '<p>正文</p>',
      digest: '摘要',
      need_open_comment: 0,
    });
  });

  it('draft/add 业务错误（如 45009 接口超限）→ api_error', async () => {
    const { fetcher } = fetcherSequence([
      { status: 200, json: { access_token: 'token-1', expires_in: 7200 } },
      { status: 200, json: { errcode: 45009, errmsg: 'reach max api daily quota' } },
    ]);
    const client = createWechatMpClient(fetcher);
    await expect(client.addDraft(CRED, { title: 't', content: 'c' }))
      .rejects.toMatchObject({ code: 'api_error', errcode: 45009 });
  });

  it('verifyCredential 会绕过缓存重新取 token', async () => {
    const { fetcher, calls } = fetcherSequence([
      { status: 200, json: { access_token: 'token-1', expires_in: 7200 } },
      { status: 200, json: { access_token: 'token-2', expires_in: 7200 } },
    ]);
    const client = createWechatMpClient(fetcher);
    await client.getAccessToken(CRED);
    await client.verifyCredential(CRED);
    expect(calls).toHaveLength(2);
  });
});

describe('wechat publishService / markdownToMpHtml', () => {
  it('标题层级 / 代码块保留，包 section 容器', () => {
    const html = markdownToMpHtml('## 小标题\n\n正文段落\n\n```js\nconst a = 1;\n```');
    expect(html).toContain('<section');
    expect(html).toContain('<h2>小标题</h2>');
    expect(html).toContain('<pre><code');
    expect(html).toContain('const a = 1;');
  });

  it('消毒：script/onerror 被剥，图片保留 https 源', () => {
    const html = markdownToMpHtml('<script>alert(1)</script>\n\n![图](https://example.com/a.png)');
    expect(html).not.toContain('<script>');
    expect(html).toContain('https://example.com/a.png');
  });

  it('javascript: 协议的链接被剥', () => {
    const html = markdownToMpHtml('[点我](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
  });
});
