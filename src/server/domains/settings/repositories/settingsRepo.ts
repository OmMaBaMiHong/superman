import type { Pool, PoolClient } from 'pg';
import { normalizeUserId } from '@/server/domains/users/userScope';

type DbClient = Pool | PoolClient;

export interface AppSettingsRow {
  aiSummaryEnabled: boolean;
  aiTranslateEnabled: boolean;
  aiAutoSummarize: boolean;
  aiModel: string;
  aiApiBaseUrl: string;
  rssUserAgent: string;
  rssTimeoutMs: number;
}

export interface AuthSettingsRow {
  authPasswordHash: string;
  authSessionSecret: string;
}

export async function getUiSettings(pool: DbClient, userId?: string): Promise<unknown> {
  const { rows } = await pool.query<{ uiSettings: unknown }>(`
    select ui_settings as "uiSettings"
    from user_settings
    where user_id = $1
  `, [normalizeUserId(userId)]);
  return rows[0]?.uiSettings ?? {};
}

export async function updateUiSettings(
  pool: DbClient,
  userIdOrSettings: string | unknown,
  maybeUiSettings?: unknown,
): Promise<unknown> {
  const userId = typeof userIdOrSettings === 'string' ? userIdOrSettings : normalizeUserId();
  const uiSettings = typeof userIdOrSettings === 'string' ? maybeUiSettings : userIdOrSettings;
  const { rows } = await pool.query<{ uiSettings: unknown }>(
    `
      insert into user_settings(user_id, ui_settings)
      values ($1, $2)
      on conflict (user_id)
      do update set
        ui_settings = excluded.ui_settings,
        updated_at = now()
      returning ui_settings as "uiSettings"
    `,
    [userId, uiSettings],
  );
  return rows[0]?.uiSettings ?? uiSettings;
}

export async function getAiApiKey(pool: DbClient, userId?: string): Promise<string> {
  const { rows } = await pool.query<{ aiApiKey: string }>(`
    select ai_api_key as "aiApiKey"
    from user_settings
    where user_id = $1
  `, [normalizeUserId(userId)]);
  return rows[0]?.aiApiKey ?? '';
}

export async function setAiApiKey(
  pool: DbClient,
  userIdOrApiKey: string,
  maybeApiKey?: string,
): Promise<string> {
  const userId = typeof maybeApiKey === 'string' ? userIdOrApiKey : normalizeUserId();
  const apiKey = maybeApiKey ?? userIdOrApiKey;
  const { rows } = await pool.query<{ aiApiKey: string }>(
    `
      insert into user_settings(user_id, ai_api_key)
      values ($1, $2)
      on conflict (user_id)
      do update set
        ai_api_key = excluded.ai_api_key,
        updated_at = now()
      returning ai_api_key as "aiApiKey"
    `,
    [userId, apiKey],
  );
  return rows[0]?.aiApiKey ?? apiKey;
}

export async function clearAiApiKey(pool: DbClient, userId?: string): Promise<string> {
  return setAiApiKey(pool, normalizeUserId(userId), '');
}

export async function getTranslationApiKey(pool: DbClient, userId?: string): Promise<string> {
  const { rows } = await pool.query<{ translationApiKey: string }>(`
    select translation_api_key as "translationApiKey"
    from user_settings
    where user_id = $1
  `, [normalizeUserId(userId)]);
  return rows[0]?.translationApiKey ?? '';
}

export async function setTranslationApiKey(
  pool: DbClient,
  userIdOrApiKey: string,
  maybeApiKey?: string,
): Promise<string> {
  const userId = typeof maybeApiKey === 'string' ? userIdOrApiKey : normalizeUserId();
  const apiKey = maybeApiKey ?? userIdOrApiKey;
  const { rows } = await pool.query<{ translationApiKey: string }>(
    `
      insert into user_settings(user_id, translation_api_key)
      values ($1, $2)
      on conflict (user_id)
      do update set
        translation_api_key = excluded.translation_api_key,
        updated_at = now()
      returning translation_api_key as "translationApiKey"
    `,
    [userId, apiKey],
  );
  return rows[0]?.translationApiKey ?? apiKey;
}

export async function clearTranslationApiKey(pool: DbClient, userId?: string): Promise<string> {
  return setTranslationApiKey(pool, normalizeUserId(userId), '');
}

/**
 * 读取用户已加密的 GitHub Token 密文。
 *
 * 明文永不返回值，调用方需经 `secretBox.open()` 解密后才能使用。空串表示未配置。
 */
export async function getGithubTokenEncrypted(pool: DbClient, userId?: string): Promise<string> {
  const { rows } = await pool.query<{ githubTokenEncrypted: string }>(
    `select github_token_encrypted as "githubTokenEncrypted" from user_settings where user_id = $1`,
    [normalizeUserId(userId)],
  );
  return rows[0]?.githubTokenEncrypted ?? '';
}

