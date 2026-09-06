import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPlatformAccount,
  deletePlatformAccount,
  getGovernanceStats,
  listPlatformAccounts,
  verifyPlatformAccount,
  type PlatformAccount,
} from '@/lib/api/apiClient';
import { toast } from '@/features/toast/toast';
import PlatformAccountsPanel from '../../h5/components/PlatformAccountsPanel';

vi.mock('next/link', () => import('../../h5/shims/next-link'));
vi.mock('next/navigation', () => import('../../h5/shims/next-navigation'));

vi.mock('@/lib/api/apiClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/apiClient')>();
  return {
    ...original,
    listPlatformAccounts: vi.fn(),
    createPlatformAccount: vi.fn(),
    deletePlatformAccount: vi.fn(),
    verifyPlatformAccount: vi.fn(),
    getGovernanceStats: vi.fn(),
  };
});

vi.mock('@/features/toast/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const mockedList = vi.mocked(listPlatformAccounts);
const mockedCreate = vi.mocked(createPlatformAccount);
const mockedDelete = vi.mocked(deletePlatformAccount);
const mockedVerify = vi.mocked(verifyPlatformAccount);
const mockedToast = vi.mocked(toast);

function makeAccount(overrides: Partial<PlatformAccount> = {}): PlatformAccount {
  return {
    id: 'a1',
    userId: '1',
    platform: 'wechat',
    accountName: '主号',
    credKind: 'app_secret',
    credentialMasked: 'wxab****12ab',
    status: 'active',
    expiresAt: null,
    lastVerifiedAt: new Date(Date.now() - 3600_000).toISOString(),
    metaJson: null,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-05T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  window.location.hash = '#/settings';
  mockedList.mockResolvedValue({ items: [makeAccount()] });
  mockedCreate.mockResolvedValue({ account: makeAccount() });
  mockedDelete.mockResolvedValue({ deleted: true });
  mockedVerify.mockResolvedValue({ verified: true });
  vi.mocked(getGovernanceStats).mockResolvedValue({
    todayPending: 0, todayArchived: 0, todayFetchSucceeded: 0, todayFetchFailed: 0, queueSize: 0,
  });
});

describe('平台授权面板', () => {
  it('账号卡片：平台名/账号名/masked 凭据/状态点/相对时间，且无明文字段', async () => {
    render(<PlatformAccountsPanel />);

    expect(await screen.findByText('公众号')).toBeInTheDocument();
    expect(screen.getByText('主号')).toBeInTheDocument();
    expect(screen.getByTestId('credential-masked')).toHaveTextContent('wxab****12ab');
    expect(screen.getByText('已验证')).toBeInTheDocument();
    expect(screen.getByText(/小时前验证/)).toBeInTheDocument();
    // 无明文泄漏：面板里不存在 appid/secret 输入或值
    expect(document.body.textContent).not.toContain('credentialPlaintext');
    expect(document.body.textContent).not.toContain('credential_encrypted');
  });

  it('error 状态显示红点文案', async () => {
    mockedList.mockResolvedValue({ items: [makeAccount({ status: 'error', lastVerifiedAt: null })] });
    render(<PlatformAccountsPanel />);

    expect(await screen.findByText('异常')).toBeInTheDocument();
    expect(screen.getByText('从未验证')).toBeInTheDocument();
  });

  it('添加表单：公众号显示 appid/secret 双栏，切抖音切换为 cookie 大文本框', async () => {
    render(<PlatformAccountsPanel />);
    await screen.findByText('公众号');
    fireEvent.click(screen.getByRole('button', { name: /添加账号/ }));

    expect(await screen.findByLabelText('AppID')).toBeInTheDocument();
    expect(screen.getByLabelText('AppSecret')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /抖音/ }));
    expect(screen.getByLabelText('登录 Cookie')).toBeInTheDocument();
    expect(screen.queryByLabelText('AppID')).not.toBeInTheDocument();
    expect(screen.getByText(/待 P2e-2\/3 开放/)).toBeInTheDocument();

    // 提交 cookie 表单
    fireEvent.change(screen.getByLabelText('登录 Cookie'), { target: { value: 'sessionid=abc' } });
    fireEvent.change(screen.getByLabelText('账号名'), { target: { value: '我的抖音号' } });
    fireEvent.click(screen.getByRole('button', { name: /保存账号/ }));
    await waitFor(() => {
      expect(mockedCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: 'douyin',
          credKind: 'cookie',
          credential: { cookie: 'sessionid=abc' },
          accountName: '我的抖音号',
        }),
      );
    });
  });

  it('验证连通：成功 toast；失败 toast 显示错误摘要', async () => {
    render(<PlatformAccountsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: '验证连通' }));
    await waitFor(() => {
      expect(mockedVerify).toHaveBeenCalledWith('a1');
    });
    await waitFor(() => {
      expect(mockedToast.success).toHaveBeenCalledWith(expect.stringContaining('验证通过'));
    });

    mockedVerify.mockResolvedValue({ verified: false, reason: 'invalid appid rid: abc' });
    fireEvent.click(screen.getByRole('button', { name: '验证连通' }));
    await waitFor(() => {
      expect(mockedToast.error).toHaveBeenCalledWith('invalid appid rid: abc');
    });
  });

  it('删除需二次确认', async () => {
    render(<PlatformAccountsPanel />);
    await screen.findByText('公众号');

    fireEvent.click(screen.getByRole('button', { name: '删除账号' }));
    expect(mockedDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    await waitFor(() => {
      expect(mockedDelete).toHaveBeenCalledWith('a1');
    });
  });
});
