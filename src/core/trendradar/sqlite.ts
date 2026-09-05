/**
 * 读取 TrendRadar 当天 SQLite（output/news/YYYY-MM-DD.db）的结构化热榜。
 *
 * 优先 better-sqlite3（原生模块，快且零进程开销）；
 * 加载失败（比如运行时 ABI 不匹配）回落到 spawn python3 输出 JSON 再解析。
 * 文件不存在由调用方提前判断，这里只管读。
 *
 * TrendRadar schema（trendradar/storage/schema.sql）：
 *   news_items(title, platform_id, rank, url, mobile_url,
 *              first_crawl_time, last_crawl_time, crawl_count)
 *   platforms(id, name)
 *   rank_history(news_item_id, rank, crawl_time) —— 每次抓取一条，可推出上一次排名
 */
import { spawn } from 'node:child_process';

export interface TrendRadarSqliteItem {
  platform: string;
  platformName: string;
  title: string;
  url: string | null;
  mobileUrl: string | null;
  rank: number | null;
  previousRank: number | null;
  crawlCount: number;
  firstCrawlTime: string | null;
  lastCrawlTime: string | null;
}

const QUERY_SQL = `
  select
    n.title as title,
    n.platform_id as platform,
    coalesce(p.name, n.platform_id) as platform_name,
    n.rank as rank,
    n.url as url,
    n.mobile_url as mobile_url,
    n.crawl_count as crawl_count,
    n.first_crawl_time as first_crawl_time,
    n.last_crawl_time as last_crawl_time,
    (
      select rh.rank
      from rank_history rh
      where rh.news_item_id = n.id
      order by rh.crawl_time desc, rh.id desc
      limit 1 offset 1
    ) as previous_rank
  from news_items n
  left join platforms p on p.id = n.platform_id
  order by n.platform_id asc, n.rank asc
`;

/** TrendRadar 的 crawl_time 是本地时间文本（'YYYY-MM-DD HH:MM:SS'），转成带时区的 ISO。 */
function toIsoLocal(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value.trim().replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

interface RawRow {
  title: string;
  platform: string;
  platform_name: string;
  rank: number | null;
  url: string | null;
  mobile_url: string | null;
  crawl_count: number | null;
  first_crawl_time: string | null;
  last_crawl_time: string | null;
  previous_rank: number | null;
}

function mapRow(row: RawRow): TrendRadarSqliteItem {
  return {
    platform: String(row.platform ?? '').trim(),
    platformName: String(row.platform_name ?? '').trim(),
    title: String(row.title ?? '').trim(),
    url: row.url?.trim() ? row.url.trim() : null,
    mobileUrl: row.mobile_url?.trim() ? row.mobile_url.trim() : null,
    rank: typeof row.rank === 'number' && row.rank > 0 ? row.rank : null,
    previousRank:
      typeof row.previous_rank === 'number' && row.previous_rank > 0
        ? row.previous_rank
        : null,
    crawlCount: typeof row.crawl_count === 'number' ? row.crawl_count : 1,
    firstCrawlTime: toIsoLocal(row.first_crawl_time),
    lastCrawlTime: toIsoLocal(row.last_crawl_time),
  };
}

async function readViaBetterSqlite3(dbPath: string): Promise<RawRow[]> {
  const mod = await import('better-sqlite3');
  const Database = mod.default;
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return db.prepare(QUERY_SQL).all() as RawRow[];
  } finally {
    db.close();
  }
}

const PYTHON_SNIPPET = `
import json, sqlite3, sys
conn = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row
rows = conn.execute(sys.argv[2]).fetchall()
print(json.dumps([dict(r) for r in rows], ensure_ascii=False))
conn.close()
`;

function readViaPython(dbPath: string, pythonBin: string): Promise<RawRow[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, ['-c', PYTHON_SNIPPET, dbPath, QUERY_SQL], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `python sqlite reader exited ${code}: ${Buffer.concat(stderr).toString('utf8').slice(0, 500)}`,
          ),
        );
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(stdout).toString('utf8')) as RawRow[]);
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * 读全天热榜条目。better-sqlite3 不可用时自动回落 python3
 * （可用 TRENDRADAR_PYTHON 指定解释器，例如 TrendRadar 的 .venv）。
 */
export async function readTrendRadarSqliteItems(
  dbPath: string,
  options?: { pythonBin?: string },
): Promise<TrendRadarSqliteItem[]> {
  let rows: RawRow[];
  try {
    rows = await readViaBetterSqlite3(dbPath);
  } catch (err) {
    console.warn('[trendradar.sync] better-sqlite3 不可用，回落 python3：', err);
    rows = await readViaPython(dbPath, options?.pythonBin ?? 'python3');
  }
  return rows.map(mapRow).filter((row) => row.title && row.platform);
}
