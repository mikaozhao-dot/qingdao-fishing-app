# 广场筛选有界验证方案更新（待 Muse 评审、创始人批准）

- 状态：**仅为方案草案，不构成任何执行授权。** 本次只写本文；没有检出 worktree、检查本机依赖、创建数据库、运行迁移、测试或验证命令，也没有安装或下载依赖。
- 原方案：`docs/luna-plaza-filter-bounded-verification-plan-2026-10-31.md`
- 固定实现 SHA：`e48de0bc22a28d41203d653fb1bedf8a2ecf071a`
- 首跑停止证据：`docs/evidence/member-activity-e48de0bc/20261031T030033Z/`。该目录的四个文件保持原样，不回填、不改写，也不并入任何后续运行。
- 更新依据：Muse 对 `25d35e3c` 停止报告的评审，要求本更新同时解决固定 SHA worktree 无法解析 `pg` 与逐命令原始日志捕获两点。本文只请求 Muse 评审；Muse 评审通过后仍须创始人另行明确批准执行。

## 本次解决的两点

### 1. 从既有本机安装解析 `pg`，不改 worktree 或依赖状态

原方案中的 `createRequire(<WORKTREE>/server/package.json)` 改为从既有 Homebrew 全局 Node 模块目录直接加载：

```js
import { createRequire } from 'node:module';

const pgRequire = createRequire('/opt/homebrew/lib/node_modules/pg/package.json');
const { Pool } = pgRequire('./');
```

- 模块来源固定为 `/opt/homebrew/lib/node_modules/pg/`。本次起草没有检查该路径是否存在；它是未来执行的只读前置条件，不是存在性声明。若目录或 `package.json` 不存在、不可读或无法加载，立即停止并回报；不搜索其他路径、不设 fallback、不复制或链接模块。
- 在固定 SHA worktree 中，只读解析 `server/package.json` 的 `dependencies.pg` 和 `server/package-lock.json` 的 `packages["node_modules/pg"].version`；本次已读到两者均为精确版本 `8.23.1`。再只读解析上述既有安装的 `package.json.version`。三个版本字符串必须逐字相同且等于 `8.23.1`；任一缺失、不一致或无法读取即停止。不得按 semver 范围推断相等，不得凑用其他版本。
- Harness 用上述独立 `createRequire` 获取 `Pool`，再把 pool 注入固定 worktree 导出的 `registerMemberActivityRoutes`。这不要求固定 worktree 自己解析 `pg`，也不改变 worktree 中的文件、依赖目录、锁文件或 Node 配置；不设置 `NODE_PATH`，不创建 symlink，不复制文件，不运行包管理器。
- 固定路径是本草案唯一选定的来源。若它不可用，执行时停手；改换路径或其他机制须先更新方案、经 Muse 评审并取得创始人批准。

### 2. 逐条命令分别捕获原始日志

每个新 run 的证据目录预先放置一份只依赖系统自带 `zsh` 与标准工具（如 `date`、`mkdir`）的 `capture-command.zsh`，不依赖项目包；同时记录脚本 SHA-256。每个目标命令单独调用一次捕获器，不将多条业务/环境命令放在同一条 shell invocation 中执行。调用形式为：

```sh
zsh <RUN_EVIDENCE>/capture-command.zsh <command-id> -- <executable> <arg1> <arg2> ...
```

每个 `<command-id>/` 单独保存：

- `command.txt`：执行文件、按参数边界记录的原始 argv、工作目录；使用可读的 shell 转义表示，不拼接后再交给 shell 求值。
- `stdout.bin` 与 `stderr.bin`：目标进程两个流的原始字节，分别直接重定向，不合并、不 tee、不编辑。
- `result.json`：目标进程退出码或 signal，以及 UTC 起止时间戳。

捕获脚本以 `if "$@" >stdout.bin 2>stderr.bin; then ...; else rc=$?; fi` 保留目标命令退出码，再单独写入时间及结果元数据；每一条命令完成后立即核对日志文件和结果记录，非零退出按原方案相应停止条件处理。控制层另将捕获器 invocation、捕获器 stdout、捕获器 stderr、退出码及起止时间分别写入 `capture-wrapper-command.txt`、`capture-wrapper-stdout.bin`、`capture-wrapper-stderr.bin`、`capture-wrapper-result.json`。捕获器本身不得向终端合并目标命令输出。若任一文件无法创建、无法记录结束时间/退出码，或捕获器/控制层异常，立即停止后续步骤并保留现场；不得重跑该命令以补日志。

