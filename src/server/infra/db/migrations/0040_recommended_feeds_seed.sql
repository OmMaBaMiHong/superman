-- 推荐订阅源种子数据
-- 从 Folo.is Discover 热门榜单爬取，按订阅数排序
-- 混合 RSSHub 路由和原生 RSS，涵盖各分类优质内容
insert into recommended_feeds (title, url, site_url, icon_url, description, position) values
  -- 🔥 Folo 热门榜单 Top (实测订阅数)
  ('Trending repositories on GitHub today', 'https://rsshub.app/github/trending/daily/any', 'https://github.com/trending', null, 'GitHub 每日 Trending 仓库，46.6K 订阅者。', 10),
  ('OpenAI News', 'https://openai.com/news/rss.xml', 'https://openai.com', null, 'OpenAI 官方新闻动态，46.6K 订阅者。', 20),
  ('36氪 - 24小时热榜', 'https://rsshub.app/36kr/hot-list', 'https://36kr.com', null, '36氪 24小时热榜，15.2K 订阅者。', 30),
  ('Twitter @Tw93', 'https://rsshub.app/twitter/user/HiTw93', 'https://x.com/HiTw93', null, 'Tw93 的 Twitter 动态，4.7K 订阅者。', 40),
  ('让小产品的独立变现更简单 - ezindie.com', 'https://www.ezindie.com/feed/rss.xml', 'https://www.ezindie.com', null, '独立开发者变现经验分享，3.0K 订阅者。', 50),
  ('科学网 - 精选博文', 'https://rsshub.app/sciencenet/blog', 'https://blog.sciencenet.cn', null, '科学网精选博文，2.9K 订阅者。', 60),
  ('微信 ‧ 24h热文榜', 'https://rsshub.app/tophub/WnBe01o371', null, null, '微信 24 小时热文榜，2.7K 订阅者。', 70),
  ('Anthropic Research', 'https://rsshub.app/anthropic/research', 'https://anthropic.com', null, 'Anthropic 最新研究成果，2.7K 订阅者。', 80),
  ('橘鸦AI早报', 'https://imjuya.github.io/juya-ai-daily/rss.xml', 'https://imjuya.github.io', null, 'AI 领域每日早报精选，2.7K 订阅者。', 90),
  ('福利羊毛 - LINUX DO', 'https://linux.do/c/welfare/36.rss', 'https://linux.do', null, 'LINUX DO 社区福利羊毛信息，2.6K 订阅者。', 100),
  ('华尔街日报', 'https://cn.wsj.com/rss-news-and-feeds/zh-hans', 'https://cn.wsj.com', null, '华尔街日报中文版，2.6K 订阅者。', 110),
  ('虎嗅', 'https://rss.huxiu.com/', 'https://www.huxiu.com', null, '虎嗅网，商业科技资讯，2.5K 订阅者。', 120),
  ('Twitter @歸藏(guizang.ai)', 'https://rsshub.app/twitter/user/op7418', 'https://x.com/op7418', null, '歸藏 AI 相关 Twitter 动态，2.4K 订阅者。', 130),
  ('cnBeta.COM - 中文业界资讯站', 'https://rsshub.app/cnbeta', 'https://www.cnbeta.com', null, '中文业界资讯，2.3K 订阅者。', 140),
  ('经济学人最新报道', 'https://economistnew.buzzing.cc/feed.xml', 'https://www.economist.com', null, '经济学人中文报道，2.2K 订阅者。', 150),
  ('每周一书 – 书伴', 'https://rsshub.app/bookfere/weekly', 'https://bookfere.com', null, '每周一书推荐，2.1K 订阅者。', 160),
  ('《联合早报》-国际-即时', 'https://plink.anyfeeder.com/zaobao/realtime/world', 'https://www.zaobao.com', null, '联合早报国际即时新闻，2.1K 订阅者。', 170),
  ('Product Hunt 热门', 'https://ph.buzzing.cc/feed.xml', 'https://www.producthunt.com', null, 'Product Hunt 每日热门产品，1.2K 订阅者。', 180),
  ('Lex Fridman - YouTube', 'https://rsshub.app/youtube/user/@lexfridman', 'https://www.youtube.com/@lexfridman', null, 'Lex Fridman 播客视频，685 订阅者。', 190),
  ('Hacker News: Show HN', 'https://hnrss.org/show', 'https://news.ycombinator.com', null, 'Hacker News Show HN 板块，413 订阅者。', 200),

  -- 📚 经典优质源（补充非 Folo 榜单但值得推荐的内容）
  ('Google AI Blog', 'https://feeds.feedburner.com/blogspot/gJZg', 'https://ai.googleblog.com', null, 'Google AI 最新研究成果，涵盖搜索、TPU、算法等领域。', 210),
  ('Hugging Face Blog', 'https://huggingface.co/blog/feed.xml', 'https://huggingface.co/blog', null, 'NLP/ML 开源社区博客，最新模型发布与部署教程。', 220),
  ('arXiv AI Papers', 'https://rsshub.app/arxiv/cs.AI', 'https://arxiv.org/list/cs.AI/recent', null, 'AI 领域最新论文每日更新，保持学术前沿。', 230),
  ('MIT Technology Review', 'https://www.technologyreview.com/feed/', 'https://www.technologyreview.com', null, 'MIT 旗下科技评论，前沿技术解读。', 240),
  ('GitHub Blog', 'https://github.blog/feed/', 'https://github.blog', null, 'GitHub 官方更新、新功能发布和开发者故事。', 250),
  ('Dev.to', 'https://dev.to/feed', 'https://dev.to', null, '全球开发者社区，涵盖全栈技术文章。', 260),
  ('MDN Blog', 'https://developer.mozilla.org/en-US/blog/feed.xml', 'https://developer.mozilla.org', null, 'Mozilla 官方博客，Web 标准与前端技术。', 270),
  ('美团技术团队', 'https://tech.meituan.com/feed/', 'https://tech.meituan.com', null, '美团技术团队博客，分享大规模工程实战经验。', 280),
  ('V2EX', 'https://www.v2ex.com/index.xml', 'https://www.v2ex.com', null, '程序员社区，技术讨论与分享。', 290),
  ('Paul Graham Essays', 'https://paulgraham.com/rss.html', 'https://paulgraham.com', null, 'YC 创始人 Paul Graham 的深度思考文章。', 300),
  ('Simon Willison Blog', 'https://simonwillison.net/atom/everything/', 'https://simonwillison.net', null, 'Django 联合创始人，AI 务实应用研究。', 310),
  ('Julia Evans Blog', 'https://jvns.ca/atom.xml', 'https://jvns.ca', null, '用漫画和故事讲解 Linux 内核、网络协议。', 320),
  ('Smashing Magazine', 'https://www.smashingmagazine.com/feed/', 'https://www.smashingmagazine.com', null, 'Web 设计与开发权威杂志，前端技巧与设计理念。', 330),
  ('Dribbble Blog', 'https://blog.dribbble.com/feed/', 'https://blog.dribbble.com', null, '设计社区 Dribbble 官方博客，UI/UX 趋势。', 340)
on conflict (url) do nothing;