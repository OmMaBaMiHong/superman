#!/usr/bin/env node
/**
 * 构建 Superman DSH 插件产物（dist/plugin）：
 *   1. esbuild 把 host 半入口（src/plugin/host/index.ts）连同 src/core 业务代码
 *      打成单个 ESM 文件（@ 别名在构建期解析；pg/better-sqlite3 等原生或
 *      运行时解析的依赖保持 external）
 *   2. 原样拷贝零构建资源：client 半 JS、H5 静态页、SQL 迁移
 * client 半是手写 window.__ModuleLoader__ 协议的浏览器脚本（见参考实现
 * feedfuse-workbench），不参与打包。
 */
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const out = join(root, 'dist', 'plugin')

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

await esbuild.build({
  entryPoints: [join(root, 'src', 'plugin', 'host', 'index.ts')],
  outfile: join(out, 'host', 'index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  alias: { '@': join(root, 'src') },
  // 原生模块与需要在运行时按 node_modules 解析的包保持 external。
  external: ['pg', 'pg-native', 'pg-cloudflare', 'better-sqlite3', 'jsdom', '@whisper-cpp-node/*', 'cloudflare:sockets'],
  // CJS 依赖（http2-wrapper 等）在 ESM 产物里动态 require node 内置模块；
  // 用 createRequire 兜底（esbuild 的已知限制）。
  banner: {
    js: "import { createRequire as __supermanCreateRequire } from 'node:module'; import { fileURLToPath as __supermanFileURLToPath } from 'node:url'; import { dirname as __supermanDirname } from 'node:path'; const require = __supermanCreateRequire(import.meta.url); const __filename = __supermanFileURLToPath(import.meta.url); const __dirname = __supermanDirname(__filename);",
  },
  logLevel: 'info',
})

for (const [from, to] of [
  ['src/plugin/client', 'dist/plugin/client'],
  ['src/plugin/public', 'dist/plugin/public'],
  ['src/plugin/host/migrations', 'dist/plugin/host/migrations'],
]) {
  cpSync(join(root, from), join(root, to), { recursive: true })
}

console.log('[build:plugin] dist/plugin 就绪（host esbuild 产物 + client/public/migrations 拷贝）')
