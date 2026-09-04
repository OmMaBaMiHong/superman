import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('layout metadata contract', () => {
  it('moves themeColor from metadata export to viewport export', () => {
    const source = readFileSync('src/app/layout.tsx', 'utf-8');
    const metadataStart = source.indexOf('export const metadata');
    const viewportStart = source.indexOf('export const viewport');

    expect(viewportStart).toBeGreaterThan(metadataStart);
    expect(source).toContain('themeColor');
    expect(source).toContain('export const viewport');

    const metadataBlock = source.slice(metadataStart, viewportStart);
    expect(metadataBlock).not.toContain('themeColor');
  });

  it('aligns viewport themeColor with the semantic page background', () => {
    const source = readFileSync('src/app/layout.tsx', 'utf-8');

    // themeColor 必须与 globals.css 的 --color-background 同步：
    // 浅色 hsl(210 20% 98%) ≈ #f9fafb，深色 hsl(240 15% 3%) ≈ #070709。
    expect(source).toContain("color: '#f9fafb'");
    expect(source).toContain("color: '#070709'");
    expect(source).not.toContain("color: '#ffffff'");
    expect(source).not.toContain("color: '#f8f6f1'");
    expect(source).not.toContain("color: '#020817'");
    // 旧靛蓝配色不得回归（用户铁律：主色青绿，背景不带蓝调）。
    expect(source).not.toContain("color: '#111a30'");
    expect(source).not.toContain("color: '#f6f7f8'");
  });
});
