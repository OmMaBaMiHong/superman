-- GitHub 可订阅目录种子（治理分类事实，与中台 tag 库一致）：
-- 本地永久缓存，中台在线时 refresh 覆盖更新——中台断了目录依旧完整。
INSERT INTO subscribe_catalog (source, key, label, sort) VALUES
  ('github', 'gh-ai',          'AI 与智能体',    10),
  ('github', 'gh-mcp',         'MCP 生态',       20),
  ('github', 'gh-devtools',    '开发工具',       30),
  ('github', 'gh-web',         'Web 与前端',     40),
  ('github', 'gh-data',        '数据与数据库',   50),
  ('github', 'gh-ml',          '机器学习',       60),
  ('github', 'gh-security',    '安全',           70),
  ('github', 'gh-automation',  '自动化与运维',   80),
  ('github', 'gh-apple',       '苹果生态',       90),
  ('github', 'gh-productivity','效率与笔记',    100),
  ('github', 'gh-content',     '内容创作与自媒体',110),
  ('github', 'gh-crawler',     '爬虫与数据采集', 120),
  ('github', 'gh-site',        '建站与自助搭建', 130),
  ('github', 'gh-browser',     '浏览器插件',     140),
  ('github', 'gh-design',      '设计与素材',     150),
  ('github', 'gh-finance',     '金融与量化',     160),
  ('github', 'gh-learn',       '学习与资源',     170),
  ('github', 'gh-ecommerce',   '电商与跨境',     180)
ON CONFLICT (source, key) DO NOTHING;
