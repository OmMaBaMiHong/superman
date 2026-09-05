import { describe, expect, it } from 'vitest';
import {
  classifyOriginality,
  needsReduceSimilarityPass,
} from '@/server/domains/pipelines/originality';

describe('pipelines originality 分档', () => {
  it('0.3 → ok（低于 0.35）', () => {
    expect(classifyOriginality(0.3)).toBe('ok');
    expect(classifyOriginality(0)).toBe('ok');
    expect(classifyOriginality(0.349)).toBe('ok');
  });

  it('0.4 → rewritten（0.35-0.5 区间，含 0.35 与 0.5 边界）', () => {
    expect(classifyOriginality(0.35)).toBe('rewritten');
    expect(classifyOriginality(0.4)).toBe('rewritten');
    expect(classifyOriginality(0.5)).toBe('rewritten');
  });

  it('0.6 → needs_review（超过 0.5）', () => {
    expect(classifyOriginality(0.6)).toBe('needs_review');
    expect(classifyOriginality(0.501)).toBe('needs_review');
    expect(classifyOriginality(1)).toBe('needs_review');
  });

  it('仅 > 0.5 触发自动降重重写', () => {
    expect(needsReduceSimilarityPass(0.5)).toBe(false);
    expect(needsReduceSimilarityPass(0.51)).toBe(true);
  });
});
