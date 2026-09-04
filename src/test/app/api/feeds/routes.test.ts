import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getQueueSendOptions } from '@/server/infra/queue/contracts';
import { JOB_REFRESH_ALL } from '@/server/infra/queue/jobs';

const pool = {
  query: vi.fn(),
};

const listFeedsMock = vi.fn();
const createFeedWithCategoryResolutionMock = vi.fn();
const updateFeedWithCategoryResolutionMock = vi.fn();
const deleteFeedAndCleanupCategoryMock = vi.fn();
const getFeedByIdMock = vi.fn();
const getUiSettingsMock = vi.fn();
const updateUiSettingsMock = vi.fn();

const enqueueMock = vi.fn();
const enqueueWithResultMock = vi.fn();
const isSafeExternalUrlMock = vi.fn();
const writeUserOperationSucceededLogMock = vi.fn();
const writeUserOperationFailedLogMock = vi.fn();
const initializeFeedRefreshRunMock = vi.fn();
const completeFeedRefreshRunItemMock = vi.fn();
const getFeedRefreshDispatchRowMock = vi.fn();
const getFeverAccountByLocalFeedIdMock = vi.fn();
const listActiveLocalFeedIdsByFeverAccountIdMock = vi.fn();
const markFeverAccountSyncAttemptedMock = vi.fn();
const getFeverAccountByIdMock = vi.fn();

vi.mock('@/server/infra/db/pool', () => ({
  getPool: () => pool,
}));
vi.mock('@/server/infra/db/pool', () => ({
  getPool: () => pool,
}));
vi.mock('@/server/infra/db/pool', () => ({
  getPool: () => pool,
}));

vi.mock('@/server/domains/feeds/repositories/feedsRepo', () => ({
  listFeeds: (...args: unknown[]) => listFeedsMock(...args),
  getFeedRefreshDispatchRow: (...args: unknown[]) => getFeedRefreshDispatchRowMock(...args),
  getFeedById: (...args: unknown[]) => getFeedByIdMock(...args),
}));
vi.mock('@/server/domains/feeds/repositories/feedsRepo', () => ({
  listFeeds: (...args: unknown[]) => listFeedsMock(...args),
  getFeedRefreshDispatchRow: (...args: unknown[]) => getFeedRefreshDispatchRowMock(...args),
  getFeedById: (...args: unknown[]) => getFeedByIdMock(...args),
}));
vi.mock('@/server/domains/fever/repositories/feverMappingsRepo', () => ({
  getFeverAccountByLocalFeedId: (...args: unknown[]) => getFeverAccountByLocalFeedIdMock(...args),
  listActiveLocalFeedIdsByFeverAccountId: (...args: unknown[]) =>
    listActiveLocalFeedIdsByFeverAccountIdMock(...args),
}));
vi.mock('@/server/domains/fever/repositories/feverAccountsRepo', () => ({
  markFeverAccountSyncAttempted: (...args: unknown[]) => markFeverAccountSyncAttemptedMock(...args),
  getFeverAccountById: (...args: unknown[]) => getFeverAccountByIdMock(...args),
}));

vi.mock('@/server/domains/feeds/services/feedCategoryLifecycleService', () => ({
  createFeedWithCategoryResolution: (...args: unknown[]) =>
    createFeedWithCategoryResolutionMock(...args),
  updateFeedWithCategoryResolution: (...args: unknown[]) =>
    updateFeedWithCategoryResolutionMock(...args),
  deleteFeedAndCleanupCategory: (...args: unknown[]) =>
    deleteFeedAndCleanupCategoryMock(...args),
}));
vi.mock('@/server/domains/feeds/services/feedCategoryLifecycleService', () => ({
  createFeedWithCategoryResolution: (...args: unknown[]) =>
    createFeedWithCategoryResolutionMock(...args),
  updateFeedWithCategoryResolution: (...args: unknown[]) =>
    updateFeedWithCategoryResolutionMock(...args),
  deleteFeedAndCleanupCategory: (...args: unknown[]) =>
    deleteFeedAndCleanupCategoryMock(...args),
}));



vi.mock('@/server/domains/settings/repositories/settingsRepo', () => ({
  getUiSettings: (...args: unknown[]) => getUiSettingsMock(...args),
  updateUiSettings: (...args: unknown[]) => updateUiSettingsMock(...args),
}));

vi.mock('@/server/domains/settings/repositories/settingsRepo', () => ({
  getUiSettings: (...args: unknown[]) => getUiSettingsMock(...args),
  updateUiSettings: (...args: unknown[]) => updateUiSettingsMock(...args),
}));

