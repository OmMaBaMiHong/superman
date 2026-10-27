-- 可订阅目录（配置化事实源）：面板加号勾选列表的数据来源。
-- 与用户勾选（user_source_prefs）、已采集数据完全解耦——空库也列出全部可订阅项。
-- 后续中台推送新渠道 = 往本表插行；种子为热点内置渠道。
CREATE TABLE IF NOT EXISTS subscribe_catalog (
  source     TEXT NOT NULL,
  key        TEXT NOT NULL,
  label      TEXT NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source, key)
);

INSERT INTO subscribe_catalog (source, key, label, sort) VALUES
  ('hot', 'zhihu',   '知乎热榜',   10),
  ('hot', 'weibo',   '微博热搜',   20),
  ('hot', 'baidu',   '百度热搜',   30),
  ('hot', 'toutiao', '头条热榜',   40),
  ('hot', 'douyin',  '抖音热点',   50)
ON CONFLICT (source, key) DO NOTHING;
