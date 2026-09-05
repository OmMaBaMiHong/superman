/**
 * POST /api/ingest/trendradar —— TrendRadar generic_webhook 实时推送入口。
 *
 * 鉴权：X-Ingest-Token 头对齐 env TRENDRADAR_INGEST_TOKEN。
 * TrendRadar 的 generic_webhook 不能自定义 header，故额外接受
 * ?token= 查询参数或 body.token 字段（payload_template 内嵌），三者任一命中即放行。
 *
 * 这是实时触达链路（次要）：渲染文本容错解析后 upsert，
 * 原始报文永远完整落在 payload_json.raw 里；结构化全量由 trendradar.sync job 补齐。
 */
import { ok, fail } from '@/server/infra/http/apiResponse';
import {
  ServiceUnavailableError,
  UnauthorizedError,
  ValidationError,
} from '@/server/infra/http/errors';
import { getServerEnv } from '@/server/infra/env';
import { getPool } from '@/server/infra/db/pool';
import { safeEqualText } from '@/server/domains/auth/services/shared';
import { parseTrendRadarWebhookPayload } from '@/server/domains/trendradar/webhookParser';
import {
  resolveTrendRadarOwnerUserId,
  upsertTrendRadarItems,
} from '@/server/domains/trendradar/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function extractProvidedToken(request: Request, bodyToken: string | null): string | null {
  const header = request.headers.get('x-ingest-token')?.trim();
  if (header) return header;
  const query = new URL(request.url).searchParams.get('token')?.trim();
  if (query) return query;
  return bodyToken;
}

export async function POST(request: Request) {
  try {
    const expectedToken = getServerEnv().TRENDRADAR_INGEST_TOKEN;
    if (!expectedToken) {
      throw new ServiceUnavailableError('未配置 TRENDRADAR_INGEST_TOKEN，ingest 通道未启用');
    }

    const body: unknown = await request.json().catch(() => null);
    const parsed = parseTrendRadarWebhookPayload(body);
    if (!parsed) {
      throw new ValidationError('请求体非法', {
        body: '需要 JSON：{title, content, token?}（TrendRadar generic_webhook 格式）',
      });
    }

    const provided = extractProvidedToken(request, parsed.token);
    if (!provided || !safeEqualText(provided, expectedToken)) {
      throw new UnauthorizedError('ingest token 无效');
    }

    const pool = getPool();
    const ownerUserId = await resolveTrendRadarOwnerUserId(pool);
    if (!ownerUserId) {
      throw new ServiceUnavailableError('未找到可归属的管理员用户');
    }

    const sourceDate = new Date().toISOString().slice(0, 10);
    const result = await upsertTrendRadarItems(
      pool,
      parsed.items.map((item) => ({
        platform: item.platform,
        title: item.title,
        url: item.url,
        rank: item.rank,
        sourceDate,
        payload: {
          via: 'webhook',
          reportType: parsed.reportType,
          raw: parsed.content,
        },
      })),
      ownerUserId,
    );

    return ok({
      received: true,
      reportType: parsed.reportType,
      parsed: parsed.items.length,
      upserted: result.upserted,
    });
  } catch (err) {
    return fail(err);
  }
}
