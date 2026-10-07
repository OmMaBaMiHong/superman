-- ============================================================
-- 0066_article_user_note.sql —— 收藏备注 / 想法（user_note）
--
-- 背景：用户收藏链接/文案时往往没想到产品思路，事后才想补充「想法 / 备注 / 备案」。
--   该备注需可编辑，并参与「生成稿件」的提示词（作为用户要求注入）。
-- 落点：articles.user_note（收藏 = articles，含剪贴板收藏与 ⭐ 收藏，统一一处）。
--
-- 迁移安全性：if not exists，幂等；回滚 drop column 即可。
-- ============================================================

alter table articles
  add column if not exists user_note text not null default '';
