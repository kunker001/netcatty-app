# Grok Build 终端上下文工程研究：给 Catty 的对照结论

## 研究范围与结论口径

- Grok Build 本地源码：`/Users/chenqi/.codex/external-sources/grok-build`
- 仓库当前提交：`8adf9013a0929e5c7f1d4e849492d2387837a28d`
- 仓库内 `SOURCE_REV`：`2ec0f0c8488842da03a71eeee3c61154957ca919`
- Catty 源码：本报告所在 Netcatty 工作树
- **已验证**：可直接由源码或本地只读实跑证明。
- **推断**：由多处实现拼合出的行为判断，尚未做完整产品级端到端复现。

一句话结论：**Grok 最值得 Catty 学的不是“多截一点输出”，而是把终端分成三层：原始输出单独保存、给模型的内容严格限额、持续日志进入对话前先做限流和抑制。Catty 的增量轮询和远程编码处理其实更好，但当前有两个入口能绕过限额，另有一个入口会稳定累积重复输出；这三个确定性问题都足以直接塞满上下文，必须先修。**

## 一、Grok 的终端输出怎样流动

```text
命令进程
  ├─ 原始 stdout/stderr ──> session/terminal/<tool_call_id>.log
  │                           ├─ 运行期最多 5 GiB，超过则杀进程
  │                           └─ 退出后只留文件前 64 MiB
  ├─ 模型结果内存 ────────> 默认约 20k 字符：前半冻结 + 后半滚动
  │                           └─ 去 ANSI、超长行每 2000 字符软换行
  └─ 后台读取 ────────────> get_task_output
                              └─ 超限时只回前 2k 预览 + 文件路径

交互 PTY 是另一条通道：256 KiB 环形缓冲 + offset + base64 推送，
不会自动把整个终端画面塞进模型对话。
```

### 1. 原始输出与模型输出分开

- **已验证**：每次 Bash 调用都会把输出写入会话目录下的 `terminal/<tool_call_id>.log`，而不是只留在对话消息里。[bash/mod.rs:1915](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs:1915)
- **已验证**：模型侧默认终端预算为 20,000 字符；超出后冻结前半、滚动保留后半，再插入截断提示。[bash/mod.rs:156](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs:156) [terminal.rs:346](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/computer/local/terminal.rs:346)
- **已验证**：原始字节转模型文本时用 UTF-8 容错解码；非法字节会被替换，因此二进制输出和错误编码并不是无损的。[terminal.rs:308](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/computer/local/terminal.rs:308)
- **已验证**：模型看到的文本会去掉 ANSI 控制码，超长单行按 2,000 字符软换行；磁盘文件仍保存原始字节。[bash/mod.rs:406](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs:406) [output.rs:413](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/types/output.rs:413)
- **已验证**：stdout 与 stderr 被收进同一个输出流和文件；每次轮询先读完当前 stdout，再读 stderr，所以二者的相对时间顺序并不精确。[terminal.rs:1528](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/computer/local/terminal.rs:1528)

这套设计最重要的价值是：**模型消息只是有界索引，原始输出是独立资产。** Catty 目前成功命令也有类似“预览 + handle”，但全文仍在渲染进程内存中，没有磁盘配额、TTL 或范围读取。

### 2. 长任务和失控输出有多层保险

- **已验证**：前台可自动转后台的命令默认最多阻塞当前轮 15 秒；后台任务最长运行 10 小时。[terminal.rs:47](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/computer/local/terminal.rs:47)
- **已验证**：运行中输出文件默认最多 5 GiB，超出会终止进程；进程结束后文件被 `set_len(64 MiB)`。[terminal.rs:65](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/computer/local/terminal.rs:65) [terminal.rs:382](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/computer/local/terminal.rs:382) [terminal.rs:1236](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/computer/local/terminal.rs:1236)
- **已验证**：退出后仍会最多等待 2 秒排空管道，避免子进程继承管道导致永久卡住。[terminal.rs:77](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/computer/local/terminal.rs:77)
- **已验证**：完成的后台任务在内存中保留 5 分钟，之后只保留最多 100 条轻量元数据；输出仍指向磁盘文件。[terminal.rs:42](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/computer/local/terminal.rs:42) [terminal.rs:1432](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/computer/local/terminal.rs:1432)
- **已验证**：会话文件默认 30 天后清理，可配置；当前会话目录会跳过。[persistence.rs:2600](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/persistence.rs:2600)

需要注意两个不能照搬的点：

