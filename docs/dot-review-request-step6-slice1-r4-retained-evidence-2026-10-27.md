# Dot 定点复核请求：第 6 步切片 1 R4 留存证据差量（2026-10-27）

**Owner：Dot**

**复核截止：2026-10-28 18:30（Asia/Shanghai，北京时间）**

**固定差量证据提交：`dcdd6fdbb9b4db01773ff37ac377bcdf018e2096`**

**状态：已完成差量复核。** Dot 于 2026-10-27 在 [`独立复核回执`](dot-step6-slice1-fixback-review-2026-10-26.md#r4-留存证据差量复核dcdd6fdb) 确认请求与数据库导出之间的一致性通过；PID 原始输出和 APK 精确来源仍无法独立核验，iOS 映射仍缺。该结论不关闭 Android 完整证据项、R4 或切片 1。

## 复核材料

- [`R4 留存证据差量回执`](step6-slice1-r4-retained-evidence-receipt-2026-10-27.md)
- [`Claim 请求脱敏导出`](evidence/step6-slice1-r4/android-claim-events-redacted.jsonl)
- [`隔离数据库只读最小输出`](evidence/step6-slice1-r4/android-db-readonly-redacted.csv)
- [`Android 主回执`](step6-slice1-r4-evidence-receipt-2026-10-27.md)
- [`Dot 原 Android 证据复核请求`](dot-review-request-step6-slice1-r4-android-evidence-2026-10-27.md)

## 只审以下差量

1. **请求日志字段与口径**：核对热链 `mvqcry9s-zgmepa4p`、主冷链复跑 `mvqczvkw-jg38fxrc` 的时间、token 摘要、visitor 摘要、HTTP 200 与 `claimed=true`；检查摘要算法、输入和截断长度说明是否与代理留存源码相符。原始请求日志不含响应 `attributionId`，差量回执已标为未留存；请确认没有把数据库 attribution ID 误写成响应字段。
2. **数据库映射与 PID 缺口**：核对每个 visitor 前缀的行数（各 1 touch / 1 attribution）、推广码、状态、时间及 ID；确认带时戳的 PID 原始输出缺失已明确标为未留存，没有由回执文字冒充原始输出。
3. **构建与授权留存**：核对 APK 哈希、命令和 API 参数；确认源码 SHA 仅标为时间线推定，Pub 缓存仅提供当前 compileSdk 35 与当前哈希，没有虚称历史逐字节比较；Aliyun 临时配置精确路径和恢复输出缺失已如实注明。许可证接受准确时间没有 CLI 留存。另请判断授权文档记载 15:36 CST，而 Android license、CMake 文件和 APK 修改时间分别为 15:07:30、15:07:29、15:10:16 CST 这一先后差异应如何记录；这些文件时间不作为接受许可证时间或接受行为的证明。
4. **冷热顺序**：确认文字正确区分约 15:13 的较早冷启动排练、15:17 热链和 15:23 主冷链复跑，且没有改动原始时间。
5. **iOS 其他来源**：核对新增的 Actions 产物线索（run `40360278886` 的 206 字节分析元数据产物，以及无产物的 run `40360278983`）确无请求/visitor/数据库映射。任务先前排除的数据库、临时目录和 Dot 自有归档没有重查。若 Dot 已知另有可定位的既有归档来源，请只指出来源位置；无需重跑 iOS。

请在截止前将每项写为“通过 / 未通过 / 无法复核”，附固定证据位置与具体理由。若不能按期完成，请在截止前回写当前状态、阻碍和新的预计复核时间。

## 结论边界

本请求已复核完毕。Android 证据项、R4 与第 6 步切片 1 仍开放，待负责方决定未留存证据的后续处理；不得据本次导出层一致性复核宣布整条 Android 链路通过。此请求不涉及 H5 免下载首单、真实资金、真实保险、生产部署、切片 2 或创始人产品验收。
