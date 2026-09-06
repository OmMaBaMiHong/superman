import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listPlatformAccounts,
  publishDraftToWechat,
  type PlatformAccount,
} from '@/lib/api/apiClient';
import { toast } from '@/features/toast/toast';
import PublishToWechatButton from '../../../features/studio/components/PublishToWechatButton';

vi.mock('@/lib/api/apiClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/apiClient')>();
  return {
    ...original,
    listPlatformAccounts: vi.fn(),
    publishDraftToWechat: vi.fn(),
  };
});

vi.mock('@/features/toast/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const mockedList = vi.mocked(listPlatformAccounts);
const mockedPublish = vi.mocked(publishDraftToWechat);
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
    lastVerifiedAt: null,
    metaJson: null,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-05T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  mockedPublish.mockResolvedValue({ mediaId: 'm1', publishedPostId: 'pp1', postUrl: 'wechat-draft://m1' });
});

describe('发布到公众号按钮', () => {
  it('无账号：按钮置灰 + tooltip 指引，不发请求', async () => {
    mockedList.mockResolvedValue({ items: [] });
    render(<PublishToWechatButton draftId="d1" />);

    const button = screen.getByTestId('publish-to-wechat');
    // 首次点击触发账号探测；探测结果为空后按钮置灰
    fireEvent.click(button);
    await waitFor(() => {
      expect(mockedList).toHaveBeenCalledWith({ platform: 'wechat' }, expect.anything());
    });
    await waitFor(() => {
      expect(button).toBeDisabled();
    });
    expect(button).toHaveAttribute('title', '先去设置页添加公众号授权');
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it('单账号：预选 + 确认发布成功 → toast + 已发布徽章', async () => {
    mockedList.mockResolvedValue({ items: [makeAccount()] });
    render(<PublishToWechatButton draftId="d1" />);

    fireEvent.click(screen.getByTestId('publish-to-wechat'));
    const radio = await screen.findByRole('radio', { name: /主号/ });
    expect(radio).toHaveAttribute('aria-checked', 'true'); // 单账号预选

    fireEvent.click(screen.getByRole('button', { name: '确认发布' }));
    await waitFor(() => {
      expect(mockedPublish).toHaveBeenCalledWith('d1', { accountId: 'a1' });
    });
    await waitFor(() => {
      expect(mockedToast.success).toHaveBeenCalledWith('已送入公众号草稿箱');
      expect(screen.getByTestId('published-badge')).toHaveTextContent('已发布到公众号');
    });
  });

  it('多账号：需手动选择后发布', async () => {
    mockedList.mockResolvedValue({
      items: [makeAccount(), makeAccount({ id: 'a2', accountName: '副号' })],
    });
    render(<PublishToWechatButton draftId="d1" />);

    fireEvent.click(screen.getByTestId('publish-to-wechat'));
    const confirm = await screen.findByRole('button', { name: '确认发布' });
    expect(confirm).toBeDisabled(); // 未选不可发

    fireEvent.click(screen.getByRole('radio', { name: /副号/ }));
    fireEvent.click(screen.getByRole('button', { name: '确认发布' }));
    await waitFor(() => {
      expect(mockedPublish).toHaveBeenCalledWith('d1', { accountId: 'a2' });
    });
  });
});
