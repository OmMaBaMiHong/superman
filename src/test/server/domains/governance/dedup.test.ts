import { describe, expect, it } from 'vitest';
import {
  TITLE_SIMILARITY_THRESHOLD,
  isDuplicateTitle,
  matchExcludeKeyword,
  normalizeTitle,
  titleSimilarity,
} from '@/server/domains/governance/dedup';

// 构造指定 Dice 相似度的字符串对：
// base 为 32 个互不相同的汉字（31 个唯一 bigram 全部共享），
// 两侧各追加 9 个互不相同的汉字（各 +9 个唯一 bigram）。
// |A| = |B| = 40，|∩| = 31，Dice = 2×31/80 = 0.775（介于 0.77 与 0.78 之间）。
const base = Array.from({ length: 32 }, (_, i) => String.fromCharCode(0x4e00 + i)).join('');
const tailA = Array.from({ length: 9 }, (_, i) => String.fromCharCode(0x4e20 + i)).join('');
const tailB = Array.from({ length: 9 }, (_, i) => String.fromCharCode(0x4e29 + i)).join('');
const PAIR_0775_A = base + tailA;
const PAIR_0775_B = base + tailB;

// |A| = |B| = 50，|∩| = 39，Dice = 2×39/100 = 0.78（恰好达到阈值）。
const base50 = Array.from({ length: 40 }, (_, i) => String.fromCharCode(0x5000 + i)).join('');
const tail50A = Array.from({ length: 11 }, (_, i) => String.fromCharCode(0x5028 + i)).join('');
const tail50B = Array.from({ length: 11 }, (_, i) => String.fromCharCode(0x5033 + i)).join('');
const PAIR_078_A = base50 + tail50A;
const PAIR_078_B = base50 + tail50B;

describe('governance dedup / titleSimilarity', () => {
  it('相同字符串相似度为 1，空串为 0', () => {
    expect(titleSimilarity('人工智能', '人工智能')).toBe(1);
    expect(titleSimilarity('', '人工智能')).toBe(0);
    expect(titleSimilarity('人工智能', '')).toBe(0);
    expect(titleSimilarity('', '')).toBe(0);
  });

  it('构造样本的 Dice 系数精确等于 0.775 / 0.78', () => {
    expect(titleSimilarity(PAIR_0775_A, PAIR_0775_B)).toBeCloseTo(0.775, 10);
    expect(titleSimilarity(PAIR_078_A, PAIR_078_B)).toBeCloseTo(0.78, 10);
  });

  it('边界：0.775 ≥ 0.77 判重，< 0.78 不判重', () => {
    expect(isDuplicateTitle(PAIR_0775_A, [PAIR_0775_B], 0.77)).toBe(true);
    expect(isDuplicateTitle(PAIR_0775_A, [PAIR_0775_B], 0.78)).toBe(false);
  });

  it('边界：恰好 0.78 命中默认阈值（≥ 判定）', () => {
    expect(TITLE_SIMILARITY_THRESHOLD).toBe(0.78);
    expect(isDuplicateTitle(PAIR_078_A, [PAIR_078_B])).toBe(true);
  });

  it('normalizeTitle 忽略大小写、空白与标点', () => {
    expect(normalizeTitle('Hello, World!')).toBe('helloworld');
    expect(normalizeTitle('  AI 时代： 重构？')).toBe('ai时代重构');
  });

  it('归一化后相同即判重；空标题不参与判重', () => {
    expect(isDuplicateTitle('Hello World!', ['hello world'])).toBe(true);
    expect(isDuplicateTitle('', ['任何标题'])).toBe(false);
    expect(isDuplicateTitle('某标题', [])).toBe(false);
  });
});

describe('governance dedup / matchExcludeKeyword', () => {
  it('标题 / 摘要 / 正文任一命中即排除（大小写不敏感）', () => {
    expect(
      matchExcludeKeyword({ title: '今日广告合集', summary: null, contentText: '' }, ['广告'])
        .matchedKeyword,
    ).toBe('广告');
    expect(
      matchExcludeKeyword({ title: '正常标题', summary: '含 Promo 内容', contentText: '' }, [
        'promo',
      ]).excluded,
    ).toBe(true);
    expect(
      matchExcludeKeyword({ title: '正常标题', summary: '', contentText: '正文提到软文' }, ['软文'])
        .excluded,
    ).toBe(true);
  });

  it('未命中或关键词为空时不排除', () => {
    const result = matchExcludeKeyword(
      { title: '正常标题', summary: '正常摘要', contentText: '正常正文' },
      ['广告', ''],
    );
    expect(result).toEqual({ excluded: false, matchedKeyword: null });
    expect(matchExcludeKeyword({ title: '任意' }, []).excluded).toBe(false);
  });
});
