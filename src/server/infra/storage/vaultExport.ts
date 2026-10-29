import { mkdir, writeFile, unlink, access, constants, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import TurndownService from 'turndown';

/**
 * 收藏 → 本地目录（Obsidian vault）落盘。
 *
 * 用户在设置里指定一个本地目录（通常是 Obsidian vault 或其子目录）：
 *   - 文本/网页收藏写成 <dir>/<标题>-<时间>.md（frontmatter + markdown 正文）
 *   - 图片/视频源文件存 <dir>/attachments/<yyyy-MM>/，笔记里以 ![[attachments/…]] 内嵌
 * 数据库只存链接（/s/app/media/… 与 articles.vault_note_path），源文件统一以该目录为准，
 * 跟着 vault 走（Obsidian Sync / iCloud 同步即带走）。未配置目录时保持旧行为
 * （~/.superman/uploads，仅数据库可见）。
 */

/** 最小查询接口，兼容插件运行时 PGlite 与可选 Postgres 连接。 */
export interface QueryRunner {
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export function attachmentsRoot(dir: string): string {
  return path.join(dir, 'attachments');
}

/** 媒体 URL（新旧前缀均可）在 vault 里的 wikilink 引用路径（attachments/<rel>）。 */
export function mediaUrlToVaultRef(url: string): string | null {
  const prefix = ['/s/api/media/', '/s/app/media/'].find((p) => url.startsWith(p));
  if (!prefix) return null;
  const rel = url.slice(prefix.length);
  if (!rel || rel.includes('..')) return null;
  return `attachments/${rel}`;
}

/** 把一条媒体 URL 对应的文件复制进 vault 的 attachments/（已存在则跳过）。返回是否复制成功。 */
export async function ensureMediaInVault(db: QueryRunner, dir: string, mediaUrl: string): Promise<boolean> {
  try {
    const prefix = ['/s/api/media/', '/s/app/media/'].find((p) => mediaUrl.startsWith(p));
    if (!prefix) return false;
    const rel = mediaUrl.slice(prefix.length);
    if (!rel || rel.includes('..')) return false;
    const target = path.join(attachmentsRoot(dir), rel);
    if (existsSync(target)) return true;
    const { resolveMediaPath } = await import('./localFileStore');
    const source = resolveMediaPath(mediaUrl, [attachmentsRoot(dir)]);
    if (!source || !existsSync(source)) return false;
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    return true;
  } catch {
    return false;
  }
}

export async function getFavoriteDir(db: QueryRunner, userId: number | string): Promise<string> {
  const { rows } = await db.query('select dir from user_favorite_dirs where user_id = $1', [userId]);
  return typeof rows[0]?.dir === 'string' ? rows[0].dir : '';
}

/** 保存收藏目录（空串 = 清除，回退默认行为）。返回是否可用。 */
export async function setFavoriteDir(db: QueryRunner, userId: number | string, dir: string): Promise<boolean> {
  if (dir) {
    try {
      await mkdir(dir, { recursive: true });
      const probe = path.join(dir, '.superman-write-test');
      await writeFile(probe, 'ok');
      await unlink(probe);
    } catch {
      return false;
    }
  }
  await db.query(
    `insert into user_favorite_dirs (user_id, dir, updated_at) values ($1, $2, now())
     on conflict (user_id) do update set dir = excluded.dir, updated_at = now()`,
    [userId, dir],
  );
  return true;
}

function findVaultMarker(dir: string): boolean {
  let cur = dir;
  for (let i = 0; i < 5; i += 1) {
    if (existsSync(path.join(cur, '.obsidian'))) return true;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return false;
}

export async function probeFavoriteDir(dir: string): Promise<{ exists: boolean; writable: boolean; isVault: boolean }> {
  if (!dir) return { exists: false, writable: false, isVault: false };
  const exists = existsSync(dir);
  let writable = false;
  if (exists) {
    try {
      await access(dir, constants.W_OK);
      writable = true;
    } catch {
      writable = false;
    }
  }
  return { exists, writable, isVault: findVaultMarker(dir) };
}

// —— markdown 生成 ——

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

/** Obsidian 文件名非法字符（/ \ : * ? " < > | # ^ [ ]）与控制符。 */
const FILENAME_FORBIDDEN = /[/\\:*?"<>|#^\[\]\u0000-\u001f]/g;

function slugify(title: string): string {
  const cleaned = title.replace(FILENAME_FORBIDDEN, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
  const capped = cleaned.slice(0, 80).trim();
  return capped || '未命名收藏';
}

function stampOf(date: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

function yamlValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\u0000-\u001f]/g, ' ').trim()}"`;
}

function htmlToMarkdown(html: string): string {
  try {
    return turndown.turndown(html).trim();
  } catch {
    return html.replace(/<[^>]+>/g, '').trim();
  }
}

type FavoriteKind = 'video' | 'images' | 'article' | 'text';

interface BuildInput {
  title: string;
  note: string | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
  rawContent: string;
  rawHtml: string;
  summary: string;
  tags: string[];
  imageUrls: string[];
  videoUrl: string | null;
  videoFilePath: string | null;
  transcriptText: string | null;
  collectedAt: Date;
}

function buildMarkdown(input: BuildInput): string {
  const localImages = input.imageUrls.filter((u) => u.startsWith('/s/api/media/') || u.startsWith('/s/app/media/'));
  const kind: FavoriteKind = input.videoUrl
    ? 'video'
    : localImages.length > 0
      ? 'images'
      : input.sourceUrl && (input.rawHtml || input.summary)
        ? 'article'
        : 'text';

  const lines: string[] = [
    '---',
    `title: ${yamlValue(input.title)}`,
    `collected: ${input.collectedAt.toISOString()}`,
    `type: ${kind}`,
    'tags:',
    '  - superman',
    '  - 收藏',
  ];
  if (input.sourceUrl) lines.push(`source: ${yamlValue(input.sourceUrl)}`);
  if (input.sourceTitle && input.sourceTitle !== input.title) lines.push(`source_title: ${yamlValue(input.sourceTitle)}`);
  for (const tag of input.tags) lines.push(`  - ${yamlValue(tag)}`);
  lines.push('---', '');

  lines.push(`# ${input.title}`, '');
  if (input.note?.trim()) lines.push('> [!note] 备注', `> ${input.note.trim().replace(/\n/g, '\n> ')}`, '');

  const remoteImages = input.imageUrls.filter((u) => /^https?:\/\//.test(u));

  if (kind === 'video') {
    const ref = input.videoUrl ? mediaUrlToVaultRef(input.videoUrl) : null;
    if (ref) lines.push(`![[${ref}]]`, '');
    if (input.transcriptText?.trim()) lines.push('## 视频文案', '', input.transcriptText.trim(), '');
    if (input.sourceUrl) lines.push(`[来源](${input.sourceUrl})`, '');
  } else if (kind === 'images') {
    if (input.rawContent.trim() && input.rawContent.trim() !== input.title) lines.push(input.rawContent.trim(), '');
    for (const url of localImages) {
      const ref = mediaUrlToVaultRef(url);
      if (ref) lines.push(`![[${ref}]]`, '');
    }
    for (const url of remoteImages) lines.push(`![图片](${url})`, '');
  } else {
    const body = input.rawContent.trim() || (input.rawHtml ? htmlToMarkdown(input.rawHtml) : '') || input.summary.trim();
    if (body) {
      // 正文里的本地媒体链接转 wikilink 内嵌
      lines.push(body.replace(/!\[([^\]]*)\]\((\/s\/app\/media\/[^)]+)\)/g, (_m, alt: string, url: string) => {
        const ref = mediaUrlToVaultRef(url);
        return ref ? `![[${ref}]]` : `![${alt}](${url})`;
      }), '');
    }
    for (const url of remoteImages) lines.push(`![图片](${url})`, '');
    if (input.sourceUrl) lines.push(`[来源](${input.sourceUrl})`, '');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

// —— 落盘 / 清理 ——

interface ArticleRow {
  user_id: number;
  origin: string | null;
  title: string | null;
  summary: string | null;
  content_html: string | null;
  user_note: string | null;
  link: string | null;
  fetched_at: string | Date | null;
  vault_note_path: string | null;
}

/**
 * 把一条收藏同步到 vault（存在则覆写原文件，标题未变不复名）。
 * 所有收藏创建/编辑链路统一走这里；内部吞错，不阻塞主流程。
 */
export async function syncArticleToVault(db: QueryRunner, articleId: number | string): Promise<void> {
  try {
    const { rows } = await db.query(
      `select user_id, origin, title, summary, content_html, user_note, link, fetched_at, vault_note_path
       from articles where id = $1`,
      [articleId],
    );
    const article = rows[0] as unknown as ArticleRow | undefined;
    if (!article || article.origin !== 'clipboard') return;

    const dir = await getFavoriteDir(db, article.user_id);
    if (!dir) return;

    const clipRes = await db.query(
      'select raw_content, raw_html, source_title, image_urls, tags from clips where article_id = $1 order by id desc limit 1',
      [articleId],
    );
    const clip = clipRes.rows[0] as
      | { raw_content: string | null; raw_html: string | null; source_title: string | null; image_urls: unknown; tags: unknown }
      | undefined;
    const videoRes = await db.query(
      'select video_url, video_file_path, transcript_text from video_materials where article_id = $1 order by id desc limit 1',
      [articleId],
    );
    const video = videoRes.rows[0] as { video_url: string | null; video_file_path: string | null; transcript_text: string | null } | undefined;

    const imageUrls = Array.isArray(clip?.image_urls) ? (clip.image_urls as unknown[]).filter((u): u is string => typeof u === 'string') : [];
    const title = (article.title ?? clip?.source_title ?? '未命名收藏').trim() || '未命名收藏';
    const markdown = buildMarkdown({
      title,
      note: article.user_note,
      sourceUrl: article.link ?? clip?.raw_content?.match(/https?:\/\/\S+/)?.[0] ?? null,
      sourceTitle: clip?.source_title ?? null,
      rawContent: clip?.raw_content ?? '',
      rawHtml: clip?.raw_html ?? article.content_html ?? '',
      summary: article.summary ?? '',
      tags: Array.isArray(clip?.tags) ? (clip.tags as unknown[]).filter((t): t is string => typeof t === 'string') : [],
      imageUrls,
      videoUrl: video?.video_url ?? null,
      videoFilePath: video?.video_file_path ?? null,
      transcriptText: video?.transcript_text ?? null,
      collectedAt: article.fetched_at ? new Date(article.fetched_at) : new Date(),
    });

    // 旧收藏的媒体还在默认目录（~/.superman/uploads），一并复制进 vault，笔记里的 ![[attachments/…]] 才有效
    const mediaUrls = [
      ...imageUrls,
      ...(video?.video_url ? [video.video_url] : []),
      ...(video?.video_url ? [video.video_url.replace(/\.[^./\\]+$/, '.poster.jpg')] : []),
    ];
    for (const mediaUrl of mediaUrls) {
      await ensureMediaInVault(db, dir, mediaUrl);
    }

    const fileName = article.vault_note_path || `${slugify(title)}-${stampOf(new Date())}.md`;
    const notePath = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
    if (notePath.includes('..')) return;
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, notePath), markdown, 'utf8');
    if (article.vault_note_path !== notePath) {
      await db.query('update articles set vault_note_path = $1 where id = $2', [notePath, articleId]);
    }
  } catch (err) {
    console.error('[vault-export] 收藏落盘失败:', err);
  }
}

function isInside(baseDir: string, target: string): boolean {
  const rel = path.relative(baseDir, target);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** 删除收藏时连带清理 vault 里的笔记与附件文件（仅限目录内的文件）。 */
export async function deleteFavoriteFiles(db: QueryRunner, userId: number | string, articleId: number | string): Promise<void> {
  try {
    const dir = await getFavoriteDir(db, userId);
    if (!dir) return;
    const attRoot = attachmentsRoot(dir);

    const targets: string[] = [];
    const noteRes = await db.query('select vault_note_path from articles where id = $1 and user_id = $2', [articleId, userId]);
    const notePath = noteRes.rows[0]?.vault_note_path;
    if (typeof notePath === 'string' && notePath) {
      const abs = path.join(dir, notePath);
      if (isInside(dir, abs)) targets.push(abs);
    }
    const clipRes = await db.query('select image_urls from clips where article_id = $1', [articleId]);
    const imageUrls = Array.isArray(clipRes.rows[0]?.image_urls) ? (clipRes.rows[0].image_urls as unknown[]) : [];
    for (const url of imageUrls) {
      if (typeof url !== 'string') continue;
      const ref = mediaUrlToVaultRef(url);
      if (!ref) continue;
      const rel = ref.slice('attachments/'.length);
      const abs = path.join(attRoot, rel);
      if (isInside(attRoot, abs)) targets.push(abs);
    }
    const videoRes = await db.query(
      'select video_file_path from video_materials where article_id = $1 and user_id = $2',
      [articleId, userId],
    );
    const videoFilePath = videoRes.rows[0]?.video_file_path;
    if (typeof videoFilePath === 'string' && videoFilePath && isInside(attRoot, videoFilePath)) targets.push(videoFilePath);

    for (const file of targets) {
      await unlink(file).catch(() => {});
    }
  } catch (err) {
    console.error('[vault-export] 收藏文件清理失败:', err);
  }
}
