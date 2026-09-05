import ipaddr from 'ipaddr.js';
import { z } from 'zod';
import { decodeSecretKey } from '@/server/infra/crypto/secretBox';

function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function parseOptionalCsv(value: unknown): string[] | undefined {
  if (typeof value !== 'string') return undefined;
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : [];
}

function parseOptionalBoolean(value: unknown): boolean | string | undefined {
  const normalized = parseOptionalString(value)?.toLowerCase();
  if (normalized === undefined) return undefined;
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return normalized;
}

export const RSS_NETWORK_MODES = ['public', 'fake-ip', 'lan', 'custom'] as const;
export type RssNetworkMode = (typeof RSS_NETWORK_MODES)[number];

export interface RssNetworkConfig {
  mode: RssNetworkMode;
  allowedCidrs: string[];
}

const rssNetworkModeOverrideSchema = z.preprocess(
  (value) => {
    const normalized = parseOptionalString(value);
    return normalized?.toLowerCase();
  },
  z.enum(RSS_NETWORK_MODES).optional(),
);
const rssAllowedCidrsSchema = z.preprocess(
  parseOptionalCsv,
  z.array(z.string()).superRefine((cidrs, ctx) => {
    for (const cidr of cidrs) {
      try {
        ipaddr.parseCIDR(cidr);
      } catch {
        ctx.addIssue({
          code: 'custom',
          message: `Invalid CIDR: ${cidr}`,
        });
      }
    }
  }),
).default([]);
const optionalBooleanSchema = z.preprocess(parseOptionalBoolean, z.boolean().optional());

export const DEFAULT_GITHUB_API_BASE_URL = 'https://api.github.com';
export const DEFAULT_GITHUB_USER_AGENT = 'FeedFuse/0.4';
export const DEFAULT_GITHUB_API_TIMEOUT_MS = 15_000;

/**
 * 应用级加密密钥（32 字节，hex 或 base64）。
 *
 * 未配置时回落到 `app_settings.secret_encryption_key`（见 secretKeyProvider），
 * 但一旦配置就必须合法：格式错误直接在启动期失败，
 * 避免用一把错误的密钥静默加密数据造成不可逆的解密失败。
 */
const secretKeySchema = z.preprocess(
  parseOptionalString,
  z
    .string()
    .optional()
    .superRefine((value, ctx) => {
      if (value === undefined) return;
      try {
        decodeSecretKey(value);
      } catch {
        ctx.addIssue({
          code: 'custom',
          message:
            'FEEDFUSE_SECRET_KEY must decode to exactly 32 bytes (64-char hex or base64)',
        });
      }
    }),
);

/** GitHub API 基址。支持指向 GitHub Enterprise Server；主机白名单由此派生。 */
const githubApiBaseUrlSchema = z.preprocess(
  parseOptionalString,
  z
    .string()
    .optional()
    .superRefine((value, ctx) => {
      if (value === undefined) return;
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        ctx.addIssue({ code: 'custom', message: 'GITHUB_API_BASE_URL must be a valid URL' });
        return;
      }

      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        ctx.addIssue({
          code: 'custom',
          message: 'GITHUB_API_BASE_URL must use http or https',
        });
      }
    }),
);

/**
 * 站点对外访问基址（如 `https://reader.example.com`），用于推导 OAuth `redirect_uri`。
 *
 * 留空时回落 `x-forwarded-proto` + `x-forwarded-host` / `host`（见 redirectUri.ts）。
 * 反向代理场景强烈建议显式配置：`redirect_uri` 需与平台后台登记值逐字节一致，
 * 微信更是严格匹配，靠 header 推导容易因端口/协议差异导致换 token 失败。
 */
const publicBaseUrlSchema = z.preprocess(
  parseOptionalString,
  z
    .string()
    .optional()
    .superRefine((value, ctx) => {
      if (value === undefined) return;
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        ctx.addIssue({
          code: 'custom',
          message: 'FEEDFUSE_PUBLIC_BASE_URL must be a valid URL',
        });
        return;
      }

      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        ctx.addIssue({
          code: 'custom',
          message: 'FEEDFUSE_PUBLIC_BASE_URL must use http or https',
        });
      }
    }),
);

const positiveIntSchema = z.preprocess((value) => {
  const normalized = parseOptionalString(value);
  if (normalized === undefined) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : normalized;
}, z.number().int().positive().optional());

