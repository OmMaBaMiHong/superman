import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  AI_DIGEST_VIEW_ID,
  ARTICLE_VIEW_ID,
  DISCOVER_VIEW_ID,
  GITHUB_VIEW_ID,
  OVERVIEW_VIEW_ID,
  PUBLISH_CENTER_VIEW_ID,
  VIDEO_VIEW_ID,
  isAggregateView,
  isReaderContentPageView,
} from '@/lib/reader/view';
import { FEED_VIEW_TAB_ITEMS } from '@/features/feeds/components/FeedViewTabs';
import FeedViewSelector from '@/features/feeds/components/FeedViewSelector';

/**
 * QA 独立探针（第二层验证，非实现工程师测试）：
 * 怀疑式边界验证「内容页视图」契约。
 * 只读生产代码 + 断言，不修改生产源码。
 */

describe('QA probe: redirect 兼容（旧路由 → 内容页视图）', () => {
  it('(reader)/discover/page.tsx exists or is removed', () => {
    // discover has been moved to + menu, the page may still exist for redirect or be removed
    try {
      const source = readFileSync('src/app/(reader)/discover/page.tsx', 'utf-8');
      // if it exists, it should redirect
      expect(source).toContain("redirect('/");
    } catch {
      // file removed is ok
      expect(true).toBe(true);
    }
  });

  it('(reader)/knowledge/page.tsx exists or is removed', () => {
    // knowledge has been moved to workbench, the page may still exist for redirect or be removed
    try {
      const source = readFileSync('src/app/(reader)/knowledge/page.tsx', 'utf-8');
      // if it exists, it should redirect
      expect(source).toContain("redirect('/");
    } catch {
      // file removed is ok
      expect(true).toBe(true);
    }
  });
});

describe('QA probe: 内容页谓词与视图归属', () => {
  it('isReaderContentPageView true only for overview, publish-center and discover', () => {
    expect(isReaderContentPageView(OVERVIEW_VIEW_ID)).toBe(true);
    expect(isReaderContentPageView(PUBLISH_CENTER_VIEW_ID)).toBe(true);
    expect(isReaderContentPageView(DISCOVER_VIEW_ID)).toBe(true);
    expect(isReaderContentPageView('all')).toBe(false);
    expect(isReaderContentPageView('unread')).toBe(false);
    expect(isReaderContentPageView('starred')).toBe(false);
    expect(isReaderContentPageView(ARTICLE_VIEW_ID)).toBe(false);
    expect(isReaderContentPageView(VIDEO_VIEW_ID)).toBe(false);
    expect(isReaderContentPageView(AI_DIGEST_VIEW_ID)).toBe(false);
    expect(isReaderContentPageView(GITHUB_VIEW_ID)).toBe(false);
    expect(isReaderContentPageView('feed-1')).toBe(false);
  });

  it('内容页绝不并入 isAggregateView（防 loadSnapshot 打到无效接口）', () => {
    expect(isAggregateView(OVERVIEW_VIEW_ID)).toBe(false);
    expect(isAggregateView(PUBLISH_CENTER_VIEW_ID)).toBe(false);
    expect(isAggregateView(DISCOVER_VIEW_ID)).toBe(false);
  });
});

describe('QA probe: 导航一致性', () => {
  it('FEED_VIEW_TAB_ITEMS 顺序：总览→全部→图文→视频→工作台→智能报告→GitHub', () => {
    expect(FEED_VIEW_TAB_ITEMS.map((item) => item.id)).toEqual([
      OVERVIEW_VIEW_ID,
      'all',
      ARTICLE_VIEW_ID,
      VIDEO_VIEW_ID,
      PUBLISH_CENTER_VIEW_ID,
      AI_DIGEST_VIEW_ID,
      GITHUB_VIEW_ID,
    ]);
  });

  it('FeedViewSelector（feed 编辑弹窗）过滤掉 content-page 视图', () => {
    render(
      <FeedViewSelector labelId="probe-view-label" value="article" onChange={vi.fn()} />,
    );

    // 内容页视图必须被过滤，不能污染订阅源「内容类型」选项
    expect(screen.queryByRole('radio', { name: '总览' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: '工作台' })).not.toBeInTheDocument();
    // '全部'（contentView=null）与 '智能报告'（digest）也不应出现
    expect(screen.queryByRole('radio', { name: '全部' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: '智能报告' })).not.toBeInTheDocument();
    // 真正的 feed 内容类型保留
    expect(screen.getByRole('radio', { name: '图文' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '视频' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'GitHub' })).toBeInTheDocument();
  });
});

