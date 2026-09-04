# UI 风格改造方案 (FeedFuse)

> **版本**: v0.1 | **日期**: 2026-08-04 | **作者**: Product Manager
> **状态**: Draft | **关联 PRD**: `docs/prd-github-module.md`
> **参考图**: `clipboard-2026-08-04T15-26-45-880Z-09a3ec85.jpg`

---

## 0. 目标与范围

将 FeedFuse 整体视觉从「浅色极简 + 蓝色主色」升级为「**深色玻璃拟态 (Dark Glassmorphism) + 青绿色主色**」的 Knowledge OS 风格。

覆盖页面：
1. **发现页** (`src/features/discover/components/DiscoverPage.tsx`)
2. **知识库页** (`src/features/knowledge/components/KnowledgePage.tsx`)
3. **GitHub 模块页**（PRD 中规划，见 `docs/prd-github-module.md`）

**非目标**（本期不做）：三栏阅读器（ReaderLayout）重设计、登录页、设置中心弹窗。这些页面已有玻璃质感，本期不强行改动，留待后续统一。

---

## 1. 全局 Design Token

### 1.1 主色与语义色（替换现有 `--color-primary` 系列）

现有 primary 为蓝色系（`hsl(221 100% 50%)` / `hsl(234 56% 60%)`）。本次改为 **emerald-500 系青绿色**，以匹配参考图风格关键词。

| Token | 现有值 | 新值（浅色） | 新值（深色） | 说明 |
|-------|--------|--------------|--------------|------|
| `--color-primary` | `221 100% 50%` | `160 84% 39%` | `152 60% 50%` | 青绿主色 |
| `--color-primary-foreground` | `0 0% 100%` | `0 0% 100%` | `240 20% 98%` | 主色上文字 |
| `--color-ring` | `221 100% 50%` | `160 84% 39%` | `152 60% 50%` | 聚焦环 |
| `--color-success` | `142.1 70.6% 45.3%` | `152 60% 42%` | `152 64% 56%` | 保持绿色语义一致 |

> **理由**：青绿主色与深色玻璃背景对比度好，且符合参考图「青绿色」关键词。其余语义色（muted/secondary/accent/info/warning/error）保持现有 HSL 定义不变，降低改动面。

### 1.2 背景与表面（Glass 体系）

参考图核心特征是「深色径向渐变 + 模糊玻璃层」。需在 `globals.css` 的 `:root` / `.dark` 中新增以下层级变量：

```css
/* 仅示意变量名与语义，不展开完整源码 */
--glass-bg:            color-mix(in oklab, var(--color-background) 72%, transparent);
--glass-bg-strong:     color-mix(in oklab, var(--color-background) 85%, transparent);
--glass-border:        color-mix(in oklab, var(--color-foreground) 10%, transparent);
--glass-blur:          16px;
--glass-shadow:        0 8px 32px rgba(0,0,0,0.35);
```

背景渐变（`.dark body`）建议演进为：以 **emerald 微光** 替换现有 indigo 微光（参考图主调偏青绿而非靛蓝）：

```
radial-gradient(circle at top, rgb(16 185 129 / 0.14), transparent 34%)
radial-gradient(circle at 18% 18%, rgb(13 148 136 / 0.10), transparent 24%)
radial-gradient(circle at 82% 12%, rgb(5 150 105 / 0.08), transparent 22%)
linear-gradient(180deg, rgb(8 12 14 / 0.96), rgb(2 4 5 / 1))
```

### 1.3 形状与圆角

| Token | 值 | 用途 |
|-------|-----|------|
| `--radius-sm` | `0.5rem` (8px) | 标签、小按钮 |
| `--radius-md` | `0.75rem` (12px) | 卡片内元素、输入框 |
| `--radius-lg` | `1rem` (16px) | StatCard、GlassCard |
| `--radius-xl` | `1.5rem` (24px) | 大容器、抽屉、对话气泡 |

> 当前代码已用 `rounded-xl`/`rounded-2xl`/`rounded-[1.5rem]`，新规范统一到上述梯度。

### 1.4 阴影与模糊

