import { beforeEach, describe, expect, it, vi } from 'vitest';

const listUsersMock = vi.fn();
const getUiSettingsMock = vi.fn();
const deleteExpiredSystemLogsMock = vi.fn();

vi.mock('@/core/auth/usersRepo', () => ({
  listUsers: (...args: unknown[]) => listUsersMock(...args),
}));

vi.mock('@/server/domains/settings/repositories/settingsRepo', () => ({
  getUiSettings: (...args: unknown[]) => getUiSettingsMock(...args),
}));

vi.mock('@/server/domains/settings/repositories/systemLogsRepo', () => ({
  deleteExpiredSystemLogs: (...args: unknown[]) => deleteExpiredSystemLogsMock(...args),
}));

describe('systemLogCleanup', () => {
  beforeEach(() => {
    listUsersMock.mockReset();
    getUiSettingsMock.mockReset();
    deleteExpiredSystemLogsMock.mockReset();
  });

  it('cleans expired logs with per-user retentionDays plus default system scope', async () => {
    listUsersMock.mockResolvedValue([{ id: '2' }, { id: '3' }]);
    getUiSettingsMock
      .mockResolvedValueOnce({ logging: { enabled: false, retentionDays: 30 } })
      .mockResolvedValueOnce({ logging: { enabled: false, retentionDays: 14 } });
    deleteExpiredSystemLogsMock
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);

    const mod = await import('../../worker/systemLogCleanup');
    const deletedCount = await mod.runSystemLogCleanup({ pool: {} as never });

    expect(deleteExpiredSystemLogsMock.mock.calls).toEqual([
      [expect.anything(), { retentionDays: 7, userId: null }],
      [expect.anything(), { retentionDays: 30, userId: '2' }],
      [expect.anything(), { retentionDays: 14, userId: '3' }],
    ]);
    expect(deletedCount).toBe(6);
  });

  it('reads cleanup settings from each user instead of default admin fallback', async () => {
    const pool = {} as never;
    listUsersMock.mockResolvedValue([{ id: '2' }]);
    getUiSettingsMock.mockResolvedValue({ logging: { enabled: false, retentionDays: 14 } });
    deleteExpiredSystemLogsMock.mockResolvedValue(0);

    const mod = await import('../../worker/systemLogCleanup');
    await mod.runSystemLogCleanup({ pool });

    expect(getUiSettingsMock).toHaveBeenCalledWith(pool, '2');
  });
});
