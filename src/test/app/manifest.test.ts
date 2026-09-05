import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import manifest from '../../app/manifest';

describe('PWA 落地契约', () => {
  it('manifest 提供指挥台主题色与主屏幕图标', () => {
    const result = manifest();

    expect(result.name).toContain('Superman');
    expect(result.display).toBe('standalone');
    expect(result.start_url).toBe('/');
    // theme-color 硬要求：浅色优先，与 globals.css --color-background 同步
    expect(result.theme_color).toBe('#f5f5f7');
    expect(result.background_color).toBe('#f5f5f7');

    const icons = result.icons ?? [];
    expect(icons.length).toBeGreaterThanOrEqual(3);
    expect(icons.some((icon) => icon.src === '/pwa-icon-192.png')).toBe(true);
    expect(icons.some((icon) => icon.src === '/pwa-icon-512.png')).toBe(true);
    expect(icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });

  it('service worker 存在且不缓存 /api/', () => {
    const sw = readFileSync('public/sw.js', 'utf-8');

    expect(sw).toContain("self.addEventListener('install'");
    expect(sw).toContain("self.addEventListener('fetch'");
    // API 请求（含登录态）必须直达网络
    expect(sw).toContain("url.pathname.startsWith('/api/')");
    expect(sw).toContain("request.method !== 'GET'");
  });

  it('PWA 图标文件已生成且非空', () => {
    for (const file of ['public/pwa-icon-192.png', 'public/pwa-icon-512.png', 'public/pwa-icon-maskable-512.png']) {
      const content = readFileSync(file);
      // PNG magic number
      expect(content[0]).toBe(0x89);
      expect(content[1]).toBe(0x50);
      expect(content.length).toBeGreaterThan(500);
    }
  });
});
