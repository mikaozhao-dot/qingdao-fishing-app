# 巡检评审：qingdao-fishing-app main at 73abc1b4（Muse，2026-10-27）

## 结论先行：有条件通过

- 评审范围：上次已评审 head `c3010f0581ac1f5e7141415a6e8158d886bf96ca` 至本轮 head `73abc1b47dd06cc3ab170d11b04b85fc23893f6a` 之间的全部新提交，共 3 个：
  - `dcdd6fdb`：新增 R4 留存证据差量回执与脱敏导出；
  - `df3c093a`：向 Dot 发出差量复核请求（截止 2026-10-28 18:30 北京时间）；
  - `73abc1b4`：Dot 差量复核结论写入 `docs/dot-step6-slice1-fixback-review-2026-10-26.md` 并同步 README 索引。
- 全量比对（整仓逐文件 blob SHA 比对，465 → 469 个文件）仅 6 个文件变化，无其他夹带：
  - 新增：`docs/step6-slice1-r4-retained-evidence-receipt-2026-10-27.md`、`docs/dot-review-request-step6-slice1-r4-retained-evidence-2026-10-27.md`、`docs/evidence/step6-slice1-r4/android-claim-events-redacted.jsonl`、`docs/evidence/step6-slice1-r4/android-db-readonly-redacted.csv`；
  - 改动：`docs/dot-step6-slice1-fixback-review-2026-10-26.md`（新增 Dot 差量复核一节并更新文首状态行）、`README.md`（仅索引行新增上述文件条目）。
- **规格正本未动**：`docs/codex-ui-design-brief-v1.md`、`docs/mvp-plan-v1.md`、`docs/fish-library-v1.md`、`docs/p0-flow-v1.md` 均不在变化清单中，无阻断项。
- **差量导出层一致性通过**：Muse 逐行实读两份导出并与回执逐项核对，数字全部吻合（见下）；但这只是导出层一致性，**不关闭 Android 证据项、R4 与第 6 步切片 1**，与 Dot 在 73abc1b4 的结论一致。

## 逐项核对（Muse 独立实读，非只信提交说明）

1. **请求日志与数据库映射对应：通过。**
   - JSONL 共 2 行：热链 `mvqcry9s-zgmepa4p`（2026-10-27T07:17:22.624Z，token 摘要 `ea423c5aae2bbe8a`，visitor 摘要 `2c9401e3faab87b7`，HTTP 200，claimed=true）；主冷链复跑 `mvqczvkw-jg38fxrc`（2026-10-27T07:23:32.384Z，token 摘要 `006e65838bbb54e9`，visitor 摘要 `246362d13ca379b4`，HTTP 200，claimed=true）。
   - CSV 共 2 行：热链 visitor 前缀 `2c9401e3faab87b7` 对应 touch `e86bc407-b300-49bb-9b31-bc75ed1032f9`（claimed/qr）与归因 `dd849109-77a5-4653-a1e9-ae5a295a3014`（pending），推广码 `D6A060475BB1C8BC`，各 1 行；冷链 visitor 前缀 `246362d13ca379b4` 对应 touch `5fe509bd-5ec3-40da-8f0b-3283b9abfa63` 与归因 `c680f712-60ee-4ba8-adb5-b257497e935b`，同推广码，各 1 行。上述全部标识与回执表格逐字一致。
   - 脱敏合规：两份导出中未见原始 token、Authorization、手机号、用户 ID 或密钥；回执明确说明原始 token 等均未导出。
2. **缺口标注诚实，无冒充：通过。**
   - 回执与 Dot 复核均明确：原始请求日志不含响应 `attributionId`（数据库 attribution ID 不冒充响应字段）；带时戳的 PID 原始输出未留存（冷链 PID 6351、热链 PID 5285 仅为回执叙述，不作证据）；APK 源码 checkout SHA 仅为时间线推定、无 provenance 文件；Aliyun 临时脚本精确路径与恢复输出未留存；许可证接受准确时间未留存。缺口没有被文字掩盖。
3. **冷热顺序叙述：通过。** 约 15:13 较早冷启动排练 → 15:17 热链 → 15:23 主冷链复跑，原始时间未改写，与导出时间戳一致。
4. **iOS 新增来源：有限结论，无夸大。** 回执称 Actions run `40360278886` 仅 206 字节分析元数据产物、run `40360278983` 无产物，均无请求/visitor/数据库映射，并明确未穷尽未配置备份与云存储；Dot 复核亦注明未解压该产物、“仅分析元数据”为执行方报告。本轮不把阴性结论扩张为全部备份已穷尽。
5. **Dot 复核本身：已入仓且结论与本巡检一致。** 73abc1b4 的 Dot 一节逐项给出“导出层通过 / PID 与 APK 来源无法复核 / 授权时间未决 / R4 与切片 1 不关闭”，本巡检在导出对应性一项上独立复算后同意该结论。

## 本轮未复核项（明确边界，不冒称）

- 未重读 APK 字节、未重算私密 token 摘要、未重查 Actions 产物 ZIP 内容、未独立复算 `9f501957 → 445ec07` 的 app/server 差异（上述为 Dot 一节中陈述的核查，本巡检未重复执行，故不背书为 Muse 已验证）。
- 未重跑任何测试、构建、doctor、模拟器或数据库流程；本差量本身也声明不重跑。

## 仍开放项（非新阻断，沿用既有状态）

- 原生冷/热进程 PID 原始记录、确切 APK 构建 provenance、Aliyun 临时配置恢复输出、许可证接受准确时间，以及 SDK 文件时间（15:07:30 / 15:07:29 / 15:10:16 CST）早于仓库授权记录时间（15:36 CST）的时间顺序差异：均保持未决，不关闭、不改写为通过。
- H5 免下载首单、真实资金、真实保险、生产部署、切片 2 均不在本差量范围。

## 下一步指令

- 执行方：无需为本差量重复索要已交的两份脱敏导出；若另有可定位的既有进程记录、构建原始记录或代理源码，按 Dot 一节所定范围只补那个来源；已明确未留存的项不得凭记忆重造。
- Dot：本轮差量复核已于 73abc1b4 入仓，无需再等 2026-10-28 18:30 截止；后续若有新来源补交，再按同样差量口径复核。
- 创始人：本轮无新增拍板项；R4 与切片 1 的关闭仍取决于上述开放项的可行后续选项，待有权者另定安排或明确接受保留风险后方可关闭。
