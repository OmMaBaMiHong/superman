import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listPlatformAccounts,
  publishDraftToSauVideo,
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
    publishDraftToSauVideo: vi.fn(),
  };
});

vi.mock('@/features/toast/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const mockedList = vi.mocked(listPlatformAccounts);
const mockedPublishWechat = vi.mocked(publishDraftToWechat);
const mockedPublishSau = vi.mocked(publishDraftToSauVideo);
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
  vi.clearAllMocks();
  mockedPublishWechat.mockResolvedValue({ mediaId: 'm1', publishedPostId: 'pp1', postUrl: 'wechat-draft://m1' });
  mockedPublishSau.mockResolvedValue({ vendorFilename: 'v.mp4', publishedPostId: 'pp2', postUrl: 'douyin-video://v.mp4' });
});

describe('发布按钮（多平台）', () => {
  it('无账号：sheet 空态提示去授权，确认按钮不可用，不发请求', async () => {
    mockedList.mockResolvedValue({ items: [] });
    render(<PublishToWechatButton draftId="d1" />);

    fireEvent.click(screen.getByTestId('publish-to-wechat'));
    await waitFor(() => {
      expect(mockedList).toHaveBeenCalledWith({ platform: 'wechat' }, expect.anything());
    });
    await screen.findByText(/还没有可用的公众号账号/);
    expect(screen.getByRole('button', { name: '确认发布' })).toBeDisabled();
    expect(mockedPublishWechat).not.toHaveBeenCalled();
  });

  it('单账号：预选 + 确认发布成功 → toast + 已发布徽章', async () => {
    mockedList.mockResolvedValue({ items: [makeAccount()] });
    render(<PublishToWechatButton draftId="d1" />);

    fireEvent.click(screen.getByTestId('publish-to-wechat'));
    const radio = await screen.findByRole('radio', { name: /主号/ });
    expect(radio).toHaveAttribute('aria-checked', 'true'); // 单账号预选

    fireEvent.click(screen.getByRole('button', { name: '确认发布' }));
    await waitFor(() => {
      expect(mockedPublishWechat).toHaveBeenCalledWith('d1', { accountId: 'a1' });
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
      expect(mockedPublishWechat).toHaveBeenCalledWith('d1', { accountId: 'a2' });
    });
  });

  it('抖音：即时发布红色确认 + 视频来源必填 + 调 SAU 发布', async () => {
    mockedList.mockImplementation(({ platform }: { platform?: string }) =>
      Promise.resolve({
        items: platform === 'douyin'
          ? [makeAccount({ id: 'dy1', platform: 'douyin', credKind: 'cookie', accountName: '抖音主号' })]
          : [],
      }),
    );
    render(<PublishToWechatButton draftId="d1" />);

    fireEvent.click(screen.getByTestId('publish-to-wechat'));
    // 切到抖音平台
    fireEvent.click(await screen.findByRole('radio', { name: /抖音/ }));
    // 红色二次确认文案
    await screen.findByText(/即时发布，不可撤回/);
    // 视频来源未填：确认按钮禁用 + 点击 toast 报错
    const confirm = screen.getByRole('button', { name: '确认即时发布' });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('视频文件路径或视频 URL'), {
      target: { value: 'https://cdn.example.com/v.mp4' },
    });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(mockedPublishSau).toHaveBeenCalledWith('d1', expect.objectContaining({
        platform: 'douyin',
        accountId: 'dy1',
        videoUrl: 'https://cdn.example.com/v.mp4',
      }));
    });
    expect(mockedToast.success).toHaveBeenCalledWith('已发布到抖音');
  });
});
