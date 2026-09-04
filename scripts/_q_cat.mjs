import { getPool } from '../src/server/infra/db/pool.ts';

async function main() {
  const pool = getPool();
  const r = await pool.query(
    `SELECT id, name, user_id FROM categories WHERE name LIKE '%抖音%' OR name = '抖音' ORDER BY id`,
  );
  console.log(JSON.stringify(r.rows, null, 2));
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
