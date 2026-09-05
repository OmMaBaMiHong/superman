#!/usr/bin/env node
/**
 * 构建 Superman DSH 插件产物（dist/plugin）：
 *   1. tsc -p config/typescript/tsconfig.plugin.json 编译 host 半 TS → dist/plugin/host
 *   2. 原样拷贝零构建资源：client 半 JS、H5 静态页、SQL 迁移
 * client 半是手写 window.__ModuleLoader__ 协议的浏览器脚本（见参考实现
 * feedfuse-workbench），不参与 tsc 编译。
 */
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const out = join(root, 'dist', 'plugin')

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

execFileSync(
  process.execPath,
  [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(root, 'config', 'typescript', 'tsconfig.plugin.json')],
  { stdio: 'inherit', cwd: root },
)

for (const [from, to] of [
  ['src/plugin/client', 'dist/plugin/client'],
  ['src/plugin/public', 'dist/plugin/public'],
  ['src/plugin/host/migrations', 'dist/plugin/host/migrations'],
]) {
  cpSync(join(root, from), join(root, to), { recursive: true })
}

console.log('[build:plugin] dist/plugin 就绪（host 编译产物 + client/public/migrations 拷贝）')
