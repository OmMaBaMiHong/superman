import { describe, expect, it, vi } from 'vitest';
import { listCredentialCenter } from '@/core/credentials/center';
import type { Queryable } from '@/plugin/host/db';

function row(platform: string, purpose: string, masked: string) {
  return {
    id: '1', userId: '1', platform, accountName: '', credKind: 'cookie',
    purpose, credentialMasked: masked, status: 'active', remark: '',
    expiresAt: null, lastVerifiedAt: null, metaJson: null, createdAt: '', updatedAt: '',
  };
}

describe('credentials/center · listCredentialCenter', () => {
  it('按平台聚合发布+采集槽；未配置的平台/槽也出现（引导态）', async () => {
    const query = vi.fn(async () => ({
      rows: [
        row('douyin', 'publish', 'abcd****wxyz'),
        row('douyin', 'collect', 'efgh****stuv'),
        row('wechat', 'publish', 'wxab****12ab'),
      ],
    }));
    const db = { query } as unknown as Queryable;

    const center = await listCredentialCenter(db, '1');

    const douyin = center.platforms.find((p) => p.platform === 'douyin')!;
    expect(douyin.slots.map((s) => s.purpose)).toEqual(['publish', 'collect']);
    expect(douyin.slots[0]).toMatchObject({ configured: true, masked: 'abcd****wxyz' });
    expect(douyin.slots[0].capabilities).toContain('发布');
    expect(douyin.slots[1].capabilities).toContain('文案提取');

    const weibo = center.platforms.find((p) => p.platform === 'weibo')!;
    expect(weibo.slots[0]).toMatchObject({ purpose: 'collect', configured: false });

    expect(center.totalConfigured).toBe(3);
  });
});
