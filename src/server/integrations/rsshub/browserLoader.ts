/**
 * Playwright 动态加载器（RSSHub 集成用）。
 *
 * 项目未直接依赖 playwright/patchright，但 vendor/rsshub 内置了 patchright。
 * 这里按优先级尝试多个解析路径，保证插件宿主在不同运行环境下都能拿到浏览器。
 */

export type PatchrightModule = {
  chromium: {
    launch: (options?: Record<string, unknown>) => Promise<BrowserLike>;
  };
};

export interface BrowserLike {
  newContext: (options?: Record<string, unknown>) => Promise<ContextLike>;
  close: () => Promise<void>;
}

export interface ContextLike {
  newPage: () => Promise<PageLike>;
  close: () => Promise<void>;
}

export interface PageLike {
  goto: (url: string, options?: Record<string, unknown>) => Promise<unknown>;
  content: () => Promise<string>;
  evaluate: <T>(fn: () => T) => Promise<T>;
  url: () => string;
  on: (event: string, handler: (arg: unknown) => void) => void;
  close: () => Promise<void>;
}

let cached: PatchrightModule | null = null;

/** 加载 patchright 模块。 */
export async function loadPatchright(): Promise<PatchrightModule> {
  if (cached) return cached;

  const candidates: string[] = ['patchright'];

  // 兜底：从项目的 vendor/rsshub 目录加载（DSH 插件宿主场景）
  try {
    const { join } = await import('node:path');
    const { pathToFileURL } = await import('node:url');
    const cwd = process.cwd();
    candidates.push(
      pathToFileURL(join(cwd, 'vendor', 'rsshub', 'node_modules', 'patchright', 'index.mjs')).href,
      pathToFileURL(join(cwd, '..', 'vendor', 'rsshub', 'node_modules', 'patchright', 'index.mjs')).href,
    );
  } catch {
    // 忽略
  }

  let lastError: unknown;
  for (const specifier of candidates) {
    try {
      const mod = (await import(/* @vite-ignore */ specifier)) as PatchrightModule;
      if (mod && typeof mod.chromium?.launch === 'function') {
        cached = mod;
        return mod;
      }
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(
    `无法加载浏览器模块（playwright/patchright）。${lastError instanceof Error ? `原因：${lastError.message}` : ''}`,
  );
}

/** 浏览器是否可用（用于能力探测）。 */
export async function isBrowserAvailable(): Promise<boolean> {
  try {
    await loadPatchright();
    return true;
  } catch {
    return false;
  }
}
