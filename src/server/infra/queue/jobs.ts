export const JOB_FEED_FETCH = 'feed.fetch';
export const JOB_REFRESH_ALL = 'feed.refresh_all';
export const JOB_AI_SUMMARIZE = 'ai.summarize_article';
export const JOB_AI_TRANSLATE = 'ai.translate_article_zh';
export const JOB_AI_TRANSLATE_TITLE = 'ai.translate_title_zh';
export const JOB_AI_DIGEST_TICK = 'ai.digest_tick';
export const JOB_AI_DIGEST_GENERATE = 'ai.digest_generate';
export const JOB_FEVER_SYNC = 'fever.sync';
export const JOB_FEVER_SYNC_DUE = 'fever.sync_due';
/** 每分钟 tick：扫描到期的 GitHub 订阅并投递 github.fetch_repo */
export const JOB_GITHUB_SYNC_DUE = 'github.sync_due';
/** 单仓库同步：拉取 Release 并投影进 feeds/articles */
export const JOB_GITHUB_FETCH_REPO = 'github.fetch_repo';
export const JOB_ARTICLE_FILTER = 'article.filter';
export const JOB_ARTICLE_FULLTEXT_FETCH = 'article.fetch_fulltext';
export const JOB_SYSTEM_LOG_CLEANUP = 'system_logs.cleanup';
/** 每 30 分钟：读 TrendRadar 当天 SQLite，全量 upsert 热点雷达条目 */
export const JOB_TRENDRADAR_SYNC = 'trendradar.sync';