export async function setGithubTokenEncrypted(
  pool: DbClient,
  userIdOrToken: string,
  maybeToken?: string,
): Promise<string> {
  const userId = typeof maybeToken === 'string' ? userIdOrToken : normalizeUserId();
  const token = maybeToken ?? userIdOrToken;
  const { rows } = await pool.query<{ githubTokenEncrypted: string }>(
    `
      insert into user_settings(user_id, github_token_encrypted)
      values ($1, $2)
      on conflict (user_id)
      do update set
        github_token_encrypted = excluded.github_token_encrypted,
        updated_at = now()
      returning github_token_encrypted as "githubTokenEncrypted"
    `,
    [userId, token],
  );
  return rows[0]?.githubTokenEncrypted ?? token;
}

/** 清除 GitHub Token（写回空密文）。 */
export async function clearGithubToken(pool: DbClient, userId?: string): Promise<string> {
  return setGithubTokenEncrypted(pool, normalizeUserId(userId), '');
}

export async function getAuthSettings(pool: DbClient): Promise<AuthSettingsRow> {
  const { rows } = await pool.query<AuthSettingsRow>(`
    select
      auth_password_hash as "authPasswordHash",
      auth_session_secret as "authSessionSecret"
    from app_settings
    where id = 1
  `);

  return rows[0] ?? {
    authPasswordHash: '',
    authSessionSecret: '',
  };
}

export async function updateAuthPassword(
  pool: DbClient,
  authPasswordHash: string,
): Promise<AuthSettingsRow> {
  const { rows } = await pool.query<AuthSettingsRow>(
    `
      update app_settings
      set
        auth_password_hash = $1,
        auth_session_secret = encode(gen_random_bytes(32), 'hex'),
        updated_at = now()
      where id = 1
      returning
        auth_password_hash as "authPasswordHash",
        auth_session_secret as "authSessionSecret"
    `,
    [authPasswordHash],
  );

  return rows[0] ?? {
    authPasswordHash,
    authSessionSecret: '',
  };
}

export async function getAppSettings(pool: Pool): Promise<AppSettingsRow> {
  const { rows } = await pool.query<AppSettingsRow>(`
    select
      ai_summary_enabled as "aiSummaryEnabled",
      ai_translate_enabled as "aiTranslateEnabled",
      ai_auto_summarize as "aiAutoSummarize",
      ai_model as "aiModel",
      ai_api_base_url as "aiApiBaseUrl",
      rss_user_agent as "rssUserAgent",
      rss_timeout_ms as "rssTimeoutMs"
    from app_settings
    where id = 1
  `);
  return rows[0];
}

export async function updateAppSettings(
  pool: Pool,
  input: Partial<AppSettingsRow>,
): Promise<AppSettingsRow> {
  const fields: string[] = [];
  const values: Array<string | boolean | number> = [];
  let paramIndex = 1;

  if (typeof input.aiSummaryEnabled !== 'undefined') {
    fields.push(`ai_summary_enabled = $${paramIndex++}`);
    values.push(input.aiSummaryEnabled);
  }
  if (typeof input.aiTranslateEnabled !== 'undefined') {
    fields.push(`ai_translate_enabled = $${paramIndex++}`);
    values.push(input.aiTranslateEnabled);
  }
  if (typeof input.aiAutoSummarize !== 'undefined') {
    fields.push(`ai_auto_summarize = $${paramIndex++}`);
    values.push(input.aiAutoSummarize);
  }
  if (typeof input.aiModel !== 'undefined') {
    fields.push(`ai_model = $${paramIndex++}`);
    values.push(input.aiModel);
  }
  if (typeof input.aiApiBaseUrl !== 'undefined') {
    fields.push(`ai_api_base_url = $${paramIndex++}`);
    values.push(input.aiApiBaseUrl);
  }
  if (typeof input.rssUserAgent !== 'undefined') {
    fields.push(`rss_user_agent = $${paramIndex++}`);
    values.push(input.rssUserAgent);
  }
  if (typeof input.rssTimeoutMs !== 'undefined') {
    fields.push(`rss_timeout_ms = $${paramIndex++}`);
    values.push(input.rssTimeoutMs);
  }

  if (fields.length === 0) {
    return getAppSettings(pool);
  }

  const { rows } = await pool.query<AppSettingsRow>(
    `
      update app_settings
      set
        ${fields.join(', ')},
        updated_at = now()
      where id = 1
      returning
        ai_summary_enabled as "aiSummaryEnabled",
        ai_translate_enabled as "aiTranslateEnabled",
        ai_auto_summarize as "aiAutoSummarize",
        ai_model as "aiModel",
        ai_api_base_url as "aiApiBaseUrl",
        rss_user_agent as "rssUserAgent",
        rss_timeout_ms as "rssTimeoutMs"
    `,
    values,
  );
  return rows[0];
}
