# 定点评审：会员发起活动·需求单生命周期切片（被评 head 316deb03）

## 结论先行：通过（仅需求单生命周期切片，限沙盒）

- 本评审只覆盖从 `4d70ec23`（上一轮 Muse 评审提交）到 `316deb03` 的 2 笔提交，结论仅为其中**需求单生命周期切片**通过，不构成会员发起活动整体验收。
- 需求广场筛选、四维匹配站内通知、船长邀约/撤回、站内会话、邀约确认转化、包船全船锁位**尚未交付**，不得自宣为已实现。
- 本评审仅限沙盒/API 范围，不授权真实资金、真实保险出单、真实推送通道或生产部署；Dot 独立复核与创始人产品验收仍按既有链路另行进行。

## 被评范围（逐笔确认，全量比对）

上一轮已审 head `4d70ec23d04d1fd9fd935e9361e4845cf59ae5b3` → 被评 head `316deb03d1e9146ddf407de7b3aeb7e959551ee0`：

1. `203ddcab` — `feat: add member activity request lifecycle`（代码切片）。
2. `316deb03` — `docs: record member activity slice status`（回执与规则索引更新，仅文档）。

全量比对（上一轮 head → 被评 head，整仓逐目录核对）确认的全部变化，共 8 个文件，别无其他：

- 新增 `server/migrations/033_member_activity_requests.sql`
- 新增 `server/src/member-activity-routes.js`
- 新增 `server/src/member-activity-service.js`
- 新增 `server/test/member-activity.test.js`
- 改动 `server/src/app.js`（仅注册新路由，见下）
- 改动 `server/package.json`（`check` 脚本仅追加两个新文件语法检查）
- 改动 `docs/luna-member-activity-implementation-receipt-2026-10-30.md`（新增切片二记录）
- 改动 `docs/current-rules-index.md`（仅会员发起活动一行：配置切片已获 Muse 通过、生命周期切片已提交待评审；与回执口径一致）

## 核对结果（实读代码，非仅信回执自述）

1. **规格正本未动**：`docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md` 的 blob SHA 在上一轮 head 与被评 head 完全一致；任务书 `docs/member-activity-implementation-task-brief-2026-10-30.md` 亦未被改动。
2. **状态机与任务书一致**：迁移 033 的 `status` 仅允许 `published / converted / closed / expired`；`converted` 当且仅当 `converted_departure_id` 非空（CHECK 约束），本切片路由不写 `converted`，转化留待后续切片，口径不超前。
3. **实名与双限频对得上任务书**：创建与编辑均先查 `users.identity_status='verified'` 且 `identity_verified_at IS NOT NULL`，未通过 403；同时有效（`published` 且未过期）≥3 条 409；上海自然日（`Asia/Shanghai` 按日截断）新发 ≥3 条 409。编辑不计入日发，符合“新发”口径。
4. **有效期取较早值**：创建时 `expires_at = LEAST(时段开始, now()+7 天)`；编辑时 `LEAST(新时段开始, 原 created_at+7 天)`，编辑不延长 7 天窗口，符合任务书“7 天/出航日先到到期”。
5. **过期处理双保险**：后台每分钟（非 test 环境）扫 `published` 且 `expires_at<=now()` 转 `expired` 并写事实；创建/列表/详情/编辑入口先行补做过期处理；事实表有 UPDATE/DELETE 触发器禁改，追加式成立。
6. **防跳单与隐私**：备注、装备要求、钓法标签均过手机号/微信号（含 `wxid_`）模式拦截；序列化不返回 `member_user_id`；列表与详情均限定本人（`member_user_id = request.user.id`），无他人身份/联系方式外泄面。
7. **字段校验对得上平台目录**：码头取既有 `step1Options.marinas`、海域取 `TARGET_AREAS`、鱼种取 `FISH_CATALOG`，非平台目录 400；人数 1–30、鱼种 1–3 个、预算区间下限 ≤ 上限、时段按 `Asia/Shanghai` 解析、跨午夜计次日、时长上限 24 小时；`app.js` 除注册新路由外无其他改动，既有交易链路一行未改。
8. **测试覆盖对得上代码**：新测试 9 项覆盖上海时间换算、跨午夜、目录/预算/人数/过期校验、联系方式拦截、序列化无 owner 字段、实名拒绝与双限频、创建/编辑/关闭事实链、过期一次性转移与事实。回执称服务端 `npm test` 34/34（上一轮 25 + 本切片 9，数字自洽）、`npm run check` 通过；本次评审对 4 个新/改 JS 文件做了本地 `node --check` 语法校验，全部通过（见保留项）。

## 保留项（不构成阻断，但须明示）

- 本次评审实读了全部 8 个文件的代码与测试，但**未在本地独立重跑**服务端完整测试套件与数据库迁移；回执中的“34/34 通过”“`npm run check` 通过”仍为执行方自述。Dot 复核与创始人产品验收前，须以 CI 或本地重跑为准。
- 观察项（非阻断、不改任务书）：起止时间相同（如 06:00–06:00）按跨午夜计为 24 小时，落在时长上限内予以放行；若产品侧希望“同值视为无效时段”，须另行裁定，本切片不擅自收紧。
- 转化、邀约、匹配通知等任务书断言，待主链后续切片逐项交付时再审；本切片通过不等于撮合链路通过。

## 下一步指令

1. Luna 按任务书与创始人裁定 `b5c61edc` 继续主链：需求广场筛选、四维匹配站内通知、船长邀约/撤回、站内会话与已读、邀约确认转化（复用 Step 2 班次校验与写入逻辑、生成零预订班次；包船只在既有 `/orders` 内增加、一次原子锁全船席位并冻结 `whole_boat_price_fen`，不得新建交易通道）。
2. 每一切片完成后按既有规矩提交代码、测试证据与回执，等待 Muse 评审与 Dot 复核；需求单切片不得自宣为整体通过。
3. Dot 复核本评审与需求单生命周期切片；创始人产品验收仍按既有链路另行进行，本评审仅限沙盒范围，不构成生产放行。
