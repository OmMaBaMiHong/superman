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
    expect(css).toContain('--color-background: hsl(210 20% 98%)');
    expect(css).toContain('--color-card: hsl(0 0% 100%)');
    // 用户铁律：青绿主色，浅色/深色同值 hsl(152 60% 50%)。
    expect(css).toContain('--color-primary: hsl(152 60% 50%)');
    expect(css).toContain('--color-accent: hsl(214 100% 96%)');
    expect(css).toContain('--color-ring: hsl(152 60% 50%)');
    expect(css).toContain('--reader-pane-hover: color-mix(');
    expect(css).toContain('var(--color-primary) 9%');
    expect(css).toContain('var(--color-card)');
    expect(css).toContain('--color-background: hsl(240 15% 3%)');
    expect(css).toContain('--color-primary: hsl(152 60% 50%)');
    expect(css).toContain('--reader-pane-hover: color-mix(');
    expect(css).toContain('.dark body {');
    expect(css).toContain('background-attachment: fixed;');
    expect(css).not.toContain('--color-background: hsl(0 0% 100%)');
    expect(css).not.toContain('--color-primary: hsl(221.2 83.2% 53.3%)');
    expect(css).not.toContain('--color-background: hsl(222.2 84% 4.9%)');
    expect(css).not.toContain('--color-primary: hsl(217.2 91.2% 59.8%)');
    expect(css).not.toContain('--color-background: hsl(42 35% 96%)');
    expect(css).not.toContain('--color-primary: hsl(224 54% 42%)');
    expect(css).not.toContain('--color-accent: hsl(221 37% 92%)');
    // 旧靛蓝主色必须彻底移除（用户铁律：改青绿）。
    expect(css).not.toContain('--color-primary: hsl(221 100% 50%)');
    expect(css).not.toContain('--color-ring: hsl(221 100% 50%)');
    expect(css).not.toContain('--color-primary: hsl(234 56% 60%)');
    expect(css).not.toContain('--color-ring: hsl(234 56% 60%)');
    expect(css).not.toContain('fonts.googleapis.com');
    expect(css).not.toContain('.font-brand');
  });

  it('defines the glass token system for both light and dark themes', () => {
    const css = readFileSync('src/app/globals.css', 'utf-8');

    // 玻璃 token（ui-style-guide §1.2 / arch-ui-integration §1.3.2）。
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
    expect(css).toContain('--font-mono:');
    expect(css).toContain('ui-monospace');

    // 浅色/深色两套都定义（默认①：浅色同样玻璃化）。
    const rootBlock = css.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    const darkBlock = css.match(/\.dark\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    expect(rootBlock).toContain('--glass-bg:');
    expect(rootBlock).toContain('--shadow-glass:');
    expect(darkBlock).toContain('--glass-bg: rgba(255, 255, 255, 0.04)');
    expect(darkBlock).toContain('--shadow-glass: 0 8px 32px rgba(0, 0, 0, 0.35)');
    expect(darkBlock).toContain('--shadow-glow:');
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

  it('uses emerald ambient glow on dark body and light body', () => {
    const css = readFileSync('src/app/globals.css', 'utf-8');

    // 深色 body：emerald 微光替换旧 indigo（ui-style-guide §1.2）。
    expect(css).toContain('rgb(16 185 129 / 0.14)');
    expect(css).toContain('rgb(13 148 136 / 0.1)');
    expect(css).toContain('rgb(5 150 105 / 0.08)');
    // 浅色 body：极淡 emerald 顶部光斑（默认①：浅色同样有可模糊的底）。
    expect(css).toContain('rgb(16 185 129 / 0.08)');
  });

  it('does not balance-wrap heading text', () => {
    const css = readFileSync('src/app/globals.css', 'utf-8');
    const headingRuleMatch = css.match(/:where\(h1, h2, h3, h4, h5, h6\)\s*\{([\s\S]*?)\}/);

    expect(headingRuleMatch?.[1]).toBeDefined();
    expect(headingRuleMatch?.[1]).not.toContain('text-wrap: balance;');
  });

  it('keeps muted foreground restrained while tightening contrast slightly', () => {
    const css = readFileSync('src/app/globals.css', 'utf-8');

    expect(css).toContain('--color-muted-foreground: hsl(215 16% 47%)');
    expect(css).toContain('--color-muted-foreground: hsl(226 8% 58%)');
  });
});
