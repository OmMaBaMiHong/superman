-- 0005_seed.sql —— 内置策略种子数据

INSERT INTO strategy_templates (name, slug, description, system_prompt, user_prompt_template, output_schema, is_builtin, max_tokens)
VALUES (
  '变现逻辑分析',
  'monetization',
  '分析短视频的变现逻辑：内容定位、目标受众、变现方式、变现路径、CTA设计、变现评分',
  '你是短视频变现分析专家。对给定的短视频（标题 + 文案 + 平台数据）做结构化变现分析，只输出一个 JSON 对象，不要任何解释文字或 Markdown 代码块。',
  E'标题：{{title}}\n作者：{{author}}\n平台：{{platform}}\n数据：{{stats}}\n文案：\n{{transcript}}',
  '{"type":"object","properties":{"content_topic":{"type":"string"},"content_category":{"type":"string","enum":["知识教学","工具推荐","赚钱项目","产品种草","资讯播报","情绪共鸣","生活记录","其他"]},"target_audience":{"type":"string"},"monetization_method":{"type":"array","items":{"type":"string","enum":["广告分成","知识付费","带货佣金","引流私域","接商单","卖课","工具服务","会员订阅","无变现"]}},"monetization_path":{"type":"string"},"cta_design":{"type":"string"},"trust_building":{"type":"string"},"monetization_score":{"type":"integer","minimum":0,"maximum":100},"key_selling_points":{"type":"array","items":{"type":"string"}},"replicable":{"type":"boolean"},"rewrite_suggestion":{"type":"string"}},"required":["content_topic","content_category","monetization_method","monetization_score"]}'::jsonb,
  true,
  2048
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO strategy_templates (name, slug, description, system_prompt, user_prompt_template, output_schema, is_builtin, max_tokens)
VALUES (
  '内容分类聚合',
  'content_taxonomy',
  '对短视频做内容分类：一级分类、二级标签、教学格式、实用价值、可改编形式',
  '你是短视频内容分类专家。对给定的短视频做结构化分类，只输出一个 JSON 对象，不要任何解释文字或 Markdown 代码块。',
  E'标题：{{title}}\n作者：{{author}}\n平台：{{platform}}\n数据：{{stats}}\n文案：\n{{transcript}}',
  '{"type":"object","properties":{"primary_category":{"type":"string"},"secondary_tags":{"type":"array","items":{"type":"string"}},"teaching_format":{"type":"string","enum":["步骤演示","概念讲解","案例分析","工具实操","经验分享","无教学"]},"practical_value":{"type":"integer","minimum":1,"maximum":5},"actionable_items":{"type":"array","items":{"type":"string"}},"adaptable_for_repurpose":{"type":"boolean"},"repurpose_formats":{"type":"array","items":{"type":"string","enum":["公众号文章","短视频脚本","社群分享","课程素材","不适合改编"]}}},"required":["primary_category","secondary_tags","teaching_format"]}'::jsonb,
  true,
  2048
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (id, name, position) VALUES (1, '短视频', 1) ON CONFLICT DO NOTHING;
INSERT INTO categories (id, name, position) VALUES (2, '自媒体', 2) ON CONFLICT DO NOTHING;
INSERT INTO categories (id, name, position) VALUES (3, '技术', 3) ON CONFLICT DO NOTHING;
