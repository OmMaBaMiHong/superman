import { describe, expect, it, vi } from 'vitest';
import {
  buildProductPlanPrompt,
  generateProductPlan,
  heuristicProductPlan,
  type GenerateProductPlanDeps,
} from '@/core/product-plans/aiPlan';
import type { AiRuntimeConfig } from '@/server/integrations/ai/runtimeConfig';

const completeConfig: AiRuntimeConfig = {
  model: 'gpt-4o-mini',
  apiBaseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  deepThinkingEnabled: false,
};

function fakeClient(content: string): GenerateProductPlanDeps {
  return {
    createClient: (() => ({
      chat: {
        completions: {
          create: vi.fn(async () => ({ choices: [{ message: { content } }] })),
        },
      },
    })) as unknown as GenerateProductPlanDeps['createClient'],
  };
}

describe('product-plans/aiPlan · 启发式回退', () => {
  it('用来源标题作为产品名，来源文本作为一句话与描述', () => {
    const draft = heuristicProductPlan({
      sourceText: '做一个把长文一键转口播稿的工具\n面向自媒体人',
      sourceTitle: '口播助手',
      mode: 'manual',
    });
    expect(draft.title).toBe('口播助手');
    expect(draft.oneLiner.length).toBeGreaterThan(0);
    expect(draft.productDesc).toContain('长文一键转口播稿');
    expect(draft.targetUsers).toBe('');
    expect(draft.usedFallback).toBe(true);
  });

  it('无来源标题时取首行，空文本给默认名', () => {
    expect(heuristicProductPlan({ sourceText: '第一行\n第二行', mode: 'manual' }).title).toBe('第一行');
    expect(heuristicProductPlan({ sourceText: '   ', mode: 'manual' }).title).toBe('未命名产品想法');
  });
});

describe('product-plans/aiPlan · 提示词', () => {
  it('把不可信内容包进围栏并区分来源模式', () => {
    const manual = buildProductPlanPrompt({ sourceText: '我的点子', mode: 'manual' });
    expect(manual).toContain('<<<UNTRUSTED_DATA_START>>>');
    expect(manual).toContain('<<<UNTRUSTED_DATA_END>>>');
    expect(manual).toContain('我的点子');
    expect(manual).toContain('口述');

    const article = buildProductPlanPrompt({ sourceText: '新闻正文', mode: 'article' });
    expect(article).toContain('采集到的内容');
  });

  it('剔除控制字符', () => {
    const prompt = buildProductPlanPrompt({ sourceText: 'a\u0000b\u0007c', mode: 'manual' });
    expect(prompt).toContain('a b c');
  });
});

describe('product-plans/aiPlan · 生成', () => {
  it('未配置 AI 时回退启发式且不调用模型', async () => {
    const createClient = vi.fn();
    const draft = await generateProductPlan(
      { sourceText: '想法', mode: 'manual' },
      null,
      { createClient: createClient as never },
    );
    expect(draft.usedFallback).toBe(true);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('配置完整时解析模型返回的 JSON', async () => {
    const payload = JSON.stringify({
      title: '口播助手',
      oneLiner: '一键把长文转口播稿',
      productDesc: '核心功能',
      targetUsers: '自媒体人',
      approach: '先做 MVP',
      businessModel: '订阅制',
      risks: '同质化',
      competitors: '某工具',
      pricing: '19 元/月',
      milestones: '3 个月上线',
      validationPlan: '找 20 个博主试用',
    });
    const draft = await generateProductPlan(
      { sourceText: '来源', sourceTitle: '源标题', mode: 'article' },
      completeConfig,
      fakeClient(payload),
    );
    expect(draft.usedFallback).toBe(false);
    expect(draft.title).toBe('口播助手');
    expect(draft.businessModel).toBe('订阅制');
    expect(draft.validationPlan).toBe('找 20 个博主试用');
  });

  it('模型调用抛错时回退启发式，绝不抛出', async () => {
    const deps: GenerateProductPlanDeps = {
      createClient: (() => ({
        chat: {
          completions: {
            create: vi.fn(async () => {
              throw new Error('boom');
            }),
          },
        },
      })) as unknown as GenerateProductPlanDeps['createClient'],
    };
    const draft = await generateProductPlan(
      { sourceText: '一个想法', sourceTitle: '想法标题', mode: 'manual' },
      completeConfig,
      deps,
    );
    expect(draft.usedFallback).toBe(true);
    expect(draft.title).toBe('想法标题');
  });
});
