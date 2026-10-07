/**
 * 宿主身份直通测试假库：按 SQL 关键字路由的内存 users 表，
 * 同时模拟 Pool（db.query）与事务连接（db.connect → begin/commit）两条路径。
 * 只覆盖 ensureHostUser / findUserByDshAccount / getUserById 用到的语句形状。
 */

export interface HostUserRow {
  id: string;
  username: string;
  passwordHash: string;
  role: 'admin' | 'member';
  status: 'active' | 'disabled';
  sessionVersion: number;
  type: 'initial_admin' | 'admin' | 'member';
  dshAccountId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function makeHostUsersDb() {
  const users: HostUserRow[] = [];
  let nextId = 2; // id=1 留给初始管理员

  async function route(text: string, params?: readonly unknown[]) {
    // 顺序敏感：dsh_account_id = $1 先于 where id = $1 判断。
    if (text.includes('from users') && text.includes('dsh_account_id = $1')) {
      const hit = users.find((u) => u.dshAccountId === params?.[0]);
      return { rows: hit ? [hit] : [], rowCount: hit ? 1 : 0 };
    }
    if (text.includes('from users') && text.includes('where id = $1')) {
      const hit = users.find((u) => String(u.id) === String(params?.[0]));
      return { rows: hit ? [hit] : [], rowCount: hit ? 1 : 0 };
    }
    if (text.includes('dsh_account_id is not null')) {
      return { rows: users.length ? [{ ok: 1 }] : [], rowCount: users.length };
    }
    if (text.includes('insert into users')) {
      // 与 ensureHostUser 的 insert 对齐：($1 username, '', $2 role, 'active', $3 dsh_account_id)
      const row: HostUserRow = {
        id: String(nextId++),
        username: String(params?.[0]),
        passwordHash: String(params?.[1] ?? ''),
        role: (params?.[1] as HostUserRow['role']) ?? 'member',
        status: 'active',
        sessionVersion: 1,
        type: 'member',
        dshAccountId: (params?.[2] as string) ?? null,
        createdAt: '',
        updatedAt: '',
      };
      users.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (text.includes('insert into user_settings')) return { rows: [], rowCount: 0 };
    if (text.includes('update users') && text.includes('username = $2')) {
      const hit = users.find((u) => String(u.id) === String(params?.[0]));
      if (hit) hit.username = String(params?.[1]);
      return { rows: hit ? [hit] : [], rowCount: hit ? 1 : 0 };
    }
    if (text.includes('update users')) {
      const hit = users.find((u) => String(u.id) === String(params?.[0]));
      return { rows: hit ? [hit] : [], rowCount: hit ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  }

  return {
    users,
    query: route,
    async connect() {
      return {
        query: route,
        begin: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
      };
    },
  };
}