vi.mock('@/server/infra/queue/queue', () => ({
  enqueue: (...args: unknown[]) => enqueueMock(...args),
  enqueueWithResult: (...args: unknown[]) => enqueueWithResultMock(...args),
}));
vi.mock('@/server/infra/queue/queue', () => ({
  enqueue: (...args: unknown[]) => enqueueMock(...args),
  enqueueWithResult: (...args: unknown[]) => enqueueWithResultMock(...args),
}));
vi.mock('@/server/infra/queue/queue', () => ({
  enqueue: (...args: unknown[]) => enqueueMock(...args),
  enqueueWithResult: (...args: unknown[]) => enqueueWithResultMock(...args),
}));
vi.mock('@/server/integrations/rss/ssrfGuard', () => ({
  isSafeExternalUrl: (...args: unknown[]) => isSafeExternalUrlMock(...args),
}));
vi.mock('@/server/integrations/rss/ssrfGuard', () => ({
  isSafeExternalUrl: (...args: unknown[]) => isSafeExternalUrlMock(...args),
}));
vi.mock('@/server/infra/logging/userOperationLogger', () => ({
  writeUserOperationSucceededLog: (...args: unknown[]) =>
    writeUserOperationSucceededLogMock(...args),
  writeUserOperationFailedLog: (...args: unknown[]) => writeUserOperationFailedLogMock(...args),
}));
vi.mock('@/server/infra/logging/userOperationLogger', () => ({
  writeUserOperationSucceededLog: (...args: unknown[]) =>
    writeUserOperationSucceededLogMock(...args),
  writeUserOperationFailedLog: (...args: unknown[]) => writeUserOperationFailedLogMock(...args),
}));
vi.mock('@/server/domains/feeds/services/feedRefreshRunService', () => ({
  initializeFeedRefreshRun: (...args: unknown[]) => initializeFeedRefreshRunMock(...args),
  completeFeedRefreshRunItem: (...args: unknown[]) => completeFeedRefreshRunItemMock(...args),
}));
vi.mock('@/server/domains/feeds/services/feedRefreshRunService', () => ({
  initializeFeedRefreshRun: (...args: unknown[]) => initializeFeedRefreshRunMock(...args),
  completeFeedRefreshRunItem: (...args: unknown[]) => completeFeedRefreshRunItemMock(...args),
}));
vi.mock('@/server/domains/feeds/services/feedRefreshRunService', () => ({
  initializeFeedRefreshRun: (...args: unknown[]) => initializeFeedRefreshRunMock(...args),
  completeFeedRefreshRunItem: (...args: unknown[]) => completeFeedRefreshRunItemMock(...args),
}));

const feedId = '1001';
const categoryId = '2001';