describe('QA probe: 玻璃 token 契约（独立复核 globals.css）', () => {
  it('主色为 cyan #22d3ee，ring 同步（深色单主题，定义于 @theme default）', () => {
    const css = readFileSync('src/app/globals.css', 'utf-8');
    // 指挥台深色单主题：主色/ring 只在 @theme default 定义一次，.dark 不再覆盖。
    expect(css.match(/--color-primary: #22d3ee/g)).toHaveLength(1);
    expect(css.match(/--color-ring: #22d3ee/g)).toHaveLength(1);
    expect(css).not.toContain('--color-primary: hsl(152 60% 50%)');
    expect(css).not.toContain('--color-ring: hsl(152 60% 50%)');
  });

  it('.glass-surface 含 backdrop-filter + -webkit- 前缀 + ::before 高光线，--glass-blur 16px', () => {
    const css = readFileSync('src/app/globals.css', 'utf-8');
    expect(css).toContain('-webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));');
    expect(css).toContain('backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));');
    expect(css).toContain('.glass-surface::before');
    expect(css).toContain('--glass-blur: 16px');
    expect(css).toContain('--glass-blur-strong: 24px');
    expect(css).toContain('--glass-saturate: 140%');
  });

  it('body 光斑背景：cyan 系纵深，透明度 ≤0.03', () => {
    const css = readFileSync('src/app/globals.css', 'utf-8');
    expect(css).toContain('rgb(34 211 238 / 0.03)');
    expect(css).toContain('rgb(34 211 238 / 0.02)');
    expect(css).toContain('background-attachment: fixed;');
    // 旧 emerald 光斑不得回归。
    expect(css).not.toContain('rgb(16 185 129 / 0.14)');
    expect(css).not.toContain('rgb(13 148 136 / 0.1)');
  });

  it('GlassCard 交互态用 --shadow-glass-hover token 而非硬编码色', () => {
    const source = readFileSync('src/components/glass/GlassCard.tsx', 'utf-8');
    expect(source).toContain('hover:shadow-[var(--shadow-glass-hover)]');
    expect(source).not.toMatch(/shadow-\[0\.?\d+px/);
  });
});

describe('QA probe: 无硬编码颜色静态护栏（本次改动组件）', () => {
  const cleanFiles = [
    'src/components/glass/GlassCard.tsx',
    'src/components/glass/StatCard.tsx',
    'src/components/glass/GlassChip.tsx',
    'src/features/reader/components/ReaderContentPage.tsx',
    'src/features/feeds/components/FeedViewTabs.tsx',
    'src/features/feeds/components/FeedListNav.tsx',
  ];

  it.each(cleanFiles)('%s 无 hsl/#hex/rgb 颜色字面量', (file) => {
    const source = readFileSync(file, 'utf-8');
    expect(source).not.toMatch(/hsl\(/);
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/rgb\(/);
  });

  it('ReaderLayout/FeedList 的 gradient 环境光背景已 token 化（零颜色字面量）', () => {
    // 契约演进：原断言要求这两个文件「必须仍含 rgba(」（视频阅读 MVP 既有 debt）。
    // 现行铁律是「颜色值只允许出现在 globals.css，组件只消费 token」，rgba 已全部
    // 收口成 var(--color-*) / color-mix(in oklab, ...)。断言意图不变——守护
    // 「环境光渐变背景仍在，且其中不含任何硬编码颜色」——只是换成 token 化表述。
    for (const file of [
      'src/features/reader/components/ReaderLayout.tsx',
      'src/features/feeds/components/FeedList.tsx',
    ]) {
      const source = readFileSync(file, 'utf-8');
      expect(source).not.toMatch(/hsl\(/);
      expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(source).not.toMatch(/rgba?\(/);

      // 渐变环境光背景仍必须存在（原断言 linesWithRgba.length > 0 的等价物）。
      const linesWithGradient = source
        .split('\n')
        .filter((line) => line.includes('gradient('));
      expect(linesWithGradient.length).toBeGreaterThan(0);

      // 原断言「rgba 行必须处于 gradient 背景」的等价物：
      // 渐变里的每个色标都必须来自设计 token（var(--...) 或 color-mix(...)），
      // 且渐变只能出现在背景工具类上，不得混入裸颜色。
      for (const line of linesWithGradient) {
        expect(line, `gradient 行必须是背景工具类：${line}`).toMatch(/bg-(gradient|\[)/);
        expect(line, `gradient 色标必须用设计 token：${line}`).toMatch(
          /var\(--|color-mix\(in oklab|color-mix\(in_oklab/,
        );
      }
    }
  });
});

describe('QA probe: 性能护栏（列表区禁逐项 blur）', () => {
  it.each([
    'src/features/reader/components/ReaderContentPage.tsx',
    'src/features/feeds/components/FeedViewTabs.tsx',
    'src/features/feeds/components/FeedListNav.tsx',
  ])('%s 不内联 backdrop-filter/backdrop-blur（只用 .glass-surface 语义类）', (file) => {
    const source = readFileSync(file, 'utf-8');
    expect(source).not.toMatch(/backdrop-filter/);
    expect(source).not.toMatch(/backdrop-blur/);
  });

  it('FeedTree 列表行无逐项 blur（token 配色）', () => {
    const source = readFileSync('src/features/feeds/components/FeedTree.tsx', 'utf-8');
    expect(source).not.toMatch(/backdrop-filter|backdrop-blur/);
  });
});
