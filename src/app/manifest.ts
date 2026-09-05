import type { MetadataRoute } from 'next';

/** PWA manifest：指挥台深色基底，可「添加到主屏幕」。 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Superman 情报指挥中心',
    short_name: 'Superman',
    description: '个人创作指挥中心：RSS 阅读、AI 审批台、热点雷达',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#050810',
    theme_color: '#050810',
    icons: [
      { src: '/pwa-icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/pwa-icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/pwa-icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