describe('/api/feeds', () => {
  beforeEach(() => {
    pool.query.mockReset();
    listFeedsMock.mockReset();
    createFeedWithCategoryResolutionMock.mockReset();
    updateFeedWithCategoryResolutionMock.mockReset();
    deleteFeedAndCleanupCategoryMock.mockReset();
    getFeedByIdMock.mockReset();
    getUiSettingsMock.mockReset();
    updateUiSettingsMock.mockReset();
    enqueueMock.mockReset();
    enqueueWithResultMock.mockReset();
    isSafeExternalUrlMock.mockReset();
    writeUserOperationSucceededLogMock.mockReset();
    writeUserOperationFailedLogMock.mockReset();
    initializeFeedRefreshRunMock.mockReset();
    completeFeedRefreshRunItemMock.mockReset();
    getFeedRefreshDispatchRowMock.mockReset();
    getFeverAccountByLocalFeedIdMock.mockReset();
    listActiveLocalFeedIdsByFeverAccountIdMock.mockReset();
    markFeverAccountSyncAttemptedMock.mockReset();
    getFeverAccountByIdMock.mockReset();
    isSafeExternalUrlMock.mockResolvedValue(true);
    initializeFeedRefreshRunMock.mockResolvedValue({ id: 'run-1' });
    getFeedRefreshDispatchRowMock.mockResolvedValue({
      id: feedId,
      kind: 'rss',
      provider: 'local_rss',
      enabled: true,
    });
    getFeedByIdMock.mockResolvedValue({
      id: feedId,
      kind: 'rss',
      provider: 'local_rss',
      title: 'My Feed',
      url: 'https://example.com/rss.xml',
      siteUrl: null,
      iconUrl: null,
      enabled: true,
      fullTextOnOpenEnabled: false,
      fullTextOnFetchEnabled: false,
      aiSummaryOnOpenEnabled: false,
      aiSummaryOnFetchEnabled: false,
      bodyTranslateOnFetchEnabled: false,
      bodyTranslateOnOpenEnabled: false,
      titleTranslateEnabled: false,
      bodyTranslateEnabled: false,
      articleListDisplayMode: 'card',
      categoryId: null,
      fetchIntervalMinutes: 30,
      lastFetchStatus: null,
      lastFetchError: null,
      lastFetchRawError: null,
      isPodcast: false,
    });
  });

  it('GET returns feeds with unreadCount', async () => {
    listFeedsMock.mockResolvedValue([
      {
        id: feedId,
        provider: 'fever',
        title: 'Example',
        url: 'https://example.com/rss.xml',
        siteUrl: null,
        iconUrl: null,
        enabled: true,
        fullTextOnOpenEnabled: false,
        fullTextOnFetchEnabled: false,
        aiSummaryOnOpenEnabled: false,
        categoryId: null,
        fetchIntervalMinutes: 30,
      },
    ]);

    pool.query.mockResolvedValue({
      rows: [{ feedId, unreadCount: 3 }],
    });

    const mod = await import('../../../../app/api/feeds/route');
    const res = await mod.GET();
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(json.data[0].unreadCount).toBe(3);
    expect(json.data[0].provider).toBe('fever');
    expect(json.data[0].fullTextOnFetchEnabled).toBe(false);
  });

  it('POST creates a feed', async () => {
    createFeedWithCategoryResolutionMock.mockResolvedValue({
      id: feedId,
      title: 'Example',
      url: 'https://1.1.1.1/rss.xml',
      siteUrl: null,
      iconUrl: null,
      enabled: true,
      fullTextOnOpenEnabled: false,
      fullTextOnFetchEnabled: true,
      aiSummaryOnOpenEnabled: true,
      categoryId,
      fetchIntervalMinutes: 30,
    });

    const mod = await import('../../../../app/api/feeds/route');
    const res = await mod.POST(
      new Request('http://localhost/api/feeds', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Example',
          url: 'https://1.1.1.1/rss.xml',
          categoryId,
          fullTextOnOpenEnabled: true,
          fullTextOnFetchEnabled: true,
          aiSummaryOnOpenEnabled: true,
        }),
      }),
    );
    const json = await res.json();

    expect(createFeedWithCategoryResolutionMock).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        fullTextOnOpenEnabled: false,
        fullTextOnFetchEnabled: true,
        aiSummaryOnOpenEnabled: true,
      }),
    );
    expect(isSafeExternalUrlMock).toHaveBeenCalledWith('https://1.1.1.1/rss.xml', {
      allowUnresolvedHostname: true,
    });
    expect(json.ok).toBe(true);
    expect(json.data.url).toBe('https://1.1.1.1/rss.xml');
    expect(json.data.fullTextOnFetchEnabled).toBe(true);
  });

  it('POST creates a feed with independent view and category', async () => {
    createFeedWithCategoryResolutionMock.mockResolvedValue({
      id: feedId,
      title: 'Andrej Karpathy - YouTube',
      url: 'rsshub://youtube/user/@AndrejKarpathy',
      siteUrl: null,
      iconUrl: null,
      enabled: true,
      fullTextOnOpenEnabled: false,
      fullTextOnFetchEnabled: false,
      aiSummaryOnOpenEnabled: false,
      categoryId,
      view: 'video',
      fetchIntervalMinutes: 30,
    });

    const mod = await import('../../../../app/api/feeds/route');
    const res = await mod.POST(
      new Request('http://localhost/api/feeds', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Andrej Karpathy - YouTube',
          url: 'rsshub://youtube/user/@AndrejKarpathy',
          categoryId,
          view: 'video',
        }),
      }),
    );
    const json = await res.json();

    expect(createFeedWithCategoryResolutionMock).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        categoryId,
        view: 'video',
      }),
    );
    expect(json.ok).toBe(true);
    expect(json.data.categoryId).toBe(categoryId);
    expect(json.data.view).toBe('video');
  });

  it('POST creates an rsshub feed without exposing the local RSSHub endpoint', async () => {
    createFeedWithCategoryResolutionMock.mockResolvedValue({
      id: feedId,
      title: 'Andrej Karpathy - YouTube',
      url: 'rsshub://youtube/user/@AndrejKarpathy',
      siteUrl: 'https://www.youtube.com/channel/UCXUPKJO5MZQN11PqgIvyuvQ',
      iconUrl: null,
      enabled: true,
      fullTextOnOpenEnabled: false,
      fullTextOnFetchEnabled: false,
      aiSummaryOnOpenEnabled: false,
      categoryId: null,
      fetchIntervalMinutes: 30,
    });

    const mod = await import('../../../../app/api/feeds/route');
    const res = await mod.POST(
      new Request('http://localhost/api/feeds', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Andrej Karpathy - YouTube',
          url: 'rsshub://youtube/user/@AndrejKarpathy',
          siteUrl: 'https://www.youtube.com/channel/UCXUPKJO5MZQN11PqgIvyuvQ',
        }),
      }),
    );
    const json = await res.json();

    expect(createFeedWithCategoryResolutionMock).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        title: 'Andrej Karpathy - YouTube',
        url: 'rsshub://youtube/user/@AndrejKarpathy',
        siteUrl: 'https://www.youtube.com/channel/UCXUPKJO5MZQN11PqgIvyuvQ',
      }),
    );
    expect(isSafeExternalUrlMock).not.toHaveBeenCalledWith(
      'rsshub://youtube/user/@AndrejKarpathy',
      expect.anything(),
    );
    expect(json.ok).toBe(true);
    expect(json.data.url).toBe('rsshub://youtube/user/@AndrejKarpathy');
  });

  it('POST /api/feeds accepts categoryName and delegates to lifecycle service', async () => {
    createFeedWithCategoryResolutionMock.mockResolvedValue({
      id: feedId,
      title: 'Example',
      url: 'https://1.1.1.1/rss.xml',
      siteUrl: null,
      iconUrl: null,
      enabled: true,
      fullTextOnOpenEnabled: false,
      aiSummaryOnOpenEnabled: false,
      categoryId,
      fetchIntervalMinutes: 30,
    });

    const mod = await import('../../../../app/api/feeds/route');
    const res = await mod.POST(
      new Request('http://localhost/api/feeds', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Example',
          url: 'https://1.1.1.1/rss.xml',
          categoryName: 'Tech',
        }),
      }),
    );
    const json = await res.json();

    expect(createFeedWithCategoryResolutionMock).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({ categoryName: 'Tech' }),
    );
    expect(json.ok).toBe(true);
  });

  it('POST /api/feeds accepts aiSummaryOnFetchEnabled/bodyTranslateOnFetchEnabled/bodyTranslateOnOpenEnabled', async () => {
    createFeedWithCategoryResolutionMock.mockResolvedValue({
      id: feedId,
      title: 'Example',
      url: 'https://1.1.1.1/rss.xml',
      siteUrl: null,
      iconUrl: null,
      enabled: true,
      fullTextOnOpenEnabled: false,
      aiSummaryOnOpenEnabled: false,
      aiSummaryOnFetchEnabled: true,
      bodyTranslateOnFetchEnabled: true,
      bodyTranslateOnOpenEnabled: false,
      categoryId: null,
      fetchIntervalMinutes: 30,
    });

    const mod = await import('../../../../app/api/feeds/route');
    const res = await mod.POST(
      new Request('http://localhost/api/feeds', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Example',
          url: 'https://1.1.1.1/rss.xml',
          aiSummaryOnFetchEnabled: true,
          bodyTranslateOnFetchEnabled: true,
          bodyTranslateOnOpenEnabled: true,
        }),
      }),
    );
    const json = await res.json();

    expect(createFeedWithCategoryResolutionMock).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        aiSummaryOnFetchEnabled: true,
        bodyTranslateOnFetchEnabled: true,
        bodyTranslateOnOpenEnabled: false,
      }),
    );
    expect(json.ok).toBe(true);
  });

  it('POST /api/feeds normalizes mutually exclusive auto-trigger flags', async () => {
    createFeedWithCategoryResolutionMock.mockResolvedValue({
      id: feedId,
      title: 'Example',
      url: 'https://1.1.1.1/rss.xml',
      siteUrl: null,
      iconUrl: null,
      enabled: true,
      fullTextOnOpenEnabled: false,
      fullTextOnFetchEnabled: true,
      aiSummaryOnOpenEnabled: false,
      aiSummaryOnFetchEnabled: true,
      bodyTranslateOnFetchEnabled: true,
      bodyTranslateOnOpenEnabled: false,
      categoryId: null,
      fetchIntervalMinutes: 30,
    });

    const mod = await import('../../../../app/api/feeds/route');
    const res = await mod.POST(
      new Request('http://localhost/api/feeds', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Example',
          url: 'https://1.1.1.1/rss.xml',
          fullTextOnOpenEnabled: true,
          fullTextOnFetchEnabled: true,
          aiSummaryOnOpenEnabled: true,
          aiSummaryOnFetchEnabled: true,
          bodyTranslateOnFetchEnabled: true,
          bodyTranslateOnOpenEnabled: true,
        }),
      }),
    );
    const json = await res.json();

    expect(createFeedWithCategoryResolutionMock).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        fullTextOnOpenEnabled: false,
        fullTextOnFetchEnabled: true,
        aiSummaryOnOpenEnabled: false,
        aiSummaryOnFetchEnabled: true,
        bodyTranslateOnFetchEnabled: true,
        bodyTranslateOnOpenEnabled: false,
      }),
    );
    expect(json.ok).toBe(true);
  });

  it('POST /api/feeds forwards siteUrl and leaves icon resolution to the lifecycle service', async () => {
    createFeedWithCategoryResolutionMock.mockResolvedValue({
      id: feedId,
      title: 'Example',
      url: 'https://1.1.1.1/rss.xml',
      siteUrl: 'https://example.com/',
      iconUrl: '/api/feeds/1001/favicon',
      enabled: true,
      fullTextOnOpenEnabled: false,
      aiSummaryOnOpenEnabled: false,
      categoryId: null,
      fetchIntervalMinutes: 30,
    });

    const mod = await import('../../../../app/api/feeds/route');
    const res = await mod.POST(
      new Request('http://localhost/api/feeds', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Example',
          url: 'https://1.1.1.1/rss.xml',
          siteUrl: 'https://example.com/',
        }),
      }),
    );
    const json = await res.json();

    expect(createFeedWithCategoryResolutionMock).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        siteUrl: 'https://example.com/',
      }),
    );
    expect(createFeedWithCategoryResolutionMock).not.toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        iconUrl: expect.anything(),
      }),
    );
    expect(json.ok).toBe(true);
  });

  it('POST validates and rejects unsafe urls', async () => {
    isSafeExternalUrlMock.mockResolvedValue(false);

    const mod = await import('../../../../app/api/feeds/route');
    const res = await mod.POST(
      new Request('http://localhost/api/feeds', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Example',
          url: 'http://192.168.1.1/rss.xml',
        }),
      }),
    );
    const json = await res.json();

    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('validation_error');
    expect(json.error.fields.url).toBe('当前网络环境不允许访问该链接');
  });

  it('POST returns conflict on duplicate url', async () => {
    createFeedWithCategoryResolutionMock.mockRejectedValue({
      code: '23505',
      constraint: 'feeds_user_url_unique',
    });

    const mod = await import('../../../../app/api/feeds/route');
    const res = await mod.POST(
      new Request('http://localhost/api/feeds', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Example',
          url: 'https://1.1.1.1/rss.xml',
        }),
      }),
    );
    const json = await res.json();

    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('conflict');
  });

  it('POST returns validation error when categoryId does not exist', async () => {
    createFeedWithCategoryResolutionMock.mockRejectedValue({
      code: '23503',
      constraint: 'feeds_category_id_fkey',
    });

    const mod = await import('../../../../app/api/feeds/route');
    const res = await mod.POST(
      new Request('http://localhost/api/feeds', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Example',
          url: 'https://1.1.1.1/rss.xml',
          categoryId: '2999',
        }),
      }),
    );
    const json = await res.json();

    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('validation_error');
    expect(json.error.fields.categoryId).toBeTruthy();
  });

  it('PATCH updates a feed', async () => {
    updateFeedWithCategoryResolutionMock.mockResolvedValue({
      id: feedId,
      title: 'Updated',
      url: 'https://example.com/rss.xml',
      siteUrl: null,
      iconUrl: null,
      enabled: false,
      fullTextOnOpenEnabled: false,
      fullTextOnFetchEnabled: true,
      aiSummaryOnOpenEnabled: true,
      articleListDisplayMode: 'list',
      categoryId: null,
      fetchIntervalMinutes: 30,
    });

    const mod = await import('../../../../app/api/feeds/[id]/route');
    const res = await mod.PATCH(
      new Request(`http://localhost/api/feeds/${feedId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: false,
          title: 'Updated',
          fullTextOnOpenEnabled: true,
          fullTextOnFetchEnabled: true,
          aiSummaryOnOpenEnabled: true,
          articleListDisplayMode: 'list',
        }),
      }),
      { params: Promise.resolve({ id: feedId }) },
    );
    const json = await res.json();

    expect(updateFeedWithCategoryResolutionMock).toHaveBeenCalledWith(
      pool,
      feedId,
      expect.objectContaining({
        fullTextOnOpenEnabled: false,
        fullTextOnFetchEnabled: true,
        aiSummaryOnOpenEnabled: true,
        articleListDisplayMode: 'list',
      }),
    );
    expect(json.ok).toBe(true);
    expect(json.data.enabled).toBe(false);
    expect(json.data.title).toBe('Updated');
    expect(json.data.fullTextOnFetchEnabled).toBe(true);
    expect(writeUserOperationSucceededLogMock).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({ actionKey: 'feed.update' }),
    );
  });

  it('PATCH updates a feed view without changing category', async () => {
    updateFeedWithCategoryResolutionMock.mockResolvedValue({
      id: feedId,
      title: 'Updated',
      url: 'https://example.com/rss.xml',
      siteUrl: null,
      iconUrl: null,
      enabled: true,
      fullTextOnOpenEnabled: false,
      fullTextOnFetchEnabled: false,
      aiSummaryOnOpenEnabled: false,
      articleListDisplayMode: 'card',
      categoryId,
      view: 'social',
      fetchIntervalMinutes: 30,
    });

    const mod = await import('../../../../app/api/feeds/[id]/route');
    const res = await mod.PATCH(
      new Request(`http://localhost/api/feeds/${feedId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          view: 'social',
        }),
      }),
      { params: Promise.resolve({ id: feedId }) },
    );
    const json = await res.json();

    expect(updateFeedWithCategoryResolutionMock).toHaveBeenCalledWith(
      pool,
      feedId,
      expect.objectContaining({
        view: 'social',
      }),
    );
    expect(json.ok).toBe(true);
    expect(json.data.categoryId).toBe(categoryId);
    expect(json.data.view).toBe('social');
  });

  it('PATCH rejects remote-managed fever feed updates to remote-owned fields', async () => {
    getFeedByIdMock.mockResolvedValue({
      id: feedId,
      kind: 'rss',
      provider: 'fever',
      title: 'Fever Feed',
      url: 'https://example.com/feed.xml',
      siteUrl: 'https://example.com',
      iconUrl: '/api/feeds/1001/favicon',
      enabled: true,
      fullTextOnOpenEnabled: false,
      fullTextOnFetchEnabled: false,
      aiSummaryOnOpenEnabled: false,
      aiSummaryOnFetchEnabled: false,
      bodyTranslateOnFetchEnabled: false,
      bodyTranslateOnOpenEnabled: false,
      titleTranslateEnabled: false,
      bodyTranslateEnabled: false,
      articleListDisplayMode: 'card',
      categoryId: '2001',
      fetchIntervalMinutes: 30,
      lastFetchStatus: null,
      lastFetchError: null,
      lastFetchRawError: null,
      isPodcast: false,
    });

    const mod = await import('../../../../app/api/feeds/[id]/route');
    const res = await mod.PATCH(
      new Request(`http://localhost/api/feeds/${feedId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Changed',
          categoryId: '2999',
        }),
      }),
      { params: Promise.resolve({ id: feedId }) },
    );
    const json = await res.json();

    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('validation_error');
    expect(updateFeedWithCategoryResolutionMock).not.toHaveBeenCalled();
  });

  it('DELETE rejects remote-managed fever feed deletion', async () => {
    getFeedByIdMock.mockResolvedValue({
      id: feedId,
      kind: 'rss',
      provider: 'fever',
      title: 'Fever Feed',
      url: 'https://example.com/feed.xml',
      siteUrl: null,
      iconUrl: null,
      enabled: true,
      fullTextOnOpenEnabled: false,
      fullTextOnFetchEnabled: false,
      aiSummaryOnOpenEnabled: false,
      aiSummaryOnFetchEnabled: false,
      bodyTranslateOnFetchEnabled: false,
      bodyTranslateOnOpenEnabled: false,
      titleTranslateEnabled: false,
      bodyTranslateEnabled: false,
      articleListDisplayMode: 'card',
      categoryId: null,
      fetchIntervalMinutes: 30,
      lastFetchStatus: null,
      lastFetchError: null,
      lastFetchRawError: null,
      isPodcast: false,
    });

    const mod = await import('../../../../app/api/feeds/[id]/route');
    const res = await mod.DELETE(
      new Request(`http://localhost/api/feeds/${feedId}`, {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: feedId }) },
    );
    const json = await res.json();

    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('validation_error');
    expect(deleteFeedAndCleanupCategoryMock).not.toHaveBeenCalled();
  });

  it('PATCH accepts numeric route id', async () => {
    updateFeedWithCategoryResolutionMock.mockResolvedValue({
      id: '1001',
      title: 'Updated',
      url: 'https://example.com/rss.xml',
      siteUrl: null,
      iconUrl: null,
      enabled: false,
      fullTextOnOpenEnabled: true,
      aiSummaryOnOpenEnabled: true,
      articleListDisplayMode: 'list',
      categoryId: null,
      fetchIntervalMinutes: 30,
    });

    const mod = await import('../../../../app/api/feeds/[id]/route');
    const res = await mod.PATCH(
      new Request('http://localhost/api/feeds/1001', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Updated' }),
      }),
      { params: Promise.resolve({ id: '1001' }) },
    );
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(updateFeedWithCategoryResolutionMock).toHaveBeenCalledWith(
      pool,
      '1001',
      expect.objectContaining({ title: 'Updated' }),
    );
  });

  it('PATCH /api/feeds/:id accepts new trigger flags', async () => {
    updateFeedWithCategoryResolutionMock.mockResolvedValue({
      id: feedId,
      title: 'Updated',
      url: 'https://example.com/rss.xml',
      siteUrl: null,
      iconUrl: null,
      enabled: true,
      fullTextOnOpenEnabled: false,
      aiSummaryOnOpenEnabled: false,
      aiSummaryOnFetchEnabled: true,
      bodyTranslateOnFetchEnabled: true,
      bodyTranslateOnOpenEnabled: false,
      categoryId: null,
      fetchIntervalMinutes: 30,
    });

    const mod = await import('../../../../app/api/feeds/[id]/route');
    const res = await mod.PATCH(
      new Request(`http://localhost/api/feeds/${feedId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          aiSummaryOnFetchEnabled: true,
          bodyTranslateOnFetchEnabled: true,
          bodyTranslateOnOpenEnabled: true,
        }),
      }),
      { params: Promise.resolve({ id: feedId }) },
    );
    const json = await res.json();

    expect(updateFeedWithCategoryResolutionMock).toHaveBeenCalledWith(
      pool,
      feedId,
      expect.objectContaining({
        aiSummaryOnFetchEnabled: true,
        bodyTranslateOnFetchEnabled: true,
        bodyTranslateOnOpenEnabled: false,
      }),
    );
    expect(json.ok).toBe(true);
  });

  it('PATCH /api/feeds/:id normalizes mutually exclusive auto-trigger flags', async () => {
    updateFeedWithCategoryResolutionMock.mockResolvedValue({
      id: feedId,
      title: 'Updated',
      url: 'https://example.com/rss.xml',
      siteUrl: null,
      iconUrl: null,
      enabled: true,
      fullTextOnOpenEnabled: false,
      fullTextOnFetchEnabled: true,
      aiSummaryOnOpenEnabled: false,
      aiSummaryOnFetchEnabled: true,
      bodyTranslateOnFetchEnabled: true,
      bodyTranslateOnOpenEnabled: false,
      categoryId: null,
      fetchIntervalMinutes: 30,
    });

    const mod = await import('../../../../app/api/feeds/[id]/route');
    const res = await mod.PATCH(
      new Request(`http://localhost/api/feeds/${feedId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fullTextOnOpenEnabled: true,
          fullTextOnFetchEnabled: true,
          aiSummaryOnOpenEnabled: true,
          aiSummaryOnFetchEnabled: true,
          bodyTranslateOnFetchEnabled: true,
          bodyTranslateOnOpenEnabled: true,
        }),
      }),
      { params: Promise.resolve({ id: feedId }) },
    );
    const json = await res.json();

    expect(updateFeedWithCategoryResolutionMock).toHaveBeenCalledWith(
      pool,
      feedId,
      expect.objectContaining({
        fullTextOnOpenEnabled: false,
        fullTextOnFetchEnabled: true,
        aiSummaryOnOpenEnabled: false,
        aiSummaryOnFetchEnabled: true,
        bodyTranslateOnFetchEnabled: true,
        bodyTranslateOnOpenEnabled: false,
      }),
    );
    expect(json.ok).toBe(true);
  });

  it('PATCH /api/feeds/:id accepts url and siteUrl', async () => {
    updateFeedWithCategoryResolutionMock.mockResolvedValue({
      id: feedId,
      title: 'Updated',
      url: 'https://2.2.2.2/rss.xml',
      siteUrl: 'https://example.org/',
      iconUrl: '/api/feeds/1001/favicon',
      enabled: true,
      fullTextOnOpenEnabled: false,
      aiSummaryOnOpenEnabled: false,
      categoryId: null,
      fetchIntervalMinutes: 30,
    });

    const mod = await import('../../../../app/api/feeds/[id]/route');
    const res = await mod.PATCH(
      new Request(`http://localhost/api/feeds/${feedId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Updated',
          url: 'https://2.2.2.2/rss.xml',
          siteUrl: 'https://example.org/',
        }),
      }),
      { params: Promise.resolve({ id: feedId }) },
    );
    const json = await res.json();

    expect(updateFeedWithCategoryResolutionMock).toHaveBeenCalledWith(
      pool,
      feedId,
      expect.objectContaining({
        title: 'Updated',
        url: 'https://2.2.2.2/rss.xml',
        siteUrl: 'https://example.org/',
      }),
    );
    expect(json.ok).toBe(true);
  });

  it('PATCH /api/feeds/:id rejects payloads that send both categoryId and categoryName', async () => {
    const mod = await import('../../../../app/api/feeds/[id]/route');
    const res = await mod.PATCH(
      new Request(`http://localhost/api/feeds/${feedId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          categoryId,
          categoryName: 'Tech',
        }),
      }),
      { params: Promise.resolve({ id: feedId }) },
    );
    const json = await res.json();

    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('validation_error');
    expect(json.error.fields.categoryName).toBeTruthy();
    expect(updateFeedWithCategoryResolutionMock).not.toHaveBeenCalled();
  });

  it('PATCH rejects unsafe url', async () => {
    isSafeExternalUrlMock.mockResolvedValue(false);

    const mod = await import('../../../../app/api/feeds/[id]/route');
    const res = await mod.PATCH(
      new Request(`http://localhost/api/feeds/${feedId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'http://192.168.1.1/rss.xml' }),
      }),
      { params: Promise.resolve({ id: feedId }) },
    );
    const json = await res.json();

    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('validation_error');
    expect(json.error.fields.url).toBe('当前网络环境不允许访问该链接');
    expect(updateFeedWithCategoryResolutionMock).not.toHaveBeenCalled();
  });

  it('PATCH validates feed url with unresolved-host fallback', async () => {
    updateFeedWithCategoryResolutionMock.mockResolvedValue({
      id: feedId,
      title: 'Updated',
      url: 'https://feeds.ruanyifeng.com/atom.xml',
      siteUrl: null,
      iconUrl: null,
      enabled: true,
      fullTextOnOpenEnabled: false,
      fullTextOnFetchEnabled: false,
      aiSummaryOnOpenEnabled: false,
      aiSummaryOnFetchEnabled: false,
      bodyTranslateOnFetchEnabled: false,
      bodyTranslateOnOpenEnabled: false,
      titleTranslateEnabled: false,
      bodyTranslateEnabled: false,
      articleListDisplayMode: 'card',
      categoryId: null,
      fetchIntervalMinutes: 30,
    });

    const mod = await import('../../../../app/api/feeds/[id]/route');
    const res = await mod.PATCH(
      new Request(`http://localhost/api/feeds/${feedId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://feeds.ruanyifeng.com/atom.xml' }),
      }),
      { params: Promise.resolve({ id: feedId }) },
    );
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(isSafeExternalUrlMock).toHaveBeenCalledWith(
      'https://feeds.ruanyifeng.com/atom.xml',
      { allowUnresolvedHostname: true },
    );
  });

  it('PATCH returns conflict on duplicate url', async () => {
    updateFeedWithCategoryResolutionMock.mockRejectedValue({
      code: '23505',
      constraint: 'feeds_user_url_unique',
    });

    const mod = await import('../../../../app/api/feeds/[id]/route');
    const res = await mod.PATCH(
      new Request(`http://localhost/api/feeds/${feedId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://2.2.2.2/rss.xml' }),
      }),
      { params: Promise.resolve({ id: feedId }) },
    );
    const json = await res.json();

    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('conflict');
  });

  it('PATCH returns validation error when categoryId does not exist', async () => {
    updateFeedWithCategoryResolutionMock.mockRejectedValue({
      code: '23503',
      constraint: 'feeds_category_id_fkey',
    });

    const mod = await import('../../../../app/api/feeds/[id]/route');
    const res = await mod.PATCH(
      new Request(`http://localhost/api/feeds/${feedId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ categoryId: '2998' }),
      }),
      { params: Promise.resolve({ id: feedId }) },
    );
    const json = await res.json();

    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('validation_error');
    expect(json.error.fields.categoryId).toBeTruthy();
  });

  it('DELETE deletes a feed', async () => {
    deleteFeedAndCleanupCategoryMock.mockResolvedValue(true);

    const mod = await import('../../../../app/api/feeds/[id]/route');
    const res = await mod.DELETE(new Request(`http://localhost/api/feeds/${feedId}`), {
      params: Promise.resolve({ id: feedId }),
    });
    const json = await res.json();

    expect(json.ok).toBe(true);
  });


  it('DELETE no longer rewrites deprecated feed keyword filter settings', async () => {
    deleteFeedAndCleanupCategoryMock.mockResolvedValue(true);

    const mod = await import('../../../../app/api/feeds/[id]/route');
    await mod.DELETE(new Request(`http://localhost/api/feeds/${feedId}`), {
      params: Promise.resolve({ id: feedId }),
    });

    expect(getUiSettingsMock).not.toHaveBeenCalled();
    expect(updateUiSettingsMock).not.toHaveBeenCalled();
  });

  it('POST /refresh enqueues feed.fetch', async () => {
    enqueueWithResultMock.mockResolvedValue({ status: 'enqueued', jobId: 'job-id-1' });

    const mod = await import('../../../../app/api/feeds/[id]/refresh/route');
    const res = await mod.POST(new Request(`http://localhost/api/feeds/${feedId}/refresh`), {
      params: Promise.resolve({ id: feedId }),
    });
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(enqueueWithResultMock).toHaveBeenCalledWith(
      'feed.fetch',
      { userId: '1', feedId, force: true, runId: 'run-1' },
      getQueueSendOptions('feed.fetch', { userId: '1', feedId, force: true, runId: 'run-1' }),
    );
    expect(json.data.runId).toBe('run-1');
  });

  it('POST /refresh routes fever feeds to fever.sync', async () => {
    getFeedRefreshDispatchRowMock.mockResolvedValue({
      id: feedId,
      kind: 'rss',
      provider: 'fever',
      enabled: true,
    });
    getFeverAccountByLocalFeedIdMock.mockResolvedValue({
      feverAccountId: 'account-1',
      localFeedId: feedId,
    });
    getFeverAccountByIdMock.mockResolvedValue({
      id: 'account-1',
      baseUrl: 'https://reader.example.com',
      username: 'demo',
      apiKey: 'secret',
      enabled: true,
      autoSyncEnabled: true,
      autoSyncIntervalMinutes: 30,
      lastSyncAt: null,
      lastSyncAttemptAt: null,
      lastError: null,
      createdAt: '2026-05-24T00:00:00.000Z',
    });
    listActiveLocalFeedIdsByFeverAccountIdMock.mockResolvedValue([feedId, '1002']);
    enqueueWithResultMock.mockResolvedValue({ status: 'enqueued', jobId: 'job-id-fever-1' });

    const mod = await import('../../../../app/api/feeds/[id]/refresh/route');
    const res = await mod.POST(new Request(`http://localhost/api/feeds/${feedId}/refresh`), {
      params: Promise.resolve({ id: feedId }),
    });
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(initializeFeedRefreshRunMock).toHaveBeenCalledWith(pool, {
      scope: 'single',
      userId: '1',
      feedId,
      targetFeedIds: [feedId, '1002'],
    });
    expect(enqueueWithResultMock).toHaveBeenCalledWith(
      'fever.sync',
      { userId: '1', accountId: 'account-1', runId: 'run-1', feedIds: [feedId, '1002'] },
      getQueueSendOptions('fever.sync', { userId: '1', accountId: 'account-1', runId: 'run-1', feedIds: [feedId, '1002'] }),
    );
    expect(markFeverAccountSyncAttemptedMock).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({ userId: '1', accountId: 'account-1' }),
    );
    expect(json.data.runId).toBe('run-1');
  });

  it('POST /refresh closes the tracked fever run when enqueue is deduped', async () => {
    getFeedRefreshDispatchRowMock.mockResolvedValue({
      id: feedId,
      kind: 'rss',
      provider: 'fever',
      enabled: true,
    });
    getFeverAccountByLocalFeedIdMock.mockResolvedValue({
      feverAccountId: 'account-1',
      localFeedId: feedId,
    });
    getFeverAccountByIdMock.mockResolvedValue({
      id: 'account-1',
      baseUrl: 'https://reader.example.com',
      username: 'demo',
      apiKey: 'secret',
      enabled: true,
      autoSyncEnabled: true,
      autoSyncIntervalMinutes: 30,
      lastSyncAt: null,
      lastSyncAttemptAt: null,
      lastError: null,
      createdAt: '2026-05-24T00:00:00.000Z',
    });
    listActiveLocalFeedIdsByFeverAccountIdMock.mockResolvedValue([feedId, '1002']);
    enqueueWithResultMock.mockResolvedValue({ status: 'throttled_or_duplicate' });

    const mod = await import('../../../../app/api/feeds/[id]/refresh/route');
    const res = await mod.POST(new Request(`http://localhost/api/feeds/${feedId}/refresh`), {
      params: Promise.resolve({ id: feedId }),
    });
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(json.data).toEqual({ enqueued: false, runId: 'run-1' });
    expect(initializeFeedRefreshRunMock).toHaveBeenCalledWith(pool, {
      scope: 'single',
      userId: '1',
      feedId,
      targetFeedIds: [feedId, '1002'],
    });
    expect(completeFeedRefreshRunItemMock).toHaveBeenNthCalledWith(1, pool, {
      runId: 'run-1',
      userId: '1',
      feedId,
      status: 'failed',
      errorMessage: 'Fever 同步任务已在队列中',
    });
    expect(completeFeedRefreshRunItemMock).toHaveBeenNthCalledWith(2, pool, {
      runId: 'run-1',
      userId: '1',
      feedId: '1002',
      status: 'failed',
      errorMessage: 'Fever 同步任务已在队列中',
    });
    expect(markFeverAccountSyncAttemptedMock).not.toHaveBeenCalled();
  });

  it('POST /refresh does not enqueue disabled fever account', async () => {
    getFeedRefreshDispatchRowMock.mockResolvedValue({
      id: feedId,
      kind: 'rss',
      provider: 'fever',
      enabled: true,
    });
    getFeverAccountByLocalFeedIdMock.mockResolvedValue({
      feverAccountId: 'account-1',
      localFeedId: feedId,
    });
    getFeverAccountByIdMock.mockResolvedValue({
      id: 'account-1',
      baseUrl: 'https://reader.example.com',
      username: 'demo',
      apiKey: 'secret',
      enabled: false,
      autoSyncEnabled: false,
      autoSyncIntervalMinutes: 0,
      lastSyncAt: null,
      lastSyncAttemptAt: null,
      lastError: null,
      createdAt: '2026-05-24T00:00:00.000Z',
    });

    const mod = await import('../../../../app/api/feeds/[id]/refresh/route');
    const res = await mod.POST(new Request(`http://localhost/api/feeds/${feedId}/refresh`), {
      params: Promise.resolve({ id: feedId }),
    });
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(json.data).toEqual({ enqueued: false });
    expect(initializeFeedRefreshRunMock).not.toHaveBeenCalled();
    expect(enqueueWithResultMock).not.toHaveBeenCalled();
    expect(markFeverAccountSyncAttemptedMock).not.toHaveBeenCalled();
  });

  it('POST /refresh (all) enqueues feed.refresh_all', async () => {
    enqueueWithResultMock.mockResolvedValue({ status: 'enqueued', jobId: 'job-id-1' });

    const mod = await import('../../../../app/api/feeds/refresh/route');
    const res = await mod.POST(new Request('http://localhost/api/feeds/refresh', { method: 'POST' }));
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(enqueueWithResultMock).toHaveBeenCalledWith(
      JOB_REFRESH_ALL,
      { userId: '1', force: true, runId: 'run-1' },
      getQueueSendOptions(JOB_REFRESH_ALL, { userId: '1', force: true, runId: 'run-1' }),
    );
    expect(json.data.runId).toBe('run-1');
  });

  it('POST /refresh (all) returns runId instead of only jobId', async () => {
    initializeFeedRefreshRunMock.mockResolvedValue({ id: 'run-1' });
    enqueueWithResultMock.mockResolvedValue({ status: 'enqueued', jobId: 'job-id-1' });

    const mod = await import('../../../../app/api/feeds/refresh/route');
    const res = await mod.POST(new Request('http://localhost/api/feeds/refresh', { method: 'POST' }));

    expect(await res.json()).toMatchObject({
      ok: true,
      data: { enqueued: true, runId: 'run-1' },
    });
  });

  it('POST /refresh returns not enqueued for disabled or unsupported feed', async () => {
    getFeedRefreshDispatchRowMock.mockResolvedValue({
      id: feedId,
      kind: 'ai_digest',
      provider: 'local_rss',
      enabled: true,
    });

    const mod = await import('../../../../app/api/feeds/[id]/refresh/route');
    const res = await mod.POST(new Request(`http://localhost/api/feeds/${feedId}/refresh`), {
      params: Promise.resolve({ id: feedId }),
    });

    expect(await res.json()).toMatchObject({
      ok: true,
      data: { enqueued: false },
    });
    expect(enqueueWithResultMock).not.toHaveBeenCalled();
  });
});
