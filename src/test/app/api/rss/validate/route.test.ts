import { beforeEach, describe, expect, it, vi } from 'vitest';

const parseStringMock = vi.fn();
const isSafeExternalUrlMock = vi.fn();
const fetchRssXmlMock = vi.fn();
const fetchFeedXmlMock = vi.fn();

vi.mock('rss-parser', () => {
  class MockParser {
    parseString = parseStringMock;
  }

  return {
    default: MockParser,
  };
});

vi.mock('@/server/integrations/rss/ssrfGuard', () => ({
  isSafeExternalUrl: (...args: unknown[]) => isSafeExternalUrlMock(...args),
}));

vi.mock('@/server/infra/http/externalHttpClient', () => ({
  fetchRssXml: (...args: unknown[]) => fetchRssXmlMock(...args),
}));

vi.mock('@/server/integrations/rss/fetchFeedXml', () => ({
  fetchFeedXml: (...args: unknown[]) => fetchFeedXmlMock(...args),
}));

describe('/api/rss/validate', () => {
  beforeEach(() => {
    parseStringMock.mockReset();
    isSafeExternalUrlMock.mockReset();
    fetchRssXmlMock.mockReset();
    fetchFeedXmlMock.mockReset();
    vi.restoreAllMocks();
    isSafeExternalUrlMock.mockResolvedValue(true);
  });

  it('returns siteUrl from parsed feed.link when validation succeeds', async () => {
    parseStringMock.mockResolvedValue({ title: 'Feed', link: 'https://example.com/' });
    fetchRssXmlMock.mockResolvedValue({
      status: 200,
      xml: '<?xml version="1.0"?><rss><channel><title>Feed</title></channel></rss>',
      etag: null,
      lastModified: null,
      finalUrl: 'https://example.com/rss.xml',
    });

    const mod = await import('../../../../../app/api/rss/validate/route');
    const response = await mod.GET(
      new Request(
        'http://localhost/api/rss/validate?url=https%3A%2F%2Fexample.com%2Frss.xml',
      ),
    );
    const json = await response.json();

    expect(json.ok).toBe(true);
    expect(json.data).toMatchObject({
      valid: true,
      siteUrl: 'https://example.com/',
    });
    expect(isSafeExternalUrlMock).toHaveBeenCalledWith('https://example.com/rss.xml', {
      allowUnresolvedHostname: true,
    });
  });

  it('validates rsshub urls through embedded RSSHub feed fetch', async () => {
    parseStringMock.mockResolvedValue({
      title: 'Andrej Karpathy - YouTube',
      link: 'https://www.youtube.com/channel/UCXUPKJO5MZQN11PqgIvyuvQ',
    });
    fetchFeedXmlMock.mockResolvedValue({
      status: 200,
      xml: '<?xml version="1.0"?><rss><channel><title>Andrej Karpathy - YouTube</title></channel></rss>',
      etag: null,
      lastModified: null,
    });

    const mod = await import('../../../../../app/api/rss/validate/route');
    const response = await mod.GET(
      new Request(
        'http://localhost/api/rss/validate?url=rsshub%3A%2F%2Fyoutube%2Fuser%2F%40AndrejKarpathy',
      ),
    );
    const json = await response.json();

    expect(json.ok).toBe(true);
    expect(json.data).toMatchObject({
      valid: true,
      title: 'Andrej Karpathy - YouTube',
      siteUrl: 'https://www.youtube.com/channel/UCXUPKJO5MZQN11PqgIvyuvQ',
    });
    expect(fetchFeedXmlMock).toHaveBeenCalledWith('rsshub://youtube/user/@AndrejKarpathy', {
      timeoutMs: 10_000,
      userAgent: 'FeedFuse RSS Validator',
    });
    expect(fetchRssXmlMock).not.toHaveBeenCalled();
    expect(isSafeExternalUrlMock).not.toHaveBeenCalledWith(
      'rsshub://youtube/user/@AndrejKarpathy',
      expect.anything(),
    );
  });

  it('returns success without siteUrl when feed.link missing', async () => {
    parseStringMock.mockResolvedValue({ title: 'Feed' });
    fetchRssXmlMock.mockResolvedValue({
      status: 200,
      xml: '<?xml version="1.0"?><rss><channel><title>Feed</title></channel></rss>',
      etag: null,
      lastModified: null,
      finalUrl: 'https://example.com/rss.xml',
    });

    const mod = await import('../../../../../app/api/rss/validate/route');
    const response = await mod.GET(
      new Request(
        'http://localhost/api/rss/validate?url=https%3A%2F%2Fexample.com%2Frss.xml',
      ),
    );
    const json = await response.json();

    expect(json.ok).toBe(true);
    expect(json.data).toMatchObject({ valid: true });
    expect(json.data.siteUrl).toBeUndefined();
  });

  it('returns unified success envelope for invalid feeds', async () => {
    parseStringMock.mockRejectedValue(new Error('not a feed'));
    fetchRssXmlMock.mockResolvedValue({
      status: 200,
      xml: '<html>not rss</html>',
      etag: null,
      lastModified: null,
      finalUrl: 'https://example.com/invalid.xml',
    });

    const mod = await import('../../../../../app/api/rss/validate/route');
    const response = await mod.GET(
      new Request(
        'http://localhost/api/rss/validate?url=https%3A%2F%2Fexample.com%2Finvalid.xml',
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        valid: false,
        reason: 'not_feed',
        message: '响应不是合法的 RSS/Atom 源',
      },
    });
  });

  it('returns dns_error when upstream hostname cannot be resolved', async () => {
    const dnsError = Object.assign(new Error('getaddrinfo ENOTFOUND www.ruanyifeng.com'), {
      code: 'ENOTFOUND',
    });
    fetchRssXmlMock.mockRejectedValue(dnsError);

    const mod = await import('../../../../../app/api/rss/validate/route');
    const response = await mod.GET(
      new Request(
        'http://localhost/api/rss/validate?url=https%3A%2F%2Fwww.ruanyifeng.com%2Fblog%2Fatom.xml',
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        valid: false,
        reason: 'dns_error',
        message: '域名无法解析，请检查网络或 DNS 设置',
      },
    });
  });

  it('returns unsafe_url when rss guard blocks the link', async () => {
    isSafeExternalUrlMock.mockResolvedValue(false);

    const mod = await import('../../../../../app/api/rss/validate/route');
    const response = await mod.GET(
      new Request(
        'http://localhost/api/rss/validate?url=https%3A%2F%2Fexample.com%2Frss.xml',
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        valid: false,
        reason: 'unsafe_url',
        message: '当前网络环境不允许访问该链接',
      },
    });
  });

  it('returns unsafe_url when redirected finalUrl is blocked by rss guard', async () => {
    isSafeExternalUrlMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    fetchRssXmlMock.mockResolvedValue({
      status: 200,
      xml: '<?xml version="1.0"?><rss><channel><title>Feed</title></channel></rss>',
      etag: null,
      lastModified: null,
      finalUrl: 'http://192.168.1.10/rss.xml',
    });

    const mod = await import('../../../../../app/api/rss/validate/route');
    const response = await mod.GET(
      new Request(
        'http://localhost/api/rss/validate?url=https%3A%2F%2Fexample.com%2Frss.xml',
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        valid: false,
        reason: 'unsafe_url',
        message: '当前网络环境不允许访问该链接',
      },
    });
    expect(isSafeExternalUrlMock).toHaveBeenNthCalledWith(1, 'https://example.com/rss.xml', {
      allowUnresolvedHostname: true,
    });
    expect(isSafeExternalUrlMock).toHaveBeenNthCalledWith(2, 'http://192.168.1.10/rss.xml', {
      allowUnresolvedHostname: true,
    });
  });
});
