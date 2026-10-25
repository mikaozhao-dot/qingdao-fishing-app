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


## dot 定点复核结论（2026-10-26 01:05 CST）

**固定代码0d46add7ea545a87dec5068c30bda3a98f36680a，本次沙盒个人准入POST门禁复核通过。** 此结论覆盖本回执此前“待Dot”状态，关闭ebe77d75指出的个人失败误拦全船问题；不重复派单、不重开切片1–2及4已通过范围。

### 六项核验结果
1. 航次保障非effective在任何准入/出航写入前409，整船阻断正确。
2. 服务端校验完整paid乘客集合，按本次出返航时段的保障结果分别写allowed/blocked；不是简单跳过失败者。018约束allowed必须effective并有关联保障；出航后manifest仅纳入allowed，测试实际检查有效者出现、失败者未出现。
3. 未投保/待核实/失败/旧时段保障均覆盖。无人有效时保存预期blocked决定但不写出航事件或推进状态；不虚称事务回滚。
4. 静态写路径审查未发现取消订单、退款、罚金或成团重算。未新增订单/资金前后快照相等断言，不把静态核查说成该类实跑证据；可在后续回归增强，不阻断本次限定结论。
5. confirmed混合准入、captain_confirmed全员准入、缺失/不完整名单、伪造客户端保障状态均覆盖。重复departed在状态校验阶段409，无重复写入，称“重复拒绝且无副作用”，不称重放200。
6. 个人/订单保障更新及出航已统一航次优先锁序；测试实际覆盖两种排队先后，更新先提交时读取新结果，出航先提交时后续修改409并保留准入决定。决定表是可在出航前重试更新的当前结果，不是逐次不可变审计日志。

### 独立核对的实际CI
- 数据库run40213532254/job121229676333，head0d46add7，success。原始日志确认018迁移成功，709 assertions passed。
  https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40213532254/job/121229676333
- 双平台run40213532287，analyze121229676196、Android121229676469、iOS121229676600全success；analyze日志点名保险弹层widget测试通过，分析无问题。
  https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40213532287

dot未另起空库复跑。新弹层依据源码及实际CI中的widget交互测试复核，无新原生截图，不宣称真机/模拟器人工目检。widget标题“only passengers with effective coverage”与提交完整名单的正确实现不一致，请随后续文案维护改为完整名单交服务端判定，不需要重开功能修复。

Muse请按本结论更新巡检状态：本次沙盒POST个人门禁缺口关闭，仍不表示真实保险服务/保单、真实资金、生产D闭环、整步/整App或上线部署通过。后续仅沿已有获批范围推进，新业务规则和生产操作仍需另行授权。
