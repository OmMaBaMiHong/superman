import { readFileSync, writeFileSync } from 'node:fs';

/**
 * 把抖音明文 Cookie（key=value; key2=value2 格式）转换为 yt-dlp 可读的
 * Netscape cookies.txt 文件。
 */
function main() {
  const raw = readFileSync('/tmp/dy_cookie_raw.txt', 'utf-8').trim();
  const lines = [
    '# Netscape HTTP Cookie File',
    '# This file was generated for yt-dlp douyin download.',
  ];
  for (const pair of raw.split(/;\s*/)) {
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    const name = pair.slice(0, idx);
    const value = pair.slice(idx + 1);
    lines.push(`#HttpOnly_.douyin.com\tTRUE\t/\tTRUE\t0\t${name}\t${value}`);
  }
  writeFileSync('/tmp/dy_cookies_netscape.txt', lines.join('\n'));
  console.log('wrote', lines.length - 2, 'cookies');
}

main();
