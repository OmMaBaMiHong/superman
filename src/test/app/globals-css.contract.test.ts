import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('globals.css contract', () => {
  it('uses tailwind v4 import and class-based dark variant', () => {
    const css = readFileSync('src/app/globals.css', 'utf-8');
    expect(css).toContain('@import "tailwindcss";');
    expect(css).toContain('@custom-variant dark (&:where(.dark, .dark *));');
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
    // 「情报指挥中心」深色单主题：基底 / 面板 / cyan 主色。
    expect(css).toContain('--color-background: #050810');
    expect(css).toContain('--color-card: #0c1220');
    expect(css).toContain('--color-popover: #111a2b');
    expect(css).toContain('--color-primary: #22d3ee');
    expect(css).toContain('--color-ring: #22d3ee');
    expect(css).toContain('--color-accent: #16213a');
    expect(css).toContain('--color-border: #1a2540');
    expect(css).toContain('--color-muted-foreground: #8b94a7');
    expect(css).toContain('--reader-pane-hover: color-mix(');
    expect(css).toContain('var(--color-primary) 9%');
    expect(css).toContain('var(--color-card)');
    expect(css).toContain('background-attachment: fixed;');
    // 深色单主题：html 直接声明 color-scheme: dark。
    expect(css).toContain('color-scheme: dark;');
    expect(css).not.toContain('--color-background: hsl(0 0% 100%)');
    expect(css).not.toContain('--color-background: hsl(210 20% 98%)');
    expect(css).not.toContain('--color-background: hsl(240 15% 3%)');
    expect(css).not.toContain('--color-primary: hsl(221.2 83.2% 53.3%)');
    expect(css).not.toContain('--color-background: hsl(222.2 84% 4.9%)');
    expect(css).not.toContain('--color-primary: hsl(217.2 91.2% 59.8%)');
    expect(css).not.toContain('--color-background: hsl(42 35% 96%)');
    expect(css).not.toContain('--color-primary: hsl(224 54% 42%)');
    expect(css).not.toContain('--color-accent: hsl(221 37% 92%)');
    // 旧靛蓝主色与旧 emerald 主色都必须彻底移除（指挥台铁律：主色 cyan）。
    expect(css).not.toContain('--color-primary: hsl(221 100% 50%)');
    expect(css).not.toContain('--color-ring: hsl(221 100% 50%)');
    expect(css).not.toContain('--color-primary: hsl(234 56% 60%)');
    expect(css).not.toContain('--color-ring: hsl(234 56% 60%)');
    expect(css).not.toContain('--color-primary: hsl(152 60% 50%)');
    expect(css).not.toContain('--color-ring: hsl(152 60% 50%)');
    expect(css).not.toContain('fonts.googleapis.com');
    expect(css).not.toContain('.font-brand');
  });

  it('defines the glass token system on the dark mission-control theme', () => {
    const css = readFileSync('src/app/globals.css', 'utf-8');

    // 面板 token（ui-style-guide §1.2 / arch-ui-integration §1.3.2）。
    expect(css).toContain('--glass-bg:');
    expect(css).toContain('--glass-bg-strong:');
    expect(css).toContain('--glass-bg-light:');
    expect(css).toContain('--glass-border:');
    expect(css).toContain('--glass-blur: 16px');
    expect(css).toContain('--glass-blur-strong: 24px');
    expect(css).toContain('--glass-saturate: 140%');
    expect(css).toContain('--glass-highlight:');
    expect(css).toContain('--glass-topline:');
    expect(css).toContain('--shadow-glass:');
    expect(css).toContain('--shadow-glow:');

    // 深色单主题：面板 token 统一定义在 :root；.dark 仅保留 color-scheme 兼容声明。
    const rootBlock = css.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    expect(rootBlock).toContain('--glass-bg: rgba(12, 18, 32, 0.55)');
    expect(rootBlock).toContain('--shadow-glass: 0 8px 32px rgba(0, 0, 0, 0.4)');
    expect(rootBlock).toContain('--shadow-glow:');
    expect(rootBlock).toContain('rgba(34, 211, 238, 0.28)');
    const darkBlock = css.match(/\.dark\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    expect(darkBlock).toContain('color-scheme: dark;');
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

  it('uses subtle cyan ambient glow (≤0.03) on the dark body', () => {
    const css = readFileSync('src/app/globals.css', 'utf-8');

    // 指挥台 body：极轻微 cyan 径向纵深，透明度 ≤0.03；旧 emerald 光斑不得回归。
    expect(css).toContain('rgb(34 211 238 / 0.03)');
    expect(css).toContain('rgb(34 211 238 / 0.02)');
    expect(css).not.toContain('rgb(16 185 129 / 0.14)');
    expect(css).not.toContain('rgb(16 185 129 / 0.08)');
  });

  it('does not balance-wrap heading text', () => {
    const css = readFileSync('src/app/globals.css', 'utf-8');
    const headingRuleMatch = css.match(/:where\(h1, h2, h3, h4, h5, h6\)\s*\{([\s\S]*?)\}/);

    expect(headingRuleMatch?.[1]).toBeDefined();
    expect(headingRuleMatch?.[1]).not.toContain('text-wrap: balance;');
  });

  it('keeps muted foreground restrained on the dark palette', () => {
    const css = readFileSync('src/app/globals.css', 'utf-8');

    // 次要文字统一 #8b94a7（指挥台色系派生），浅色 muted 值不得回归。
    expect(css).toContain('--color-muted-foreground: #8b94a7');
    expect(css).not.toContain('--color-muted-foreground: hsl(215 16% 47%)');
    expect(css).not.toContain('--color-muted-foreground: hsl(226 8% 58%)');
  });
});
