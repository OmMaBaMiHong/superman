# OpenWrite 免费模型研究与 Superman 接入

## 用户要求

研究 `/Users/wade/Downloads/OpenWrite-v1.3.2-windows-x64/` 免费模型代理方式，在 Superman 增加同类免费模型逻辑。保留 DSH 插件形态及现有 AI 配置，不修改 DSH 源码。

## 已验证证据

这是 Flutter Windows 发布包，业务逻辑位于 `data/app.so`，没有附带 Dart 源码。静态字符串可以证明程序包含以下配置，但不能单凭字符串断定所有运行分支：

| 文件偏移 | 内容 |
| --- | --- |
| 0x2359c0 | https://api.kilo.ai/api/openrouter |
| 0x2efad0 | https://api.kilo.ai/api/openrouter/models |
| 0x260780 | Bearer anonymous |
| 0x3de600 | openrouter/free |
| 0x2911c0 等 | 包内另有 Kilo 客户端标识字符串；实现不依赖冒充其客户端 |

包内同时有 OpenCode Zen、作者站点的公告/更新/设备心跳接口。设备心跳与模型匿名鉴权是不同线索；没有证据说明需要把设备登记到作者服务器才能调用免费模型。此次不移植这些作者服务或追踪逻辑。

官方资料交叉核实：

- https://kilo.ai/docs/gateway/authentication ：允许免费模型匿名访问，按 IP 限流。
- https://kilo.ai/docs/contributing/architecture/cloud-security ：`/api/openrouter` 与 `/api/gateway` 为兼容入口。
- https://kilo.ai/docs/gateway/usage-and-billing ：目前免费请求每 IP 每小时 200 次，超额返回 429。
- https://kilo.ai/docs/getting-started/using-kilo-for-free ：免费模型会变动，部分提供方会记录输入与输出。

2026-09-09 本机验证：GET models 返回 200，369 个模型中按免费 ID 筛得 19 项。使用公开匿名占位符、`openrouter/free` 和短提示 `Reply with only OK.` 调用 chat/completions，返回 200、`OK`，实际模型 `google/gemma-4-31b-it:free`，usage.cost=0。未调用作者服务器、未使用或提取第三方私有凭证。

## 实施计划与成功标准

1. 共享 AI 配置增加可选免费模式与独立免费模型字段，默认沿用现有配置。切换不覆盖原模型、接口、Key；免费模式只返回固定 Kilo 地址和匿名凭证，不回退收费模型。测试证明配置切换、翻译共享及配置指纹一致。
2. 插件提供当前设置、免费模型目录、保存和短提示测试接口。按登录用户保存设置，仅允许目录中价格为零且具有免费 ID 的模型；错误提示区分限流与不可用。测试证明鉴权、用户作用域、无关设置保留、付费模型拒绝。
3. Superman 设置页增加免费模型入口、动态下拉框和测试按钮，说明内容发往 Kilo 及其模型提供方。沿用现有治理、改写、评论分析和插件问答的 AI 调用链路。验证窄面板可用与实测响应。

执行位置是运行 DSH 的设备，不是远程打开 H5 的手机浏览器；集中部署会共享服务器出口 IP。只复用公开协议与行为，不声称复制了未提供的源码。

## 验收记录

- 设置页增加模型来源、动态免费模型列表、测试和保存入口。原模型/接口/Key 保留；当前账户仍使用原配置，选择免费模式并保存后生效。
- 修复阻碍入口使用的 H5 路由映射：底部设置的 `/?settings=open` 原先被转换为 `#/reader`，现在进入 `#/settings`。只修改 Superman 的 H5 转换函数。
- 治理、改写、评论分析和插件问答采用共享免费配置。摘要、智能报告与内容筛选的旧 Key 前置判断同步兼容免费模式，避免用户启用后仍被旧校验挡住或使用旧收费配置；翻译共享配置和任务配置指纹同步生效。专用翻译配置和向量模型保持各自配置。
- 93 项回归测试通过，包含真实 PostgreSQL 临时表事务验证设置保存、用户隔离、原配置保留、付费模型拒绝；另 1 项显式启用的真实网络测试通过：虚构图书馆新闻生成标题/摘要/理由/评分/知识分类，`usedFallback=false`，耗时约 53 秒。
- DSH 窄面板设置页真实点击“测试免费模型”，显示 `连接成功 · nex-agi/nex-n2.5-pro:free · OK`。下拉框加载 19 项免费模型。左侧 DSH 菜单和既有对话正常；未修改 DSH 源码或配置文件。
- 插件构建、改动模块 ESLint、diff 检查通过。apiClient.ts 仍有既有 `askKnowledge` 的 options 未使用 lint 错误；全项目类型检查仍有既有 GitHub 模块 6 处错误，本次无新增类型错误。
- 已执行 `graphify update .`；AST 提取完成，但 23075 节点超过 HTML 可视化上限，工具返回失败，未将生成图纳入提交。

免费服务有上游限流、可用性和延迟波动，不自动改用收费模型。这里的模型设置影响 Superman 自己的 AI 任务；DSH 主对话和发送到主对话的快捷指令仍使用 DSH 选择的模型。
