import { getPool } from '../src/server/infra/db/pool.ts';

async function main() {
  const pool = getPool();
  const r = await pool.query(
    `SELECT provider, COALESCE(scope, '') AS scope, LENGTH(cookie_value) AS len,
            LEFT(cookie_value, 120) AS preview
     FROM user_rsshub_cookies WHERE provider = 'douyin' ORDER BY updated_at DESC LIMIT 5`,
  );
  console.log(JSON.stringify(r.rows, null, 2));
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
