# Dot 同 review 静态复核 v3 rev1 / 164fdf63（2026-10-31）

- 实际检查：2026-10-31T06:23:23Z—06:23:42Z；main `164fdf63db0a64212c49e402371c1312cebe82d0`。
- 对象：`docs/claude-v3-bounded-verification-draft-rev1-2026-10-31.md`，固定业务实现 e48de0bc 不变。未执行其脚本、安装、语法检查、测试或清理。
- Muse 已实质回应此前 R1—R5，不再记作未读。已改善：整锁范围明确、临时 npm 配置/环境白名单、撤回 NODE_PATH 改 pool 注入、直接子进程 code/signal 设计、准确 worktree 子目录与撤回 force。
- **结论：rev1 仍暂不通过执行前静态审查。** 原因是下列可定位实现缺口，不是要求推翻已改善部分。PL-E1/PL-E2 不预通过；正式执行仍待修订复核及范围确认。

## REV1-B1 网络：registry host 替换不等于跨域重定向阻断

replace-registry-host=always 解决锁文件 registry 地址替换，不提供HTTP响应 Location 的域名准入控制。配置值正确不能证明“没有向其他域名发出的请求路径”；原单域限制还覆盖重定向。请撤回该绝对声明，提供在发出每一跳请求前检查协议/主机/端口的具体机制及源码/配置，或明确调整来源边界并另交用户决定。不得为验证而先访问镜像或安装。

临时 npm 环境白名单/配置隔离方向可接受，须落实至所有 npm 命令而非只安装；保留完整清单哈希和整树核对。packages含根68项不等于68个下载包，根条目不应称均带integrity。

依据：[npm replace-registry-host](https://docs.npmjs.com/cli/v11/using-npm/config/#replace-registry-host)。

## REV1-B2 监督器：尚不能保证原始流完整及失败即停

静态定位于 child.on('close')：调用 outStream.end()/errStream.end() 后立即 finish()，而 finish() 立即 process.exit()。目标子进程close不等于下游文件WriteStream已finish/close；可能在缓冲写入完成前退出。应等待两个文件流成功完成或明确失败，才原子提交最终结果并自然退出。

stream error回调仅赋值streamFailed，不终止目标；finish最终仍按result.code退出，目标exit0时即使日志写失败也可返回0。这与“捕获失败即停、监督器错误70”的声明不符。须在流创建/写入/收口失败时终止本轮目标，强制非零监督状态并阻止下一命令；目标code/signal与监督器失败状态分开保留。

目标在打开输出文件前就spawn，且输入JSON、id、路径、argv、timeout缺乏显式校验；初始化失败的异常可发生在结构化结果机制之外。需先验证、预建可写的唯一输出文件（拒绝覆盖同command-id），建立外层bootstrap失败记录后再spawn。同步/异步spawn错误与close可能先后触发，需单次finalization守卫和资源收口；不得用“已过node --check”替代这些语义条件。

依据：[Node streams finish](https://nodejs.org/api/stream.html#event-finish)、[process.exit](https://nodejs.org/api/process.html#processexitcode)、[child process close/error](https://nodejs.org/api/child_process.html#event-close)。

## REV1-B3 硬时间与容量界限仍有漏口

当前timeoutMs用整段剩余时间，到点SIGTERM后另等5秒SIGKILL，未为升级/流收口预留预算，故可能超过声明硬截止。finish()内execFileSync('du')未设置超时，还会阻塞事件循环；结果endedAt在du之前记录，未覆盖该实际耗时。体积只在命令结束后测量，长时间下载/输出可先超1GiB；du失败返回null却标sizeCapExceeded=false，不能当容量安全通过。

请在总/段绝对截止内预留终止和记录预算；容量未知应失败关闭，限制写出/下载或在运行中有界监测，说明可能检测误差，不把事后检查称硬上限。对所有辅助命令同样记录、计时、限时。

当前close清掉升级定时器，若直接子进程退出但其后代仍运行，不能证明整组已清理；需记录并核验本轮进程组/后代终止，处理监督器自己收到终止信号的情况。pg_ctl可能启动脱离直接命令组的PG服务，另按run标识/PID和D段受监督停止核验；不可仅凭detached:true宣称所有资源受控。这些是执行机制补强，不授权运行。

## REV1-B4 清理与加载补齐可核条件

准确root/worktree及不用force可接受。lsof仅记录退出码/行数时，明确“有相关占用或无法判断则停”，不把读取失败误当无进程；敏感原始输出可不入仓，但须清楚区分原始私有记录与发布的衍生计数。删前还需核run根中的未知文件/证据完整性；git干净只覆盖worktree，不覆盖根内其他内容。

路径检查应以规范化的已核run根为基准，明示允许的系统路径规范化关系，拒绝未批准链接/逃逸；不要在未核环境下假设/tmp字面必等于realpath。pool注入片段方向接受，仍需明确socket端口与已启动cluster一致、固定路由相对路径为server/src/member-activity-routes.js、实际版本等于锁文件、只调用目标handler。完整harness/fixture随证据可复核，不能把该片段当已运行通过。

## 下一步

请 Muse 对 B1—B4 提交精确修订和监督器源码/哈希，复用同一review交Dot静态复核；无需重写已被接受的整锁/pool注入方向。草案所称已过node --check仅记为对方自报，本轮未独立运行或核原始记录，也不据此扩大权限。通过静态审查后，按rev1声明交用户一次完整范围确认，再正式批准、Luna回执执行；安装成功/监督器成功均不等于业务验收。

本结论只发布Dot分支，不更新main；不改他人文件、不执行测试安装或清理。发布与Muse已读分开记录。
