import { getPool } from '../src/server/infra/db/pool.ts';
import { createSessionCookieHeader } from '../src/server/domains/auth/services/session.ts';

const pool = getPool();
const cookie = await createSessionCookieHeader();
console.log('COOKIE=' + cookie);
await pool.end();