1. 5 GiB 对桌面应用太大；Catty 应采用更小的默认值和全局总配额。
2. Grok 提示模型“完整输出在文件”，但退出后只保留**文件开头** 64 MiB，因此对更大输出这句话不准确；末尾错误甚至可能丢失。

### 3. 后台读取并不是真正的增量读取

- **已验证**：`get_task_output` 每次读取当前完整快照；若超过预算，只回前 2,000 字符预览并给出文件路径。[task_output/tool.rs:11](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/implementations/task_output/tool.rs:11)
- **已验证**：多任务读取允许最多 20 个任务，各自独立套用默认约 40 KiB 上限，没有统一总预算。[task.rs:318](/Users/chenqi/.codex/external-sources/grok-build/crates/common/xai-tool-types/src/task.rs:318) [task_output/mod.rs:205](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/implementations/grok_build/task_output/mod.rs:205)
- **推断**：一次多任务调用最坏仍可能向上下文注入约 800 KiB，而且重复轮询会把相同预览反复写进历史。Grok 的模型读取没有 Catty 的 `nextOffset` 语义。

因此，**Catty 的 `terminal_start` / `terminal_poll` 设计更好**：它有 256 KiB 滚动尾窗、`outputBaseOffset`、`totalOutputChars`、`outputTruncated` 和 `nextOffset`，并按聊天会话隔离任务。[aiExec.cjs:16](/Users/chenqi/.codex/worktrees/de5f/netcatty/electron/terminalWorker/aiExec.cjs:16) [aiExec.cjs:165](/Users/chenqi/.codex/worktrees/de5f/netcatty/electron/terminalWorker/aiExec.cjs:165) [aiExec.cjs:196](/Users/chenqi/.codex/worktrees/de5f/netcatty/electron/terminalWorker/aiExec.cjs:196)

Catty 当前的问题不是底层没有增量，而是上层没有利用好它：相同 offset 的重复 poll 不会被历史裁剪，SessionState 也不记录 jobId、nextOffset 和已读位置。由于该问题已实测可在一次短循环内稳定累积近 50k 字符，本文将它列为 P0，而不是一般优化。

### 4. 持续日志先限流，再进入对话

Grok 为 monitor 单独做了一条“事件入口”，这是最值得 Catty 借鉴的部分：

- **已验证**：单行最多 500 字符，一个事件批次最多 3,000 字符，原始行缓冲最多 1 MiB，200ms 合批。[monitor/types.rs:1](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/implementations/grok_build/monitor/types.rs:1)
- **已验证**：令牌桶初始允许 10 个事件，之后每 2 秒补 1 个；被抑制的事件只累计数量，恢复时发一条摘要。[rate_limiter.rs:5](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/implementations/grok_build/monitor/rate_limiter.rs:5)
- **已验证**：持续 30 秒过载后停止向对话发送该监控流，并提示改写为更精确的 grep/awk 过滤。[rate_limiter.rs:121](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/implementations/grok_build/monitor/rate_limiter.rs:121)
- **推断**：该“自动停止”只中断事件管线，没有在同一路径调用终端 kill；底层命令可能继续运行到超时或会话清理。因此 Catty 借鉴时应同时停止进程或明确标为“仅静音”。[monitor/tool.rs:321](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/implementations/grok_build/monitor/tool.rs:321) [monitor/tool.rs:360](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/implementations/grok_build/monitor/tool.rs:360)

对于 Catty，正确做法不是让每个终端刷新都成为一条消息，而是把它们变成：`时间窗口内合批 -> 单行/单批上限 -> 总速率限制 -> 被抑制数量摘要 -> 必要时停流/停进程`。

### 5. 交互终端和模型上下文彻底分开

- **已验证**：Grok 的交互 PTY 是独立客户端通道，使用 256 KiB 环形缓冲、单调 offset、16ms 合批，并以 base64 传输原始字节。[pty_session.rs:1](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/terminal/pty_session.rs:1) [pty_session.rs:186](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/terminal/pty_session.rs:186) [pty_session.rs:366](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/terminal/pty_session.rs:366)
- **已验证**：重连时只回放这 256 KiB 环形缓冲，重建客户端终端画面；这不是模型工具结果。[pty_session.rs:530](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/terminal/pty_session.rs:530)

这一边界对 Catty 尤其重要：**用户看到的终端画面可以高频、完整；模型读取必须显式、有界、可增量、可审计。** 不应把终端 UI 的 scrollback 直接当模型记忆。

## 二、上下文裁剪、压缩与恢复

### 1. 普通旧工具结果先做便宜裁剪

