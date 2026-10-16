# Issue #2121：Mosh 网络压力测试的一手资料与验收标准

研究日期：2026-07-15

## 结论

官方 Mosh 明确承诺已建立的会话可跨临时断网继续、可处理显著丢包、乱序和重复包，并支持固定为 IPv6 的会话。官方还公开测试过 **100 ms RTT、两个方向各 29% 独立丢包（约 50% 往返丢包）** 的场景。

但官方没有给出“断网 65 秒后必须几秒恢复”“单向丢包必须承受多少”“必须连续运行 30 分钟”之类的合格线。因此，本报告把结论分成三类：

- **官方保证**：论文、官方手册或官方说明直接陈述的能力。
- **源码推断**：从官方 Mosh 1.4.0 实现能确定的具体行为，但不是面向用户的时限承诺。
- **项目门槛**：Netcatty/MoshCatty 为上线质量自行设定的压力值。它们可以比官方公开实验更严格，但不能写成“官方标准”。

对 #2121 最重要的判断是：**65 秒双向黑洞应当恢复**，前提是黑洞发生前会话已经建立，原客户端、原服务端和密钥都没有丢失，而且服务端没有配置短于测试时长的网络超时。65 秒这个数字不是官方协议上限；它只是有意跨过源码中的 40 秒服务端脱离目标地址和 60 秒客户端省电刷新节点。

本文定义的是上线前的**目标验收线**，不是“当前已经全部完成”的声明。当前实际跑过的参数、次数和剩余缺口以同目录的 [`issue-2121-mosh-upstream-audit.md`](./issue-2121-mosh-upstream-audit.md) 为准。现有脚本已经覆盖官方 29% 双向丢包的短时基线、组合乱序/重复、65 秒断网、IPv6 最小 MTU 和 1800 次长期输入；下文更高强度的单向 30% 丢包 1000 次、25% 乱序/10% 重复 1000 次仍是后续目标，不能标成已完成。

## 资料和版本口径

本报告只使用以下一手资料：

