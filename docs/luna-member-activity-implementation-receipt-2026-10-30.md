# Luna 开工回执：会员发起活动需求撮合（2026-10-30）

- 状态：**匹配配置 `9dad7ea` 与需求单生命周期 `203ddca` 均获 Muse 限沙盒通过。配置切片的 Dot 有界复核未授予技术验收；固定 SHA 本地测试、Flutter Actions 原始日志入口和覆盖说明已补回，等待 Dot 复核。生命周期切片等待 Dot 复核。切片三“船长端需求广场筛选 API”已先提交回执，正在实现。**
- 工单：`docs/member-activity-implementation-task-brief-2026-10-30.md`
- 后续裁定：`docs/member-activity-conversion-rulings-2026-10-30.md`（创始人批准包船订单模式和邀约字段口径）。
- 起始基线：`main` 提交 `7880f00299458637685e0809dd55111c96699ae4`；本次按仓库指令同步至主线最新提交后继续。
- 开工边界：仅沙盒/API；不接真实资金、真实保险出单、真实推送通道或生产部署。

## 已确认口径

- 船长服务码头和目标鱼种使用可维护配置；审核船籍码头仅回填为初始服务码头，旧班次鱼种不推断为船长偏好。
- 包船模式在既有 `/orders` 订单端点内实现，一次原子锁定全船席位，金额冻结为邀约确认时写入班次的 `whole_boat_price_fen`；普通散客仍最多下单 6 席，不建立第二套订单/支付链路。
- 包船/拼船与 `trip_type` 正交。邀约必须包含创建班次所需字段；`trip_type` 取现有合法值，报名截止时间沿用现有发班默认值。
- 具体裁定原文见 `docs/member-activity-conversion-rulings-2026-10-30.md`。

## 切片一：匹配配置

- 迁移：`server/migrations/032_captain_activity_matching_settings.sql`；服务码头和鱼种分别存储，已审核船只的船籍码头用于初始回填。
- 船长专用读取/保存 API 校验平台目录并在事务内替换配置；未审核船长不能读写。
- 船长工作台新增“需求撮合偏好”设置页。
- 验证：服务端 `npm test` 25/25、`npm run check` 通过；`dart analyze lib/api_client.dart lib/step2_flow.dart` 报告无问题。首次 Flutter analyzer 服务因 LSP 输出截断未能启动，直接 Dart 分析已验证相关改动。
- 代码提交：`9dad7ea`（`feat: add captain activity matching settings`），已推送 `main`；Muse 已限沙盒通过。Dot 有界复核未授予技术验收。固定 SHA 的 8 项服务端定点测试、Dart 分析与 Flutter Actions run/job 日志入口及覆盖说明见 `docs/member-activity-validation-evidence-2026-10-31.md`；等待 Dot 复核。原复核详见 `docs/dot-member-activity-settings-9dad7ea-review-2026-10-30.md`。

## 切片二：需求单生命周期

- 迁移：`server/migrations/033_member_activity_requests.sql`，包括需求单表、状态约束、查询索引和只追加事实表。
- 新增实名会员创建/列表/详情、编辑、手动关闭接口；实名未通过拒绝发布，同时有效不超过 3 条、上海自然日新发不超过 3 条。
- 日期和时段按 `Asia/Shanghai` 解析；有效期取时段开始与发布后 7 天的较早值。后台每分钟自动下架到期需求，读写接口也会补做过期处理。
- 发布、编辑、关闭、自动下架均写入追加事实；备注、装备要求和钓法标签拦截手机号及微信号模式。接口不返回会员身份/联系方式。
- 验证：服务端 `npm test` 34/34；本次复跑 `npm run check` 通过。覆盖实名拒绝、双限频、字段校验、联系方式过滤、创建/编辑/关闭与自动下架事实。
- 定点验证：固定代码 SHA `203ddcab4f804cc0ea2837154e1835d7298a98e6` 的 `test/member-activity.test.js` 为 9/9 通过，三个相关 JS 文件 `node --check` 均退出 0；见 `docs/member-activity-validation-evidence-2026-10-31.md`。
- 代码提交：`203ddca`（`feat: add member activity request lifecycle`），已推送 `main`；Muse 已限沙盒通过（评审 `316deb03`），Dot 复核待完成。

## 后续切片

按任务书继续实现需求广场筛选与双向撮合通知、船长邀约/撤回、站内会话与已读、邀约确认转化、包船全船锁位和既有订单路径。确认转化必须复用 Step 2 班次校验与写入逻辑并生成零预订班次；后续订单继续复用既有沙盒支付、保险、退改、B1、选位和候补规则。

按既有评审链，当前两个已交付切片等待 Muse 评审和 Dot 复核；未自宣验收通过。后续切片完成后分批提交测试证据及回执，再进入评审。

## 切片三开工回执：船长端需求广场筛选 API

- 范围：新增船长端已发布/未到期需求浏览 API；提供码头、出航日期、人数、目标鱼种、包船/拼船五类筛选。人数采用精确匹配；目标鱼采用集合相交匹配。
- 访问门禁：仅已审核船长可访问；响应继续使用不含会员身份与联系方式的需求单序列化结构，所有筛选值参数化。
- 数据与行为：不新增迁移；只查询 `published` 且 `expires_at > now()` 的需求单，按出航时间排序并限制单次结果数。
- 边界：本切片不生成四维匹配记录，不发站内通知，不做船长邀约或消息；这些进入后续独立切片。
- 验证：加入筛选组合、非法筛选值、未审核船长拒绝、已关闭/过期需求不可见和身份字段不泄漏用例。
- 评审门槛：提交代码、定点测试结果和更新后的回执后等待 Muse 评审，再按门槛交 Dot 复核。
