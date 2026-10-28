# 第 6 步切片 2：R1 摘要展示回执（2026-10-28）

## 状态

R1 按创始人决定 `0911449` 完成实现与定向补证。固定代码批次为 [`45682879962fc996c6726d7e8c9f81d42e29f69a`](https://github.com/mikaozhao-dot/qingdao-fishing-app/commit/45682879962fc996c6726d7e8c9f81d42e29f69a)。同 SHA 数据库验收、Flutter 回归/分析、iOS 模拟器构建和 Android debug APK 构建均通过；1/4/5 条真实运行 PNG 已入仓并目检。Dot 已于 `bd489ae` 对 B 类混合来源冻结快照补证作限定关闭；A 类成品图已提交，等待 Dot 目检。

**仍待 Dot 完成 R1 定点复核，之后还需创始人产品验收。R1 尚未标记技术关闭，第 6 步切片 2 整体仍未通过，也未授权启动下一切片。** R2/R3 与既有推广来源补证的限定关闭维持原状。

## 创始人决定五项的实现位置

1. **展示前 4 条来源记录，不按鱼种合并、相加或去重。** `app/lib/step6_certificate_flow.dart:498-500` 取前四条来源行；`646-662` 按原顺序逐条建立独立行。真实服务端事实在 `server/src/step6-certificate-routes.js:157-203` 分别追加本人记录与本人补充；混合夹具在 `server/scripts/step6-certificate-acceptance.mjs:338-352` 与冻结断言 `389-404`。
2. **超过 4 条时展示总数、已展示数、未展示数和 App 完整明细路径。** `app/lib/step6_certificate_flow.dart:663-690` 仅在有遗漏时渲染摘要，逐项展示四个信息。
3. **4 条以内全部显示且不出现遗漏提示。** 展示条件仍是 `omittedCount > 0`，见 `app/lib/step6_certificate_flow.dart:663-664`；1/4/5 条 widget 用例及 ≤4 无摘要断言见 `app/test/step6_certificate_test.dart:270-354`。
4. **摘要仅限图面；服务端预览和冻结快照保留全部来源行。** 预览把 `facts.items` 原样放入 `fishItems`，见 `server/src/step6-certificate-routes.js:340-350`；创建证书时仍将完整 `facts.items` 写入快照，见 `383-404`。5 行 API 预览与冻结断言及每种来源的数量断言见 `server/scripts/step6-certificate-acceptance.mjs:361-404`。
5. **预览提供可点击的现有航次详情入口。** 入口跳转与参数传递见 `app/lib/step6_certificate_flow.dart:386-395,446-453`；`app/lib/main.dart:264-270` 接到现有 Step5 只读页。只读页的读接口、写入守卫和隐藏编辑/提交控件见 `app/lib/step5_flow.dart:300-311,345-405,418-461,568-700`；用户路径用例见 `app/test/step6_certificate_test.dart:356-459`。

详情入口读取 `/step5/departures/{id}/me` 的既有事实接口；`readOnly: true`，没有新增或调用渔获写入接口，也没有把详情页称作第二份证书快照。

## 真实运行成图

以下 PNG 来自 iOS Simulator 中运行的 Flutter App：临时运行时夹具渲染生产 `CertificateArtwork`，使用 `RenderRepaintBoundary.toImage(pixelRatio: 3)` 并经 Flutter PNG 编码器导出。尺寸均为 1080 × 1656。图面实现来自 `3040a298835674672a3016ff76754da5a4e1dca9`；其后至固定代码批次 `4568287` 没有改动 Flutter 图面代码。来源行、数量和目检结果见 [运行图清单](evidence/step6-slice2/r1-runtime/README.md)。

- [1 条来源行 PNG](evidence/step6-slice2/r1-runtime/certificate-1-source-rows-iphone-simulator.png)：全数显示，没有遗漏提示。
- [4 条来源行 PNG](evidence/step6-slice2/r1-runtime/certificate-4-source-rows-iphone-simulator.png)：4 条全数显示，没有遗漏提示。
- [5 条混合来源 PNG](evidence/step6-slice2/r1-runtime/certificate-5-source-rows-iphone-simulator.png)：同一种小黄鱼在 `本人记录` 与 `本人补充` 中保持两行；图内展示前 4 条并显示 5 条总数、1 条未展示及 App 明细路径。

目检三张 PNG：鱼名、来源标签、数量和摘要可读，未见裁切或溢出。这是运行时导出的成品图证据，不以 widget bounds 或 PNG 文件头代替目检。

## 混合来源 API 与冻结快照用例

`server/scripts/step6-certificate-acceptance.mjs:338-352` 建立同一实际乘客的 2 条本人报告记录与 3 条本人补充记录，总数 5；小黄鱼分别记录本人数量 2、补充数量 3。预览 API 断言完整行数和两种来源各自的数量（`361-369`）；证书创建后断言冻结快照仍为 5 条、同鱼跨来源不合并、本人 2 行/补充 3 行，且小黄鱼数量仍为 2/3（`387-404`）。Dot 于 `bd489ae` 已阅读该固定 SHA 的同 SHA CI 原始日志，并在该夹具边界内关闭 B 类混合来源快照补证；结论不扩展到 R1 全项。

首轮 `40606245723` 在早期 SHA `165121e` 只因 `.sort()` 后期望数组次序写反而失败；日志中的实际值包含两种标签。该比较已纠正，最终固定 SHA 验收通过；业务来源顺序与数量未因修复而改写。

## 固定 SHA 同提交验证

- 数据库 run [40606715924 / acceptance job 122547918831](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40606715924/job/122547918831)，checkout SHA 为 `45682879962fc996c6726d7e8c9f81d42e29f69a`。Step 6 slice 2 certificate acceptance **70 assertions passed**；同一 job 的 Step 4、Step 5、Step 6 slice 1、退款重订迁移验收也成功。
- Flutter 双端 run [40606729561](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40606729561)，checkout SHA 相同：
  - [analyze job 122547971952](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40606729561/job/122547971952)：**33 tests passed**，`No issues found!`。
  - [iOS job 122547972180](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40606729561/job/122547972180)：iOS Simulator `Runner.app` 构建成功。
  - [Android job 122547972213](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40606729561/job/122547972213)：Android debug APK 构建成功。
- 本地 `npm run check`、`npm test` 通过；Node 单元测试 **10 项通过**。隔离数据库脚本的结论只引用上述 CI，不声称本地数据库或生产环境验收。

## 下一步

已将 A 类运行成图目检请求交回仓库，截止 **2026-10-28 12:00 CST（UTC+8）**。Dot 已限定关闭 B 类混合来源冻结快照补证；当前仅待 Dot 查看三张运行 PNG 及其 SHA/夹具对应关系，并判断图面文字、行数、摘要与完整明细路径是否可读且无裁切。不能以本回执代替 Dot 对 A 的结论。Dot 完成后再由创始人做 R1/切片 2 产品验收。
