import type { Pool, PoolClient } from 'pg';

type DbClient = Pool | PoolClient;

export type UserRole = 'admin' | 'member';
export type UserStatus = 'active' | 'disabled';
export type UserType = 'initial_admin' | 'admin' | 'member';

export interface UserRow {
  id: string;
  username: string;
  type: UserType;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  sessionVersion: number;
  createdAt: string;
  updatedAt: string;
}

export type PublicUserRow = Omit<UserRow, 'passwordHash'>;

const userColumns = `
  id,
  username,
  case
    when id = 1 then 'initial_admin'
    when role = 'admin' then 'admin'
    else 'member'
  end as type,
  password_hash as "passwordHash",
  role,
  status,
  session_version as "sessionVersion",
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

const publicUserColumns = `
  id,
  username,
  case
    when id = 1 then 'initial_admin'
    when role = 'admin' then 'admin'
    else 'member'
  end as type,
  role,
  status,
  session_version as "sessionVersion",
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

function normalizeUsername(username: string): string {
  return username.trim();
}

export async function ensureUserSettings(db: DbClient, userId: string): Promise<void> {
  await db.query(
    `
      insert into user_settings(user_id)
      values ($1)
      on conflict (user_id) do nothing
    `,
    [userId],
  );
}

export async function findUserByUsername(
  db: DbClient,
  username: string,
): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>(
    `
      select ${userColumns}
      from users
      where lower(username) = lower($1)
      limit 1
    `,
    [normalizeUsername(username)],
  );

  return rows[0] ?? null;
}

export async function findUserByDshAccount(
  db: DbClient,
  dshAccountId: string,
): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>(
    `
      select ${userColumns}
      from users
      where dsh_account_id = $1
      limit 1
    `,
    [dshAccountId],
  );

  return rows[0] ?? null;
}

/**
 * 宿主代管用户：按 DSH 账号 ID 自动建号或返回已绑定用户。
 *
 * - `password_hash = ''`：不可口令登录（登录链路只认非空 hash），会话只能由宿主身份换发；
 * - 首个绑定的宿主账号视为产品主人（admin），其后为 member；
 * - 昵称只做展示（username），宿主侧改名且不撞名时跟随更新，不 bump session_version。
 */
export async function ensureHostUser(
  db: Pool,
  input: { dshAccountId: string; displayName: string | null },
): Promise<UserRow> {
  const existing = await findUserByDshAccount(db, input.dshAccountId);
  if (existing) {
    const name = normalizeUsername(input.displayName ?? '');
    if (name && name.toLowerCase() !== existing.username.toLowerCase()) {
      // 目标昵称被其他用户占用时保持原名，不做破坏性改名。
      const { rows } = await db.query<UserRow>(
        `
          update users
          set username = $2, updated_at = now()
          where id = $1
            and not exists (
              select 1 from users u2
              where lower(u2.username) = lower($2) and u2.id <> $1
            )
          returning ${userColumns}
        `,
        [existing.id, name],
      );
      return rows[0] ?? existing;
    }
    return existing;
  }

  const { rowCount: hasHostUser } = await db.query(
    'select 1 from users where dsh_account_id is not null limit 1',
  );
  const role: UserRole = (hasHostUser ?? 0) > 0 ? 'member' : 'admin';
  const fallback = `dsh-${input.dshAccountId.slice(0, 12)}`;
  const base = normalizeUsername(input.displayName ?? '') || fallback;
  // 昵称被占用时逐级退到带账号片段的确定性名字；账号列冲突（并发绑定）直接复用已有行。
  const candidates = [base, `${base}-${input.dshAccountId.slice(0, 6)}`, fallback];

  let lastError: unknown = new Error('ensureHostUser: 用户名候选全部冲突');
  for (const username of candidates) {
    const client = await db.connect();
    try {
      await client.query('begin');
      const { rows } = await client.query<UserRow>(
        `
          insert into users(username, password_hash, role, status, dsh_account_id)
          values ($1, '', $2, 'active', $3)
          on conflict do nothing
          returning ${userColumns}
        `,
        [username, role, input.dshAccountId],
      );
      if (!rows[0]) {
        await client.query('rollback');
        const raced = await findUserByDshAccount(db, input.dshAccountId);
        if (raced) return raced;
        lastError = new Error(`ensureHostUser: 用户名 ${username} 已被占用`);
        continue;
      }
      const user = rows[0];
      await ensureUserSettings(client, user.id);
      await client.query('commit');
      return user;
    } catch (err) {
      await client.query('rollback').catch(() => {});
      lastError = err;
    } finally {
      client.release();
    }
  }
  throw lastError;
}