| Token | 值 | 用途 |
|-------|-----|------|
| `--shadow-glass` | `0 8px 32px rgba(0,0,0,0.35)` | 玻璃卡片浮起 |
| `--shadow-glow` | `0 0 0 1px rgba(16,185,129,0.25), 0 8px 24px rgba(16,185,129,0.12)` | 主色聚焦/选中 |
| `--blur-glass` | `blur(16px) saturate(140%)` | 玻璃层 backdrop-filter |

### 1.5 间距与字号

- 页面主容器：`max-w-5xl`（从现有 `max-w-4xl` 略放宽以容纳统计卡片栅格）
- 区块间距：`gap-4` / `space-y-6`
- 标题：`text-2xl font-bold tracking-tight`（沿用现有）
- 卡片标题：`text-sm font-medium`；元信息：`text-xs text-muted-foreground`

### 1.6 字体

复用现有 `font-sans`（系统字体栈）。新增等宽字体变量用于代码/数字统计：

```
--font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
```
统计卡片数字使用 `--font-mono` + `tabular-nums` 保证对齐。

---

## 2. 可复用组件规范

> 以下为组件契约规范（props / 视觉 / 状态），工程师据此用 Radix + Tailwind 实现，不在此写实现代码。

### 2.1 GlassCard（玻璃卡片）

**用途**：所有浮层容器、面板、列表项基础容器。
**视觉**：
- 背景：`var(--glass-bg)` + `backdrop-blur-[var(--blur-glass)]`
- 边框：`1px solid var(--glass-border)`
- 圆角：`--radius-lg`
- 阴影：`--shadow-glass`
- hover：border 提亮至 `color-mix(foreground 16%)`，bg 微提
**Props**：`interactive?`, `padded?`, `className?`
**状态**：默认 / hover / active（主色细边 + glow）。
**暗色专属**：`dark:border-white/[0.06]` 边界微光，沿用现有 `mobileSurfaceClassName` 思路。

### 2.2 StatCard（统计卡片）

**用途**：顶部指标行（今日新增 / 未读库存 / 已读 / 长期未读）。
**布局**：左上图标（emerald tint 圆角方块）+ 大号数字（mono）+ 下方标签 + 可选趋势小字。
**视觉**：
- 容器：GlassCard 变体，`--radius-xl`，`p-4`
- 图标：`h-9 w-9 rounded-xl bg-primary/10 text-primary`
- 数字：`text-2xl font-semibold tabular-nums`
- 标签：`text-xs text-muted-foreground`
**变体**：`accent`（主色高亮，用于核心指标）/ `neutral`（灰调）

### 2.3 DetailDrawer（详情抽屉）

**用途**：选中列表项后从右侧滑出，展示元数据 + AI 助手建议。
**底层**：复用现有 `Sheet`（Radix Dialog 变体，`side="right"`），注入玻璃样式。
**布局**：
- 顶部：标题 + 来源/时间元信息行
- 中部：可滚动内容（Markdown 正文 / 元信息网格 / 来源列表）
- 底部固定区：「AI 助手建议」区块（`bg-primary/8 rounded-xl p-3`，含 Sparkles 图标）
**宽度**：沿用 `--layout-settings-drawer-max-width` 思路，建议 `max-w-md (28rem)`。
**视觉**：`dark:bg-[linear-gradient(180deg,rgba(13,17,19,0.92),rgba(8,11,12,0.88))]` + backdrop-blur。

### 2.4 NavRail（侧边导航）

**用途**：参考图「YCS Knowledge OS 式深色侧边栏」。
**现状**：阅读器已有左侧 FeedList 面板（`bg-muted/55` + 渐变）。发现/知识库页目前是居中 `max-w-4xl` 单列，**无独立 NavRail**。
**本期方案（轻量）**：不在发现/知识库页新建硬导航，而是复用**顶部 Tab 行 + 左对齐页面标题**替代重型 NavRail（避免与阅读器三栏冲突）。若后续要做统一 App Shell，NavRail 规范：
- 宽 `w-60`，`GlassCard` 左贴边，图标 + 文字双列
- 项：发现 / 阅读 / 知识库 / GitHub / 设置
- 选中态：`bg-primary/12 text-primary` + 左侧 2px 主色条
- 折叠态：仅图标 `w-14`