const rssNetworkConfigSchema = z
  .object({
    RSS_NETWORK_MODE: rssNetworkModeOverrideSchema,
    RSS_ALLOWED_CIDRS: rssAllowedCidrsSchema,
  })
  .transform(({ RSS_NETWORK_MODE, RSS_ALLOWED_CIDRS }): RssNetworkConfig => ({
    mode: RSS_NETWORK_MODE ?? 'public',
    allowedCidrs: RSS_ALLOWED_CIDRS,
  }));

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    AUTH_INITIAL_PASSWORD: z.preprocess(
      (value) =>
        typeof value === 'string' && value.trim().length === 0 ? undefined : value,
      z.string().min(1).optional(),
    ),
    IMAGE_PROXY_SECRET: z.preprocess(
      (value) =>
        typeof value === 'string' && value.trim().length === 0 ? undefined : value,
      z.string().min(1).optional(),
    ),
    AUTH_COOKIE_SECURE: optionalBooleanSchema,
    RSS_NETWORK_MODE: rssNetworkModeOverrideSchema,
    RSS_ALLOWED_CIDRS: rssAllowedCidrsSchema,
    FEEDFUSE_SECRET_KEY: secretKeySchema,
    FEEDFUSE_PUBLIC_BASE_URL: publicBaseUrlSchema,
    GITHUB_API_BASE_URL: githubApiBaseUrlSchema,
    GITHUB_USER_AGENT: z.preprocess(parseOptionalString, z.string().optional()),
    GITHUB_API_TIMEOUT_MS: positiveIntSchema,
    /**
     * TrendRadar 热点雷达接入令牌（Phase 1b）。
     * POST /api/ingest/trendradar 的 X-Ingest-Token 需与此值一致；
     * 未配置时 ingest 路由返回 503（与 AUTH_INITIAL_PASSWORD 同一 env 模式）。
     */
    TRENDRADAR_INGEST_TOKEN: z.preprocess(
      (value) =>
        typeof value === 'string' && value.trim().length === 0 ? undefined : value,
      z.string().min(1).optional(),
    ),
    /** TrendRadar 本地数据目录（其仓库根目录），sync job 从这里找 output/news/*.db。 */
    TRENDRADAR_HOME: z.preprocess(parseOptionalString, z.string().optional()),
  })
  .transform((env) => ({
    ...env,
    RSS_NETWORK_MODE: env.RSS_NETWORK_MODE ?? 'public',
    GITHUB_API_BASE_URL: env.GITHUB_API_BASE_URL ?? DEFAULT_GITHUB_API_BASE_URL,
    GITHUB_USER_AGENT: env.GITHUB_USER_AGENT ?? DEFAULT_GITHUB_USER_AGENT,
    GITHUB_API_TIMEOUT_MS: env.GITHUB_API_TIMEOUT_MS ?? DEFAULT_GITHUB_API_TIMEOUT_MS,
  }));

export type ServerEnv = z.infer<typeof envSchema>;

export function parseEnv(input: Record<string, unknown>): ServerEnv {
  return envSchema.parse(input);
}

export function getServerEnv(): ServerEnv {
  return parseEnv(process.env as Record<string, unknown>);
}

export function getRssNetworkConfig(input: Record<string, unknown>): RssNetworkConfig {
  return rssNetworkConfigSchema.parse(input);
}

export interface GithubApiConfig {
  /** API 基址，末尾不带斜杠，例如 `https://api.github.com` */
  baseUrl: string;
  /** 允许外呼的主机白名单（小写），由 baseUrl 派生 */
  allowedHosts: string[];
  userAgent: string;
  timeoutMs: number;
}

/**
 * 解析 GitHub API 运行时配置。
 *
 * `allowedHosts` 是 SSRF 防护的第二道闸门：githubClient / fetchExternalJson
 * 会在**每一跳重定向**上校验主机，防止 Authorization header 被带去第三方主机。
 */
export function getGithubApiConfig(
  input: Record<string, unknown> = process.env as Record<string, unknown>,
): GithubApiConfig {
  const env = envSchema.parse(input);
  const baseUrl = env.GITHUB_API_BASE_URL.replace(/\/+$/, '');
  const host = new URL(baseUrl).host.toLowerCase();

  return {
    baseUrl,
    allowedHosts: [host],
    userAgent: env.GITHUB_USER_AGENT,
    timeoutMs: env.GITHUB_API_TIMEOUT_MS,
  };
}
