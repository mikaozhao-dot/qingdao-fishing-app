# 广场筛选切片有界沙盒验证方案（待 Muse 评审、创始人批准后执行）

- 对应 Dot 复核：`docs/dot-plaza-evidence-inventory-review-2026-10-31.md`。
- 对应 Muse 转交：`docs/claude-to-luna-bounded-verification-plan-request-2026-10-31.md`。
- 固定实现：`e48de0bc22a28d41203d653fb1bedf8a2ecf071a`。
- 目的：只提出补齐 PL-E1/PL-E2 的本地验证计划。**本文是方案，不是测试、迁移、代码修改或生产操作授权；当前未执行本文任何命令。**
- 目标结果：取得固定 SHA 可追溯的原始运行证据；用隔离的真实 PostgreSQL 查询验证广场筛选、状态/到期排除、排序和上限。即使所有步骤通过，也只供 Dot 对该切片复核，不自动构成技术验收或解锁后续切片。

## 1. 固定版本与环境核对

批准后在独立 detached worktree 中检出上述完整 SHA，并在任何测试前记录：

```sh
git -C "$WORKTREE" rev-parse HEAD
git -C "$WORKTREE" status --porcelain
```

`HEAD` 必须逐字等于 `e48de0bc22a28d41203d653fb1bedf8a2ecf071a`，工作树必须干净；否则立即停止。记录 Node、PostgreSQL 客户端和服务端的完整版本，以及 macOS 版本、启动/结束时间、工作目录（使用 `/tmp` 路径，避免个人目录泄露）。Node 须满足项目要求 `>=22`；拟用本机已有 PostgreSQL `17.11`。若所需版本或 `pg` 依赖不在本机，停止并报告，不下载、不联网安装、不改依赖锁文件。

## 2. 数据与隔离

- 使用独立临时 PostgreSQL cluster，数据目录、Unix socket、日志和数据库均位于一个随机命名的 `/tmp/qf-e48de0bc-*` 目录；禁用 TCP 监听，只开放该目录下的本地 socket。不连接共享开发库、生产库或任何外部主机；不读取 `.env`、云端凭据或真实业务数据。
- 仅在空临时库按顺序应用现有 `server/migrations/001_core_schema.sql` 与 `server/migrations/033_member_activity_requests.sql`。前者提供用户、船长、班次和订单基础表，后者提供需求单及事实表。若这两份迁移不能独立建立本验证所需结构，停止并提交新方案；不擅自运行其他迁移。
- 只写合成用户、一个 `approved` 船长档案和合成需求单；固定或随机测试 UUID、虚构联系方式字节与哈希，不放入真实姓名、手机号、微信、订单、支付、保险或用户内容。使用平台内目录中的有效码值。
- 唯一业务入口是临时 Node harness 注册当前 `registerMemberActivityRoutes`，用真实 PostgreSQL pool 执行当前广场 handler 与到期 CTE；`requireUser` 在 harness 中仅用 stub 注入合成船长身份，因此不把结果描述为真实认证中间件验证。所有查询、更新和到期事实均只发生在该临时库。

批准后拟用的临时环境命令骨架如下；`ROOT` 每次随机生成，命令只针对该目录与本地 socket：

```sh
ROOT="$(mktemp -d /tmp/qf-e48de0bc.XXXXXX)"
WORKTREE="$ROOT/worktree"
PGROOT="$ROOT/pg"
mkdir -m 700 -p "$PGROOT/data" "$PGROOT/socket"
git worktree add --detach "$WORKTREE" e48de0bc22a28d41203d653fb1bedf8a2ecf071a
git -C "$WORKTREE" rev-parse HEAD
git -C "$WORKTREE" status --porcelain
initdb -D "$PGROOT/data" --no-locale -E UTF8 -U qf_test
pg_ctl -D "$PGROOT/data" \
  -o "-c listen_addresses='' -c unix_socket_directories=$PGROOT/socket -c port=55439" \
  -l "$PGROOT/postgres.log" -w start
createdb -h "$PGROOT/socket" -p 55439 -U qf_test qf_e48de0bc
psql "host=$PGROOT/socket port=55439 user=qf_test dbname=qf_e48de0bc" \
  -v ON_ERROR_STOP=1 \
  -f "$WORKTREE/server/migrations/001_core_schema.sql" \
  -f "$WORKTREE/server/migrations/033_member_activity_requests.sql"
```

若系统已有同名 socket/端口造成冲突，改用本次随机 socket 目录中的另一个端口；不停止或改配任何现存 PostgreSQL 实例。若上述两份迁移失败，不尝试扩大迁移范围。

