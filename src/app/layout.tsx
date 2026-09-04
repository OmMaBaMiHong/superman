import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FeedFuse',
  description: 'Modern RSS reader',
  icons: {
    icon: [
      { url: '/feedfuse-icon-16.svg', sizes: '16x16', type: 'image/svg+xml' },
      { url: '/feedfuse-icon-32.svg', sizes: '32x32', type: 'image/svg+xml' },
      { url: '/feedfuse-icon-64.svg', sizes: '64x64', type: 'image/svg+xml' },
      { url: '/feedfuse-icon-128.svg', sizes: '128x128', type: 'image/svg+xml' }
    ],
    shortcut: '/feedfuse-icon-32.svg',
    apple: '/feedfuse-icon-128.svg'
  }
};

export const viewport: Viewport = {
  themeColor: [
    // 浏览器 UI 主题色：Next.js metadata 要求字面量，无法引用 CSS 变量（token 铁律的合理豁免）。
    // 取值必须与 globals.css 的 --color-background 同步：
    // 浅色 hsl(210 20% 98%) ≈ #f9fafb；深色 hsl(240 15% 3%) ≈ #070709（旧靛蓝 #111a30 已废弃）。
    { media: '(prefers-color-scheme: light)', color: '#f9fafb' },
    { media: '(prefers-color-scheme: dark)', color: '#070709' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <a
          href="#main-content"
          className="sr-only fixed left-3 top-3 z-[120] rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground focus:not-sr-only focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          跳转到主要内容
        </a>
        <main id="main-content">{children}</main>
      </body>
    </html>
  );
}
