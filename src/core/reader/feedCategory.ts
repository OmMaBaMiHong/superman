/**
 * 订阅源分类（本地标签库）。
 *
 * 现状：中台只下发「推荐条目」本身，不带内容分类标签；feeds.category_id 是用户手动分类，
 * 大量订阅源为空。所以这里给一套**可维护的关键词标签库**做兜底推断——命中即归类，
 * 不命中落「其他」。手动分类优先（category_id 有值时用它的名字），推断只补空缺。
 *
 * 维护方式：改 CATEGORY_RULES 即可，顺序即优先级（先命中先返回）。
 * 关键词统一小写匹配（标题 + url + site_url 拼一起）。
 */

export const FEED_CATEGORIES = ['AI', '财经', '科技', '开发', '新闻', '生活', '其他'] as const;
export type FeedCategory = (typeof FEED_CATEGORIES)[number];

/** 关键词 → 分类；数组顺序即优先级。 */
const CATEGORY_RULES: ReadonlyArray<readonly [FeedCategory, readonly string[]]> = [
  ['AI', [
    'openai', 'anthropic', 'claude', 'chatgpt', 'deepmind', 'huggingface', 'hugging face',
    'gemini', 'llm', '大模型', '人工智能', '机器学习', '深度学习', '机器之心', '量子位',
    'aigc', 'midjourney', 'stable diffusion',
  ]],
  ['财经', [
    '华尔街日报', '财新', '第一财经', '彭博', 'bloomberg', 'reuters', '路透', '雪球', '同花顺',
    '财经', '经济', '商业', '投资', '股票', '基金', '金融', '创业', '36氪', '36kr', '虎嗅',
    '钛媒体', '亿邦', '晚点', '福布斯', 'forbes', 'wsj', 'ft.com', '金融时报',
    '财报', '美联储', '央行', '利率', '通胀', 'a股', '港股', '美股',
  ]],
  ['科技', [
    'theverge', 'the verge', 'techcrunch', 'engadget', 'wired', 'arstechnica', 'ars technica',
    '少数派', 'sspai', '爱范儿', 'ifanr', '极客', 'geek', '数字尾巴', 'cnbeta', 'it之家', 'ithome',
    '测评', '评测', 'review', '数码', '手机', '硬件', '芯片', '科技',
  ]],
  ['开发', [
    'github', 'hacker news', 'hackernews', 'dev.to', 'stackoverflow', '掘金', 'juejin', 'v2ex',
    '开源', 'open source', 'programming', '程序员', '代码', 'sdk', 'api ', 'golang', 'rust',
    'javascript', 'typescript', 'python', 'linux',
  ]],
  ['新闻', [
    '新华', '人民网', '人民日报', '央视', '环球时报', 'bbc', 'cnn', '纽约时报', 'nytimes',
    '美联社', 'apnews', '新闻', '日报', '晚报', '时政', '观察者',
  ]],
  ['生活', [
    '小红书', '知乎', '豆瓣', '美食', '旅行', '电影', '音乐', '读书', '文化', '健康', '健身',
    '摄影', '穿搭', 'pinterest',
  ]],
];

/** 按标题/域名推断分类；都不命中返回「其他」。 */
export function inferFeedCategory(input: {
  title?: string | null;
  url?: string | null;
  siteUrl?: string | null;
}): FeedCategory {
  const title = input.title ?? '';
  const haystack = `${title} ${input.url ?? ''} ${input.siteUrl ?? ''}`.toLowerCase();
  if (!haystack.trim()) return '其他';
  // 中文标题里「AI」常直接贴在汉字间（如「橘鸦AI早报」），小写子串会被英文单词误伤，
  // 所以单独用「独立大写 AI / 独立小写 ai 词」判断。
  if (/(^|[^A-Za-z])AI([^A-Za-z]|$)/.test(title) || /(^|[^a-z])ai([^a-z]|$)/.test(haystack)) return 'AI';
  for (const [category, keywords] of CATEGORY_RULES) {
    if (keywords.some((keyword) => haystack.includes(keyword))) return category;
  }
  return '其他';
}
