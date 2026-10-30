# 定点评审：会员发起活动·船长端需求广场筛选 API 切片（被评 head c669a4cc）

## 结论先行：通过（仅船长端需求广场筛选 API 切片，限沙盒）

- 本评审只覆盖从 `27ea6a1a`（上一轮已审 head）到 `c669a4cc` 的 5 笔提交，结论仅为其中**船长端需求广场筛选 API 切片**通过，不构成会员发起活动整体验收。
- 四维匹配站内通知、船长邀约/撤回、站内会话、邀约确认转化、包船全船锁位**尚未交付**，不得自宣为已实现。
- 本评审仅限沙盒/API 范围，不授权真实资金、真实保险出单、真实推送通道或生产部署；Dot 独立复核与创始人产品验收仍按既有链路另行进行。

## 被评范围（逐笔确认，全量比对）

上一轮已审 head `27ea6a1aef8ce17ef02b86a14172bcccc1ef9f15` → 被评 head `c669a4cc0ba9486e21eedf88944ac89331580c2a`，共 5 笔：

1. `3d8489d9` — `docs: record member activity review gates`（文档：评审口径更新）
2. `818f1f8f` — `docs: add member activity validation evidence`（文档：新增验证证据）
3. `6ebb925a` — `docs: receipt for captain demand plaza filters`（文档：切片三回执）
4. `e48de0bc` — `feat: add captain member activity plaza filters`（代码切片）
5. `c669a4cc` — `docs: record member plaza filter slice`（文档：规则索引与回执同步）

全量比对（上一轮 head → 被评 head，整仓逐目录核对，旧 617 个文件 → 新 618 个文件）确认的全部变化，共 6 个文件，别无其他：

- 新增 `docs/member-activity-validation-evidence-2026-10-31.md`
- 改动 `docs/current-rules-index.md`（仅会员发起活动一行，见下）
- 改动 `docs/luna-member-activity-implementation-receipt-2026-10-30.md`（新增切片三回执）
- 改动 `server/src/member-activity-routes.js`（新增船长广场路由）
- 改动 `server/src/member-activity-service.js`（新增筛选校验函数）
- 改动 `server/test/member-activity.test.js`（新增 4 项测试）

## 核对结果（实读代码，非仅信回执自述）

1. **规格正本未动**：`docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md` 的变化不在全量比对结果中；任务书 `docs/member-activity-implementation-task-brief-2026-10-30.md` 与创始人裁定 `docs/member-activity-conversion-rulings-2026-10-30.md` 亦未被改动。
2. **五维筛选与任务书 §2 一致**：新增 `GET /captain/member/activity-requests` 支持码头、出航日期、人数、目标鱼种、包船/拼船五类筛选；未知筛选键直接 400，不静默忽略。码头取既有 `step1Options.marinas`、鱼种取 `FISH_CATALOG`、日期做真实日期校验（含 2026-02-30 拒绝）、人数为 1–30 整数精确匹配、包船/拼船仅接受 `charter`/`shared`（`auction` 被拒绝，与首期不做竞价一致）。
3. **只返回已发布未到期需求**：查询前先补做过期处理，条件为 `status='published'` 且 `expires_at > now()`；按 `requested_start_at ASC, created_at DESC, id ASC` 排序，上限 100 条；不新增迁移。
4. **门禁与参数化成立**：先校验筛选值（非法值 400 且不触库），再查 `captain_profiles.verification_status='approved'`，未审核船长 403 且不进入列表查询；全部筛选值均以参数占位符传入 SQL，测试断言 SQL 文本中不含筛选值原文。
5. **身份不泄漏**：响应复用既有 `serializeMemberActivityRequest`，该函数不返回 `member_user_id` 及任何联系方式字段；测试断言返回项无 `memberUserId`。需求单备注等字段仍受创建时手机号/微信号拦截约束（上一切片已审，本切片未改动该逻辑）。
6. **回执与规则索引口径无超前宣称**：回执明确本切片不生成四维匹配记录、不发站内通知、不做邀约或消息；规则索引如实写明配置切片 Dot 有界复核未授予技术验收、生命周期切片待 Dot 复核、广场切片待 Muse 评审；验证证据文件如实说明定点测试用 fakePool、不证明真实 PostgreSQL 事务/并发与真实认证中间件，Flutter CI 未单独执行服务端匹配配置测试。
7. **测试数量自洽**：新增 4 项（五维全接受、非法值拒绝、广场门禁与参数化及身份不泄漏、未审核与非法值前置拒绝），与回执称的 9 → 13 项一致；本次评审对 3 个新/改 JS 文件做了本地 `node --check` 语法校验，全部通过。

## 保留项（不构成阻断，但须明示）

- 本次评审实读了全部 6 个文件的代码、测试与文档，但**未在本地独立重跑**服务端完整测试套件与真实数据库迁移；回执中的“13/13 通过”仍为执行方自述。`fish_codes @> ARRAY[?::varchar]` 的真实库行为亦未以真实 PostgreSQL 验证，Dot 复核与创始人产品验收前，须以 CI 或本地重跑为准。
- 表述精确认知：回执称目标鱼“集合相交匹配”，代码实际为单值包含匹配（`fish_codes @> ARRAY[单个鱼种]`），对单值筛选等价于相交非空；多值鱼种筛选不在本切片范围，不属越界，亦不属已实现的多值筛选。
- 非阻断陈旧句：回执“后续切片”段仍有一句“当前两个已交付切片等待 Muse 评审”，与文首已更新的状态（生命周期切片已获 Muse 限沙盒通过）不一致，以文首状态为准，下一切片回执顺手清理即可，不必为此单开提交。

## 下一步指令

1. Luna 按任务书与创始人裁定继续主链：四维匹配站内通知、船长邀约/撤回、站内会话与已读、邀约确认转化（复用 Step 2 班次校验与写入逻辑、生成零预订班次；包船只在既有 `/orders` 内增加、一次原子锁全船席位并冻结 `whole_boat_price_fen`，不得新建交易通道）。
2. 每一切片完成后按既有规矩提交代码、测试证据与回执，等待 Muse 评审与 Dot 复核；广场筛选切片不得自宣为撮合链路通过。
3. Dot 复核本评审与广场筛选 API 切片；创始人产品验收仍按既有链路另行进行，本评审仅限沙盒范围，不构成生产放行。
