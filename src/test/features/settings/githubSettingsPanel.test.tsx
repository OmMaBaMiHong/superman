import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../../store/appStore';
import type { GithubRepoSubscription } from '@/types';

const githubReposState = vi.hoisted(() => ({
  repos: [] as Record<string, unknown>[],
  tokenStatus: null as Record<string, unknown> | null,
  loading: false,
  reload: vi.fn(),
  createRepo: vi.fn(),
  updateRepo: vi.fn(),
  removeRepo: vi.fn(),
  refreshRepo: vi.fn(),
  saveToken: vi.fn(),
  clearToken: vi.fn(),
}));

const { runImmediateSuccessMock, runImmediateFailureMock } = vi.hoisted(() => ({
  runImmediateSuccessMock: vi.fn(),
  runImmediateFailureMock: vi.fn(),
}));

vi.mock('@/features/github/hooks/useGithubRepos', () => ({
  useGithubRepos: () => githubReposState,
}));

vi.mock('@/lib/api/apiClient', () => {
  class ApiError extends Error {
    code: string;
    fields?: Record<string, string>;
    constructor(message: string, code = 'api_error', fields?: Record<string, string>) {
      super(message);
      this.name = 'ApiError';
      this.code = code;
      this.fields = fields;
    }
  }
  return { ApiError };
});

vi.mock('@/features/notifications/userOperationNotifier', () => ({
  runImmediateSuccess: (...args: unknown[]) => runImmediateSuccessMock(...args),
  runImmediateFailure: (...args: unknown[]) => runImmediateFailureMock(...args),
}));

import GithubSettingsPanel from '../../../features/settings/panels/GithubSettingsPanel';
import { ApiError } from '@/lib/api/apiClient';

function makeRepo(overrides: Partial<GithubRepoSubscription> = {}): GithubRepoSubscription {
  return {
    id: '1',
    feedId: '1',
    owner: 'facebook',
    repo: 'react',
    fullName: 'facebook/react',
    title: 'facebook/react',
    htmlUrl: 'https://github.com/facebook/react',
    avatarUrl: 'https://avatars.githubusercontent.com/u/6412038',
    description: 'The library for web and native user interfaces',
    contentTypes: ['release'],
    includePrerelease: false,
    enabled: true,
    fetchIntervalMinutes: 60,
    categoryId: null,
    unreadCount: 0,
    status: 'idle',
    lastSyncedAt: null,
    nextSyncAt: null,
    rateLimitedUntil: null,
    lastError: null,
    lastErrorCode: null,
    ...overrides,
  } as unknown as GithubRepoSubscription;
}

