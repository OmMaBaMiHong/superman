import { Pool } from 'pg';
import { open as openSealed } from '../src/server/infra/crypto/secretBox';
import { resolveSecretKey } from '../src/server/infra/crypto/secretKeyProvider';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const key = await resolveSecretKey(pool);
  const { rows } = await pool.query('select cookie_encrypted from user_rsshub_cookies where user_id = 1 and provider = $1', ['douyin']);
  if (rows.length === 0) { console.error('NO_COOKIE'); process.exit(1); }
  const plain = openSealed(rows[0].cookie_encrypted, key);
  console.log(plain);
  await pool.end();
}
main();
