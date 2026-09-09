import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from '@/h5/pages/SettingsPage';

const api = vi.hoisted(() => ({ getAiModelSettings: vi.fn(), saveAiModelSettings: vi.fn(), listFreeModels: vi.fn(), testFreeModel: vi.fn() }));
vi.mock('@/lib/api/apiClient', () => api);
vi.mock('@/h5/components/PlatformAccountsPanel', () => ({ default: () => null }));
vi.mock('@/features/mobile/components/MobileTabBar', () => ({ default: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  api.getAiModelSettings.mockResolvedValue({ providerMode: 'configured', freeModel: 'openrouter/free' });
  api.listFreeModels.mockResolvedValue({ items: [{ id: 'openrouter/free', name: '免费自动选择' }, { id: 'a/model:free', name: '免费模型 A' }] });
  api.saveAiModelSettings.mockImplementation(async (value) => value);
  api.testFreeModel.mockResolvedValue({ text: 'OK', model: 'a/model:free' });
});

describe('free model settings UI', () => {
  it('loads dynamic options, tests without saving and saves the explicit selection', async () => {
    render(<SettingsPage username="wade" />);
    const mode = await screen.findByLabelText('模型来源');
    fireEvent.change(mode, { target: { value: 'kilo-free' } });
    fireEvent.change(await screen.findByLabelText('免费模型'), { target: { value: 'a/model:free' } });
    fireEvent.click(screen.getByRole('button', { name: '测试免费模型' }));
    await screen.findByText(/连接成功/);
    expect(api.saveAiModelSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存模型设置' }));
    await waitFor(() => expect(api.saveAiModelSettings).toHaveBeenCalledWith({ providerMode: 'kilo-free', freeModel: 'a/model:free' }));
  });
  it('keeps a visible retry action when model loading fails', async () => {
    api.listFreeModels.mockRejectedValue(new Error('免费模型目录暂不可用'));
    render(<SettingsPage username="wade" />);
    fireEvent.change(await screen.findByLabelText('模型来源'), { target: { value: 'kilo-free' } });
    await screen.findByText('免费模型目录暂不可用');
    expect(screen.getByRole('button', { name: '刷新模型列表' })).toBeEnabled();
  });
});