describe('GithubSettingsPanel', () => {
  beforeEach(() => {
    githubReposState.repos = [];
    githubReposState.tokenStatus = null;
    githubReposState.loading = false;
    runImmediateSuccessMock.mockReset();
    runImmediateFailureMock.mockReset();
    useAppStore.setState({ selectedView: 'all', loadSnapshot: vi.fn() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the loading state before repos resolve', () => {
    githubReposState.loading = true;
    render(<GithubSettingsPanel />);
    expect(screen.getByText('加载中…')).toBeInTheDocument();
  });

  it('shows the empty state and the add-repository button', () => {
    render(<GithubSettingsPanel />);
    expect(screen.getByText('还没有订阅的 GitHub 仓库，点击下方「添加仓库」开始。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加仓库' })).toBeInTheDocument();
  });

  it('renders repo cards with status and type badges', () => {
    githubReposState.repos = [
      makeRepo({ id: '1', fullName: 'facebook/react', status: 'idle', lastSyncedAt: null, includePrerelease: true }),
    ];
    render(<GithubSettingsPanel />);

    expect(screen.getByText('facebook/react')).toBeInTheDocument();
    expect(screen.getByText('空闲')).toBeInTheDocument();
    expect(screen.getByText('[Release]')).toBeInTheDocument();
    expect(screen.getByText('上次同步 尚未同步')).toBeInTheDocument();
    expect(screen.getByText('包含预发布')).toBeInTheDocument();
  });

  it('creates a repo and emits success then reloads snapshot', async () => {
    githubReposState.createRepo.mockResolvedValue(makeRepo({ id: '1', fullName: 'facebook/react' }));

    render(<GithubSettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: '添加仓库' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('仓库地址'), {
      target: { value: 'facebook/react' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '添加仓库' }));

    await waitFor(() => {
      expect(githubReposState.createRepo).toHaveBeenCalledWith({
        repoInput: 'facebook/react',
        includePrerelease: false,
        title: undefined,
      });
    });
    await waitFor(() => {
      expect(runImmediateSuccessMock).toHaveBeenCalledWith({
        actionKey: 'github.repo.create',
        context: { fullName: 'facebook/react' },
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(useAppStore.getState().loadSnapshot).toHaveBeenCalledWith({ view: 'all' });
  });

  it('keeps the dialog open and does not toast on a field validation error from the server', async () => {
    githubReposState.createRepo.mockRejectedValue(
      new ApiError('repo not found', 'validation_error', { repoInput: 'repo_not_found' }),
    );

    render(<GithubSettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: '添加仓库' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('仓库地址'), {
      target: { value: 'ghost/nope' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '添加仓库' }));

    await waitFor(() => {
      expect(githubReposState.createRepo).toHaveBeenCalled();
    });
    expect(await screen.findByText('repo_not_found')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(runImmediateSuccessMock).not.toHaveBeenCalled();
    expect(runImmediateFailureMock).not.toHaveBeenCalled();
  });

  it('triggers a refresh and emits success when enqueued', async () => {
    const repo = makeRepo({ id: '1', fullName: 'facebook/react' });
    githubReposState.repos = [repo];
    githubReposState.refreshRepo.mockResolvedValue({ enqueued: true, feedId: '1' });

    render(<GithubSettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: '同步' }));

    await waitFor(() => {
      expect(githubReposState.refreshRepo).toHaveBeenCalledWith('1');
    });
    await waitFor(() => {
      expect(runImmediateSuccessMock).toHaveBeenCalledWith({
        actionKey: 'github.repo.refresh',
        context: { outcome: 'queued' },
      });
    });
    expect(runImmediateFailureMock).not.toHaveBeenCalled();
  });

  it('emits failure when refresh is not enqueued', async () => {
    const repo = makeRepo({ id: '1', fullName: 'facebook/react' });
    githubReposState.repos = [repo];
    githubReposState.refreshRepo.mockResolvedValue({
      enqueued: false,
      feedId: '1',
      reason: 'already_enqueued',
    });

    render(<GithubSettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: '同步' }));

    await waitFor(() => {
      expect(runImmediateFailureMock).toHaveBeenCalledWith({
        actionKey: 'github.repo.refresh',
        err: '暂时无法加入同步队列，请稍后重试',
      });
    });
  });

  it('deletes a repo after confirmation and reloads snapshot', async () => {
    const repo = makeRepo({ id: '1', fullName: 'facebook/react' });
    githubReposState.repos = [repo];
    githubReposState.removeRepo.mockResolvedValue({ id: '1' });

    render(<GithubSettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: '删除' }));

    const confirmButton = await screen.findByRole('button', { name: '确认删除' });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(githubReposState.removeRepo).toHaveBeenCalledWith('1');
    });
    await waitFor(() => {
      expect(runImmediateSuccessMock).toHaveBeenCalledWith({ actionKey: 'github.repo.delete' });
    });
    expect(useAppStore.getState().loadSnapshot).toHaveBeenCalledWith({ view: 'all' });
  });

  it('saves a token and emits success', async () => {
    githubReposState.tokenStatus = { hasToken: false, maskedToken: null, rateLimit: null };
    githubReposState.saveToken.mockResolvedValue({ hasToken: true, maskedToken: 'ghp_****cdef', rateLimit: null });

    render(<GithubSettingsPanel />);
    fireEvent.change(screen.getByLabelText('Token'), {
      target: { value: 'ghp_' + 'a'.repeat(36) },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存 Token' }));

    await waitFor(() => {
      expect(githubReposState.saveToken).toHaveBeenCalledWith('ghp_' + 'a'.repeat(36));
    });
    await waitFor(() => {
      expect(runImmediateSuccessMock).toHaveBeenCalledWith({ actionKey: 'github.token.save' });
    });
  });

  it('shows inline error when token save fails with a token field error', async () => {
    githubReposState.tokenStatus = { hasToken: false, maskedToken: null, rateLimit: null };
    githubReposState.saveToken.mockRejectedValue(
      new ApiError('invalid token', 'validation_error', { token: 'Token 格式不正确' }),
    );

    render(<GithubSettingsPanel />);
    fireEvent.change(screen.getByLabelText('Token'), {
      target: { value: 'not-a-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存 Token' }));

    await waitFor(() => {
      expect(githubReposState.saveToken).toHaveBeenCalled();
    });
    expect(await screen.findByText('Token 格式不正确')).toBeInTheDocument();
    expect(runImmediateSuccessMock).not.toHaveBeenCalled();
  });

  it('clears a configured token and emits success', async () => {
    githubReposState.tokenStatus = {
      hasToken: true,
      maskedToken: 'ghp_****cdef',
      rateLimit: { limit: 5000, remaining: 4999 },
    };
    githubReposState.clearToken.mockResolvedValue({ hasToken: false, maskedToken: null, rateLimit: null });

    render(<GithubSettingsPanel />);
    expect(screen.getByText('已配置')).toBeInTheDocument();
    expect(screen.getByText('剩余调用 4999/5000')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '清除' }));

    await waitFor(() => {
      expect(githubReposState.clearToken).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(runImmediateSuccessMock).toHaveBeenCalledWith({ actionKey: 'github.token.clear' });
    });
  });

  it('edits a repo and emits update success', async () => {
    const repo = makeRepo({ id: '1', fullName: 'facebook/react', title: 'facebook/react' });
    githubReposState.repos = [repo];
    githubReposState.updateRepo.mockResolvedValue(makeRepo({ id: '1', fullName: 'facebook/react' }));

    render(<GithubSettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('自定义标题（可选）'), {
      target: { value: 'React 官方' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(githubReposState.updateRepo).toHaveBeenCalledWith('1', expect.objectContaining({
        title: 'React 官方',
      }));
    });
    await waitFor(() => {
      expect(runImmediateSuccessMock).toHaveBeenCalledWith({ actionKey: 'github.repo.update' });
    });
  });
});
