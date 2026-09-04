/**
 * T04 面板测试：OAuthSettingsPanel（「三方授权」设置分区）。
 *
 * 覆盖验收项（docs/arch-oauth-hub.md §T04）：
 * - 渲染 4 张平台卡片，未配置平台呈「未配置」引导态（授权按钮禁用 + tooltip 提示）；
 * - 可折叠配置区（展开/收起 Client ID 表单）；
 * - 已配置平台点击「去授权」→ 跳转 authorizeUrl（window.location.assign）；
 * - 撤销走 AlertDialog 二次确认；
 * - 状态徽章：已连接 / 已过期 / 未连接。
 *
 * 与 `githubSettingsPanel.test.tsx` 同风格：mock `useOAuthHub` 与通知器。
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuthConnectionView, OAuthProviderConfigStatus } from '@/types';

const oauthHubState = vi.hoisted(() => ({
  providers: [] as OAuthProviderConfigStatus[],
  connections: [] as OAuthConnectionView[],
  connectionByProvider: new Map<string, OAuthConnectionView>(),
  loading: false,
  reload: vi.fn(),
  saveConfig: vi.fn(),
  clearConfig: vi.fn(),
  startAuthorize: vi.fn(),
  revokeConnection: vi.fn(),
  refreshConnection: vi.fn(),
}));

const { runImmediateSuccessMock, runImmediateFailureMock } = vi.hoisted(() => ({
  runImmediateSuccessMock: vi.fn(),
  runImmediateFailureMock: vi.fn(),
}));

const assignMock = vi.hoisted(() => vi.fn());

vi.mock('@/features/oauth/hooks/useOAuthHub', () => ({
  useOAuthHub: () => oauthHubState,
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

import OAuthSettingsPanel from '../../../features/settings/panels/OAuthSettingsPanel';

const PROVIDER_IDS = ['github', 'wechat', 'douyin', 'xiaohongshu'] as const;

function makeStatus(overrides: Partial<OAuthProviderConfigStatus> = {}): OAuthProviderConfigStatus {
  return {
    provider: 'github',
    displayName: 'GitHub',
    configured: false,
    clientId: '',
    maskedClientSecret: null,
    enabled: true,
    redirectUri: 'https://feedfuse.test/api/oauth/callback/github',
    supportsPkce: true,
    requiresExactRedirectUri: false,
    ...overrides,
  };
}

function makeConnection(overrides: Partial<OAuthConnectionView> = {}): OAuthConnectionView {
  return {
    id: '42',
    provider: 'github',
    status: 'active',
    displayName: 'octocat',
    avatarUrl: null,
    authorizedAt: '2025-03-01T00:00:00.000Z',
    accessTokenExpiresAt: null,
    canRefresh: false,
    ...overrides,
  };
}

function fourUnconfiguredStatuses(): OAuthProviderConfigStatus[] {
  const displayNames: Record<string, string> = {
    github: 'GitHub',
    wechat: '微信',
    douyin: '抖音',
    xiaohongshu: '小红书',
  };
  return PROVIDER_IDS.map((provider) =>
    makeStatus({ provider, displayName: displayNames[provider], configured: false }),
  );
}

function rebuildConnectionMap() {
  oauthHubState.connectionByProvider = new Map(
    oauthHubState.connections.map((connection) => [connection.provider, connection]),
  );
}

describe('OAuthSettingsPanel', () => {
  beforeEach(() => {
    oauthHubState.providers = [];
    oauthHubState.connections = [];
    oauthHubState.connectionByProvider = new Map();
    oauthHubState.loading = false;
    runImmediateSuccessMock.mockReset();
    runImmediateFailureMock.mockReset();
    assignMock.mockReset();
    // jsdom 里 location.assign 会抛「导航未实现」，测试里替换成桩。
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign: assignMock },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('渲染 4 张平台卡片，未配置平台呈「未配置」引导态', async () => {
    oauthHubState.providers = fourUnconfiguredStatuses();
    render(<OAuthSettingsPanel />);

    expect(screen.getByText('三方授权')).toBeInTheDocument();
    for (const name of ['GitHub', '微信', '抖音', '小红书']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    // 四张卡片都是「未连接」。
    expect(screen.getAllByText('未连接')).toHaveLength(4);

    // 未配置 → 授权按钮禁用。
    const authorizeButtons = screen.getAllByRole('button', { name: '去授权' });
    expect(authorizeButtons).toHaveLength(4);
    for (const button of authorizeButtons) {
      expect(button).toBeDisabled();
    }
  });

  it('未配置平台默认展开配置区，可收起再展开', async () => {
    // 单卡片场景：四张都未配置时各自默认展开，收起一张只影响自己。
    oauthHubState.providers = [
      makeStatus({ provider: 'github', displayName: 'GitHub', configured: false }),
    ];
    render(<OAuthSettingsPanel />);

    // 未配置默认展开 → Client ID 输入可见。
    expect(await screen.findByLabelText('Client ID')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '收起应用配置' }));
    expect(screen.queryByLabelText('Client ID')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '展开应用配置' }));
    expect(await screen.findByLabelText('Client ID')).toBeInTheDocument();
  });

  it('已配置平台点击「去授权」→ 跳转 authorizeUrl 并触发开始授权', async () => {
    oauthHubState.providers = [
      makeStatus({ provider: 'github', displayName: 'GitHub', configured: true, clientId: 'Iv1.abcdef', maskedClientSecret: 'abcd****wxyz' }),
      makeStatus({ provider: 'wechat', displayName: '微信', configured: false }),
    ];
    oauthHubState.startAuthorize.mockResolvedValue(
      'https://github.com/login/oauth/authorize?state=abc&code_challenge=xyz&code_challenge_method=S256',
    );

    render(<OAuthSettingsPanel />);

    const authorizeButton = screen.getAllByRole('button', { name: '去授权' })[0];
    expect(authorizeButton).toBeEnabled();
    fireEvent.click(authorizeButton);

    await waitFor(() => {
      expect(oauthHubState.startAuthorize).toHaveBeenCalledWith('github', expect.any(String));
    });
    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith(
        'https://github.com/login/oauth/authorize?state=abc&code_challenge=xyz&code_challenge_method=S256',
      );
    });
  });

  it('撤销连接走 AlertDialog 确认，确认后调用 revokeConnection 并弹成功', async () => {
    const connection = makeConnection({ id: '42', provider: 'github', status: 'active' });
    oauthHubState.providers = [
      makeStatus({ provider: 'github', displayName: 'GitHub', configured: true, clientId: 'Iv1.abcdef', maskedClientSecret: 'abcd****wxyz' }),
    ];
    oauthHubState.connections = [connection];
    rebuildConnectionMap();
    oauthHubState.revokeConnection.mockResolvedValue({ id: '42' });

    render(<OAuthSettingsPanel />);

    expect(screen.getByText('已连接')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '断开' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('确认断开授权连接')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '确认断开' }));

    await waitFor(() => {
      expect(oauthHubState.revokeConnection).toHaveBeenCalledWith('42');
    });
    await waitFor(() => {
      expect(runImmediateSuccessMock).toHaveBeenCalledWith({
        actionKey: 'oauth.connection.revoke',
        context: { displayName: 'GitHub' },
      });
    });
  });

  it('状态徽章：已连接 / 已过期 / 未连接 各自正确呈现', async () => {
    const active = makeConnection({ id: '1', provider: 'github', status: 'active' });
    const expired = makeConnection({ id: '2', provider: 'wechat', status: 'expired', displayName: '微信用户' });
    oauthHubState.providers = fourUnconfiguredStatuses().map((status) =>
      status.provider === 'github'
        ? { ...status, configured: true, clientId: 'Iv1.abcdef', maskedClientSecret: 'abcd****wxyz' }
        : status.provider === 'wechat'
          ? { ...status, configured: true, clientId: 'wx123', maskedClientSecret: 'wx****4567' }
          : status,
    );
    oauthHubState.connections = [active, expired];
    rebuildConnectionMap();

    render(<OAuthSettingsPanel />);

    expect(screen.getByText('已连接')).toBeInTheDocument();
    expect(screen.getByText('已过期')).toBeInTheDocument();
    // douyin / xiaohongshu 无连接 → 未连接（两张）。
    expect(screen.getAllByText('未连接')).toHaveLength(2);
  });

  it('加载中显示占位', async () => {
    oauthHubState.loading = true;
    render(<OAuthSettingsPanel />);
    expect(screen.getByText('加载中…')).toBeInTheDocument();
  });
});