/** 宿主账号登出/凭据失效时作废其全部会话（session_version 跳变使已签发令牌全部失效）。 */
export async function bumpDshAccountSessions(db: DbClient, dshAccountId: string): Promise<boolean> {
  const result = await db.query(
    `
      update users
      set session_version = session_version + 1, updated_at = now()
      where dsh_account_id = $1
    `,
    [dshAccountId],
  );

  return (result.rowCount ?? 0) > 0;
}

export async function getUserById(db: DbClient, userId: string): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>(
    `
      select ${userColumns}
      from users
      where id = $1
      limit 1
    `,
    [userId],
  );

  return rows[0] ?? null;
}

export async function listUsers(db: DbClient): Promise<PublicUserRow[]> {
  const { rows } = await db.query<PublicUserRow>(
    `
      select ${publicUserColumns}
      from users
      order by created_at asc, id asc
    `,
  );

  return rows;
}

export async function createUser(
  db: Pool,
  input: { username: string; passwordHash: string; role: UserRole },
): Promise<UserRow> {
  const client = await db.connect();
  try {
    // 创建用户和默认设置必须绑定同一个连接，保证事务真正生效。
    await client.query('begin');
    const { rows } = await client.query<UserRow>(
      `
        insert into users(username, password_hash, role, status)
        values ($1, $2, $3, 'active')
        returning ${userColumns}
      `,
      [normalizeUsername(input.username), input.passwordHash, input.role],
    );
    const user = rows[0];
    await ensureUserSettings(client, user.id);
    await client.query('commit');
    return user;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

export async function setUserStatus(
  db: DbClient,
  input: { userId: string; status: UserStatus },
): Promise<PublicUserRow | null> {
  const { rows } = await db.query<PublicUserRow>(
    `
      update users
      set
        status = $2,
        session_version = session_version + 1,
        updated_at = now()
      where id = $1
      returning ${publicUserColumns}
    `,
    [input.userId, input.status],
  );

  return rows[0] ?? null;
}

export async function resetUserPassword(
  db: DbClient,
  input: { userId: string; passwordHash: string },
): Promise<PublicUserRow | null> {
  const { rows } = await db.query<PublicUserRow>(
    `
      update users
      set
        password_hash = $2,
        session_version = session_version + 1,
        updated_at = now()
      where id = $1
      returning ${publicUserColumns}
    `,
    [input.userId, input.passwordHash],
  );

  return rows[0] ?? null;
}

export async function changeUserPassword(
  db: DbClient,
  input: { userId: string; passwordHash: string },
): Promise<PublicUserRow | null> {
  return resetUserPassword(db, input);
}

export async function updateUser(
  db: DbClient,
  input: {
    userId: string;
    username?: string;
    role?: UserRole;
    status?: UserStatus;
    passwordHash?: string;
  },
): Promise<PublicUserRow | null> {
  const values: string[] = [input.userId];
  const assignments: string[] = [];
  const shouldBumpSessionVersion =
    input.role !== undefined || input.status !== undefined || input.passwordHash !== undefined;

  // 只拼接实际提交的字段，避免空 patch 覆盖现有数据。
  if (input.username !== undefined) {
    values.push(normalizeUsername(input.username));
    assignments.push(`username = $${values.length}`);
  }

  if (input.role !== undefined) {
    values.push(input.role);
    assignments.push(`role = $${values.length}`);
  }

  if (input.status !== undefined) {
    values.push(input.status);
    assignments.push(`status = $${values.length}`);
  }

  if (input.passwordHash !== undefined) {
    values.push(input.passwordHash);
    assignments.push(`password_hash = $${values.length}`);
  }

  if (assignments.length === 0) {
    return null;
  }

  if (shouldBumpSessionVersion) {
    assignments.push('session_version = session_version + 1');
  }
  assignments.push('updated_at = now()');

  const { rows } = await db.query<PublicUserRow>(
    `
      update users
      set ${assignments.join(', ')}
      where id = $1
      returning ${publicUserColumns}
    `,
    values,
  );

  return rows[0] ?? null;
}

export async function persistInitialAdminPassword(
  db: DbClient,
  input: { userId: string; passwordHash: string },
): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>(
    `
      update users
      set
        password_hash = $2,
        session_version = session_version + 1,
        updated_at = now()
      where id = $1 and password_hash = ''
      returning ${userColumns}
    `,
    [input.userId, input.passwordHash],
  );

  return rows[0] ?? null;
}

export async function deleteUser(
  db: DbClient,
  input: { userId: string },
): Promise<boolean> {
  const result = await db.query(
    `
      delete from users
      where id = $1
    `,
    [input.userId],
  );

  return (result.rowCount ?? 0) > 0;
}
