import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import ServiceWorkerRegister from '@/components/pwa/ServiceWorkerRegister';
import './globals.css';

// 阅读正文：Inter；UI chrome / 标签 / 数字：JetBrains Mono（300-700）。
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Superman',
  description: 'Modern RSS reader',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Superman',
  },
  icons: {
    icon: [
      { url: '/feedfuse-icon-16.svg', sizes: '16x16', type: 'image/svg+xml' },
      { url: '/feedfuse-icon-32.svg', sizes: '32x32', type: 'image/svg+xml' },
      { url: '/feedfuse-icon-64.svg', sizes: '64x64', type: 'image/svg+xml' },
      { url: '/feedfuse-icon-128.svg', sizes: '128x128', type: 'image/svg+xml' }
    ],
    shortcut: '/feedfuse-icon-32.svg',
    apple: '/pwa-icon-192.png'
  }
};

export const viewport: Viewport = {
  themeColor: [
    // 浏览器 UI 主题色：Next.js metadata 要求字面量，无法引用 CSS 变量（token 铁律的合理豁免）。
    // 取值必须与 globals.css 的 --color-background 同步：指挥台深色基底 #050810。
    { media: '(prefers-color-scheme: light)', color: '#050810' },
    { media: '(prefers-color-scheme: dark)', color: '#050810' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body>
        <ServiceWorkerRegister />
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