---

## 3. 发现页优化方向

**文件**：`src/features/discover/components/DiscoverPage.tsx`

### 3.1 改造要点

| 区域 | 现有 | 目标 |
|------|------|------|
| 容器 | `mx-auto max-w-4xl px-6 py-8` | `max-w-5xl`，背景继承全局渐变（无需白底） |
| 顶部 | 纯标题 + 描述 | **StatCard 行**（今日新增订阅源 / 热门推荐 / 已订阅数 / 未读数） |
| 分类筛选 | 圆角胶囊按钮（bg-muted） | GlassChip：玻璃底 + 选中态 `bg-primary/15 text-primary` + 主色细边 |
| 搜索框 | 普通 Input | 玻璃输入框：`bg-glass border-glass focus:ring-primary/40` |
| 列表项 | `hover:bg-muted/40` 行 | **GlassCard 列表**：每项独立玻璃卡片，`space-y-3`，图标方块 `bg-primary/10`，右侧订阅按钮玻璃化 |
| Tab 切换 | 无 | 新增 **RSS / GitHub** 顶部主 Tab（切换数据源，GitHub Tab 内容见第 5 节） |

### 3.2 列表项卡片结构（发现页）

```
[GlassCard]
├─ 左：图标方块 (bg-primary/10, Rss/BookOpen icon)
├─ 中：标题 (sm font-medium) + Badge[推荐/热门] + URL (xs muted) + 描述 (xs line-clamp-2)
└─ 右：ExternalLink(ghost) + 订阅按钮 (primary / outline 已订阅)
```

### 3.3 数据源切换

顶部主 Tab：`全部 / RSS / GitHub`。RSS 复用现有 `getRecommendedFeeds`；GitHub 预留接口（PRD R12）。

---

## 4. 知识库页优化方向

**文件**：`src/features/knowledge/components/KnowledgePage.tsx`

### 4.1 改造要点

| 区域 | 现有 | 目标 |
|------|------|------|
| 顶部 | 标题 + 清空按钮 | **StatCard 行**（对话轮次 / 引用来源数 / 今日提问 / 长期未整理） |
| 模式选择器 | 圆角边框按钮 | GlassChip 变体，选中 `bg-primary/15 text-primary border-primary/30` |
| 消息气泡 | user=`bg-primary` / assistant=`border bg-muted/30` | 保持语义，**升级为玻璃气泡**：assistant 用 `glass-bg + blur + border-glass`；user 用 `bg-primary/90` |
| 来源标签 | `border-border/50 bg-muted/20` | 玻璃 chip `bg-glass border-glass`，hover 提亮 |
| 输入区 | `border-border/70 bg-muted/20` | 玻璃输入条：`bg-glass backdrop-blur border-glass focus:border-primary/40` |
| 右侧详情 | 无 | 新增 **DetailDrawer**：选中某条 assistant 消息的「来源」时，右滑展示来源文章元数据 + AI 助手建议（摘要、相关推荐） |

### 4.2 问答时间轴

- 消息列表改为**时间轴视图**：左侧 emerald 渐变竖线 + 节点圆点（assistant=primary，user=foreground/30）
- 每条消息 GlassCard，hover 显示「查看来源详情」入口 → 触发 DetailDrawer

### 4.3 来源详情抽屉内容

```
[DetailDrawer]
├─ 标题：来源文章标题
├─ 元信息：来源 / 发布时间 / 阅读状态
├─ 正文摘要（Markdown 渲染）
└─ [AI 助手建议] bg-primary/8 rounded-xl：
   ├─ 一句话总结
   └─ 相关来源推荐 (chips)
```

---

## 5. GitHub 模块页建议

> 详细需求见 `docs/prd-github-module.md`。此处仅给 UI 方向，供工程师与架构师对齐。

### 5.1 仓库卡片 (GlassCard 变体)

```
[GlassCard interactive]
├─ 左：仓库 avatar (rounded-xl, bg-primary/10, GitBranch icon)
├─ 中：owner/repo (sm font-medium) + 描述 (xs muted line-clamp-2)
│     + 标签行：语言 Badge / stars / 上次更新
└─ 右：状态 Badge (已启用/已暂停) + ⚙ 配置 + 🗑 删除 + ▸ 展开
```

