# Issue #2121: MoshCatty 与官方 Mosh 的实现对照

研究日期：2026-07-15

## 结论

最新的 MoshCatty 主分支已经修复了 #2121 背后最重要的协议和显示问题：高延迟下的并行状态会按各自声明的旧状态重建，不再把多个增量依次叠到当前画面；预测回显也已经改为“远端画面、预测覆盖层、最终差异输出”这一条显示路径。这两点分别解决字符重复和预测字符被画两次的问题。

交付状态已经推进到最后一段：

1. [`moshcatty-0.1.7`](https://github.com/binaricat/MoshCatty/releases/tag/moshcatty-0.1.7) 已公开发布，四个平台文件和校验文件均已下载核对；Netcatty 也能自动解析并取得该版本。
2. Netcatty 的配套改动仍在 [PR #2231](https://github.com/binaricat/Netcatty/pull/2231)，尚未进入主分支；该 PR 会拒绝低于 `0.1.7` 的客户端，并已用正式 0.1.7 文件完成 macOS、Windows、Linux x64 和 Linux arm64 打包。
3. 已新增 Windows ConPTY 自动检查，覆盖密码提示、无结尾换行的握手信息、客户端切换和切换后的输入传递。它仍不能完全替代“正式 Windows 安装包 + Netcatty 页面”的人工视觉验收。
4. 已在完全隔离的网络中，用公开发布的 MoshCatty 0.1.7 对 Ubuntu 官方 `mosh-server` 1.4.0 完成高丢包、非对称延迟、乱序、重复包、65 秒完全断网、IPv6 最小 MTU 和 30 分钟持续压力测试；所有输入均按顺序且只执行一次，未发现新的协议缺陷。详细依据和可复现脚本见[网络压力验收报告](./issue-2121-network-stress-primary-sources.md)与[测试脚本](./issue-2121-netns-stress.sh)。

因此，当前判断是：核心方向已经与官方 Mosh 对齐，没有证据支持重写；0.1.7 发布门槛已经完成，合入配套 PR 和 Windows 正式产品页面验收仍是关闭 #2121 前的硬门槛。

## 版本与资料口径

本报告固定对照以下版本：

| 对象 | 版本 |
|---|---|
| 官方 Mosh | [`mobile-shell/mosh@decd9b7`](https://github.com/mobile-shell/mosh/commit/decd9b705eb81626f694335b8d5940538beb06da) |
| MoshCatty | [`binaricat/MoshCatty@cd25c0f`](https://github.com/binaricat/MoshCatty/commit/cd25c0fd1b3553d520ca3f65c93b0d3d53dffb04)，已合并 [PR #5](https://github.com/binaricat/MoshCatty/pull/5) |
| Netcatty 配套实现 | [PR #2231 的提交 `c15b364`](https://github.com/binaricat/Netcatty/commit/c15b36412eab5d9c74a5bb5ce02294fce7fd09d5) |
| 用户问题 | [Netcatty issue #2121](https://github.com/binaricat/Netcatty/issues/2121) |

这里需要澄清“RFC 规格”的范围：IETF 没有发布 Mosh 或状态同步协议 SSP 的 RFC / Internet-Draft。它的权威定义来自 [Mosh 原始论文](https://mosh.org/mosh-paper.pdf)、[官方说明](https://mosh.org/)和官方源码。Mosh 使用的 OCB3 加密算法由 [RFC 7253](https://www.rfc-editor.org/rfc/rfc7253) 定义；RTT/RTO 估算参考 [RFC 6298](https://www.rfc-editor.org/rfc/rfc6298)，但 Mosh 把最小 RTO 降到了 50 ms。两份 RFC 都只覆盖被 Mosh 采用的底层算法，不规定 SSP、漫游、终端同步或本地预测。

## 对照结果

### 1. SSH 启动和 `MOSH CONNECT`

官方行为：

- 官方启动器通过 SSH 启动普通用户权限的 `mosh-server`，读取端口和 128 位会话密钥，然后关闭 SSH，转入 UDP。见[论文第 2 节](https://mosh.org/mosh-paper.pdf)和[`mosh.pl`](https://github.com/mobile-shell/mosh/blob/decd9b705eb81626f694335b8d5940538beb06da/scripts/mosh.pl#L353-L465)。
- 官方默认使用 `ssh -n -tt`，并从 `SSH_CONNECTION` 取得 SSH 实际连到的服务端地址，避免域名再次解析后把 UDP 发到另一个地址。
- 官方只接受 22 字符的 Mosh 密钥，格式由[`mosh.pl`](https://github.com/mobile-shell/mosh/blob/decd9b705eb81626f694335b8d5940538beb06da/scripts/mosh.pl#L415-L459)和[`crypto.cc`](https://github.com/mobile-shell/mosh/blob/decd9b705eb81626f694335b8d5940538beb06da/src/crypto/crypto.cc#L104-L153)共同限定。

当前状态：

- Netcatty PR #2231 已恢复 `-n -tt`，通过远端 POSIX `sh` 读取 `SSH_CONNECTION`，并按官方顺序把 locale 作为 `mosh-server -l` 的候选值传入，而不是强行覆盖远端 locale。见[`moshHandshake.cjs`](https://github.com/binaricat/Netcatty/blob/d2c3605bf237f211242551b1bb33dfc5ffecc5ad/electron/bridges/moshHandshake.cjs#L199-L261)。
- SSH 实际地址会优先交给 MoshCatty，原始主机名作为后备候选。见[`moshSession.cjs`](https://github.com/binaricat/Netcatty/blob/d2c3605bf237f211242551b1bb33dfc5ffecc5ad/electron/bridges/terminalBridge/moshSession.cjs#L598-L639)和 MoshCatty 的[`Client::dial_candidates_with_size`](https://github.com/binaricat/MoshCatty/blob/cd25c0fd1b3553d520ca3f65c93b0d3d53dffb04/src/client.rs#L147-L260)。

对 #2121 的意义：

`no MOSH CONNECT` 发生在 MoshCatty 启动之前。此时 Ubuntu 上看不到任何 UDP 包是符合控制流程的，不是“客户端已经启动但没有发首包”。UDP 防火墙只会影响拿到 `MOSH CONNECT` 之后的阶段。

该诊断问题已经在 PR #2231 中修复：失败提示不再把“没有收到 `MOSH CONNECT`”和“检查 UDP 端口”写在一起，而是明确说明 UDP 客户端尚未启动。错误现在按阶段区分：

- SSH/服务端启动阶段没有拿到 `MOSH CONNECT`：检查 SSH 认证、PTY 输出、远端 `mosh-server` 和 locale；
- MoshCatty 已启动但 15 秒内没有收到合法状态：再检查 UDP、防火墙、地址选择和 NAT。

优先级：核心启动修复为 **P0**；错误提示拆分为 **P1**。

### 2. 字符重复：编号状态必须从声明的基线重建

官方行为：

SSP 的每条状态指令都声明 `old_num`、`new_num` 和从旧状态到新状态的 `diff`。官方接收端必须：

1. 确认 `new_num` 没有处理过；
2. 找到 `old_num` 对应的完整状态；
3. 克隆该状态并应用 `diff`；
4. 按编号保存新状态，旧的乱序状态可作为以后状态的基线，但不能把当前画面倒退。

这是协议的幂等性基础，见[论文 2.2、2.3 节](https://mosh.org/mosh-paper.pdf)和官方[`networktransport-impl.h`](https://github.com/mobile-shell/mosh/blob/decd9b705eb81626f694335b8d5940538beb06da/src/network/networktransport-impl.h#L68-L174)。

高延迟下，服务端可能在收到状态 1 的确认前又发送状态 2，且两者都基于状态 0。如果客户端把两个 diff 依次应用到当前画面，同一个字符就可能重复出现。

当前状态：

- MoshCatty 的传输层保留 `old_num/new_num/throwaway_num`，只接受引用仍存在基线的状态。见[`transport.rs`](https://github.com/binaricat/MoshCatty/blob/cd25c0fd1b3553d520ca3f65c93b0d3d53dffb04/src/transport.rs#L581-L746)。
- 终端层按状态号保存完整画面、解析状态和回显确认；每个新状态都从它声明的旧状态克隆，再与“最新已显示状态”计算一次输出差异。见[`terminal.rs`](https://github.com/binaricat/MoshCatty/blob/cd25c0fd1b3553d520ca3f65c93b0d3d53dffb04/src/terminal.rs#L178-L236)。
- 回归测试[`parallel_remote_states_render_shared_content_once`](https://github.com/binaricat/MoshCatty/blob/cd25c0fd1b3553d520ca3f65c93b0d3d53dffb04/src/client.rs#L897-L918)直接覆盖了两个并行状态共享旧基线时只能显示一次的情况。

判断：最新源码中的根因已经修复；`0.1.6` 及更早版本不满足这一条件，不能继续被 Netcatty 打包。

优先级：发布并强制使用 `0.1.7+` 为 **P0**。

### 3. 本地预测回显、下划线和单一显示路径

官方行为：

- 客户端对每个按键在后台做预测，但不是所有预测都立即显示。
- 预测按 epoch 分组；一个 epoch 中任意预测被服务端证明正确后，该组其余预测才可显示。
- 可能改变回显行为的输入，如回车、部分控制键、上下方向键，会开启新的 tentative epoch。
- 一次读入超过 100 字节的批量粘贴和窗口尺寸变化会清空预测，避免把不可安全推断的大段输入或旧几何位置画到屏幕上。
- 服务端在输入交给应用至少 50 ms 后发送 `echo ack`。客户端用这个字段判断当前远端画面是否已经足以验证预测；客户端本身不使用一个简单的墙钟超时来判错。
- 高延迟下，未确认预测会带下划线；服务端确认后下划线消失。

以上机制见[论文 3.2 节](https://mosh.org/mosh-paper.pdf)、官方[`terminaloverlay.h`](https://github.com/mobile-shell/mosh/blob/decd9b705eb81626f694335b8d5940538beb06da/src/frontend/terminaloverlay.h#L179-L311)、[`terminaloverlay.cc`](https://github.com/mobile-shell/mosh/blob/decd9b705eb81626f694335b8d5940538beb06da/src/frontend/terminaloverlay.cc#L350-L873)和[`stmclient.cc`](https://github.com/mobile-shell/mosh/blob/decd9b705eb81626f694335b8d5940538beb06da/src/frontend/stmclient.cc#L275-L430)。

当前状态：

- MoshCatty 已对齐 adaptive 显示和下划线阈值、epoch、`echo_ack` 的 Pending 判定、错误预测清理、退格和左右方向键等主要规则。见[`prediction.rs`](https://github.com/binaricat/MoshCatty/blob/cd25c0fd1b3553d520ca3f65c93b0d3d53dffb04/src/prediction.rs#L997-L1199)。
- 显示顺序为：重建远端 framebuffer → 验证预测 → 应用预测覆盖层 → 计算一次最终画面差异。见[`DisplayPipeline`](https://github.com/binaricat/MoshCatty/blob/cd25c0fd1b3553d520ca3f65c93b0d3d53dffb04/src/prediction.rs#L1403-L1640)。
- 测试覆盖了“本地先画、远端确认后不重复”“预测字符绝不从第二条路径直接写入”“5 秒未确认时出现下划线”等场景，见[`prediction_tests.rs`](https://github.com/binaricat/MoshCatty/blob/cd25c0fd1b3553d520ca3f65c93b0d3d53dffb04/src/prediction_tests.rs)。

判断：协议和内部显示路径已经对齐。剩余风险不是已知算法缺口，而是 Windows + ConPTY + xterm.js 实际组合尚未做最终视觉验收。自动测试能证明状态正确，不能完全证明用户看到的光标、下划线和字符不会被宿主终端重复处理。

优先级：Windows 真实产品链路验收为 **P0**。

### 4. 网络时序、重传和拥塞控制

官方行为：

- 每个 UDP 包带独立递增序列号、时间戳和可选时间戳回声；回声会扣除时间戳在对端等待发送的时间，避免 delayed ACK 污染 RTT。
- 平滑 RTT 和偏差参考 RFC 6298 的 TCP 算法，但把 RTO 限制在 50–1000 ms；画面发送间隔约为 SRTT 的一半，并限制在 20–250 ms。
- 数据 ACK 最多延迟 100 ms，画面变化先收集至少 8 ms；空闲时每 3 秒发送一次新编号心跳。
- 最近路径活跃时按 RTO 重传，长时间没有收到远端状态后降为每 3 秒尝试，避免断网期间持续刷包。
- ECN 拥塞标记会通过时间戳回声惩罚让对端降速。

权威实现见官方[`transportsender-impl.h`](https://github.com/mobile-shell/mosh/blob/decd9b705eb81626f694335b8d5940538beb06da/src/network/transportsender-impl.h#L49-L369)和[`network.cc`](https://github.com/mobile-shell/mosh/blob/decd9b705eb81626f694335b8d5940538beb06da/src/network/network.cc#L367-L539)。论文 2.2、2.3 节说明了相同设计目标和参数来源。

当前状态：

MoshCatty 已实现相同的 RTT 更新、50–1000 ms RTO、20–250 ms 发送间隔、100 ms delayed ACK、8 ms 最短收集时间、3 秒心跳和长断网退避。收到乱序旧包时仍允许 SSP 使用其内容，但不会用它更新 RTT 或路径。见[`transport.rs`](https://github.com/binaricat/MoshCatty/blob/cd25c0fd1b3553d520ca3f65c93b0d3d53dffb04/src/transport.rs)和[`client.rs`](https://github.com/binaricat/MoshCatty/blob/cd25c0fd1b3553d520ca3f65c93b0d3d53dffb04/src/client.rs)。

判断：当前没有发现与 #2121 直接相关的剩余时序缺陷。真实公网仍需保留长期单向丢包、乱序、重复包和持续输出的压力测试，防止单元测试无法覆盖的系统 UDP 队列、调度和 NAT 行为。

优先级：持续公网压力测试为 **P1**。

### 5. 漫游、断网恢复与“重连”的准确含义

官方行为：

- 客户端换 IP 或 UDP 源端口后，只要服务端收到一个认证成功且序列号更新的包，就把该包来源设为新目标。见[论文 2.2 节](https://mosh.org/mosh-paper.pdf)和官方[`network.cc`](https://github.com/mobile-shell/mosh/blob/decd9b705eb81626f694335b8d5940538beb06da/src/network/network.cc#L478-L544)。
- 客户端在 10 秒没有成功往返后更换本地 UDP 端口，旧 socket 最多保留 60 秒；这帮助 NAT 或本地路径重新建立映射。见官方[`network.cc`](https://github.com/mobile-shell/mosh/blob/decd9b705eb81626f694335b8d5940538beb06da/src/network/network.cc#L367-L400)。
- 已建立的会话默认不会因短期或长时间断网主动退出；恢复网络后继续同步最新状态。

当前状态：

MoshCatty 已实现相同的 10 秒端口跳转、旧 socket 保留、初次连接 15 秒限制、已建立会话长期等待和双向关闭握手。见[`client.rs`](https://github.com/binaricat/MoshCatty/blob/cd25c0fd1b3553d520ca3f65c93b0d3d53dffb04/src/client.rs#L27-L38)及其端口跳转、关闭处理。

需要准确区分：Mosh 的“恢复”要求原来的 `mosh-client` 进程、`mosh-server` 进程和会话密钥都仍然存在。服务端长时间没有收到客户端时可以暂时清除回包目标，但进程默认继续等待；同一个客户端恢复发包后会重新附着。服务端默认等待策略见官方[`mosh-server` 手册](https://github.com/mobile-shell/mosh/blob/decd9b705eb81626f694335b8d5940538beb06da/man/mosh-server.1#L95-L106)。

如果客户端进程已经退出或本机重启，新启动的官方客户端不能接管旧 `mosh-server`；如果服务端进程死亡、服务器重启或密钥丢失，也不能凭 UDP 自动复活原会话。Mosh 维护者在官方 [issue #403](https://github.com/mobile-shell/mosh/issues/403#issuecomment-15202467) 中明确说明，新客户端不能重挂旧会话，需要跨客户端进程保留任务时应配合 tmux/screen。Netcatty 此时发起的“重新连接”是重新走 SSH、创建一个新会话，不是 SSP 漫游。

判断：当前实现已经具备官方 Mosh 的断网恢复和客户端漫游模型。产品说明和验收不应把“服务端死亡后自动恢复原 shell”列为 Mosh 承诺。

优先级：真实换网和 65 秒以上黑洞恢复验收为 **P0**；产品措辞澄清为 **P2**。

### 6. 终端状态同步和大画面

官方行为：

- Mosh 不是传输远端输出字节流，而是服务端维护权威终端状态，客户端同步最近画面。见[论文 2、3 节](https://mosh.org/mosh-paper.pdf)和官方[`completeterminal.cc`](https://github.com/mobile-shell/mosh/blob/decd9b705eb81626f694335b8d5940538beb06da/src/statesync/completeterminal.cc#L44-L175)。
- 初始客户端状态必须带真实窗口尺寸，合法完整状态上限为 4 MiB；接收端需要保留可能被后续状态引用的分支状态。
- 官方 Display 会输出足以把旧 framebuffer 变成新 framebuffer 的终端指令；宽字符、末列、擦除、滚动区、模式和光标状态都可能影响最终画面。

当前状态：

- MoshCatty 的第一个线状态已携带真实窗口尺寸；完整指令限制对齐到 4 MiB。
- 远端编号状态保存 framebuffer、解析器、显示属性和 `echo_ack`，并按 `throwaway_num` 回收。
- 最新修复补齐了宽字符续格、末列覆盖、Unicode 15 宽度差异、插入/自动换行/原点模式、滚动和光标保存恢复等行为。

判断：协议侧没有发现新的高风险缺口。仍应在目标 Windows 页面覆盖中文、emoji、窗口缩放、全屏程序、清屏重画和超过 1 MiB 的压缩画面。

还要保留一个官方 Mosh 本身的语义限制：SSP 优先同步“最新屏幕状态”，不会保证像 SSH 字节流一样保存快速滚屏时的每一行历史。Mosh 原始论文在第 2 节明确指出，`cat` 大文件时依赖完整 scrollback 可能不可靠，建议使用 `less`、`screen` 或 `tmux`。Netcatty 把 MoshCatty 放在主屏以保留已经显示过的 scrollback，但无法恢复官方服务端从未发送的中间画面。

优先级：Windows 终端边界验收为 **P0**；公开说明上游 scrollback 语义为 **P2**。

### 7. OCB3 与 RFC 7253

官方 Mosh 使用 AES-128 OCB3、128 位认证标签、12 字节 nonce 和空附加数据。MoshCatty 当前实现使用相同参数，并有 RFC 7253 Appendix A 测试向量、方向位、篡改拒绝和官方线格式测试。

判断：未发现与 #2121 相关的加密互通问题。RFC 7253 只能证明 OCB 算法实现，不能用来替代 SSP 和终端行为测试。

优先级：无新增工作。

## 剩余风险与优先级

| 优先级 | 项目 | 为什么仍未完成 | 可验证的完成证据 |
|---|---|---|---|
| **P0** | 合入 Netcatty PR #2231 | 当前主分支尚未强制使用新客户端，也未带 SSH 启动修复 | PR 全部检查通过并合入；正式构建实际包含新客户端 |
| **P0** | Windows 端到端验收 | #2121 的真实故障发生在 Windows；跨平台单测不能替代 ConPTY 和页面显示 | 正式 Windows 包连接公网 Ubuntu，完成下面的重复、预测、换网、断网、宽字符用例，录屏和日志均通过 |
| **P1** | 公网 IPv6 路径 | IPv6-only、最小 MTU 和无网络分片已经通过，但本地 Mac 没有公网 IPv6 路由，仍不能替代真实跨网路径 | 从另一条公网 IPv6 前缀连接 Ubuntu 公网 IPv6，完成大画面、断网和恢复后输入 |
| **P1** | Windows 长时间非对称网络压力 | Linux 隔离环境中的 30 分钟压力已经通过；Windows 正式产品链路仍可能受 ConPTY、页面显示和系统网络调度影响 | Windows 正式安装包连接公网 Ubuntu，在相同压力下持续 30 分钟，无漏键、重复、内存持续增长或键盘饥饿 |
| **P2** | 产品说明 | “漫游/恢复”和“重新建立新会话”容易混淆；scrollback 也有上游限制 | 文档明确说明原客户端和服务端进程仍存活是恢复前提，并说明快速滚屏历史不保证完整 |

## 建议的真实复现与验收矩阵

使用用户提供的公网 Ubuntu 作为官方 `mosh-server`，本地 Netcatty/MoshCatty 作为客户端。服务端只使用 Ubuntu 官方公开安装方式和系统包，不部署修改版服务端。

1. **重复显示**：制造约 500 ms RTT，连续输入 `ls`、快速重复字符、退格改字和带空格命令。页面只能显示一次，服务端逐字节收到的输入必须与键盘输入一致。
2. **预测与下划线**：分别使用 adaptive 和 `MOSH_PREDICTION_DISPLAY=always`。预测应立即出现；高延迟下未确认字符有下划线，确认后消失；不能等一个 RTT 才显示。
3. **SSH 启动**：覆盖密码、公钥、带口令私钥、2FA/keyboard-interactive；连续至少 100 次连接。`no MOSH CONNECT` 场景单独记录 SSH 输出，不能用“服务端无 UDP”判断 UDP 客户端故障。
4. **完全黑洞恢复**：会话建立后双向阻断 UDP 65 秒，再恢复；必须是同一远端 shell 进程、同一工作目录继续工作，客户端不能自行退出。
5. **漫游**：切换本地网络或改变 NAT/源端口；服务端收到新来源的认证包后，同一会话应在数秒内继续。
6. **单向故障**：只阻断上行、只阻断下行、只丢 ACK，持续输入和持续输出；检查退避、提示、端口跳转和恢复。
7. **终端同步**：窗口缩放、清屏、vim/tmux、中文、emoji、宽字符落在末列、滚动区、鼠标序列和超过 1 MiB 的压缩画面。
8. **退出**：正常 `exit`、本地 `Ctrl-^ .`、网络故障后退出；服务端不应留下会话进程。

## 本次实际验证

- 在 MoshCatty `cd25c0f` 上运行 `cargo test --all-targets`：**337 项通过，0 项失败**；4 项需要外部 SSH 凭据的 live 测试按设计跳过。
- MoshCatty PR #5 的 GitHub 检查在 Windows、macOS 和 Ubuntu 均通过；4 项公网 Ubuntu live 测试连续跑了两轮，全部通过。
- 对 Ubuntu 24.04.4 官方 `mosh-server` 1.4.0 连续执行 **100 次** SSH 启动，100 次都收到 `MOSH CONNECT`，并确认没有遗留服务端进程。
- `moshcatty-0.1.7` 的四个平台文件和 `SHA256SUMS` 已公开发布并全部校验通过；Netcatty 的默认版本解析和本机下载都选择了 0.1.7。
- Netcatty 用正式 0.1.7 文件完成 macOS、Windows、Linux x64 和 Linux arm64 打包；本地完整结果为 **5413 项通过、0 项失败、4 项按平台跳过**，检查和生产构建通过。
- 在 Ubuntu 主机本机用 IPv6 `::1` 跑通 MoshCatty 0.1.7 与官方 mosh-server 的完整会话。测试机有公网 IPv6，但本地 Mac 没有 IPv6 路由，所以公网 IPv6 路径仍未验证。
- 在独立 network namespace 中只保留 IPv6、把两端 MTU 设为 1280，并发送难压缩的大画面。抓到 25 个 IPv6 UDP 包，其中服务端发出 13 个、合计 7100 字节；解密后确认同一条 Mosh 指令被拆成 6 个分片。最大 IPv6 包为 1264 字节，未出现 IPv6 Fragment Header，最终画面正确。
- 在官方论文公开的 100 ms RTT、两个方向各 29% 丢包条件下完成 10 次输入；又在约 750 ms 非对称延迟、5%/12% 丢包、10%/15% 乱序和 2%/3% 重复包条件下完成 10 次输入。两组均无漏项、重复或乱序执行。
- 会话建立后双向完全断网 65 秒，并在断网期间输入命令。恢复后 10 秒内，同一会话执行了这条命令且只执行一次，随后新输入也正常完成。
- 持续 30 分钟施加约 700 ms 非对称延迟、1%/3% 丢包、5%/10% 乱序和 1%/2% 重复包；每秒输入一次，共 1800 次，每 30 秒加入一次大画面更新。最终 1800 条记录连续、无遗漏且各执行一次，解除压力后 10 秒内恢复。客户端 RSS 的 5 分钟采样为 3044、3496、3500、3500、3500、3500 KiB，没有持续增长。

## 最终判断

MoshCatty 最新源码已经补齐 #2121 暴露的核心协议和预测路径，当前没有证据表明需要推翻重写。字符重复的状态模型根因已经修复；预测回显、下划线、长断网恢复、端口跳转、ACK/重传和终端重建也已经沿官方实现逐项对齐。

现在最重要的不是继续扩大改动，而是把已经完成的修复合入正式产品，并用 #2121 的 Windows 正式安装包 + Netcatty 页面 + 公网 Ubuntu 官方服务端拓扑做最后的人工使用验收。0.1.7 发布、连续启动、断网恢复、正式文件打包、IPv6-only 最小 MTU 和 30 分钟非对称压力都已经拿到证据；在 PR 合入、Windows 页面视觉验收和公网 IPv6 跨网路径拿到证据之前，不应关闭 #2121，也不应宣称所有环境都已完全验收。
