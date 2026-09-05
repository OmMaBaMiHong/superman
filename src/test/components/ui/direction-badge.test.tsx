import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DirectionBadge from '../../../components/ui/direction-badge';

vi.mock('@/lib/api/apiClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/apiClient')>();
  return {
    ...original,
    listDirections: vi.fn(async () => ({
      items: [
        {
          id: '1', userId: '1', key: 'topic', name: '选题', color: '#ef4444', icon: '🔥',
          keywordsDsl: '', aiHint: '热点素材', quotaWeight: 40, enabled: true, sort: 10, builtin: true,
        },
        {
          id: '2', userId: '1', key: 'money', name: '搞钱', color: '#f59e0b', icon: '💰',
          keywordsDsl: '', aiHint: '商机灵感', quotaWeight: 30, enabled: true, sort: 20, builtin: true,
        },
      ],
    })),
  };
});

describe('DirectionBadge（P2b 方向徽章）', () => {
  it('模板命中：显示 icon + 名称 + 模板色', async () => {
    render(<DirectionBadge directionKey="topic" reason="命中关键词：热搜" />);

    const badge = screen.getByTestId('direction-badge');
    await waitFor(() => {
      expect(badge).toHaveTextContent('🔥 选题');
    });
    expect(badge.getAttribute('data-direction')).toBe('topic');
    expect(badge.style.color).toBe('rgb(239, 68, 68)'); // #ef4444，不做主题映射
    expect(badge.getAttribute('title')).toBe('命中关键词：热搜');
  });

  it('null（存量未分类）：灰色「未分类」徽章', () => {
    render(<DirectionBadge directionKey={null} />);

    const badge = screen.getByTestId('direction-badge');
    expect(badge).toHaveTextContent('未分类');
    expect(badge.getAttribute('data-direction')).toBeNull();
  });

  it('模板表外的 key（已删除模板）：灰底兜底显示 raw key', async () => {
    render(<DirectionBadge directionKey="legacy_key" />);

    const badge = screen.getByTestId('direction-badge');
    await waitFor(() => {
      expect(badge).toHaveTextContent('legacy_key');
    });
  });
});
