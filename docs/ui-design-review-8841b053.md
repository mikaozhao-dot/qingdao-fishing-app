# 海钓仓 Muse 评审：广场筛选有界验证方案更新草案（被评头 8841b053）

- 被评范围：`qingdao-fishing-app / main` 自 `213964c8ddf427ec048754e261d0ebc8875937ae`（Muse 评审 25d35e3c）之后至 `8841b0536605b3e86832dfda452a30b8d8387595`（docs: draft bounded verification plan update，2026-10-31 11:43 CST）的 2 笔提交：`39a873e5`（Muse 令：请 Luna 起草方案更新，禁止执行，属 Muse 自身文件，按巡检规则不重评、仅确认无夹带）、`8841b053`（Luna 方案更新草案）。
- 评审方式：根目录树比对基线至被评头，唯一变化的顶层目录为 `docs`；`docs` 全量比对唯一差异为新增 `docs/claude-to-luna-plan-update-draft-order-2026-10-31.md` 与 `docs/luna-plaza-bounded-verification-plan-update-2026-10-31.md`。规格正本（`docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md`）、业务代码、迁移、测试文件、首跑停止证据目录均未出现在差异中。

## 结论：通过（方案草案层面；不构成执行授权，不构成任何验收）

Luna 的方案更新草案按 Muse 令 `39a873e5` 的两点要求逐项作答，且逐项对照原方案未变条款，边界自述干净。本评审只放行该草案进入创始人批准环节；**未取得创始人对执行的明确批准前，仍禁止创建 worktree、检查本机依赖、创建 cluster、运行任何迁移/测试/验证、安装/下载依赖或改代码**。四维匹配通知切片继续冻结，Dot 的 PL-E1/PL-E2 仍未闭合。

## 实读核对（以草案原文与固定 SHA 仓库实读为准，不以提交说明为准）

- **pg 依赖来源已闭合为可执行口径**：草案将原方案的 worktree 内 `createRequire` 改为从固定路径 `/opt/homebrew/lib/node_modules/pg/package.json` 只读加载 `Pool` 并注入固定 worktree 导出的 `registerMemberActivityRoutes`；明文规定不改 worktree 文件、依赖目录、锁文件或 Node 配置，不设 `NODE_PATH`、不建 symlink、不复制文件、不运行包管理器；该路径不可用时立即停手、不设 fallback、不另寻路径，换源须另行更新方案并经评审与创始人批准。版本核对口径为三方逐字一致：`server/package.json` 的 `dependencies.pg`、`server/package-lock.json` 的 `packages["node_modules/pg"].version`、既有安装的 `package.json.version`，任一缺失或不一致即停，不得按 semver 范围推断相等、不得凑用。Muse 独立实读固定 SHA `e48de0bc` 的仓库文件核对：前两者确为 `8.23.1`，与草案所称一致；既有安装的版本草案明言本次起草未检查，留待执行预检核对，该留白是合规的（不是存在性声明）。
- **逐命令日志捕获已闭合**：草案规定新 run 证据目录预置仅依赖系统自带 `zsh` 与标准工具的 `capture-command.zsh` 并记录其 SHA-256；每条目标命令单独调用一次捕获器，分别保存 `command.txt`（原始 argv 与工作目录）、`stdout.bin`、`stderr.bin`（原始字节、不合并、不 tee、不编辑）、`result.json`（退出码或 signal、UTC 起止时间戳）；控制层另行分别记录捕获器 invocation 与其自身 stdout/stderr/退出码/起止时间；捕获失败即停、不得重跑补日志；预检与正式命令一律适用，两份迁移拆为两次独立 `psql -f` 调用，迁移范围与顺序不变；日志器 bootstrap 须在任何预检命令之前就绪并在 manifest 中单列，否则不得开始预检。
- **其余条款逐项沿用、无静默改写**：逐项对照表覆盖固定 SHA 与版本核对、独立随机 `/tmp` PostgreSQL（仅 Unix socket、禁用 TCP）、迁移集合、合成数据与唯一业务入口、五维筛选与 101 行排序、定点测试与语法检查、证据与隐私、10 分钟与 1 GiB 上限与有界清理、docs-only 归档与复核流程；新 run 用新 run-id，首跑停止证据 4 个文件保持原样，不得改写或并入。
- **起草范围合规**：草案开篇与结尾均声明仅为方案草案、不构成执行授权；本轮差异中无证据目录新增、无代码与依赖改动，未见执行痕迹。草案中“本次已读到”两处版本值经 Muse 上述独立实读验证属实，不构成对草案结论的实质影响。

## 非阻断观察（执行前须注意，不作打回）

- 捕获器 `capture-command.zsh` 的源码本身尚未随草案入仓，草案只规定了其行为与归档其 SHA-256 的要求；执行回执时须把该脚本源码与 hash 一并归档，供 Muse 复核其行为是否与草案一致，否则该 run 的日志仍不能视为逐命令合规证据。
- 固定路径 `/opt/homebrew/lib/node_modules/pg` 是否存在、版本是否为 `8.23.1`，目前仍是未验证的前置条件；执行预检若不满足，须按草案立即停手回报，不得现场改换来源。

## 下一步指令（致相关会话）

- 本草案无需返工，提交创始人决定是否批准执行；创始人批准前不得执行，批准后须先回执再以新 run-id 执行。
- 执行证据提交后先交 Muse 复核，再由创始人转 Dot 对 PL-E1/PL-E2 复核；四维匹配通知切片继续冻结，本评审不解冻任何切片。
- 下一评审目标为创始人批准后的执行回执与证据（如有）的新提交。
