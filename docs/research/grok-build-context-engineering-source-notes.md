# Grok Build 上下文工程与 Agent Runtime 源码笔记

> 研究对象：官方 `xai-org/grok-build` 本地源码快照，`SOURCE_REV=2ec0f0c8488842da03a71eeee3c61154957ca919`。
> 范围：提示词与上下文装配、token 预算、历史裁剪/压缩、工具结果、缓存、会话恢复、子 agent、hooks/skills、可观测性与离线评估。
> 方法：只使用仓库内第一方源码和仓库自带的第三方归属声明，不以 README 宣传文字代替实现证据。

## 结论先行

Grok Build 最值得 Catty 学的不是某一个 prompt，而是以下 8 个机制组成的闭环：

1. **把上下文做成可检查、可持久化的数据结构，而不是散落的字符串拼接。** `PromptContext` 明确记录 audience、prompt mode、AGENTS.md、memory、role/persona、运行环境和构建时间，再统一渲染；父 agent 与子 agent 使用不同模板和目录信息，但项目指令保持一致。[`prompt/context.rs:79-151`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-agent/src/prompt/context.rs#L79-L151) [`prompt/context.rs:160-171`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-agent/src/prompt/context.rs#L160-L171) [`prompt/context.rs:251-297`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-agent/src/prompt/context.rs#L251-L297)
2. **在真正压缩前先做分层、可逆的减负。** 超过 50% 才对请求副本裁剪旧工具结果；近 3 轮不动，较老大结果保留头尾，10 轮以前的结果只留占位；原始事件流仍保留用于重放。[`request_builder.rs:20-108`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-chat-state/src/actor/request_builder.rs#L20-L108) [`request_builder.rs:155-208`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-chat-state/src/actor/request_builder.rs#L155-L208) [`types.rs:67-97`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-chat-state/src/types.rs#L67-L97) [`mutations.rs:165-205`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-chat-state/src/actor/mutations.rs#L165-L205)
3. **把两段式压缩的第一段放到后台提前跑。** 达到正式压缩阈值前 10 个百分点时，后台总结约 95% 的历史；真正触发压缩时只需把 NOTE1 与最近约 5% 合并成最终摘要。缓存带前缀指纹与 model 标识，历史编辑、回退、分叉或切模型后自动失效。[`compaction.rs:34-63`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/compaction.rs#L34-L63) [`compaction.rs:219-340`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/compaction.rs#L219-L340) [`compaction.rs:342-429`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/compaction.rs#L342-L429) [`two_pass.rs:1-20`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/two_pass.rs#L1-L20)
4. **压缩不是不可逆删除：摘要之外保留可检索的分段档案。** `Summary`、原始 transcript、Markdown segments 三种模式可选；segments 模式给后继 agent 一个索引和只读恢复路径，摘要不够时再按需读取精确代码、错误和工具输出。[`compaction_mode.rs:7-20`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-chat-state/src/compaction_mode.rs#L7-L20) [`compaction_mode.rs:51-77`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-chat-state/src/compaction_mode.rs#L51-L77) [`fork.rs:92-106`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/fork.rs#L92-L106)
5. **压缩后显式重新注入运行状态，而不是赌摘要记住一切。** 新上下文重建时单独采集正在运行的终端任务、子 agent、改过的文件、MCP 服务、todo、skills、AGENTS.md、plan mode 和 memory，再生成 system reminder；这比把所有责任交给总结模型更可靠。[`compaction.rs:1205-1350`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/compaction.rs#L1205-L1350) [`compaction.rs:1381-1499`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/compaction.rs#L1381-L1499)
6. **所有工具调用历史都做结构完整性修复。** 在恢复、下一轮写入和发请求边界去重重复 ToolResult、为悬空 tool call 补合成结果；另有显式 repair 路径移除会导致 provider 400 的孤儿结果。[`mutations.rs:26-70`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-chat-state/src/actor/mutations.rs#L26-L70) [`mutations.rs:80-109`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-chat-state/src/actor/mutations.rs#L80-L109)
7. **子 agent 是独立可恢复会话，不只是一次函数调用。** 子 agent 有独立 session id、原始 transcript、tool state、model、cwd、能力与隔离模式；支持继续以前的子 agent、后台运行、父轮取消隔离、进度/用量拉取，并把用量按 model 汇总回父账单。[`task/types.rs:29-68`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/implementations/grok_build/task/types.rs#L29-L68) [`task/types.rs:84-108`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/implementations/grok_build/task/types.rs#L84-L108) [`task/types.rs:304-335`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/implementations/grok_build/task/types.rs#L304-L335) [`usage.rs:100-146`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-chat-state/src/usage.rs#L100-L146)
8. **压缩路径本身是可观测、可离线重放的产品功能。** 每次压缩记录触发比例、阈值、输入/输出 token、重试阶段、失败类别、TTFT、流耗时、最大 token 间隔、两段式命中/失效等；同时把“实际送给压缩模型的历史 + 返回摘要/错误”保存成 artifact，供离线迭代 prompt。[`compaction.rs:800-864`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/compaction.rs#L800-L864) [`session_compact.rs:219-310`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/helpers/session_compact.rs#L219-L310) [`persistence.rs:360-374`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/persistence.rs#L360-L374)

对 Catty 的优先级建议：先做 **压缩后状态再注入 + 工具历史完整性修复 + 压缩 artifact/eval**；随后做 **可恢复 segments**；最后用实验开关验证 **后台两段式压缩**。这些项的收益与风险边界最清晰。

## 1. 提示词与上下文装配

### 1.1 PromptContext 是正式协议

`PromptContext` 是可序列化的第一等对象，而不是最终 prompt 的临时参数。它包含 schema version、prompt mode、父/子 audience、可覆盖的基础模板、AGENTS.md 列表、memory 路径、role/persona、OS/shell/cwd/date 和 non-interactive 状态。[`prompt/context.rs:79-151`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-agent/src/prompt/context.rs#L79-L151)

渲染统一走 ToolBridge 的模板引擎，因此工具名不是写死在 prompt 中，换工具集或兼容模式时仍能解析正确名称；`Extend` 支持基础模板 + 自定义 body，`Full` 支持完全替换。[`prompt/context.rs:233-297`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-agent/src/prompt/context.rs#L233-L297)

父/子 agent 的差异被显式建模：子 agent 用紧凑模板、不接收 persona catalog，但仍接收完整 AGENTS.md，避免验证型子任务绕过项目约束。[`prompt/context.rs:68-77`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-agent/src/prompt/context.rs#L68-L77) [`prompt/context.rs:160-170`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-agent/src/prompt/context.rs#L160-L170) [`prompt/context.rs:205-220`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-agent/src/prompt/context.rs#L205-L220)

**Catty 可借鉴：** 给现有 system prompt/context manager 增加一个可 dump、可版本化的 `PromptContextSnapshot`，让问题排查能回答“这轮究竟注入了什么、来自哪里、为何出现”。

### 1.2 项目规则有顺序、来源和幂等性

AGENTS.md/rules 的查找顺序是 global → repo root → cwd，越深的文件越晚出现、冲突时优先；兼容 Claude/Cursor 规则目录，并受 gitignore 过滤，最终按 canonical path 去重。[`agents_md.rs:66-77`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-agent/src/prompt/agents_md.rs#L66-L77) [`agents_md.rs:87-168`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-agent/src/prompt/agents_md.rs#L87-L168)

每段规则保留源文件路径，rules frontmatter 被剥离；恢复会话时通过结构标签或 legacy 前缀识别已有项目指令，避免重复注入。[`agents_md.rs:186-229`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-agent/src/prompt/agents_md.rs#L186-L229) [`prompt_build.rs:65-90`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/acp_session_impl/prompt_build.rs#L65-L90)

### 1.3 大用户输入采用“内联摘要 + 文件指针”

首轮大 prompt 超过 25 KB 时，不直接粗暴截掉尾部：会把全文写到 session 文件，内联内容按 query 80%、context 余量、skills 独立 4 KB 预算分配，并保留 head + tail，确保结尾真正问题仍在；写盘失败则改成无路径的诚实提示，避免模型追逐不存在的文件。[`prompt_build.rs:185-202`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/acp_session_impl/prompt_build.rs#L185-L202) [`prompt_build.rs:203-276`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/acp_session_impl/prompt_build.rs#L203-L276) [`prompt_build.rs:278-309`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/acp_session_impl/prompt_build.rs#L278-L309)

这和 Catty 已有的 tool output handle 思路相似，但 Grok 把同一模式也用于用户输入。值得统一成通用的“上下文外置对象”：有稳定 handle、摘要、大小、来源、读取工具和生命周期。

## 2. Token 预算与上下文计量

Grok 把 bytes/4 估算、图片固定成本、百分比、剩余量和阈值判断放在共享 crate，所有 UI、预检和自动压缩使用同一套整数语义；阈值是 `>=`，边界行为有测试固定。[`xai-token-estimation/src/lib.rs:1-32`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-token-estimation/src/lib.rs#L1-L32) [`xai-token-estimation/src/lib.rs:35-104`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-token-estimation/src/lib.rs#L35-L104) [`xai-token-estimation/src/lib.rs:188-207`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-token-estimation/src/lib.rs#L188-L207)

运行时不是只信模型上次返回的 usage：`get_estimated_total_tokens` 会把上次模型总量与之后新增的工具结果估算相加，用于下一次请求前的 overflow 检查。[`handle.rs:403-419`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-chat-state/src/handle.rs#L403-L419) [`mutations.rs:112-127`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-chat-state/src/actor/mutations.rs#L112-L127)

工具 schema 本身也进入压缩预算；输入溢出时采用 `verbatim → fitted verbatim → lossy` 的降级阶梯，fitted 为摘要预留 32,768 token，再扣除工具 schema token；lossy 最多使用窗口 70%。[`compaction.rs:879-890`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/compaction.rs#L879-L890) [`compaction.rs:931-946`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/compaction.rs#L931-L946) [`compaction.rs:1062-1116`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/compaction.rs#L1062-L1116)

**Catty 可借鉴：** 统一 `tokenEstimator`、UI context 指示、step pruning 与 413 预检的边界语义；把 tool schema、pending tool output、图片字节都纳入“下一请求成本”，而不是只看上一响应 usage。

## 3. 历史裁剪、压缩与可恢复性

### 3.1 三层减负

第一层是工具本身输出限额：一般工具默认 40 KB，终端结果默认 20,000 字符；完整终端输出写文件，模型收到头尾预览和文件路径。[`xai-grok-tools/src/lib.rs:5-16`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/lib.rs#L5-L16) [`types/output.rs:413-432`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/types/output.rs#L413-L432) [`types/output.rs:1217-1238`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/types/output.rs#L1217-L1238)

第二层是请求副本 pruning：只在窗口超过 50% 后运行，近 3 个用户轮不动；较老且超过 4,000 字符的结果保留头尾各 1,500；10 轮以前只留 placeholder。[`request_builder.rs:155-208`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-chat-state/src/actor/request_builder.rs#L155-L208) [`types.rs:67-97`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-chat-state/src/types.rs#L67-L97)

第三层才是整段 compaction。默认阈值 85%，可配模型、memory flush、5 分钟 wall-clock backstop，并可启用两段式模式。[`xai-grok-agent/src/compaction.rs:3-44`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-agent/src/compaction.rs#L3-L44)

这种分层优于“每轮都压缩工具结果”：它刻意保护稳定前缀，避免频繁改写旧消息导致 KV cache miss。[`request_builder.rs:64-85`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-chat-state/src/actor/request_builder.rs#L64-L85)

### 3.2 两段式后台预压缩

两段式先按估算 token 权重切分约 95%/5%，且切点会避开 assistant tool_calls 与对应 ToolResult，保证结构合法。[`two_pass.rs:29-50`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/two_pass.rs#L29-L50) [`two_pass.rs:52-139`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/two_pass.rs#L52-L139)

NOTE1 最多 12,000 字符；优先取完整、足够长的 `<summary>`，否则使用原始输出。正式压缩前缓存必须同时满足 prefix_len、model slug、前缀 fingerprint 三项，任何不一致都退回单段压缩。[`two_pass.rs:14-20`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/two_pass.rs#L14-L20) [`two_pass.rs:141-187`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/two_pass.rs#L141-L187) [`compaction.rs:379-415`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/compaction.rs#L379-L415)

它还区分“后台已经完成的延迟”和“用户实际等待的延迟”，只有后者计入最终 TTFT；这是评估 speculative work 是否真的降低用户等待的正确方法。[`compaction.rs:342-355`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/compaction.rs#L342-L355) [`compaction.rs:416-428`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/compaction.rs#L416-L428)

**风险：** 后台 pass1 会额外花 token，且 prefix fingerprint 目前只 hash item 类型和 text_content，没有显式 hash tool call arguments；如果 tool calls 的参数不在 `text_content()` 中，理论上可能出现缓存误命中。Catty 若实现，应使用完整 canonical serialization fingerprint，并先用命中率、浪费 token、同步等待下降三项实验数据验证。

### 3.3 压缩后恢复精确细节

`CompactionMode` 提供 summary-only、指向原始 `updates.jsonl`、以及 clean Markdown segment store 三种模式。后两者在摘要尾部告诉后继 agent 如何用 read/grep 找回精确内容。[`compaction_mode.rs:7-20`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-chat-state/src/compaction_mode.rs#L7-L20) [`compaction_mode.rs:51-77`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-chat-state/src/compaction_mode.rs#L51-L77)

segment 有独立索引、关键词、turn/tool/file/error 统计和不同细节级别；fork 时连同 segments 一起复制，因此子分支不会因为父会话压缩失去早期证据。[`compaction_transcript.rs:75-140`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-chat-state/src/compaction_transcript.rs#L75-L140) [`compaction_transcript.rs:184-267`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-chat-state/src/compaction_transcript.rs#L184-L267) [`fork.rs:92-106`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/fork.rs#L92-L106)

**Catty 可借鉴：** `ToolOutputStore` 解决的是大工具输出，segments 解决的是“摘要后整个旧对话”。两者可共用 handle/read 基础设施：压缩摘要携带结构化 archive manifest，按 segment/turn/tool/file 查询，而非只给一个巨大 transcript 路径。

### 3.4 压缩后重新建立“工作现场”

压缩成功后，Grok 不直接只留下 system + summary。它重新构造 AGENTS.md、skills、memory、计划模式、运行中的后台命令、活跃子 agent、改过的文件、MCP 和 todo，再对 compacted history 做 orphan ToolResult 清理与验证；若仍不合法，退回更小的安全历史。[`compaction.rs:1205-1350`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/compaction.rs#L1205-L1350) [`compaction.rs:1425-1499`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/compaction.rs#L1425-L1499) [`compaction.rs:1504-1548`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/compaction.rs#L1504-L1548)

这是对 Catty 最直接的改进点：现有 SessionState reinjection 可以扩展为正式的 `ContinuationState`，明确包含 active jobs、subagents、todo/plan、edited files、MCP/tool catalog version、skills/AGENTS snapshot、外置输出 handles，并有 schema/version 和恢复测试。

## 4. 工具结果与缓存

Grok 明确区分 `ToolRunResult.output`（干净、协议/序列化/追踪用）和 `prompt_text`（可附 reminder、专供模型），避免 UI/协议数据被模型提示加工污染。[`types/output.rs:128-145`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/types/output.rs#L128-L145)

对话完整性修复发生在确定的写边界，不在任意读取时运行，避免把仍在执行中的并行工具误判为悬空；修复会持久化，因而恢复后不会重复撞 provider 400。[`mutations.rs:26-43`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-chat-state/src/actor/mutations.rs#L26-L43) [`mutations.rs:47-70`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-chat-state/src/actor/mutations.rs#L47-L70)

图片处理也考虑 cache：只有请求体接近 50 MB 才批量移除最旧图片，并一次降到 25 MB，形成迟滞区，避免每轮移一张、每轮破坏 KV 前缀；占位文案明确告诉模型图片已不可见，避免凭“记忆”幻觉描述。[`request_builder.rs:215-265`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-chat-state/src/actor/request_builder.rs#L215-L265)

**Catty 可借鉴：** 所有会改写历史前缀的策略都应有 cache-cost 意识；用 high-water/low-water 批处理，而不是刚过线就做最小改写。并将“干净工具结果”和“给模型看的文本”拆为两个字段，防止 reminder、裁剪标记污染恢复/审计数据。

## 5. 会话恢复与分叉

本地会话只有存在 `summary.json` 才算可恢复，避免只有 images 的残缺目录劫持 resume；远端恢复会寻找同 cwd 下最新的本地 child，避免重复恢复。[`persistence.rs:395-419`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/persistence.rs#L395-L419) [`persistence.rs:422-453`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/persistence.rs#L422-L453)

分叉会复制 chat、updates、plan state 和 compaction segments，记录 parent_session_id，并可指定 prompt index/model/cwd；磁盘复制放到 blocking pool，后台注册服务端，不阻塞本地 fork 的关键路径。[`fork.rs:64-113`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/fork.rs#L64-L113) [`fork.rs:115-163`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/fork.rs#L115-L163)

恢复/子 agent spawn 对 system prompt 的策略不同：顶层 resume 保留历史 system；子 agent resume 继承 raw transcript 和 tool state，但用当前定义重新渲染 system，避免旧 persona/工具目录永久冻结。[`prompt_build.rs:92-110`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/acp_session_impl/prompt_build.rs#L92-L110) [`task/types.rs:44-47`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/implementations/grok_build/task/types.rs#L44-L47)

## 6. 子 agents

子 agent channel protocol 把身份、parent prompt、resume_from、cwd、runtime overrides、是否后台、是否向父模型展示完成事件、是否 fork parent context 都作为明确字段。[`task/types.rs:29-68`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/implementations/grok_build/task/types.rs#L29-L68)

能力不是简单的“全工具/无工具”，而是 ReadOnly、ReadWrite、Execute、All 四档，并在移除所有能产生后台任务的工具时同步移除无意义的 get/kill 生命周期工具。[`task/types.rs:139-174`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/implementations/grok_build/task/types.rs#L139-L174) [`task/types.rs:189-300`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/implementations/grok_build/task/types.rs#L189-L300)

父子共享 filesystem、terminal backend、memory、scheduler、hunk tracker、hooks 等运行资源，但子会话有独立的 model/context threshold/usage/session signals；背景子 agent 在父轮取消时继续，前台子 agent 才按 parent_prompt_id 取消。[`subagent/mod.rs:135-214`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/agent/subagent/mod.rs#L135-L214) [`task/types.rs:39-58`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/implementations/grok_build/task/types.rs#L39-L58)

用量账本区分 main-loop calls 与 subagent calls，能按 model 汇总 input/output/cached/reasoning/cost，并显式标记 incomplete；后台仍在跑时不伪造精确账单。[`usage.rs:1-26`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-chat-state/src/usage.rs#L1-L26) [`usage.rs:31-89`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-chat-state/src/usage.rs#L31-L89) [`usage.rs:100-146`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-chat-state/src/usage.rs#L100-L146)

**Catty 可借鉴：** 将 subagent completion 从一段自由文本提升为结构化结果：status、session id、turn/tool count、duration、tokens、worktree、archive handles；父上下文仅保留短摘要，细节通过 resume/read 获取。

## 7. Hooks 与 Skills

Hook 生命周期覆盖 session、turn stop/failure、pre/post tool、permission denied、prompt submit、notification、subagent 和 pre/post compact；envelope 包含 session/cwd/workspace/transcript/prompt id，tool payload 限制为 128 KB。[`event.rs:3-49`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-hooks/src/event.rs#L3-L49) [`event.rs:152-172`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-hooks/src/event.rs#L152-L172) [`event.rs:201-240`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-hooks/src/event.rs#L201-L240) [`event.rs:322-340`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-hooks/src/event.rs#L322-L340)

只有 PreToolUse 是阻塞决策；hook 超时/崩溃采取 fail-open，并把失败展示与记录，而不是默默吞掉。[`event.rs:127-149`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-hooks/src/event.rs#L127-L149) [`dispatcher.rs:15-35`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-hooks/src/dispatcher.rs#L15-L35)

Skills 采用渐进披露：启动时仅列名称/说明/路径，单条说明上限 400 bytes，整个 listing 预算由 context window 推导；实际 body 调用时再载入。[`skill_discovery_tracker/listing.rs:1-20`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/types/skill_discovery_tracker/listing.rs#L1-L20) [`skill_discovery_tracker/listing.rs:79-120`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/types/skill_discovery_tracker/listing.rs#L79-L120)

运行期还会根据 read/list/edit/apply_patch 实际触达路径发现或激活 skills；I/O 在资源锁外执行，checked_dirs 回写避免重复 stat，公告由 session 统一排队去重。[`skill_discovery.rs:27-45`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/reminders/skill_discovery.rs#L27-L45) [`skill_discovery.rs:109-155`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/reminders/skill_discovery.rs#L109-L155) [`skill_discovery.rs:159-218`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/reminders/skill_discovery.rs#L159-L218)

**Catty 可借鉴：** hook 应进入统一 AgentEvent trace；skill announcement 需要预算和去重，并在压缩后恢复“已宣布/已激活”状态，避免每次 compaction 后重复灌入。

## 8. 可观测性与离线评估

压缩 span 记录 trigger、使用比例、阈值、tokens before、attempts、degenerate/input-overflow/deterministic/transient rejection、TTFT、stream time、delta count、最大 inter-token gap、两段式是否使用、prefire hit/wait/stale 和 prefix release。[`compaction.rs:800-864`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/compaction.rs#L800-L864) [`compaction.rs:1150-1202`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/compaction.rs#L1150-L1202)

compaction streaming timing 是 O(1) accumulator，不保存每 token 时间戳；能直接算 TTFT、流持续时间、delta 数和最大间隔。[`session_compact.rs:256-310`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/helpers/session_compact.rs#L256-L310)

更关键的是持久化 `compaction_requests/{id}.json`：包含精确输入 ConversationItem、工具定义、模型、用户额外上下文、摘要或错误和每次尝试细节，注释明确说用于 offline prompt iteration。[`persistence.rs:360-368`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/persistence.rs#L360-L368)

这使“摘要质量”可以离线回放，而不是靠线上主观反馈。Catty 应补一套固定 eval：

- continuation state recall：active task/subagent/todo/edited file 是否完整；
- exact-detail recovery：摘要缺失时能否从 archive 找回具体错误、命令、路径；
- tool-call integrity：压缩/取消/恢复后无 dangling/orphan/duplicate；
- instruction retention：用户约束、AGENTS.md、skill 触发在多次压缩后仍有效；
- latency/cost：同步压缩等待、prefire 命中率、浪费 token、cached input 比例；
- continuation success：后继 agent 在不看原始 transcript 时能否完成下一步。

## 9. 原创实现与移植部分的边界

仓库的正式归属声明非常明确：从 OpenAI Codex 移植的是 `xai-grok-tools/src/implementations/codex/` 下的 apply_patch、grep_files、list_dir、read_file；从 sst/opencode 移植的是 `implementations/opencode/` 下 bash、edit、glob、grep、read、skill、todowrite、write。[`THIRD_PARTY_NOTICES.md:1-12`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/THIRD_PARTY_NOTICES.md#L1-L12) [`THIRD_PARTY_NOTICES.md:14-42`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/THIRD_PARTY_NOTICES.md#L14-L42)

因此本笔记讨论的 `PromptContext`、chat-state actor、分层 pruning、图片迟滞、两段式 prefire compaction、segment archive、ContinuationState 重建、session fork/resume、subagent coordinator、usage ledger、hook runtime、compaction telemetry/artifacts，均不在声明的 Codex/OpenCode 移植目录中，应视为 Grok Build 自己的 runtime/context-engineering 实现。这里的“原创”只表示**仓库归属证据显示不是那两组移植文件**，不主张它在思想史上从未受其他 agent 产品启发。

需要特别避免误判：Grok 可以配置 `Codex` prompt profile，也能组合 OpenCode 工具集；这表示兼容/复用工具行为，不等于它的上下文 runtime 来自 Codex/OpenCode。[`prompt/context.rs:15-29`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-agent/src/prompt/context.rs#L15-L29) [`xai-grok-agent/src/config.rs:518-528`](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-agent/src/config.rs#L518-L528)

## 10. 给 Catty 的落地计划建议

### P0：先补正确性与评估底座

1. 定义版本化 `ContinuationState`，压缩后确定性重注入 active jobs、subagents、todo/plan、edited paths、MCP、skills/AGENTS、tool-output handles。
2. 在开始新轮、取消完成、恢复、压缩替换四个边界运行 conversation integrity repair，并记录修复数与原因。
3. 保存每次 compaction 的精确输入、输出、模型、token、重试与错误 artifact；建立 20–50 条真实长会话的离线 continuation eval。

### P1：增加可恢复的压缩档案

4. 在现有 ToolOutputStore 上增加 conversation segment handles 和索引；摘要只带 manifest/恢复提示，不塞回全文。
5. 对工具结果采用“近轮保护、旧结果头尾裁剪、极旧占位”的分层策略，并保证原始 trace 仍可重放。
6. 给大用户输入使用同一套外置 handle，不让首轮超长需求在进入 agent 前就丢失尾部。

### P2：在实验开关下优化延迟与缓存

7. 实现带完整 canonical fingerprint 的后台两段式 compaction；记录 hit/stale/wasted tokens/sync wait saved。
8. 对会破坏 prompt cache 的历史改写采用 high-water/low-water 批处理，并比较 cached input tokens 的变化。
9. 将 skill listing、tool catalog、MCP announcement 都纳入独立预算和持久化去重状态。

### 不建议直接照搬

- 不应直接采用 bytes/4 作为唯一 token 估算器；Catty 已有模型相关估算基础，应保留实际 tokenizer/usage 校正，只统一边界语义。
- 不应未经 eval 就开启后台 pass1；它可能增加费用且缓存失效会造成纯浪费。
- 不应把 50%/85%/95%、40 KB、10 轮等常数照抄；这些是 Grok 的模型和服务约束，应由 Catty 的 trace 分布校准。
- Hook 的 fail-open 是 Grok 明示的威胁模型选择，不适合作为所有安全策略的默认值；Catty 需要按 hook 类型区分“工作流扩展”和“安全门禁”。

## 最终判断

Catty 现有架构已经有 pre-turn compaction、step pruning、413 retry、SessionState reinjection、ToolOutputStore 和统一 AgentEvent，方向是对的。Grok Build 显示下一阶段最有价值的不是再加一种总结 prompt，而是把这些模块连成一个**可恢复、可验证、可观测的上下文生命周期**：压缩前分层减负，压缩时保存证据，压缩后重建现场，细节按需恢复，所有路径都能离线重放和量化。