### 5.2 仓库详情抽屉 (DetailDrawer)

选中仓库 → 右滑：
```
[DetailDrawer]
├─ 标题：owner/repo
├─ 元信息网格：stars / forks / open issues / 语言 / 订阅状态
├─ 关注范围：Release / Issue / PR / Commit (GlassChip 多选展示)
├─ 刷新状态：last_fetched_at / next_fetch_at / error (如有)
└─ [AI 助手建议]：该仓库近期活跃度解读
```

### 5.3 Release 时间轴

GitHub 条目列表用**时间轴**（与知识库一致语言）：
```
emerald 竖线
├─ ● [Release] v19.0 — reactjs/react · 2h
│     GlassCard: 标题 + 时间 + 标签[tag] + 摘要预览 + 「查看」→ DetailDrawer
├─ ● [PR] #1234 Fix hydration — vercel/next.js · 5h
└─ ● [Issue] ...
```
类型 Badge 配色（沿用 PRD）：
- Release：`bg-gray-500/15 text-gray-300`
- PR：`bg-emerald-500/15 text-emerald-400`
- Issue：`bg-amber-500/15 text-amber-400`
- Commit：`bg-sky-500/15 text-sky-400`

---

## 6. Tailwind 4 Token 适配建议

现有 `globals.css` 使用 Tailwind 4 `@theme` + `@layer base` 定义 `:root` / `.dark` 变量。适配步骤：

1. **改 primary 色相**：在 `@theme` 的 `.dark` 块中，将 `--color-primary` 由 `234 56% 60%` 改为 `152 60% 50%`；`:root`(浅色) 改为 `160 84% 39%`。同步改 `--color-ring`、`--color-primary-foreground`。
2. **新增玻璃变量**：在 `@layer base` 的 `:root` 与 `.dark` 中新增 `--glass-bg` / `--glass-border` / `--glass-blur` / `--shadow-glass` / `--shadow-glow` / `--font-mono`（见 §1.2/1.4/1.6）。
3. **背景渐变升级**：`.dark body` 的 `background-image` 径向渐变从 indigo 微光改为 emerald 微光（§1.2 片段）。
4. **复用既有玻璃工具类**：代码已存在 `supports-[backdrop-filter]`、`FROSTED_HEADER_CLASS_NAME`、`mobileSurfaceClassName` 等玻璃实现，新组件优先复用而非重写。
5. **组件层封装**：建议在 `src/components/glass/` 下新增 `GlassCard.tsx` / `StatCard.tsx` / `GlassChip.tsx` / `DetailDrawer.tsx`，统一消费上述 token；发现页 / 知识库 / GitHub 页均引用，避免样式漂移。
6. **不改项**：`muted` / `secondary` / `accent` / `info` / `warning` / `error` 保持原值；阅读器三栏布局本期不动。

### 风险与注意
- **对比度**：emerald-500 在深色背景上需保证正文 `foreground` 仍用近白（`hsl(240 14% 93%)`），主色仅用于强调与交互，不用于大段文字。
- **性能**：`backdrop-blur` 在长列表（发现页/Release 时间轴）逐项使用可能掉帧，建议仅 GlassCard 容器层 blur，列表项内部不叠加 blur。
- **降级**：`prefers-reduced-motion` 已全局处理，玻璃过渡动画需同步尊重该设置。

---

## 7. 实现优先级（建议）

| 阶段 | 内容 |
|------|------|
| P0 | §1 Token 改造（primary 改色 + 玻璃变量 + 背景渐变）+ `GlassCard`/`StatCard`/`GlassChip` 基础组件 |
| P1 | 发现页 StatCard 行 + 玻璃列表项 + RSS/GitHub Tab；知识库玻璃气泡 + 时间轴 |
| P2 | `DetailDrawer` 通用化；GitHub 模块页（仓库卡片 + 详情抽屉 + Release 时间轴）；NavRail（如需统一 App Shell） |

---

*文档结束。下一步：工程师依据本规范与 PRD 实现；架构师可据此确认组件目录与 token 落地方式。*
