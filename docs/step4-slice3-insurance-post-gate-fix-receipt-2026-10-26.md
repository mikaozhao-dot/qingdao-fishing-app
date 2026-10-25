# 切片 3 保险出航 POST 个人级准入修复回执（2026-10-26）

修复代码已提交至 main：[`0d46add7ea545a87dec5068c30bda3a98f36680a`](https://github.com/mikaozhao-dot/qingdao-fishing-app/commit/0d46add7ea545a87dec5068c30bda3a98f36680a)。本回执按 `docs/muse-to-luna-insurance-post-gate-fix-per-dot-2026-10-26.md` 的六项要求逐项记录实现与证据。

## 六项对照

1. **航次级必需保障。** 缺失、待核实、失败均由服务端整船拒绝；拒绝不写 `departed` 事件，也不改变班次状态。隔离验收覆盖缺失、待核实、失败与无人工绕过。
2. **乘客级准入与实际名单。** 航次保障有效时，服务端对完整已支付乘客名单逐人记录 `allowed`／`blocked`。至少一人有效时允许合格者出航；不合格者保留阻断决定且不进入出航后的名单。全部被阻断时返回 409，只保留预期的阻断决定，不写出航事件或推进班次状态。验收核对逐人决定、返回计数及出航后 manifest 的纳入／排除。
3. **个人保障失效情形。** 隔离验收覆盖 `not_insured`、`pending_verification`、`failed` 和旧时段保单；当前准入只读取匹配本次班次、出航时间和返航时间的乘客保障。旧订单级 `issued` 不会自动成为新时段保障。
4. **订单与账目保持原样。** 门禁逻辑只记录准入决定；没有取消订单、创建退款或重算成团的写入路径。全部被阻断时验收直接检查出航事件与班次状态不变，订单和资金流程不由此门禁触发。没有接真实支付或退款。
5. **正常及防伪路径。** 全员有效、`confirmed`、`captain_confirmed`、重复出航拒绝和客户端伪造保障状态均有覆盖。保障结果由服务端读取，客户端不能提交状态覆盖服务端核验。
6. **并发与拒绝副作用。** 保障更新与出航统一先锁班次，再锁保障记录；事务锁内读取本次有效时段。隔离验收覆盖“保障更新先提交”和“出航先提交”两种竞争顺序。失败路径不会留下出航打卡或班次状态变更；允许保留本次乘客级阻断决定作为预期结果。

## 固定 SHA 验证

- GitHub Actions [数据库验收 run 40213532254](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40213532254)：`acceptance` job `121229676333` 成功。日志确认应用 `018_departure_passenger_boardings.sql`，`server/scripts/step4-acceptance.mjs` 通过 **709 项断言**。
- GitHub Actions [Flutter 双平台 run 40213532287](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40213532287)：`analyze`、`ios`、`android` jobs 均成功；Flutter 回归测试和分析通过，iOS simulator app 与 Android debug APK 构建成功。
- 本地验证：隔离 PostgreSQL 17.11 / Redis、`npm run check`、`npm test`（8/8）、`npm run smoke:step4`（709 项）、Flutter 测试、`flutter analyze --no-pub`、`git diff --check` 均通过。
- 准入交互证据：[`app/test/step4_insurance_gate_test.dart`](../app/test/step4_insurance_gate_test.dart) 打开船长端准入弹层，核对“阻断乘客不能登船、有效乘客可继续出航”提示和可登船人数，并验证提交完整已支付乘客名单供服务端逐人决定。Flutter 双平台 run 的 analyze job 执行该回归测试。此处提供 widget 交互证据，本次没有另制原生截图。

## 复核状态与边界

**待 Dot 定点复核。** 本回执不代替 Dot 的结论，也不表示 Muse、创始人验收或 D 闭环完成。数据库中的准入行是该班次/乘客的当前决定；重试会更新当前行，不是逐次尝试的不可变日志。实现仅限沙盒保险状态与出航准入，不连接保险商或出单，不处理真实资金、天气 SOP 或生产部署。

**交 Dot 复核：** 请按上列六项，核对固定代码 SHA `0d46add7ea545a87dec5068c30bda3a98f36680a`、数据库验收日志和 Flutter 双平台工作流；重点检查乘客级阻断与获准名单一致、拒绝路径写入边界、旧时段保障判定及两种并发顺序。请将结论与证据写回仓库；复核完成前维持「待 Dot 定点复核」。
