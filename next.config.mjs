/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: [
    'rsshub',
    '@whisper-cpp-node/core',
    '@whisper-cpp-node/darwin-arm64',
  ],
  // Next.js 仅支持在项目根读取 next.config，这里保留唯一根配置入口。
  poweredByHeader: false,
  // 关闭 Next.js 开发调试浮层（Route/Bundler 等），避免干扰应用自身 UI。
  devIndicators: false,
  experimental: {
    // 对高频图标库做按需导入重写，减少客户端打包体积。
    optimizePackageImports: ['lucide-react'],
  },
  typescript: {
    // 将 TypeScript 主配置迁移到 config 目录，避免根目录散落配置文件。
    tsconfigPath: 'config/typescript/tsconfig.json',
  },
  webpack: (config, { dev }) => {
    if (dev) {
      // 开发模式下忽略 vendor/rsshub 目录的文件监听：它是外部依赖（serverExternalPackages），
      // 不会被 webpack 编译，但 watcher 仍会扫整个目录，改动任意文件都会触发全量重编译，
      // 导致「每次刷新卡半天」。排除后可显著加快 dev 热更新。
      // 注意：Next 冻结了 config.watchOptions，需重建对象再赋值。
      const watchOptions = { ...config.watchOptions };
      const ignored = Array.isArray(watchOptions.ignored) ? [...watchOptions.ignored] : [];
      watchOptions.ignored = [...ignored, '**/vendor/rsshub/**'];
      config.watchOptions = watchOptions;
    }
    return config;
  },
};

export default nextConfig;