1. [Mosh 原始论文](https://mosh.org/mosh-paper.pdf)，尤其是 2.1–2.3 节和第 5 页的高丢包实验。
2. [Mosh 官方说明](https://mosh.org/)和 [官方 README](https://github.com/mobile-shell/mosh/blob/mosh-1.4.0/README.md#L6-L50)。
3. Ubuntu 24.04 当前官方包所基于的上游版本 [`mosh-1.4.0` / `bc73a263`](https://github.com/mobile-shell/mosh/tree/mosh-1.4.0) 的源码和手册。
4. [RFC 8200：IPv6](https://datatracker.ietf.org/doc/html/rfc8200#section-5)、[RFC 8201：IPv6 路径 MTU 发现](https://datatracker.ietf.org/doc/html/rfc8201#section-1)和 [RFC 8085：UDP 使用指南](https://datatracker.ietf.org/doc/html/rfc8085#section-3.2)。

Mosh/SSP 没有 IETF RFC 或 Internet-Draft。RFC 只规定 IPv6、UDP 和 MTU 等底层行为，不能替代 Mosh 论文和官方源码。

## 总验收原则

所有测试都应满足这些共同条件，否则“看到最终标记”不足以证明协议正确：

1. 服务端使用未修改的 Ubuntu 官方 `mosh-server` 1.4.0；被测对象只在客户端。
2. 会话运行在真实 PTY 中。先确认一条基线输入和一条基线输出都成功，再开始施加网络故障。
3. 清除 `MOSH_SERVER_NETWORK_TMOUT`，或把它设得明显长于整个测试。测试期间不重启客户端、服务端或远端 shell。
4. 每条输入带唯一、不可猜测的编号；远端测试程序把实际收到的编号写入独立日志。验收时检查 **不漏、不重、顺序正确**。只在客户端画面中搜索标记不能排除同一命令被执行两次。
5. 服务端输出也带连续编号和最终状态摘要。恢复后既检查远端实际接收日志，也检查客户端最终权威画面。
6. 保存服务端日志、客户端日志、进程退出状态和抓包。每个用例结束后确认没有遗留 `mosh-server`。
7. 网络参数通过隔离的 network namespace 和 `tc netem` 施加，不能修改测试主机承载 SSH 的真实网卡。

建议让远端测试程序按行接收 `INPUT <seq> <nonce>`，将每条记录追加到测试日志，并回显 `ACK <seq> <sha256>`。结束时输出 `FINAL <count> <sha256-of-all-inputs>`。这样能把“显示最终画面”“输入完整”“输入没有重复执行”分开验证。

## 1. 65 秒双向断网后恢复

### 官方保证

- 官方 README 说明：客户端睡眠/唤醒或临时失去互联网连接时，会话仍保持，并在网络恢复后继续。[来源](https://github.com/mobile-shell/mosh/blob/mosh-1.4.0/README.md#L10-L18)
- `mosh-server` 手册说明：如果没有设置 `MOSH_SERVER_NETWORK_TMOUT`，服务端会无限期等待客户端再次出现；如果要配置，官方建议使用一周或 30 天这样的高值。[来源](https://github.com/mobile-shell/mosh/blob/mosh-1.4.0/man/mosh-server.1#L95-L106)

官方没有承诺固定恢复秒数，也没有把 65 秒定义为特殊边界。

### 源码推断

- 服务端 40 秒没听到客户端后，会清除当前回包目标并记录“detached”，但不会因此退出。[`network.h`](https://github.com/mobile-shell/mosh/blob/mosh-1.4.0/src/network/network.h#L133-L143)、[`network.cc`](https://github.com/mobile-shell/mosh/blob/mosh-1.4.0/src/network/network.cc#L417-L428)
- 收到新的、认证成功的客户端包后，服务端重新记录来源地址和端口并继续原会话。[`network.cc`](https://github.com/mobile-shell/mosh/blob/mosh-1.4.0/src/network/network.cc#L511-L573)
- 客户端在 10 秒没有成功往返后尝试更换本地 UDP 端口；这有助于重新建立 NAT 映射。[`network.h`](https://github.com/mobile-shell/mosh/blob/mosh-1.4.0/src/network/network.h#L139-L143)、[`network.cc`](https://github.com/mobile-shell/mosh/blob/mosh-1.4.0/src/network/network.cc#L423-L428)
- 客户端断开超过 60 秒后只会降低状态栏刷新频率，不会自动退出。[`terminaloverlay.cc`](https://github.com/mobile-shell/mosh/blob/mosh-1.4.0/src/frontend/terminaloverlay.cc#L312-L330)
- 只有“服务端从启动起从未收到过客户端”的情况，才会在 60 秒后退出。故障必须在首个状态往返成功后开始。[`mosh-server.cc`](https://github.com/mobile-shell/mosh/blob/mosh-1.4.0/src/frontend/mosh-server.cc#L680-L705)、[`mosh-server.cc`](https://github.com/mobile-shell/mosh/blob/mosh-1.4.0/src/frontend/mosh-server.cc#L909-L919)

### 可执行验收标准

以下数字是 **项目门槛**：

1. 会话完成基线往返后，两个方向同时 `loss 100%`，持续至少 65 秒。
2. 黑洞期间向客户端 PTY 写入至少一条唯一输入；远端在断网期间当然不会立刻收到，这不算失败。
3. 第 30、45、65 秒分别确认客户端和服务端 PID 仍存活，远端 shell PID 没有变化。
4. 恢复原网络后，黑洞期间写入的输入必须在 **10 秒内**到达远端且只执行一次；客户端最终画面必须出现对应确认。
5. 恢复后再发送一条新输入，仍必须在 10 秒内完成往返。
6. 不允许通过重新走 SSH、创建新 `mosh-server` 或新 shell 来“假装恢复”。

若只在恢复后才发送新命令，该测试只能证明“进程没死”，不能证明断网期间排队的用户输入被正确保留。

## 2. 单向丢包

### 官方保证

- 官方说明称 Mosh 支持丢失“显著比例”数据包的链路。[来源](https://github.com/mobile-shell/mosh/blob/mosh-1.4.0/README.md#L39-L50)
- 论文把“从丢包或乱序中恢复”列为 SSP 设计目标；传输的是从编号旧状态到编号新状态的幂等操作。[论文 2.1–2.3 节](https://mosh.org/mosh-paper.pdf)
- 论文的定量实验是 100 ms RTT、两个方向各 29% 独立丢包，约等于 50% 往返丢包；关闭本地预测时，Mosh 的中位协议延迟为 222 ms、平均 329 ms。[论文第 5 页](https://mosh.org/mosh-paper.pdf)

这不是永久单向中断的保证。某一方向 100% 永久丢包时，该方向的新信息不可能传过去，任何协议都不能保证实时进展。

### 源码推断

- 每个方向独立同步自己的状态；发送端根据已确认基线重建当前状态，不要求每个中间状态都到达。[`transportsender-impl.h`](https://github.com/mobile-shell/mosh/blob/mosh-1.4.0/src/network/transportsender-impl.h#L85-L125)
- 接收端去重已经见过的新状态；如果一个乱序状态引用的旧状态尚未到达或已丢弃，就先忽略，等待发送端从双方共同确认的基线重发。[`networktransport-impl.h`](https://github.com/mobile-shell/mosh/blob/mosh-1.4.0/src/network/networktransport-impl.h#L70-L118)
- 官方实现专门限制长期单向连接造成的接收状态队列增长；这说明长期非对称链路是被考虑的异常场景，但不是“任意长、任意速率都保证无上限缓存”。[`networktransport-impl.h`](https://github.com/mobile-shell/mosh/blob/mosh-1.4.0/src/network/networktransport-impl.h#L113-L131)

### 可执行验收标准

先跑一项接近官方论文的基线，再跑非对称用例：

1. **论文基线**：100 ms RTT，两个方向各 29% 独立丢包；连续 5 分钟或 1000 条唯一输入，以较晚完成者为准。
2. **上行受损**：客户端到服务端 30% 独立丢包，反向 0%；持续 10 分钟并发送 1000 条唯一输入。
3. **下行受损**：交换方向，其他条件不变。
4. **完全单向黑洞**：每个方向分别做一次 30 秒的 100% 丢包，恢复后检查收敛；不要求黑洞期间跨故障方向实时传输。

这些持续时间、30% 和 10 秒恢复线都是 **项目门槛**。通过条件是：客户端和服务端不退出；远端输入日志不漏、不重、顺序正确；恢复正常网络后 10 秒内显示最终状态；没有持续增长的未确认状态队列。

## 3. 乱序和重复包

### 官方保证

论文明确说明 SSP 用幂等的编号状态处理乱序和重复数据包，并把“从丢包或乱序中恢复”列为协议目标。[论文 2.1、2.2 节](https://mosh.org/mosh-paper.pdf)

RFC 8085 也要求需要可靠性或顺序的 UDP 应用自行处理重复和乱序；这不是 UDP 本身提供的能力。[RFC 8085 第 3.3 节](https://datatracker.ietf.org/doc/html/rfc8085#section-3.3)

### 源码推断

- 相同 Mosh 分片再次到达时不会重复计数；完整逻辑消息只在所有分片齐全后组装。[`transportfragment.cc`](https://github.com/mobile-shell/mosh/blob/mosh-1.4.0/src/network/transportfragment.cc#L91-L148)
- 已收到过的状态号直接忽略；仍可重建的乱序状态按编号插入历史，不会把当前最新画面倒退。[`networktransport-impl.h`](https://github.com/mobile-shell/mosh/blob/mosh-1.4.0/src/network/networktransport-impl.h#L88-L166)
- 较旧的加密包不会再改变 RTT 和漫游目标，但其有效载荷仍可交给上层状态同步处理。[`network.cc`](https://github.com/mobile-shell/mosh/blob/mosh-1.4.0/src/network/network.cc#L511-L519)

### 可执行验收标准

以下为 **项目门槛**：两个方向都施加 100 ms 基础延迟、20 ms 抖动、25% 乱序和 10% 重复，持续 10 分钟并交换 1000 条唯一输入；可以再叠加 5% 独立丢包。

验收必须同时满足：

- 远端每个输入编号恰好出现一次；不能只检查“最终有这个标记”。
- 服务端输出的最终摘要和客户端最终画面一致。
- 乱序旧包不能让画面回退到较早状态。
- 日志中不能出现协议解析失败、认证失败、断言失败或进程重启。

## 4. IPv6

### 官方保证

- 官方手册允许 `--family=inet6` / `-6`，并说明会话启动时选择一个 IPv4 或 IPv6 服务端地址，在该会话生命周期内保持这一地址族。[`mosh.1`](https://github.com/mobile-shell/mosh/blob/mosh-1.4.0/man/mosh.1#L157-L197)
- 同一手册也明确称 IPv6、双栈和多地址服务器支持“有限”。因此不能把“所有双栈切换和跨地址族漫游都透明”当成官方保证。[`mosh.1`](https://github.com/mobile-shell/mosh/blob/mosh-1.4.0/man/mosh.1#L60-L70)

### 源码推断

客户端和服务端都用 `AF_UNSPEC` 解析数值地址，并根据 `AF_INET6` 建立 UDP socket 和计算 IPv6 数据包预算。[`network.cc`](https://github.com/mobile-shell/mosh/blob/mosh-1.4.0/src/network/network.cc#L200-L212)、[`network.cc`](https://github.com/mobile-shell/mosh/blob/mosh-1.4.0/src/network/network.cc#L284-L388)

### 可执行验收标准

1. 客户端和服务端测试接口只配置 IPv6，不配置 IPv4；服务端绑定明确的 IPv6 地址，客户端也直接使用该数值 IPv6 地址。
2. 抓包必须确认终端会话的全部 Mosh 流量都是 IPv6 UDP，而不是 SSH 或 IPv4 后备路径。
3. 完成基线、连续输入、窗口变化、大画面和正常退出；远端输入日志与客户端最终画面一致。
4. 在具备公网 IPv6 路由时，再从不同公网前缀、至少跨一个路由跳数重复一次。

前三项通过只证明 **IPv6 协议路径**。`::1` 或同机 network namespace 不能证明公网 IPv6 路由、防火墙和运营商路径正常；公网项必须单独记录，不能用本机结果代替。

## 5. IPv6 最小 MTU 与“分片”

### 标准要求

- RFC 8200 规定 IPv6 链路最小 MTU 为 1280 字节。IPv6 路由器不会替源节点分片；源节点可以使用 Fragment Header，但能调整报文大小的应用应避免依赖它。[RFC 8200 第 4.5、5 节](https://datatracker.ietf.org/doc/html/rfc8200#section-5)
- RFC 8085 要求 UDP 应用避免产生超过路径 MTU 的 IP 包；如果不知道路径 MTU，IPv6 应回退到 1280，并从中扣除 IPv6、扩展头和 UDP 头。应用层大消息应拆成可独立接收和重传的 UDP 数据报。[RFC 8085 第 3.2 节](https://datatracker.ietf.org/doc/html/rfc8085#section-3.2)

### 源码推断

官方 Mosh 没有让大终端状态直接依赖 IPv6 分片：

- IPv6 总预算固定为 1280 字节，并保守预留 40 字节基础头、16 字节扩展头和 8 字节 UDP 头，得到 1216 字节的应用数据报预算。[`network.h`](https://github.com/mobile-shell/mosh/blob/mosh-1.4.0/src/network/network.h#L102-L134)、[`network.cc`](https://github.com/mobile-shell/mosh/blob/mosh-1.4.0/src/network/network.cc#L200-L212)
- Mosh 再扣除自己的序列号、时间戳和加密开销，把一条大的 SSP 指令拆成多个 Mosh 分片，每个分片放在独立 UDP 数据报中。[`transportsender-impl.h`](https://github.com/mobile-shell/mosh/blob/mosh-1.4.0/src/network/transportsender-impl.h#L319-L352)、[`transportfragment.cc`](https://github.com/mobile-shell/mosh/blob/mosh-1.4.0/src/network/transportfragment.cc#L157-L198)

因此这里应验证的是 **Mosh 应用层分片成功，同时不触发 IPv6 网络层分片**。把接口 MTU 强行设为 1279 或更小已经违反 IPv6 最低链路要求，不属于官方保证范围。

### 可执行验收标准

以下为 **项目门槛**：

1. 两端 IPv6 接口 MTU 都设为 1280，只使用 IPv6。
2. 把 PTY 设为至少 200×80，输出一帧确定性、难压缩的随机可见字符，保证单个逻辑画面变化明显大于一个 UDP 数据报；最后显示该画面的摘要标记。
3. 开启官方服务端详细日志，证明至少一条逻辑状态出现 `frag 1` 或更高编号，即实际走过 Mosh 应用层分片。
4. 抓包确认所有 IPv6 包长度不超过 1280，且没有 IPv6 Fragment Header；不得出现 `EMSGSIZE`、oversize datagram 或丢失最终状态。
5. 客户端最终画面摘要与服务端生成摘要相同，正常退出。

像 `seq 1 4000` 这类高度规律输出可能压缩得很好，而且 Mosh 只保证最新屏幕状态，不保证每一行滚屏历史。它能做大输出冒烟检查，但不能单独证明近 MTU 分片路径已被覆盖。

## 6. 长时间高延迟

### 官方保证和公开证据

- 官方称 Mosh 适合蜂窝、远距离和高延迟链路，并能在高延迟时预测显示按键。[README](https://github.com/mobile-shell/mosh/blob/mosh-1.4.0/README.md#L20-L34)
- 论文的真实轨迹覆盖 6 名用户约 40 小时、9986 次按键；EV-DO 链路平均 RTT 约 500 ms。论文还列出约 273 ms RTT 的 MIT–Singapore 路径结果。[论文第 4、5 页](https://mosh.org/mosh-paper.pdf)
- 发送间隔约为平滑 RTT 的一半，并被限制在 20–250 ms，以免持续输出填满网络队列。[论文 2.3 节](https://mosh.org/mosh-paper.pdf)、[`transportsender.h`](https://github.com/mobile-shell/mosh/blob/mosh-1.4.0/src/network/transportsender.h#L51-L57)、[`transportsender-impl.h`](https://github.com/mobile-shell/mosh/blob/mosh-1.4.0/src/network/transportsender-impl.h#L71-L83)

论文的 40 小时是收集到的真实使用轨迹，不等于官方做过一个连续 40 小时、固定 600 ms RTT 的耐久测试。

### 可执行验收标准

以下为 **项目门槛**：

1. 连续 30 分钟保持 600 ms RTT（两个方向各 300 ms），每个方向 100 ms 抖动和 1% 独立丢包。
2. 每秒发送一条唯一输入，共至少 1800 条；每 30 秒制造一次大画面更新。
3. 客户端、服务端和远端 shell 全程不重启；输入日志 1800 条不漏、不重、顺序正确；最终权威画面一致。
4. 故障参数移除后 10 秒内完成一次新的输入输出往返。
5. 从 5 分钟热身结束后开始记录客户端 RSS。结束时不应出现持续单调增长；最终值不得超过热身值的 25% 或 32 MiB（取更宽松者）。这是 MoshCatty 客户端自身的门槛，不包括 Netcatty/xterm.js 的滚屏缓存。

如果还要验收“用户感觉是否足够快”，必须在真实 Netcatty 页面另做预测回显、下划线和光标视觉检查。无头日志只能证明会话正确，不能证明视觉体验。

## 目标验收矩阵（不是当前完成清单）

| 场景 | 官方直接承诺 | 官方定量基线 | 本项目合格线 |
|---|---|---|---|
| 65 秒双向黑洞 | 临时断网后恢复；服务端默认无限等待 | 无 | 黑洞中输入保留；恢复后 10 秒内同一会话继续 |
| 单向丢包 | 支持显著丢包 | 双向各 29%、100 ms RTT | 每个方向单独 30% 持续 10 分钟；另做 30 秒单向全黑洞 |
| 乱序、重复 | SSP 设计目标，幂等编号状态 | 无百分比 | 25% 乱序、10% 重复、1000 条输入，恰好执行一次 |
| IPv6 | 可固定使用 IPv6，但双栈支持有限 | 无 | IPv6-only 协议路径通过；公网路径单独通过 |
| IPv6 MTU | 源码按 1280 字节预算避免网络层分片 | RFC 最小 MTU 1280 | MTU 1280，大画面触发 Mosh 分片，无 IPv6 Fragment Header |
| 长期高延迟 | 面向高延迟链路 | 真实轨迹平均约 500 ms RTT | 600 ms RTT 连续 30 分钟，1800 条输入正确，资源无持续增长 |

## 什么证据还不够

- 只看到 `AFTER_OUTAGE`：没有证明断网期间写入的数据被保留。
- 只看到 1000 个标记都出现过：没有统计每个标记是否出现且执行恰好一次。
- 只跑 `::1` 或同机 namespace：没有证明公网 IPv6 路由可用。
- 只输出大量连续数字：没有证明难压缩的大状态走过 Mosh 分片，也没有证明 IPv6 包未分片。
- 只跑 30 分钟但每 30 秒才做一次命令：可以证明会话存活，不能充分覆盖持续用户输入和队列压力。
- 只看无头客户端日志：不能替代 Windows 正式安装版中预测字符、下划线、光标和重复显示的视觉验收。

## 最终判断

官方资料足以支持这些期望：会话建立后，65 秒双向断网不应杀死会话；有限丢包、乱序和重复包应最终收敛；IPv6-only 和 1280 字节 MTU 是官方实现有意支持的路径；长延迟下应保持正确并避免队列被持续输出填满。

官方资料不支持虚构统一的恢复时限或百分比。本文给出的 10 秒恢复、30% 单向丢包、25% 乱序、10% 重复、30 分钟和 600 ms RTT，都是为了 Netcatty/MoshCatty 上线质量而设的 **项目门槛**。只有远端实际输入日志、客户端最终权威画面、进程身份和抓包同时满足，才应把某一项记为完成。
