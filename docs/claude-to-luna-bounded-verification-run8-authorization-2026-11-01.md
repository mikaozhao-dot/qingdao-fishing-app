# run 8 授权令（依赖来源终局裁定·路线 a：只读本机 pg）：v3 有界验证第八次执行

- 日期：2026-11-01
- 发令：Muse
- 生效依据：run 7 停手报告 `81983d9a`（B 段前因依赖来源三方冲突停手：原方案禁网安装、方案更新草案只读本机 pg 但自声明非执行授权、源码交付与续跑令的 67 包联网安装口径未经方案更新批准；停手报告明示须由 Muse/创始人经显式评审批准的文本先行消解冲突）；巡检评审 `docs/ui-design-review-81983d9a.md`（提交 `9f7a9c2d`，呈创始人二选一）；**创始人 2026-11-01 在海钓侧聊点选「选 (a)：批准只读路线，用本机 pg（版本须与 8.23.1 逐字一致）」**。本令即该点选的执行文本。
- 依据链全集：原方案 `4fe41339` ＋ 方案更新草案 `8841b053` ＋ 执行令 `686ace04` ＋ 补丁生效文本 `70fe1d48` ＋ 源码交付与续跑令 `44275557` ＋ 预算统一生效令 `8fdc6c1d` ＋ run 3 授权令 `c02d2c75` ＋ run 4 授权令 `22596178` ＋ run 5 授权令 `ad9b964f` ＋ run 6 授权令 `6b421f69` ＋ run 7 授权令 `934481cd` ＋ run 7 回执 `99df3534` ＋ run 7 清理窗证据 `70563e2c` ＋ run 7 A 段证据 `457aac14` ＋ run 7 停手报告 `81983d9a` ＋ 巡检评审 `9f7a9c2d` ＋ 本令。与前述文件冲突处，按本令第 1 节的消解表处理；未被消解表触及的条款（验证范围、证据口径、停手纪律、合成数据与隔离要求）全部不变。

## 1. 依赖来源终局裁定（本令核心，消解 run 7 停手所指冲突）

1. **方案更新草案转正（仅限本 run）**：方案更新 `8841b053` 的依赖解析一节，经创始人本次点选批准、由本令正式采为 run 8 的执行依据；其「仅为方案草案、不构成执行授权」的状态表述，就本 run 而言被本令取代。该草案其余部分（逐命令捕获、对照表、审批边界中与本令不冲突者）随同生效。
2. **唯一依赖来源（固定路径、只读）**：harness 所需 `pg` 只能按下式从既有本机安装只读加载，不得有任何其他来源：

   ```js
   import { createRequire } from 'node:module';
   const pgRequire = createRequire('/opt/homebrew/lib/node_modules/pg/package.json');
   const { Pool } = pgRequire('./');
   ```

   取到的 `Pool` 注入固定 worktree 导出的 `registerMemberActivityRoutes(app, { pool, config, requireUser, clockNow })`（app 为捕获式假对象，与定点测试同模式，不启真实 Fastify）。
3. **三方版本逐字核对（B 段门槛）**：固定 worktree 内只读解析 `server/package.json` 的 `dependencies.pg`、`server/package-lock.json` 的 `packages["node_modules/pg"].version`、既有安装 `package.json` 的 `version`，三者必须逐字相同且等于 `8.23.1`。任一缺失、不可读、不一致或加载失败，即在 B 段停手报回。本机该落点在二轮 run 曾查为空——本 run 只按本节复核，查无即停手是正确结果，不得临场改源。
4. **禁止项（本 run 全程）**：不安装、不下载、不复制、不链接（含 symlink）、不设置 `NODE_PATH`、不运行任何包管理器、不为依赖发起任何网络请求、不搜索其他路径、不设 fallback、不改 worktree 内任何文件/锁文件/配置。
5. **冲突消解表（下列旧口径就本 run 而言全部让位于本节）**：
   - 原方案 `4fe41339` 中 harness 以 `createRequire(<WORKTREE>/server/package.json)` 解析 `pg` 的口径 → 被第 2 条的固定路径口径取代；原方案「不下载、不联网安装」的禁令与本路线一致、继续有效。
   - v3 联网安装链（执行令 `686ace04`、源码交付与续跑令 `44275557` 及 rev1–rev5 草案中关于 B 段的部分）所定的「整锁 67 包经准入代理联网安装」→ **本 run 取消、不予授权**。`registry-gate.mjs` 本 run 不得调用；`supervise.mjs` 本 run 不使用，其未使用系本令明示安排、不构成偏离，两工具文件本身不动。
   - 方案更新草案对照表中沿用原方案「总执行 10 分钟」的表述 → 被预算统一令及 run 3 以降口径取代，本 run 预算以本令第 4 节为准。
   - 计时与日志机制：本 run 采用方案更新第 2 节的 `capture-command.zsh` 逐命令捕获（每命令单独保存 command/stdout/stderr/result，捕获器源码与 SHA-256 入证据、bootstrap 在 manifest 中单列）；两份迁移拆为两次独立 `psql -f` 调用。不采用 v3 监督器捕获口径。
6. **路线 (b) 未授权**：联网安装方案更新不在本令范围内；B 段停手后如需走 (b)，须另经方案更新、Muse 评审与创始人批准，不得以本令为据续行。

