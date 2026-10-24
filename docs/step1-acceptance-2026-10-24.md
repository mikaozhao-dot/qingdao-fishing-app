# 第 1 步正式验收（Muse，2026-10-24）

结论：**第 1 步（账号与船档案）正式验收通过，全部条件关闭。** 第 0 步遗留两条件（flutter analyze 全量通过、CI 原始日志独立复核口径）随本步一并关闭。

验收依据（均经独立复核）：
1. 后端主链路 31 项断言实跑通过（docs/step1-review-84828e0f87c2.md）：注册/实名/入驻/审核/注销、PII 密文落库与解密回环、模板与舒适度边界全对。
2. estimatedSpacingCm 类型不一致已修复（f835a6b），后续八提交评审通过（docs/step1-followup-review-ae38b007d0e9.md）。
3. flutter analyze 按工单改走托管 CI 关闭：Actions #40049325934 analyze job Success，输出 No issues found，完整日志 artifact 留存。
4. 设备冒烟关闭：iOS 27.1 模拟器真实截图 5 张（design/step1-review-photos/07–11，每张 <1MB，字节数与记录逐项一致）；Muse 抽验 07/10/11 三张目检通过——品牌与冻结 A 色板一致、双身份切换在位、青礁号 13.0m/沙子口/舒适/12 位数据与后端证据一致、选位图编号顺时针 1–12 且 6/7 尾角加价位高亮、间距 183.3cm 显示为数字。两轮 flutter drive 集成流程自报 All tests passed，与截图互证。

如实记录事项（不影响验收）：模拟器下载命令额外带入 iOS 27.0（报告 8.05 GB），执行方已自行移除并主动披露，最终运行时列表仅保留批准的 27.1；精确传输耗时无可核实记录，记录中已声明。工具链现状：Xcode 27.1 + CocoaPods 1.17.0 就绪；Android SDK 未装（不在本步批准范围，后续需要时另行报备）。

下一步：第 2 步任务书 docs/codex-dev-step2-brief-v1.md 已同批发布。
