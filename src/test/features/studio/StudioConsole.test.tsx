import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acceptDraft,
  createRewriteJobs,
  exportDraftMarkdown,
  getDraftDetail,
  getGovernanceQueue,
  getGovernanceStats,
  listDrafts,
  listPipelineJobs,
  listPublishedPosts,
  retryPipelineJob,
  type DraftDetail,
  type DraftItem,
  type GovernanceQueueItem,
  type PipelineJobItem,
} from '@/lib/api/apiClient';
import StudioConsole from '../../../features/studio/components/StudioConsole';

vi.mock('next/navigation', () => ({
  usePathname: () => '/studio',
}));

vi.mock('@/lib/api/apiClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/apiClient')>();
  return {
    ...original,
    getGovernanceQueue: vi.fn(),
    getGovernanceStats: vi.fn(),
    createRewriteJobs: vi.fn(),
    listPipelineJobs: vi.fn(),
    retryPipelineJob: vi.fn(),
    listDrafts: vi.fn(),
    listPublishedPosts: vi.fn(),
    getDraftDetail: vi.fn(),
    acceptDraft: vi.fn(),
    exportDraftMarkdown: vi.fn(),
  };
});

const mockedQueue = vi.mocked(getGovernanceQueue);
const mockedStats = vi.mocked(getGovernanceStats);
const mockedCreate = vi.mocked(createRewriteJobs);
const mockedJobs = vi.mocked(listPipelineJobs);
const mockedRetry = vi.mocked(retryPipelineJob);
const mockedDrafts = vi.mocked(listDrafts);
const mockedDraftDetail = vi.mocked(getDraftDetail);
const mockedAccept = vi.mocked(acceptDraft);
const mockedExport = vi.mocked(exportDraftMarkdown);

function makeTopic(overrides: Partial<GovernanceQueueItem> = {}): GovernanceQueueItem {
  return {
    id: '101',
    title: 'DeepSeek Harness 首发',
    summary: '内置类 VS Code 工作台，文件管理、终端、Git 全部内置。',
    aiReason: null,
    qualityScore: 74,
    feedId: 'f1',
    feedTitle: 'AI阿伟',
    categoryId: 'c1',
    categoryTitle: '技术',
    publishedAt: '2026-09-05T08:00:00.000Z',
    sourceUrl: 'https://example.com/a1',
    governanceStatus: 'archived',
    redraftCount: 0,
    contentType: 'image',
    ...overrides,
  };
}

function makeJob(overrides: Partial<PipelineJobItem> = {}): PipelineJobItem {
  return {
    id: 'j1',
    articleId: '101',
    kind: 'rewrite',
    platform: 'wechat',
    status: 'running',
    error: null,
    durationMs: null,
    createdAt: '2026-09-05T10:00:00.000Z',
    updatedAt: '2026-09-05T10:00:01.000Z',
    articleTitle: 'DeepSeek Harness 首发',
    ...overrides,
  };
}

function makeDraft(overrides: Partial<DraftItem> = {}): DraftItem {
  return {
    id: 'd1',
    articleId: '101',
    jobId: 'j1',
    platform: 'xhs',
    title: '姐妹们这个工作台真的绝了',
    similarityScore: 0.28,
    originalityFlag: 'ok',
    status: 'draft',
    createdAt: '2026-09-05T10:05:00.000Z',
    updatedAt: '2026-09-05T10:05:00.000Z',
    articleTitle: 'DeepSeek Harness 首发',
    ...overrides,
  };
}

function makeDraftDetail(overrides: Partial<DraftDetail> = {}): DraftDetail {
  return {
    ...makeDraft(),
    body: '## 开箱即用\n\n这个工作台**真的绝了**。\n\n<script>alert(1)</script>',
    articleSummary: '内置类 VS Code 工作台。',
    articleLink: 'https://example.com/a1',
    ...overrides,
  };
}

beforeEach(() => {
  mockedQueue.mockResolvedValue({ items: [makeTopic()], total: 1 });
  mockedStats.mockResolvedValue({
    todayPending: 0,
    todayArchived: 0,
    todayFetchSucceeded: 0,
    todayFetchFailed: 0,
    queueSize: 0,
  });
  mockedCreate.mockResolvedValue({ jobs: [] });
  mockedJobs.mockResolvedValue({ items: [], total: 0 });
  mockedRetry.mockResolvedValue({});
  mockedDrafts.mockResolvedValue({ items: [makeDraft()], total: 1 });
  vi.mocked(listPublishedPosts).mockResolvedValue({ items: [] });
  mockedDraftDetail.mockResolvedValue(makeDraftDetail());
  mockedAccept.mockResolvedValue({});
  mockedExport.mockResolvedValue({ markdown: '# x', fileName: 'draft-d1.md' });
});

