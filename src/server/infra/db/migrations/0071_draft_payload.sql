-- 草稿的平台化产物统一放 JSONB：标题候选 / 摘要 / 话题标签 / 封面文案 / 大纲。
-- 每个平台的字段不一致，用列会越加越乱；老数据默认空对象，读取端按缺省处理。
alter table drafts add column if not exists payload_json jsonb not null default '{}'::jsonb;
