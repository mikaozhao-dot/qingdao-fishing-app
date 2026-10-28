# 第 6 步切片 2 差量回修进度（2026-10-28）

## 当前状态

Dot 对固定实现 `458c4a2d626d6f88f70e598af372f32efd030830` 曾作整体暂不通过结论，要求修复 S6-S2-R1/R2/R3 并补定向证据。Muse 已评审差量回修开工回执（`2ec9e29`），当时要求先做 R2/R3，R1 等 Muse/创始人定性。Dot 后续于 `faa9593` 按 `d347d7c` 同 SHA 证据，对 R2/R3 与证书推广来源补证作限定关闭。之后创始人在 `0911449` 定版 R1 摘要展示方案；Dot 于 `bd489ae` 按固定 SHA 原始 CI 日志对 B 类混合来源冻结快照补证作限定关闭，又于 `577c845` 独立目检 A 类 1/4/5 条运行图并在限定范围关闭 R1 技术项。**本轮所列技术复核项均已按限定范围关闭；只待创始人产品验收，切片 2 尚未产品关单。**

R2/R3 初步实现及推广来源用例已在代码提交 `aac590ac9874d9707833c0b5c14282e764bfeab1` 推至 `main`。该 SHA 的双平台 run `40598302378` 已成功；数据库 run `40598302377` 在首次建立验收用户时因 `users_identity_number_hash_unique_idx` 重复而失败，新增证书归因与 R3 用例尚未执行。Dot 的差量巡检 `0778827` 独立确认相同失败位置，并要求修正验收身份号夹具、不可修改真实身份唯一约束。

夹具修正在 `d347d7c016cb12acfba09222491d95625e630e43` 入 main：普通验收用户不写入可选身份哈希；需参与首次计佣的证书扫码用户使用事先核对未占用的合成身份号。数据库 run `40598838144` 与双平台 run `40598941709` 均在此 SHA 成功。Dot 已独立阅读原始日志，并在 `faa9593` 对限定范围关闭 R2/R3 和证书来源推广补证；边界与未验证项见 [Dot 复核记录](dot-step6-slice2-certificate-review-2026-10-28.md)。

R1 的定版与交付：`0911449` 选择证书图仅显示前 4 条来源行；超过 4 条时标明总数、展示数、未展示数和 App 明细路径；4 条以内全展示且不显示遗漏提示；服务端完整冻结快照不截断；预览页可进入现有只读航次详情。实现与验证证据见 [R1 回执](step6-slice2-r1-delivery-receipt-2026-10-28.md)，1/4/5 条运行成图见 [R1 证据目录](evidence/step6-slice2/r1-runtime/README.md)。

固定代码批次 `45682879962fc996c6726d7e8c9f81d42e29f69a` 的隔离数据库验收 70 项、Flutter 33 项回归与分析、iOS Simulator 构建及 Android debug APK 构建均通过。真实服务端混合来源夹具包含本人报告 2 行、本人补充 3 行，以及同一小黄鱼在两来源分别为 2 与 3；预览与冻结快照均检查全量行及数量。真实 1/4/5 条 PNG 已提交并目检。

R2/R3、B 类混合来源快照与 A 类运行成图均已获 Dot 限定范围通过；**当前仅待创始人产品验收，不标记切片 2 产品关单，不启动下一切片。** A 类结果见 [Dot 复核记录](dot-step6-slice2-certificate-review-2026-10-28.md)。

## R1 摘要展示回修与验证（固定 SHA `4568287`）

- 数据库 run [40606715924](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40606715924)：同 SHA checkout，证书验收 **70 项断言通过**。
- Flutter 双平台 run [40606729561](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40606729561)：同 SHA checkout，**33 项 Flutter 测试通过、Dart analyze 无问题、iOS Simulator Runner.app 与 Android debug APK 构建成功**。
- `npm run check` 与 `npm test` 通过；Node 单元测试 10 项通过。隔离数据库验收只引用 GitHub Actions，不声称本机数据库或生产环境测试。
- 成图由 iOS Simulator 运行中的 Flutter 生产 `CertificateArtwork` 组件调用 `RenderRepaintBoundary.toImage(pixelRatio: 3)` 导出，1080 × 1656。1/4 条均无遗漏提示；5 条展示前 4 条并标明另有 1 条及详情入口。三张 PNG、SHA-256 与夹具说明见证据目录。

## 已做的 R2/R3 与定向补证

- **R2 返回刷新：** 预览页成功生成证书后，无论经 AppBar 返回还是系统返回，均将变更信号送回中心页并刷新；未生成就返回仍不触发刷新。
- **R3 本人航次分页：** 候选航次按时间与 ID 稳定游标分页；仅在服务端按已验证实名匹配实际门禁乘客并确认有可用渔获后计入最多 100 条本人候选。没有改为按购票账号过滤。
- **候选边界用例：** 新增“本人旧航次由他人代订，且排序在 100 个更新的他人航次之后”的验收夹具，同时断言列表不泄露其他乘客记录。
- **证书推广定向链：** 新增以真实证书推广链接进行扫描、现有 claim、重复 claim、自推排除及首单佣金流程的验收用例，检查 `certificate` 来源保留且佣金沿用现有 5% 与返航后解锁规则。没有修改推广归因或计佣实现。

## 本地验证及 CI

- Flutter：`flutter test --no-pub test/step6_certificate_test.dart` 通过（4 项）；针对修改文件的 `dart analyze` 无问题。`aac590a` 双平台 run `40598302378` 成功。修正后 `d347d7c` 同 SHA run `40598941709` 的 iOS 模拟器构建、Android debug APK 构建、31 项 Flutter 回归测试和 Dart analyze 均成功；Dot 已阅读对应 job 原始日志。
- 服务端：`npm run check` 通过；`npm test` 通过（10 项）。旧 run `40598302377` 因测试身份唯一冲突失败；修正后 `d347d7c` 同 SHA 数据库 run `40598838144` 成功，证书验收脚本输出 **57 assertions passed**。该 CI 是隔离数据库执行，不是本机数据库或生产验证；Dot 已阅读对应 job 原始日志。
- 本机未配置 `DATABASE_URL` / `REDIS_URL`，未声称执行隔离数据库验收脚本。

## 下一步

Dot 已于 `577c845` 按所交 1/4/5 条原尺寸 PNG 完成限定范围的独立检查，并关闭 R1 技术复核；详细边界见 `docs/dot-step6-slice2-certificate-review-2026-10-28.md`。现在只待创始人根据 `docs/founder-acceptance-request-step6-slice2-2026-10-28.md` 作限定沙盒产品验收或列出打回项。未收到创始人明确决定前，不写产品通过或正式关单，不进入下一切片；真实资金、保险和生产部署仍未授权。
