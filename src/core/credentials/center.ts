/**
 * 授权与凭证中心：按平台聚合所有凭据（发布授权 + 采集 Cookie + 三方 OAuth）。
 *
 * 存储统一在 platform_accounts（purpose 区分 publish / collect / oauth）。
 * 这里只做「平台 → 凭据槽」的视图聚合，供 UI 与 agent 工具消费；
 * 永不携带明文/密文，只回打码值。
 */
import type { Pool, PoolClient } from 'pg';
import {
  listPlatformAccounts,
  type AccountPlatform,
  type CredentialPurpose,
} from '@/core/platform-accounts/repository';

type DbClient = Pool | PoolClient;

export interface CredentialSlot {
  purpose: CredentialPurpose;
  label: string;
  credKind: 'app_secret' | 'cookie' | 'oauth';
  /** 该槽解锁的能力（展示用）。 */
  capabilities: string[];
  configured: boolean;
  masked: string;
  status: 'active' | 'expired' | 'error';
  accountName: string;
  updatedAt: string | null;
}

export interface CredentialPlatformView {
  platform: AccountPlatform;
  name: string;
  icon: string;
  slots: CredentialSlot[];
}

export interface CredentialCenter {
  platforms: CredentialPlatformView[];
  totalConfigured: number;
}

const PLATFORM_META: Record<AccountPlatform, { name: string; icon: string }> = {
  wechat: { name: '公众号', icon: '💬' },
  douyin: { name: '抖音', icon: '🎵' },
  xhs: { name: '小红书', icon: '📕' },
  bilibili: { name: 'B站', icon: '📺' },
  channels: { name: '视频号', icon: '🎬' },
  weibo: { name: '微博', icon: '🌐' },
};

/** 每个平台「应有哪些凭据槽」的静态目录（未配置也展示，起引导作用）。 */
const SLOT_CATALOG: Record<
  AccountPlatform,
  Array<{ purpose: CredentialPurpose; label: string; credKind: 'app_secret' | 'cookie' | 'oauth'; capabilities: string[] }>
> = {
  wechat: [{ purpose: 'publish', label: '公众号发布（AppID/Secret）', credKind: 'app_secret', capabilities: ['发布'] }],
  douyin: [
    { purpose: 'publish', label: '抖音发布（扫码登录）', credKind: 'cookie', capabilities: ['发布'] },
    { purpose: 'collect', label: '抖音采集 Cookie', credKind: 'cookie', capabilities: ['订阅抓取', '文案提取'] },
  ],
  xhs: [
    { purpose: 'publish', label: '小红书发布（扫码登录）', credKind: 'cookie', capabilities: ['发布'] },
    { purpose: 'collect', label: '小红书采集 Cookie', credKind: 'cookie', capabilities: ['订阅抓取'] },
  ],
  bilibili: [{ purpose: 'publish', label: 'B站发布（Cookie）', credKind: 'cookie', capabilities: ['发布'] }],
  channels: [{ purpose: 'publish', label: '视频号发布（Cookie）', credKind: 'cookie', capabilities: ['发布'] }],
  weibo: [{ purpose: 'collect', label: '微博采集 Cookie', credKind: 'cookie', capabilities: ['订阅抓取'] }],
};

export const CREDENTIAL_PLATFORM_ORDER: readonly AccountPlatform[] = [
  'douyin',
  'xhs',
  'wechat',
  'bilibili',
  'channels',
  'weibo',
];

/** 按平台聚合用户的全部凭据。 */
export async function listCredentialCenter(
  db: DbClient,
  userId: string,
): Promise<CredentialCenter> {
  const rows = await listPlatformAccounts(db, { userId });
  const byKey = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    byKey.set(`${row.platform}:${row.purpose}`, row);
  }

  let totalConfigured = 0;
  const platforms = CREDENTIAL_PLATFORM_ORDER.map((platform) => {
    const slots = SLOT_CATALOG[platform].map((slot): CredentialSlot => {
      const row = byKey.get(`${platform}:${slot.purpose}`);
      const configured = Boolean(row && row.credentialMasked);
      if (configured) totalConfigured += 1;
      return {
        purpose: slot.purpose,
        label: slot.label,
        credKind: slot.credKind,
        capabilities: slot.capabilities,
        configured,
        masked: row?.credentialMasked ?? '',
        status: row?.status ?? 'active',
        accountName: row?.accountName ?? '',
        updatedAt: row?.updatedAt ?? null,
      };
    });
    return {
      platform,
      name: PLATFORM_META[platform].name,
      icon: PLATFORM_META[platform].icon,
      slots,
    };
  });

  return { platforms, totalConfigured };
}
