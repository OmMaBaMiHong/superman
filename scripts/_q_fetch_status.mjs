import { getPool } from '../src/server/infra/db/pool.ts';

async function main() {
  const pool = getPool();
  const r = await pool.query(
    `SELECT id, title, url, last_fetch_status, last_fetch_error, last_fetch_raw_error, last_fetched_at
     FROM feeds WHERE id IN ('15','16','17','18')`,
  );
  console.log(JSON.stringify(r.rows, null, 2));
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