## 3. 拟运行步骤与覆盖

先在固定 SHA 的 `server/` 目录运行现有定点回归和语法检查：

```sh
node --test test/member-activity.test.js
node --check src/member-activity-routes.js
node --check src/member-activity-service.js
```

随后运行独立 PG harness，建议以 Node `node:test` 测试文件实现，并用 `node --test <evidence-dir>/plaza-filter-pg.integration.test.mjs` 执行。Harness 可用 `createRequire(<WORKTREE>/server/package.json)` 解析项目现有 `pg` 依赖，再从固定 worktree 导入 `registerMemberActivityRoutes`；数据库连接参数只指向该随机 Unix socket。Harness 源码、合成数据定义和断言随结果归档在 `docs/evidence/member-activity-e48de0bc/<run-id>/`，但不改 `server/src`、`server/test` 或任何业务代码。Harness 使用真实数据库列表查询，并逐项保存期望 ID 与返回 ID：

Fixture 只需插入一条合成 `users` 记录（虚构 `phone_ciphertext`/`phone_hash`）、一条 `captain_profiles.verification_status='approved'` 记录，以及 `member_activity_requests` 合成行；不创建班次、订单、船只或身份材料。所有目标码从当前平台目录读取。每个断言保存筛选输入、预期需求 ID、实际需求 ID 及到期后状态/事实计数，不输出连接串。

1. **五维筛选**：以同一组有效码头、日期、人数、鱼种和包/拼方式请求时仅命中目标行；逐一改变任一维度后，原目标行应被排除。另跑五维组合筛选，确认无效码仍走现有拒绝路径。
2. **状态和到期**：closed、已 expired 行不出现在结果；published 且 `expires_at` 已过数据库当前时钟的行经既有到期 CTE 后转成 expired 并不返回，同时确认事实表只在预期到期转换时有合成记录。
3. **排序和上限**：准备 101 条均符合条件的合成需求，按 `requested_start_at ASC, created_at DESC, id ASC` 核对前 100 条完整顺序；结果数量必须为 100，第 101 条不得出现。
4. **时钟边界**：用数据库 `clock_timestamp()` 建立基准，并通过 route 的 `clockNow` 注入固定应用时钟。至少覆盖 `expires_at = clockNow` 的严格边界（不返回但因数据库时钟仍较早而保持 published）及数据库当前时钟已过期的转换。记录两种时钟值，不把此项外推成生产时钟同步结论。

执行定点测试与两个语法检查不替代 PG 行为验证；PG harness 不替代真实认证、迁移全链、并发/事务压力、端到端或生产环境验证。

## 4. 原始证据与归档

每条命令分别保存未编辑的 stdout、stderr、退出码和起止 UTC 时间；另存 manifest，记录固定 SHA、命令原文、Node/PostgreSQL/macOS 版本、隔离 cluster/socket 标识、harness SHA-256、合成 fixture 标识及每项预期/实际结果。数据库连接串和任何凭据不得写入日志；发布前对日志做隐私检查，只允许本地临时路径和合成 ID。若原始输出包含个人目录或凭据，停止发布并先设计可追溯的脱敏方式，不能静默改写后称为原始日志。

归档建议：`docs/evidence/member-activity-e48de0bc/<run-id>/`，包含 harness 源码、fixture/查询脚本、manifest、各命令原始输出和结果表；另外写一份简短回执解释覆盖边界。是否在一次执行中产生的证据都归入新 run，不回填成历史运行结果。归档后作为独立 docs-only 提交，请 Muse 复核，再交 Dot 对 PL-E1/PL-E2 复核。

## 5. 资源、费用与清理

- 只使用本机既有软件和本地 CPU/磁盘；禁止外部服务、云资源、付费资源和网络安装。建议总执行上限 10 分钟、临时目录上限 1 GiB；触顶立即停止并保留失败日志。
- Harness 关闭数据库 pool；停止本次独立 PostgreSQL cluster；确认目标 PID、socket 和数据目录均属于本 run 后只清理该随机命名临时目录及 detached worktree。不使用 `killall`、不清理共享 PostgreSQL 数据、不触碰其他 worktree。
- 若清理校验失败，停止删除并回报剩余临时资源位置；不扩大清理范围。

## 6. 审批门槛

当前提交只请求 Muse 审阅方案。待 Muse 确认范围与命令可行后，再由创始人明确批准是否执行；批准前不检出新 worktree、不查询本机版本、不创建 cluster、不应用迁移、不运行单测/语法检查/harness，也不改代码。Muse 或创始人要求改动方案时先更新本文并重新评审。未取得明确执行批准前，四维匹配通知切片继续等待。
