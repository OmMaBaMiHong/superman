/**
 * 推荐订阅兜底列表（P1-A）：recommended_feeds 表为空时伺服这份内置精选。
 * 覆盖科技/AI/B站头部博主；抖音博主需用户自己的 rsshub://douyin/user/<sec_uid>
 * 路由（sec_uid 无法离线枚举），兜底列表不放不可验证的抖音占位 URL。
 * platform 字段供前端配平台识别徽章。
 */
export interface RecommendedFeedFallbackItem {
  title: string;
  url: string;
  siteUrl?: string;
  description?: string;
  platform: 'rss' | 'bilibili' | 'douyin' | 'ai' | 'tech';
}

export const FALLBACK_RECOMMENDED_FEEDS: readonly RecommendedFeedFallbackItem[] = [
  // —— 科技/AI 媒体 ——
  { title: '36氪 - 24小时热榜', url: 'https://rsshub.app/36kr/hot-list', platform: 'tech', description: '36氪当日热文' },
  { title: '少数派', url: 'https://sspai.com/feed', siteUrl: 'https://sspai.com', platform: 'tech', description: '效率工具与数字生活' },
  { title: '阮一峰的网络日志', url: 'https://www.ruanyifeng.com/blog/atom.xml', siteUrl: 'https://www.ruanyifeng.com/blog/', platform: 'tech', description: '科技爱好者周刊' },
  { title: 'HelloGitHub 月刊', url: 'https://hellogithub.com/rss', siteUrl: 'https://hellogithub.com', platform: 'tech', description: '有趣的开源项目' },
  { title: 'Hacker News Best', url: 'https://rsshub.app/hackernews/best', platform: 'tech', description: 'HN 精选' },
  { title: 'Solidot', url: 'https://www.solidot.org/index.rss', platform: 'tech', description: '奇客的资讯' },
  { title: 'InfoQ 中文', url: 'https://rsshub.app/infoq/topic/1', platform: 'tech', description: '软件工程实践' },
  { title: '爱范儿', url: 'https://rsshub.app/ifanr/channel', platform: 'tech', description: '消费科技媒体' },
  // —— AI ——
  { title: 'OpenAI News', url: 'https://openai.com/news/rss.xml', siteUrl: 'https://openai.com/news', platform: 'ai', description: 'OpenAI 官方动态' },
  { title: 'Anthropic Research', url: 'https://rsshub.app/anthropic/research', platform: 'ai', description: 'Anthropic 研究' },
  { title: 'Google DeepMind Blog', url: 'https://rsshub.app/google/blog/technology/ai', platform: 'ai', description: 'DeepMind/AI 博客' },
  { title: 'Hugging Face Blog', url: 'https://huggingface.co/blog/feed.xml', siteUrl: 'https://huggingface.co/blog', platform: 'ai', description: '开源模型生态' },
  { title: '机器之心', url: 'https://rsshub.app/jiqizhixin/hot', platform: 'ai', description: 'AI 中文媒体热文' },
  { title: '量子位', url: 'https://rsshub.app/qbitai/category/资讯', platform: 'ai', description: 'AI 资讯' },
  // —— B站头部博主（rsshub 用户视频路由）——
  { title: '老师好我叫何同学', url: 'rsshub://bilibili/user/video/163637592', siteUrl: 'https://space.bilibili.com/163637592', platform: 'bilibili', description: '科技测评' },
  { title: '影视飓风', url: 'rsshub://bilibili/user/video/946974', siteUrl: 'https://space.bilibili.com/946974', platform: 'bilibili', description: '影像科技' },
  { title: '林亦LYi', url: 'rsshub://bilibili/user/video/696795707', siteUrl: 'https://space.bilibili.com/696795707', platform: 'bilibili', description: 'AI 科普' },
  { title: '科技美学', url: 'rsshub://bilibili/user/video/3766866', siteUrl: 'https://space.bilibili.com/3766866', platform: 'bilibili', description: '数码测评' },
];

/** 从订阅 URL 推断平台标签（推荐列表与订阅管理共用）。 */
export function inferFeedPlatform(url: string): RecommendedFeedFallbackItem['platform'] {
  // 同时覆盖裸域名与 rsshub:// 路由路径段（rsshub://bilibili/user/video/…）
  if (/bilibili|b23\.tv/i.test(url)) return 'bilibili';
  if (/douyin|iesdouyin/i.test(url)) return 'douyin';
  if (/openai|anthropic|deepmind|huggingface|jiqizhixin|qbitai/i.test(url)) return 'ai';
  return 'rss';
}
