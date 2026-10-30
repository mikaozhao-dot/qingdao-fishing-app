# 定点评审：会员发起活动·船长服务码头/鱼种可维护配置切片（被评 head d28514e7）

## 结论先行：通过（仅配置切片，限沙盒）

- 本评审只覆盖从 `7880f002`（Muse 任务书）到 `d28514e7` 的 4 笔提交，结论仅为其中**服务码头/鱼种可维护配置切片**通过，不构成会员发起活动整体验收。
- 需求单、需求广场、匹配通知、邀约、站内沟通、确认转化主链**尚未交付**，不得自宣为已实现。
- 回执中请裁定的两项（包船订单复用方式、班次字段映射）已由创始人 2026-10-30 另行批准（`docs/member-activity-conversion-rulings-2026-10-30.md`，入仓 `b5c61edc`），本评审不重复裁定；Luna 按该裁定继续主链。

## 被评范围（逐笔确认，全量比对）

基线 `7880f00299458637685e0809dd55111c96699ae4` → 被评 head `d28514e7dde30223544de857fbda3f37ae7f0a91`：

1. `1aa30ccd` — Luna 开工回执 `docs/luna-member-activity-implementation-receipt-2026-10-30.md`（新增）。
2. `74418d8a` — 任务队列状态对齐（规则索引更新，见下）。
3. `9dad7ea9` — `feat: add captain activity matching settings`（代码切片）。
4. `d28514e7` — 配置切片交付记录（规则索引更新）。

全量比对（基线→被评 head，docs / server / app / design / scripts / .github 逐目录核对）确认的全部变化，共 9 个文件，别无其他：

- 新增 `docs/luna-member-activity-implementation-receipt-2026-10-30.md`
- 改动 `docs/current-rules-index.md`（仅会员发起活动一行：配置切片已提交待评审、转化待裁定；与回执口径一致）
- 新增 `server/migrations/032_captain_activity_matching_settings.sql`
- 新增 `server/src/activity-matching-settings.js`
- 改动 `server/src/step2-routes.js`（仅新增撮合偏好接口，见下）
- 改动 `server/package.json`（`check` 脚本仅追加新文件语法检查）
- 新增 `server/test/activity-matching-settings.test.js`
- 改动 `app/lib/api_client.dart`（仅新增通用 `put` 方法）
- 改动 `app/lib/step2_flow.dart`（仅新增撮合偏好页与工作台入口按钮）

## 核对结果（实读代码，非仅信回执自述）

1. **规格正本未动**：`docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md` 的 blob SHA 在基线与被评 head 完全一致；任务书 `docs/member-activity-implementation-task-brief-2026-10-30.md` 亦未被改动。
2. **不碰既有交易链路**：`step2-routes.js` 的 diff 除新增接口外无其他改动；既有发班校验、订单、选位逻辑一行未改。客户端页面文案亦明示“不会修改已有班次或订单”，与代码一致。
3. **迁移编号顺延**：基线最高迁移为 `031`，本切片为 `032`，符合任务书“沿用既有迁移编号续编”要求。
4. **回填口径有实证**：回填取 `boats.home_marina_code` 且限定 `review_status='approved'`，该字段与条件在既有 `step2-routes.js` 中已有同款用法；鱼种不从旧班次推断，与回执“空列表表示尚未配置”一致。
5. **服务端接口守门一致**：GET/PUT 均先经既有 `captainApproved`（`captain_profiles.verification_status='approved'`）校验，未审核者 403；PUT 内复核后才在同一事务内 DELETE+INSERT 整体替换，失败 ROLLBACK；校验拒绝非数组、未知码头/鱼种代码、重复值，空数组放行。
6. **测试覆盖对得上代码**：新测试覆盖校验（通过/空选/非法/重复）、序列化带平台名称、GET 船长隔离回显、PUT 原子替换、非法不写入、未审核 403。服务端 `npm test` 25/25 与 `npm run check` 通过、Dart 分析无问题为执行方自述数字（见保留项）。
7. **客户端接线对得上**：新页面取 `/step2/options` 的 `marinas`/`fish`（服务端 `optionsPayload` 确实返回含 code/name 的这两项）与新接口的 `serviceMarinaCodes`/`fishTargetCodes`；`_mapList` 为既有工具；工作台仅新增“需求撮合偏好”入口按钮，未改既有流程。

## 保留项（不构成阻断，但须明示）

- 本次评审实读了全部 9 个文件的代码与测试，但**未在本地独立重跑**服务端测试与 Dart 分析；回执中的“25/25 通过”“`npm run check` 通过”仍为执行方自述。Dot 复核与创始人产品验收前，须以 CI 或本地重跑为准。
- 回执首次 `flutter analyze` 因 LSP 输出截断未能启动、改用 `dart analyze` 校验两个文件一事已如实记录在回执中，不作隐瞒；不影响本切片的沙盒通过，但完整 Flutter 分析应在主链交付时补齐。
- 配置切片通过不等于匹配规则通过：匹配命中/四类不命中、邀约唯一性与撤回、转化冻结等任务书断言，待主链切片逐项交付时再审。

## 下一步指令

1. Luna 按创始人裁定 `b5c61edc` 继续主链：需求单、匹配通知、邀约、站内沟通、确认转化；其中包船模式只在既有 `/orders` 内增加、一次原子锁全船席位并冻结 `whole_boat_price_fen`，不得新建交易通道；邀约须补齐既有发班必填字段，包船/拼船与 `trip_type` 正交、不自动映射。
2. 每一切片完成后按既有规矩提交代码、测试证据与回执，等待 Muse 评审与 Dot 复核；配置切片不得自宣为整体通过。
3. Dot 复核本评审与配置切片；创始人产品验收仍按既有链路另行进行，本评审仅限沙盒范围，不构成生产放行。

## 另注（Muse 自身提交，不评审）

巡检期间分支又落一笔 Muse 提交 `b5c61edc`（创始人转化裁定入仓，含新裁定文件与规则索引更新；server/app/design 目录与 `d28514e7` 完全一致，无夹带代码）。按巡检规则不评审 Muse 自身文件，本评审推送后 head 可直接越过该提交。
