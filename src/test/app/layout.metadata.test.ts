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

    // themeColor 必须与 globals.css 的 --color-background 同步：浅色 #f5f5f7，深色 #000000。
    expect(source).toContain("{ media: '(prefers-color-scheme: light)', color: '#f5f5f7' }");
    expect(source).toContain("{ media: '(prefers-color-scheme: dark)', color: '#000000' }");
    expect(source).not.toContain("color: '#ffffff'");
    expect(source).not.toContain("color: '#050810'");
    expect(source).not.toContain("color: '#f9fafb'");
    expect(source).not.toContain("color: '#070709'");
    // 旧配色不得回归（液态玻璃铁律：浅色优先苹果灰白）。
    expect(source).not.toContain("color: '#111a30'");
    expect(source).not.toContain("color: '#f6f7f8'");
  });
});