- **已验证**：Grok 在上下文使用超过 50% 后，构造请求时裁剪旧工具结果；最近 3 轮不动，超过 4,000 字符的旧结果保留 1,500 头 + 1,500 尾，10 轮前直接替换为占位。[request_builder.rs:155](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-chat-state/src/actor/request_builder.rs:155) [types.rs:67](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-chat-state/src/types.rs:67)
- **已验证**：这一步发生在请求副本上，不会先破坏完整会话记录；更深层的 compaction 另有归档与重建流程。[request_builder.rs:20](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-chat-state/src/actor/request_builder.rs:20) [compaction.rs:219](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/compaction.rs:219)

Catty 已经会在预算压力下按终端 session 只保留最近两次成功的 `terminal_execute`，方向正确。[staleContextPruner.ts:184](/Users/chenqi/.codex/worktrees/de5f/netcatty/infrastructure/ai/harness/staleContextPruner.ts:184) 但它没有覆盖 `terminal_poll` 和 `terminal_read_context`，所以 6 次相同 offset 的本地实跑仍累计约 49.6k 字符且未触发调整。

### 2. 压缩后要恢复“可继续工作”的状态，而不是恢复大段日志

- **已验证**：Grok compaction 后会重新注入正在运行的终端任务、子代理、已编辑文件、待办和工具状态，而不是重新塞入任务输出。[compaction.rs:1205](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-shell/src/session/compaction.rs:1205)
- **推断**：它注入运行任务 ID/命令/状态，但没有“模型上次读到哪个 offset”；加上 `get_task_output` 是全快照，压缩后仍可能重复读取。
- **推断**：终端任务表是进程内 Map，新建 actor 时为空，未发现从磁盘恢复活进程的路径。重启后旧日志文件可能还在，但旧 taskId 不能继续作为真实运行任务读取。[terminal.rs:543](/Users/chenqi/.codex/external-sources/grok-build/crates/codegen/xai-grok-tools/src/computer/local/terminal.rs:543)

Catty 应保存的是结构化任务续读状态：`jobId + sessionId + command + status + nextOffset + outputBaseOffset + handleId + sideEffectClass`。恢复时先向后端核实任务是否仍存在，再注入“仍运行 / 已完成 / 已失联”，不能假装恢复，也不能建议盲目重跑。

## 三、Catty 当前最危险的三个确定性漏洞

### P0-1：失败或超时输出绕过终端压缩

- **已验证**：工具执行器把失败命令的完整 stdout/stderr 拼进 error。[toolExecutors.ts:96](/Users/chenqi/.codex/worktrees/de5f/netcatty/infrastructure/ai/shared/toolExecutors.ts:96)
- **已验证**：`capabilityTools` 对失败结果直接返回，只有成功结果进入 `fitTerminalExecuteResultForModel`。[capabilityTools.ts:328](/Users/chenqi/.codex/worktrees/de5f/netcatty/infrastructure/ai/harness/capabilityTools.ts:328)
- **已验证**：前台 PTY 默认 `maxBufferedChars=0`，而 helper 将 0 解释为不限长度。[ptyExec.cjs:27](/Users/chenqi/.codex/worktrees/de5f/netcatty/electron/bridges/ai/ptyExec.cjs:27) [ptyExecHelpers.cjs:277](/Users/chenqi/.codex/worktrees/de5f/netcatty/electron/bridges/ai/ptyExecHelpers.cjs:277)
- **实跑已验证**：构造约 200k 字符后超时，进入模型的 error 长度为 200,035，handle 数为 0；同等大小的成功输出会被截断并生成 handle。

这意味着最容易产生巨量日志的“失败、超时、构建报错”恰好绕过保护。修复标准必须是：**无论成功、失败、超时、取消、桥接异常，所有 stdout/stderr 都先经过同一个终端输出封装器，模型只拿有界预览。**

### P0-2：`tool_output_read` 可以把全文重新灌回上下文

- **已验证**：handle 默认读 12k，但调用方可传任意 `maxChars`；`full` 模式只是从头截到调用值，没有硬上限。[toolOutputStore.ts:67](/Users/chenqi/.codex/worktrees/de5f/netcatty/infrastructure/ai/harness/toolOutputStore.ts:67) [toolInputs.cjs:345](/Users/chenqi/.codex/worktrees/de5f/netcatty/electron/capabilities/schemas/toolInputs.cjs:345)
- **已验证**：`tool_output_read` 被明确排除在二次 fitting 之外，因此模型可以用一个巨大 `maxChars` 将原文一次性拉回。[capabilityTools.ts:126](/Users/chenqi/.codex/worktrees/de5f/netcatty/infrastructure/ai/harness/capabilityTools.ts:126)