describe('StudioConsole · 选题卡池', () => {
  it('渲染选题卡（形态徽章 + 质量分 + 生成稿件按钮），按 archived 过滤拉取', async () => {
    render(<StudioConsole />);

    expect(await screen.findByText('DeepSeek Harness 首发')).toBeInTheDocument();
    expect(screen.getByTestId('content-type-badge')).toHaveTextContent('图文');
    expect(screen.getByLabelText('质量分 74')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /生成稿件/ })).toBeEnabled();
    expect(mockedQueue).toHaveBeenCalledWith(expect.objectContaining({ statuses: ['archived'] }));
  });

  it('平台多选：确认后调 rewrite API 并切到任务分区', async () => {
    render(<StudioConsole />);
    fireEvent.click(await screen.findByRole('button', { name: /生成稿件/ }));

    // sheet 打开，默认勾选公众号，加选小红书
    expect(await screen.findByText('公众号深度文')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /小红书种草/ }));
    fireEvent.click(screen.getByRole('button', { name: /开始生成（2）/ }));

    await waitFor(() => {
      expect(mockedCreate).toHaveBeenCalledWith(
        expect.objectContaining({ articleId: '101', platforms: expect.arrayContaining(['wechat', 'xhs']) }),
      );
    });
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /流水线任务/ })).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('搜索选题：关键词经 queue API 透传', async () => {
    render(<StudioConsole />);
    await screen.findByText('DeepSeek Harness 首发');

    fireEvent.change(screen.getByLabelText('搜索选题'), { target: { value: 'DeepSeek' } });
    await waitFor(
      () => {
        expect(mockedQueue).toHaveBeenCalledWith(
          expect.objectContaining({ keyword: 'DeepSeek' }),
        );
      },
      { timeout: 1500 },
    );
  });
});

describe('StudioConsole · 流水线任务', () => {
  it('渲染任务状态徽章（running 脉冲 / failed 红 + 错误详情 + 重试）', async () => {
    mockedJobs.mockResolvedValue({
      items: [
        makeJob(),
        makeJob({ id: 'j2', platform: 'xhs', status: 'failed', error: 'AI provider 未配置 api key', durationMs: 3200 }),
      ],
      total: 2,
    });
    render(<StudioConsole />);
    fireEvent.click(await screen.findByRole('tab', { name: /流水线任务/ }));

    const runningRow = (await screen.findAllByTestId('pipeline-job'))[0];
    expect(runningRow).toHaveAttribute('data-status', 'running');
    expect(screen.getByText('运行中')).toBeInTheDocument();
    expect(screen.getByText('失败')).toBeInTheDocument();
    expect(screen.getByText(/AI provider 未配置/)).toBeInTheDocument();
    // LLM 未配置引导
    expect(screen.getByText(/去设置页配置/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /重试/ }));
    await waitFor(() => {
      expect(mockedRetry).toHaveBeenCalledWith('j2');
    });
  });
});

describe('StudioConsole · 草稿对照', () => {
  it('点草稿打开对照 sheet：原文/成稿渲染、相似度大号数字、markdown 消毒', async () => {
    render(<StudioConsole />);
    fireEvent.click(await screen.findByRole('tab', { name: /草稿箱/ }));
    fireEvent.click(await screen.findByTestId('draft-row'));

    expect(await screen.findByTestId('glass-detail-sheet')).toBeInTheDocument();
    // 成稿 markdown 渲染（默认 tab = 成稿）
    const draftBody = (await screen.findAllByTestId('draft-body'))[0];
    await waitFor(() => {
      expect(draftBody.textContent).toContain('这个工作台');
      expect(draftBody.textContent).toContain('真的绝了');
    });
    // 相似度大号数字
    expect(screen.getByLabelText('相似度 28%')).toBeInTheDocument();
    // script 被消毒剥除
    expect(draftBody.querySelector('script')).toBeNull();
    expect(draftBody.innerHTML).not.toContain('alert(1)');
    // 移动端切到原文 tab
    fireEvent.click(screen.getByRole('tab', { name: '原文' }));
    expect(screen.getAllByText('内置类 VS Code 工作台。').length).toBeGreaterThan(0);
  });

  it('needs_review 显示红色提示条；accept 后变已采用', async () => {
    mockedDrafts.mockResolvedValue({
      items: [makeDraft({ originalityFlag: 'needs_review', similarityScore: 0.62 })],
      total: 1,
    });
    mockedDraftDetail.mockResolvedValue(
      makeDraftDetail({ originalityFlag: 'needs_review', similarityScore: 0.62 }),
    );
    render(<StudioConsole />);
    fireEvent.click(await screen.findByRole('tab', { name: /草稿箱/ }));
    fireEvent.click(await screen.findByTestId('draft-row'));

    expect(await screen.findByRole('alert')).toHaveTextContent('相似度过高，请人工核对后再发布');
    expect(screen.getAllByText('需人工终审').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText('相似度 62%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '采用' }));
    await waitFor(() => {
      expect(mockedAccept).toHaveBeenCalledWith('d1');
    });
    await waitFor(() => {
      expect(screen.getAllByText('已采用').length).toBeGreaterThan(0);
    });
  });

  it('导出 Markdown 触发下载', async () => {
    render(<StudioConsole />);
    fireEvent.click(await screen.findByRole('tab', { name: /草稿箱/ }));
    fireEvent.click(await screen.findByTestId('draft-row'));
    await screen.findByTestId('glass-detail-sheet');
    await screen.findByRole('button', { name: /导出 Markdown/ });

    const clickSpy = vi.fn();
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, ...rest) => {
      const el = originalCreate(tag, ...rest);
      if (tag === 'a') el.click = clickSpy;
      return el;
    });
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
    globalThis.URL.revokeObjectURL = vi.fn();

    fireEvent.click(screen.getByRole('button', { name: /导出 Markdown/ }));
    await waitFor(() => {
      expect(mockedExport).toHaveBeenCalledWith('d1');
      expect(clickSpy).toHaveBeenCalled();
    });
    vi.restoreAllMocks();
  });
});