## 2. 清理窗（对象仅一处：run 7 保留根）

- 对象：run 7 A 段隔离根 `/private/tmp/qf-e48de0bc.20261101T232857Z.p0yahdxh`（run 7 停手后按「保留现场」留存，内含 detached worktree；run 7 证据已入仓 `70563e2c`/`457aac14`/`81983d9a`，本 run 不重做归档）。
- 口径沿用 run 7 甲案：只列顶层条目名字＋类型（一层为限）；每个条目须归入已知运行时目录名（`worktree/`、`pg/`、`deps/`、`home/`、`npm-cache/`、`npm-logs/`）、`capture/`、或已在 run 7 归档证据中有着落的根级运行产物文件；无法归类即按序短路停手（名字含个人标记时只报类型、不记录名字）。
- 被排除目录严禁打开、读取、哈希、枚举或归档其内容，仍随根删除。
- 对账后按序短路做其余身份核验：路径存在、非符号链接、realpath 一致 →（有 worktree 时）.git 指针与反向指针、固定 HEAD `e48de0bc`、工作树干净（含 untracked，有 untracked 即停手）、注册状态、占用检查 → 注销 → 删除整根 → 事后核验 absent。路径在开工时已不存在的，停手报回（无法证明其身份），不得径行视为已清理。

## 3. 执行分段（Luna，先回执后动手，仅此一个新 run）

- 回执文件：`docs/luna-bounded-verification-v3-run8-receipt-2026-11-01.md`，须注明依据链含本令与创始人路线 (a) 点选。
- **A 段（准备）**：先建证据目录与 `capture-command.zsh` 并记录其 SHA-256（bootstrap 完成前不得开始任何预检命令）；新建随机隔离根（`/tmp/qf-e48de0bc.<新 run-id>.*`、权限 0700）；detached worktree 检出固定 SHA `e48de0bc22a28d41203d653fb1bedf8a2ecf071a`，核 HEAD 逐字一致、工作树干净；记录 Node（须 ≥22）、PostgreSQL 客户端/服务端、macOS 完整版本；根顶层清单与体量（≤1 GiB）。
- **B 段（依赖只读核验）**：按第 1 节第 2–4 条执行：固定路径目录与 `package.json` 存在可读 → 三方版本逐字核对 → `createRequire` 加载 `Pool` 成功（只记录成功/失败与版本，不记录任何连接串）→ 复核 worktree 仍干净。全过才进 C 段；任一不过即停手归档、本 run 关闭。
- **C 段（真实 PG 验证）**：顺序为 ①`initdb` 建独立 cluster（数据/socket/日志均在本 run 隔离根内、仅 Unix socket、禁用 TCP；端口冲突时只在本 run socket 目录内换端口，不停、不改任何现存实例）→ ②`createdb` → ③迁移 `001_core_schema.sql`（独立一次 `psql -f`）→ ④迁移 `033_member_activity_requests.sql`（独立一次 `psql -f`）→ ⑤定点测试 `node --test test/member-activity.test.js` → ⑥语法检查两件（`node --check src/member-activity-routes.js`、`node --check src/member-activity-service.js`）→ ⑦真实 PG harness（`node --test <证据目录>/plaza-filter-pg.integration.test.mjs`，Pool 按 B 段方式注入），覆盖原方案第 3 节全部断言：五维逐项变更排除与无效码拒绝、closed/expired 排除与到期 CTE 转换、101 行按 `requested_start_at ASC, created_at DESC, id ASC` 核对完整前 100 条与 LIMIT 100、`expires_at = clockNow` 时钟边界；每项保存预期 ID 与实际 ID。只用合成数据（一条合成 users、一条 approved captain profile、合成需求行），不读 `.env`、不碰真实数据与凭据。
- **D 段（收口）**：关闭 pool、停本 run cluster（先核 PID/socket/数据目录确属本 run）、注销 worktree 并删除本 run 隔离根、核验 absent；证据隐私扫描（日志只允许固定 worktree 路径、随机 `/tmp` 路径、固定 `/opt/homebrew/lib/node_modules/pg` 路径与合成 ID；发现个人路径或敏感值即停止发布并报回，不得静默编辑后称原始日志）；写 manifest 与简短回执说明，归档至 `docs/evidence/member-activity-e48de0bc/<新 run-id>/`。证据中的时间字段须含义统一、自洽（started/completed/elapsed 互相吻合；run 7 评审所指 `stopped_utc` 误标问题本 run 不得重现）。

## 4. 预算

清理窗 10 分钟 ＋ A 3 分 ＋ B 5 分 ＋ C 10 分 ＋ D 5 分 ＝ 总 33 分钟（均为本地执行时间；各段自该段本地执行启动起算，回执推送、巡查等待与 git 操作不计时）；临时体量上限 1 GiB 不变；任一段触顶即按停手纪律处理。

## 5. 停手纪律与边界

- 任一段实质停手即归档停手报告、本 run 关闭，不得自行重开、重试或换源续行；已关闭的历轮 run（含 run 7）不得续跑。
- 历轮证据原样不动；不改任何业务代码、规格正本与工具文件。
- 本令不解冻四维匹配通知切片；PL-E1/PL-E2 仍由 Dot 按原 review 判定。
