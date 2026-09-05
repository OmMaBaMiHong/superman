import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('globals.css contract', () => {
  it('uses tailwind v4 import and system-following dark variant', () => {
    const css = readFileSync('src/app/globals.css', 'utf-8');
    expect(css).toContain('@import "tailwindcss";');
    // 液态玻璃双主题：dark: 跟随 prefers-color-scheme，不依赖 .dark 类手动开关
    expect(css).toContain('@custom-variant dark (@media (prefers-color-scheme: dark));');
    expect(css).not.toContain('@custom-variant dark (&:where(.dark');
    expect(css).toContain('@plugin "tailwindcss-animate";');
    expect(css).toContain('--color-background');
    expect(css).toContain('--color-foreground');
    expect(css).toContain('--color-primary');
    expect(css).toContain('--color-ring');
    expect(css).toContain('--color-success');
    expect(css).toContain('--color-success-foreground');
    expect(css).toContain('--color-warning');
    expect(css).toContain('--color-warning-foreground');
    expect(css).toContain('--color-info');
    expect(css).toContain('--color-info-foreground');
    expect(css).toContain('--color-error');
    expect(css).toContain('--color-error-foreground');
    expect(css).toContain('--color-overlay');
    expect(css).toContain('--shadow-button');
    expect(css).toContain('--shadow-button-hover');
    expect(css).toContain('--shadow-field');
    expect(css).toContain('--shadow-surface');
    expect(css).toContain('--shadow-surface-hover');
    expect(css).toContain('--shadow-popover');
    expect(css).toContain('--breakpoint-sm');
    expect(css).toContain('--breakpoint-md');
    expect(css).toContain('--breakpoint-lg');
    expect(css).toContain('--layout-dialog-form-max-width');
    expect(css).toContain('--layout-settings-drawer-max-width');
    expect(css).toContain('--layout-notification-viewport-max-width');
    expect(css).toContain('--layout-notification-viewport-max-width: 20rem');
    expect(css).toContain('--layout-reader-feed-drawer-max-width');
    expect(css).toContain('--layout-reader-tablet-list-max-width');
    expect(css).toContain('--layout-reader-tablet-list-min-width');
    // 浅色优先：苹果灰白底 + 加深 cyan 主色
    expect(css).toContain('--color-background: #f5f5f7');
    expect(css).toContain('--color-foreground: #1d1d1f');
    expect(css).toContain('--color-primary: #0891b2');
    expect(css).toContain('--color-ring: #0891b2');
    expect(css).toContain('--color-muted-foreground: #86868b');
    // 深色：纯黑底 + 提亮 cyan
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain('--color-background: #000000');
    expect(css).toContain('--color-foreground: #f5f5f7');
    expect(css).toContain('--color-primary: #22d3ee');
    expect(css).toContain('--color-muted-foreground: #98989d');
    expect(css).toContain('--reader-pane-hover: color-mix(');
    expect(css).toContain('var(--color-primary)');
    expect(css).toContain('background-attachment: fixed;');
    expect(css).toContain('color-scheme: light;');
    expect(css).toContain('color-scheme: dark;');
    // 旧主题色板不得回归（指挥台深色 / 旧浅色系 / 旧靛蓝 / 旧 emerald）
    expect(css).not.toContain('--color-background: #050810');
    expect(css).not.toContain('--color-background: hsl(210 20% 98%)');
    expect(css).not.toContain('--color-background: hsl(240 15% 3%)');
    expect(css).not.toContain('--color-primary: hsl(221.2 83.2% 53.3%)');
    expect(css).not.toContain('--color-primary: hsl(152 60% 50%)');
    expect(css).not.toContain('--color-ring: hsl(152 60% 50%)');
    expect(css).not.toContain('--color-primary: hsl(221 100% 50%)');
    expect(css).not.toContain('fonts.googleapis.com');
    expect(css).not.toContain('.font-brand');
  });

  it('defines the liquid glass token system for both light and dark themes', () => {
    const css = readFileSync('src/app/globals.css', 'utf-8');

    // 液态玻璃 token：blur(20px) saturate(180%) + 半透明底 + 半透明边框 + 顶部高光
    expect(css).toContain('--glass-bg:');
    expect(css).toContain('--glass-bg-strong:');
    expect(css).toContain('--glass-bg-light:');
    expect(css).toContain('--glass-border:');
    expect(css).toContain('--glass-blur: 20px');
    expect(css).toContain('--glass-blur-strong: 28px');
    expect(css).toContain('--glass-saturate: 180%');
    expect(css).toContain('--glass-highlight:');
    expect(css).toContain('--glass-topline:');
    expect(css).toContain('--shadow-glass:');
    expect(css).toContain('--shadow-glow:');

    // 浅色玻璃：半透明白 + 黑色发丝边框 + 白色顶部高光
    const rootBlock = css.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    expect(rootBlock).toContain('--glass-bg: rgba(255, 255, 255, 0.7)');
    expect(rootBlock).toContain('--glass-border: rgba(0, 0, 0, 0.08)');
    expect(rootBlock).toContain('--glass-highlight: rgba(255, 255, 255, 0.6)');

    // 深色玻璃：rgba(28,28,30) + 白色发丝边框 + 弱高光
    const darkBlock =
      css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([\s\S]*?)\}\s*\}/)?.[1] ??
      '';
    expect(darkBlock).toContain('--glass-bg: rgba(28, 28, 30, 0.65)');
    expect(darkBlock).toContain('--glass-border: rgba(255, 255, 255, 0.14)');
    expect(darkBlock).toContain('--glass-highlight: rgba(255, 255, 255, 0.1)');
  });

  it('defines .glass-surface semantic classes with full glass recipe', () => {
    const css = readFileSync('src/app/globals.css', 'utf-8');

    expect(css).toContain('.glass-surface {');
    expect(css).toContain('-webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));');
    expect(css).toContain('backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));');
    expect(css).toContain('box-shadow: var(--shadow-glass), inset 0 1px 0 var(--glass-highlight);');
    expect(css).toContain('.glass-surface::before');
    expect(css).toContain('.glass-surface-strong {');
    expect(css).toContain('.glass-surface-light {');
  });

  it('uses subtle cyan ambient glow on the body for both themes', () => {
    const css = readFileSync('src/app/globals.css', 'utf-8');

    // 浅色/深色 body 均为极淡 cyan 顶部光晕（让玻璃有可模糊的底）
    expect(css).toContain('rgb(8 145 178 / 0.05)');
    expect(css).toContain('rgb(34 211 238 / 0.05)');
    // 旧 emerald 光斑与指挥台深底光斑不得回归
    expect(css).not.toContain('rgb(16 185 129 / 0.14)');
    expect(css).not.toContain('rgb(16 185 129 / 0.08)');
  });

  it('does not balance-wrap heading text', () => {
    const css = readFileSync('src/app/globals.css', 'utf-8');
    const headingRuleMatch = css.match(/:where\(h1, h2, h3, h4, h5, h6\)\s*\{([\s\S]*?)\}/);

    expect(headingRuleMatch?.[1]).toBeDefined();
    expect(headingRuleMatch?.[1]).not.toContain('text-wrap: balance;');
  });

  it('keeps reduced-motion downgrade for all animations', () => {
    const css = readFileSync('src/app/globals.css', 'utf-8');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('animation-duration: 0.01ms !important');
    expect(css).toContain('transition-duration: 0.01ms !important');
  });
});