修复标准：服务端写死单次硬上限，支持 `offset/range/search/head/tail`，返回 `nextOffset/hasMore/totalChars`；每一轮所有 handle 读取还要共享总预算，不能只限制单次调用。

### P0-3：重复 poll/read_context 不参与终端历史去重

- **已验证**：跨轮历史省略只识别 `terminal_execute` 的几个别名，不覆盖 `terminal_poll` 与 `terminal_read_context`。[cattyHistoryReplay.ts:112](/Users/chenqi/.codex/worktrees/de5f/netcatty/components/ai/cattyHistoryReplay.ts:112)
- **已验证**：预算压力下的终端特化裁剪同样只识别 `terminal_execute`。[staleContextPruner.ts:98](/Users/chenqi/.codex/worktrees/de5f/netcatty/infrastructure/ai/harness/staleContextPruner.ts:98)
- **实跑已验证**：连续 6 次使用相同 offset 读取约 8k 内容，预算压力下 `didAdjust=false`，约 49.6k 重复文本全部保留。

修复标准：把每次读取标识为 `chatSessionId + sessionId/jobId + requestedOffset + nextOffset + snapshotVersion`；完全相同的读取只保留一次，后续增量可合并为一个范围。`terminal_read_context` 当前的行号会随 scrollback 淘汰或 reflow 漂移，不能假装成可靠日志 cursor；需要单独的输出版本或快照 ID。

## 四、逐项对比

| 维度 | Grok Build | Catty 现状 | 判断 |
|---|---|---|---|
| 成功命令预览 | 默认约 20k，头尾 | stdout 24k / stderr 12k，重复行压缩、头尾 + handle | Catty 不弱 |
| 失败/超时输出 | 同一终端结果路径，仍受预算约束 | **绕过 fit，可无上限** | Catty P0 |
| 原文保存 | 会话磁盘文件，有运行/完成/TTL上限 | JS 内存全文，无总量/TTL/LRU | Grok 更完整 |
| 后台读取 | 全快照，超限前 2k + 文件；无 offset | `nextOffset` 增量 + 256 KiB 尾窗 | Catty 更好 |
| 重复读取去重 | 无真正 cursor，可能重复 | 底层有 cursor，上下文层不按 job+offset 去重 | Catty 应补上层 |
| handle 读取 | 通过有界工具读文件 | head/tail/full，但 `maxChars` 无硬上限 | Catty P0 |
| ANSI/进度条 | 模型预览去 ANSI，monitor 合批限流 | PTY normalize 去 ANSI/CR，但各工具路径不统一 | Grok 更一致 |
| UTF-8/远程编码 | UTF-8 lossy | Stateful decoder，支持 GBK/GB18030 分块 | Catty 更强 |
| 持续日志 | monitor 专用入口：批次、速率、抑制 | 主要依赖模型谨慎 poll | Grok 值得学 |
| 交互 PTY | 与模型工具分离，256 KiB 环形缓冲 | UI 终端与 AI 能力分层，但 read_context 仍是屏幕行语义 | 原则一致 |
| 历史裁剪 | 通用旧 tool result 分层裁剪 | terminal_execute 特化，poll/read_context 未覆盖 | Grok 更完整 |
| 压缩后任务状态 | 注入运行任务，但无已读 offset | SessionState 只记 lastCommand | 两边都有缺口 |
| 敏感信息 | 未发现通用终端 secret redaction | 未发现；catalog 还标为 `sensitiveRead:false` | 两边都缺 |
| 会话/跨聊天隔离 | 任务有 owner session | 后台 job 按 chatSessionId 校验 | 两边都有基础 |

## 五、建议实施顺序

### P0：先堵住能直接撑爆上下文或泄密的入口

1. **统一终端输出封装**：成功、失败、超时、取消、异常全部走同一预算器；先保存原文，再只回结构化预览。
2. **锁死 `tool_output_read`**：单次和单轮双重硬上限；增加 offset/range/search；禁止调用参数放大服务端上限。
3. **让 poll/read_context 真正去重**：相同范围不得重复进入历史；只保存已读区间、摘要和下次 offset。
4. **终端敏感信息处理**：在进入模型前识别并遮罩常见 token、私钥、密码、连接串；原文只留本地受控存储，并明确生命周期。
5. **写命令 413 只执行一次**：压缩或重试只能重放已记录结果，不能重新执行有副作用的命令。历史提示也不应默认写“Re-run terminal_execute”。[cattyHistoryReplay.ts:112](/Users/chenqi/.codex/worktrees/de5f/netcatty/components/ai/cattyHistoryReplay.ts:112)

