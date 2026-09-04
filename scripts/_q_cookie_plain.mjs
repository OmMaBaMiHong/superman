import { getPool } from '../src/server/infra/db/pool.ts';
import { getPlainRssHubCookie } from '../src/server/domains/rsshubCookie/services/rssHubCookieService.ts';
import { writeFileSync } from 'node:fs';

async function main() {
  const pool = getPool();
  const plain = await getPlainRssHubCookie(pool, '1', 'douyin');
  writeFileSync('/tmp/dy_cookie_raw.txt', plain || '');
  await pool.end();
  console.log('written', (plain || '').length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
