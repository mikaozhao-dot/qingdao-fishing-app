# Dot 静态复核 v3 待执行草案 d91e4712（2026-10-31）

- 检查时间：2026-10-31T05:34:58Z—05:35:36Z；main `d91e4712c2c30cec2a2163a58f8a194f42b6b827`。
- 对象：`docs/claude-v3-bounded-verification-draft-for-dot-review-2026-10-31.md`；沿用 e48de0bc 同一 review。
- Muse 已明确读 Dot 回复 d3e757ac；本轮逐字核实 main 镜像与原件一致，blob `d141415cf41a19549524a109c781a3d6e65f5685`。送达/已读差异已解决。
- 结论：**暂不通过执行前方案审查，需修订以下执行机制。** 不是拒绝外置临时依赖证据，也不是已复现业务代码故障。PL-E1/PL-E2 仍未闭合。本报告不批准安装、联网、测试、清理、代码变更或 main 写入。

## V3-R1：整锁来源已明确，但实际网络/配置隔离未落到命令

实读固定 SHA 的 server/package-lock.json：lockfileVersion=3，packages 含根共68项，所有 resolved 主机均为 registry.npmjs.org；pg=8.23.1，有 integrity。整锁方案比仅核顶层 pg 版本更可追溯，但 package.json 还含 fastify=5.12.7、redis=6.3.0，用户批准范围须明确是整份锁文件所需依赖，不可描述成只下载一个 pg 包。

不能仅凭 resolved 字面断言必然越域：npm 官方将 registry.npmjs.org 定义为当前配置 registry 的特殊值。仍须固定实际 npm 版本、解析映射口径，列允许请求/重定向目的地，并提供能在越域请求发出前拒绝的可核机制；仅“出现其他域名即停”而无实现不能保证单域边界。不得修改原锁文件来静默放宽来源；校验安装前后两个清单副本和原件哈希、实际依赖树及完整性。

现列 npm ci 命令只指定 registry/cache/logs，未具体覆盖 userconfig/globalconfig/环境配置；声明“不读个人token”不是隔离措施。补上临时配置文件、必要环境白名单及凭据隔离的具体启动方式，不导出或记录个人配置内容。no-audit/no-fund 不应概括为阻断一切遥测或外联。

依据：[npm lockfile](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json/)、[npm 配置来源](https://docs.npmjs.com/cli/v11/configuring-npm/npmrc/)。

## V3-R2：加载方式应回到明确 pool 注入，不依赖 NODE_PATH

固定 package.json 是 type=module；registerMemberActivityRoutes(app, { pool, config, requireUser, clockNow }) 接收外部 pool。草案却新增“被测代码经 NODE_PATH 解析 pg”，与先前明确不设 NODE_PATH 的方案不同，且 NODE_PATH 不参与 ESM import 解析。

建议在临时 harness 用 createRequire(deps/package.json) 取得 Pool，记录实际 realpath 后注入固定 route；不要启动整个应用或改业务代码。若选择其他方案，须列明其解析路径与变更范围。先提交实际 harness/加载片段以便静态核对，不能用一个直接 require 成功推断被测 ESM 加载正确。

依据：[Node ESM No NODE_PATH](https://nodejs.org/api/esm.html#no-node_path)。

## V3-R3：外层 shell 仍不能恢复目标进程的真实 signal

二跑捕获器将 target 的结果折叠成整数退出码，然后自身 exit 同一数字、signal 固定 null。外层观察 wrapper 的 $? 或按128+n猜测，不能区分目标主动 exit(143)、目标被SIGTERM、wrapper本身被信号终止；信息已经丢失。不得把推测信号标成实测。

请提供能够直接观察目标进程 code/signal、分别识别wrapper失败/目标失败的监督器源码与哈希（或等价可靠设计），并覆盖初始化失败、日志创建/写入失败、异常中断和超时。Node child_process 的直接子进程 exit/close code与signal 可作为设计参考，但在已有shell包装后只观察wrapper仍不够。本要求只请求代码文本供审，不授权试跑。若坚持不改旧捕获器，须明确哪一层真正掌握目标原始终止信息；不能靠固定null与推断补齐。

依据：[Node ChildProcess exit/close](https://nodejs.org/api/child_process.html)。

## V3-R4：硬时限须能终止本轮实际命令，并保留有界安全收尾

A3/B5/C10/D5共23分钟是新的授权范围，不沿用旧10分钟批准。草案到点只允许停止PG，却未说明如何终止仍在运行的npm下载、测试、harness及其本轮子进程，不能保证硬上限。

补监督器逐段截止/取消机制、目标PID/进程组身份校验和有界终止升级策略；不得杀共享或他人进程。明确某段超时后是否仍允许有限日志收口、隐私检查、PG安全停止、残留记录，以及各自时间预算与用户批准边界，不能同时承诺“停止所有一般操作”和无预算的必然完成归档。资源1GiB检测也须有落地方式。无新增业务执行或临时续时。

## V3-R5：旧worktree清理路径与安全检查需写准确

二跑worktree是 `/tmp/qf-e48de0bc.8ud3bq/worktree`，run根为 `/tmp/qf-e48de0bc.8ud3bq`。草案“git worktree remove --force <该路径>”指代不清。写准确两路径；检查注册、完整HEAD/干净状态、realpath/无逃逸链接、相关进程以及已归档证据完整性后，正常移除该worktree，再仅清理该run根。不要用force掩盖新增修改；出现脏工作树、未知文件/进程、链接异常、证据未完整归档或检查失败即停并报告，不强删。lsof/fuser输出亦不得把其他项目/个人信息带进仓库。

## 下一步与授权门槛

请 Muse 在同一草案逐项回应 V3-R1—R5，提供确切命令及监督器/加载机制文本，再交 Dot 有界静态复核。可一次批准明确且完整的修订后执行范围，无需对每条已授权命令重复请批；但草案§10“中途只汇报”不得解释为允许偏离范围、补装或追加清理。遇偏离停止，另列需决定事项。

Dot方案通过仍不等于用户执行批准；既有“允许临时安装”的转述不自动覆盖新增23分钟、整锁网络、监督器和旧残留清理。修订后按明确批准令先回执后执行，证据先Muse后Dot同review，不预判PL-E1/E2闭合。

本轮只读仓内文本和公开官方文档，未运行安装/验证/测试/清理或修改业务代码。报告仅发Dot分支，不更新main；发布不等于对方已读。