### P1：把现有增量能力变成真正的上下文能力

1. SessionState 保存运行任务和最后已读 offset；compaction 后先核实真实状态，再恢复续读位置。
2. ToolOutputStore 增加每 handle、每 chat、全局总字节数、条数、TTL、LRU；关闭终端和删除聊天时精确清理。
3. 大输出从 JS heap 移到 Netcatty 专用临时目录；以不可猜 handle 访问，使用受限权限，支持字节范围读取和搜索。
4. 统一 ANSI、CR 进度、超长单行、重复行、binary/base64/高熵文本处理；保留 `encoding` 与是否 lossy 的元数据。
5. 为 follow/watch/log tail 增加 Grok monitor 式入口：200ms 合批、单行/单批预算、速率限制、抑制计数和明确的停流/停进程行为。

### P2：长期上下文质量

1. 通用工具历史裁剪覆盖 terminal_execute、terminal_poll、terminal_read_context 和 tool_output_read，而不是按工具名漏补。
2. 结构化保存命令 outcome：命令、退出码、时间、是否有副作用、摘要、handle、任务状态；旧历史删原文但保留事实。
3. 建立离线终端上下文基准，记录峰值上下文占比、重复率、错误定位率、秘密暴露数和写命令执行次数。

## 六、交付前硬门槛与 13 个压测场景

以下门槛建议作为合并前必须通过的条件：

- 写命令遇到 413：`WriteCount = 1`。
- 并发任务串线、跨聊天读取：`crossTalk = 0`、`crossChatRead = 0`。
- 模型可见内容里的测试密钥：`SecretExposure = 0`。
- UTF-8 分块边界不损坏；Catty 原有 GBK/GB18030 能力不退化。[ptyExecHelpers.cjs:8](/Users/chenqi/.codex/worktrees/de5f/netcatty/electron/bridges/ai/ptyExecHelpers.cjs:8)
- 任一场景不得把上下文推到窗口的 90% 以上。

建议自动化 13 场景：

1. 持续高速日志；
2. 超长单行；
3. 关键错误位于输出中段；
4. ANSI 颜色与 `\r` 进度刷新；
5. UTF-8 多字节字符跨 chunk；
6. 二进制与高熵 base64；
7. 四个并发终端；
8. 后台任务多次轮询；
9. 相同 offset 重复读取；
10. 有副作用命令执行后触发 413；
11. 应用重启 / session resume；
12. 输出包含 token、密码、私钥片段；
13. handle 过期、淘汰和跨聊天访问。

每个场景至少采集：进入模型字符数、原始输出字符数、压缩比、重复字符比例、峰值上下文占比、handle 数和内存/磁盘占用；涉及命令的再采集执行次数、任务归属和最终状态。

## 七、不建议照搬 Grok 的地方

1. 不照搬 5 GiB 运行文件默认上限；桌面产品应更保守并有全局配额。
2. 不照搬“完成后截文件开头 64 MiB”；应保留头尾或分块索引，否则真正错误常在末尾。
3. 不照搬 `get_task_output` 全快照；Catty 已有 offset，应把它贯彻到上下文历史。
4. 不照搬多任务各自限额却没有聚合限额。
5. 不照搬 monitor “显示已停止但未确认进程已杀”的含糊语义。
6. 不照搬仅 UTF-8 lossy；Catty 的 stateful decoder 和远程编码支持必须保留。
7. 不把“文件路径”直接当安全 handle；路径泄露、权限和生命周期都需要单独设计。

## 最终判断

Catty 不需要复制 Grok 的终端系统。Catty 已经有更适合真实终端代理的底座：远程会话、增量 offset、尾窗、跨聊天隔离和多编码解码。真正需要补的是模型入口治理：

> 任何终端字节进入模型前都必须经过同一个有界入口；任何大输出只能通过有额度、有游标、可过期的句柄读取；任何持续日志都先限流再入对话；任何压缩与恢复都保存任务事实和已读位置，而不是保存或重放大段日志。

先修三个 P0，再补句柄生命周期和 monitor 式限流，Catty 在“会真正操控终端”的场景里会比 Grok 当前实现更稳，也更不容易因一次失败命令把整个上下文窗口打满。
