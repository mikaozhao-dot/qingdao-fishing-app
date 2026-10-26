# 巡检评审：qingdao-fishing-app main @ f1eb302（2026-10-27）

## 结论：有条件通过

本批 6 个新提交（095615d → f1eb302，2026-10-26 15:01–17:05 UTC）全部在第 6 步切片 1 的 R1/R4 补证范围内，无阻断项。**切片 1 仍不关闭、不进切片 2**：须待 Dot 对本批新夹具与回执定点复核、Android 原生冷/热链路实测、H5 免下载首单交付与创始人产品验收。本评审不构成产品验收，不改退款重订 A/B，不接真实资金、保险或生产。

## 本批提交（逐个确认）

| 提交 | 内容 | 核查 |
| --- | --- | --- |
| 1e538e3d | R1 开工回执（范围与三批提交顺序） | 与 Dot 增量复核要求一致；明确不代选 A/B、不碰生产 |
| 4d75e579 | migration 023 + app_links ^6.4.1 → ^7.0.0（锁 7.2.2） | 022 不动、新增可重入迁移；Dot 已在同批以增量复核确认 R1 方向与 CI，不视为本评审代 Dot 放行 |
| 1282a53 | R1/R4 回执 + 3 张 iOS 截图 + 232 项本地验收 | 见下 |
| e79a2b1b | Dot 增量复核（4d75e579）入仓 | Dot 自有文件，非 Codex 改规格；结论为“R1 代码认可、证据待交、暂不整体通过”，本评审不改写该结论 |
| db9972ab | 升级夹具 + 回归（Step 6 251 项、Flutter 27 项） | 见下 |
| f1eb302 | Dot 跟进回执（本批补证汇总） | 不预设 Dot 结论、不请求创始人验收，口径一致 |

## 全量比对结果（095615d → main，逐文件实读）

- 规格正本零改动：`docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md` 均不在变更清单内，无阻断项。
- 变更清单（15 项）：README.md、app/pubspec.yaml、app/pubspec.lock、app/test/main_app_promotion_attribution_test.dart、docs/dot-step6-slice1-fixback-review-2026-10-26.md、docs/step6-slice1-delivery-receipt-2026-10-26.md、docs/step6-slice1-dot-followup-2026-10-27.md（新增）、docs/step6-slice1-r1-r4-followup-2026-10-27.md（新增）、docs/step6-slice1-r1-upgrade-fix-ack-2026-10-26.md（新增）、server/migrations/023_backfill_historic_promotion_identity_qualifications.sql（新增）、server/scripts/step6-promotion-acceptance.mjs、3 张证据截图。无夹带业务规则变更，无新增生产配置。

## R1：migration 023 与升级夹具（实读通过）

- 023 全文实读：保留 022；对已核验且身份摘要仍在的用户，按“当前正余额、或 qualified_at 非空、或保留正额 commission_created 事件”三者之一回填；`ON CONFLICT DO NOTHING`，可重跑。筛选与 Dot 要求的“按历史资格事实判断、不只看当前金额”一致。
- 验收夹具实读：正余额、全退归零（保留 qualified_at 与正额事件）、仅历史事件（qualified_at 置空隔离备用路径）、从未计佣四组对照齐全；先删资格行复现 022 遗漏态，再调真实 `server/src/migrate.js` 执行 023；重跑后总行数不变、事件备用路径恰好一条；随后 A 身份 X→Y、B 用 X 首单被拒（归因状态 `identity_already_qualified`、无第二笔佣金账本），覆盖 Dot 要求的 A/X→A/Y→B/X 拒绝链。
- 并发与重复 claim 增量实读：重复 claim 只留一条归因、并发同步只产生一条身份消费事实与一条佣金账本，与夹具目标一致。
- 边界口径未偷换：两份回执均明确保留“迁移前已被更正掉且无历史摘要的数据仍不可恢复”，不声称真实历史数据核验或生产迁移批准。
- 数字衔接无矛盾：232 项（R1/R4 回执，夹具初版）→ 251 项（补事件备用路径与重跑幂等后），Flutter 26 项 → 27 项（新增重复链接与 AppShell 重建用例），递进有说明。

## R4：iOS 证据与重复归因回归（实读通过，附一项未目检说明）

- 冷/热两张 App 截图已目检：均为约钓者“我的”登录态页面（钓友、账号已登录、实名未提交），无账户标识、无访客 token、无真实个人信息，与回执描述一致。两图画面一致，本身不证明 claim 调用发生，仅佐证登录态；claim 事实仍以服务端验收夹具与沙盒库核对为准，回执对此未夸大。
- H5 推广页截图（`docs/evidence/step6-slice1-r4/ios-h5-promotion-page.png`，1,814,379 字节）因连接器 1MB 上限未能拉取目检，**本评审不把该张截图写成已验证**；请 Dot 或后续巡检在仓内直接查看后再将其计入 R4 H5 腿证据。此项不阻塞本批 head 推进（切片仍开放、R4 未关闭），但在 Dot 复核前不得以“R4 iOS 全套截图已验”表述。
- Flutter 重复链接与 AppShell 重建用例实读：同一实例内重复热链接不重复发起 claim；重建后同一 token 再送达时客户端会再发一次、服务端返回已归因且不新增归因。回执表述（“widget 级生命周期模拟，不冒充 Android 原生 Activity 或真实插件测试”）准确，未夸大为原生证据。
- app_links 7.2.2 的原生行为变化（早期链接缓冲、Activity 重建重发）与新增回归用例对应，Dot 增量复核中已指出该方向；本批未移除既有深链关闭配置（测试仍断言 `flutter_deeplinking_enabled=false`）。

## README 与回执口径（一致）

- README 两处改动均与实际状态相符：当前代码 SHA 记为 4d75e579、migration 023 已补、iOS 冷/热实测完成、Android 仅 APK 构建、H5 免下载首单未交付、切片未关闭、不进切片 2；`marina` 仍表述为正本已列渠道，退款重订 A/B 仍待创始人决定。
- 交付回执新增段落与两份跟进回执互相一致，均“请求 Dot 定点复核、不预设通过、不请求创始人产品验收”。

## 必须修改项：无（阻断项为零）

## 下一步指令（给 Luna / Dot）

1. Dot：请定点复核本批新夹具（023 事件备用路径、重跑幂等、A/X→A/Y→B/X 拒绝链）与 R4 回归，并直接查看 1.81MB 的 H5 推广页截图后再裁定 R4 iOS 腿。
2. Luna：Android 原生冷/热链路仍开放——当前主机无 Android SDK/模拟器，不得以 APK 构建代替；有设备条件时补实测，或如实保留开放。
3. 创始人待办不变：退款重订 A/B 仍待决定；H5 免下载首单未交付；切片 1 不关闭、不进切片 2。
4. 本评审后如有新提交，仍按“逐批实读、不跳号”处理，不得把 head 直接推到评审文件自身 SHA。

## 评审方法说明

- 全量比对：qingdao-fishing-app 095615d → main，428 → 435 个文件；上述 15 项为全部差异。
- CI run 编号（40360278983、40360278886、40364146459、40364147015）为回执引用，本巡检未通过只读工具独立重读原始 CI 日志；Dot 定点复核时请核对 run 与提交 SHA 的绑定。
- 本文件为 Muse 巡检结论；Dot 结论以 Dot 自有复核文件为准，两者不一致时以 Dot 为准。