预检与正式步骤一律使用此机制，包括固定 SHA / 工作树状态、版本与依赖只读核对、环境命令、`initdb`、`pg_ctl`、`createdb`、迁移、定点测试、语法检查、PG harness 与清理检查。两份允许的迁移改为两次单独的 `psql -f` 调用，以便分别保存输出；顺序与迁移范围不变。创建 run 目录和捕获脚本属于日志器 bootstrap，需在 manifest 中单列记录；开始任何方案中的环境预检命令之前，日志器必须已就绪。若不能先建立日志器 bootstrap 记录，则不得开始预检。

日志只允许出现固定 worktree 路径、随机 `/tmp/qf-e48de0bc-*` 路径、固定 `/opt/homebrew/lib/node_modules/pg` 路径和合成 ID；不得输出个人目录、连接串、口令、云凭据或真实用户数据。若发现原始日志含个人路径或敏感值，按原方案立即停止发布，不得静默编辑后称为原始日志。

## 与原方案逐项对照

| 原方案部分 | 本更新处理 | 说明 |
| --- | --- | --- |
| 固定 SHA、Node/PostgreSQL/macOS 版本核对、干净 detached worktree | 沿用；改为每项命令分别捕获 | Node `>=22`、本机 PostgreSQL `17.11`、完整版本记录、HEAD 完整 SHA 与干净工作树门槛不变；失败立即停止。 |
| 独立随机 `/tmp` PostgreSQL、仅 Unix socket、禁用 TCP | 沿用 | 不连接共享/生产库或外部主机，不读取 `.env`、云凭据或真实数据。 |
| 仅迁移 `001_core_schema.sql`、`033_member_activity_requests.sql` | 沿用迁移集合与顺序；命令粒度改为两次独立 `psql -f` 调用 | 迁移失败即停，不扩迁移。 |
| 合成数据与唯一业务入口 `registerMemberActivityRoutes` | 沿用 | 仅一条合成 users、一条 approved captain profile 和合成需求行；不建班次、订单、船只或身份材料。联系方式字节/哈希为虚构值，码值来自平台内目录。`requireUser` 仍只 stub 合成船长身份，不声称测试真实认证。 |
| 五维筛选、状态/到期、101 行排序与 LIMIT 100、时钟边界 | 沿用 | 包含五维逐项变更排除目标行、无效码拒绝；closed/expired 排除和到期事实；101 条按原顺序核对完整前 100 条；`expires_at = clockNow` 边界及数据库时钟转换。不增加测试维度或生产结论。 |
| 定点测试、两个语法检查和真实 PostgreSQL harness | 沿用，所有命令分别记录 | 定点/语法检查不替代数据库行为验证；harness 不替代真实认证、全量迁移、并发压力、端到端或生产验证。 |
| 证据目录、manifest、fixture、预期/实际 ID、日志隐私检查 | 沿用；增加捕获器源码及其 hash、逐命令目录 | 新 run 使用全新 run-id；首跑停止目录原样保留。 |
| 10 分钟与 1 GiB 上限、本次资源有界清理 | 沿用 | 本机 CPU/磁盘，不用云端、外部服务或付费资源；触顶停止并保留失败日志。只核验并清理属于本 run 的 PID、socket、数据目录与 detached worktree；校验失败即停，不扩大范围。 |
| docs-only 归档、Muse 复核、Dot 对 PL-E1/PL-E2 复核 | 沿用 | 本更新及其后续执行均不构成验收；匹配通知切片继续冻结，直至 Dot 点头。 |

## 明确变更项与审批边界

1. **依赖解析变更**：从 worktree 内部的 `createRequire` 改为固定路径 `/opt/homebrew/lib/node_modules/pg/package.json` 的只读加载；不改 worktree 或依赖状态，不安装、下载、复制、链接或改配置。若该机制不可用，不执行；任何换源或会改变 worktree/依赖状态的方案都须在单独更新中说明并经 Muse 评审、创始人批准。
2. **日志执行机制变更**：新增逐命令捕获器，预检和正式命令一律分开记录 stdout、stderr、退出码和 UTC 起止时间；两份迁移也拆成两次独立调用，迁移范围和顺序不变。捕获失败即停止。
3. **未变更范围**：除以上两点外，沿用原方案第 1 至 6 节所有数据、环境、业务入口、测试覆盖、资源限制、隐私、清理、证据归档及审批边界。原方案正文不在本提交中改写。

## 审批与后续流程

本文只请求 Muse 评审。未取得 Muse 对本文的评审结论及创始人对执行的明确批准前，禁止创建 worktree、检查本机依赖、创建 cluster、运行任何迁移/测试/验证、安装/下载依赖或改代码。若获批，先按批准范围回执，再以新 run-id 执行；收令回执仍不等于验收。证据提交后先交 Muse 复核，再由创始人转 Dot 对 PL-E1/PL-E2 复核。四维匹配通知切片继续冻结，本更新不解冻任何切片。
