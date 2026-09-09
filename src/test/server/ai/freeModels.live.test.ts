import { expect, it } from 'vitest';
import { draftGovernanceArticle } from '@/core/governance/aiDraft';
import { createOpenAIClient } from '@/server/integrations/ai/openaiClient';
import { resolveSharedAiConfig } from '@/server/integrations/ai/runtimeConfig';

// Explicit opt-in: sends only synthetic public test content; no stored user data or credentials.
it.skipIf(process.env.RUN_LIVE_FREE_MODEL !== '1')('generates a governance draft through the real anonymous free gateway', async () => {
  const config = resolveSharedAiConfig({ settings: { ai: { model: '', apiBaseUrl: '', providerMode: 'kilo-free' } }, aiApiKey: '' });
  const result = await draftGovernanceArticle({
    title: '社区图书馆延长开放时间',
    contentText: '功能验收用虚构新闻：社区图书馆计划在周末延长开放两小时，新增亲子阅读活动，并开放免费的预约座位。',
    directions: [{ key: 'knowledge', name: '知识', aiHint: '阅读与教育知识' }],
  }, config, { createClient: ({ apiBaseUrl, apiKey }) => createOpenAIClient({ apiBaseUrl, apiKey }) });
  expect(result.usedFallback).toBe(false);
  expect(result.title.length).toBeGreaterThan(0);
  expect(result.summary.length).toBeGreaterThan(0);
  expect(result.directionKey).toBe('knowledge');
  console.info('Live free model governance:', JSON.stringify(result));
}, 75_000);
