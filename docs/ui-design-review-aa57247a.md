# Muse 评审：G 投保失败回填 aa57247a（有条件通过，不等于 G 整体通过）

- 被评提交：`aa57247a9ef3eacdcd0e5fd8fb8bf3c5c5438c03`（fix: close G insurance failure review findings）
- 对比基线：`eb907aecee27c85e007ee1a4738599a3810e64b8`
- 评审方式：全量比对基线至当前头（`62d7eb9b`），实读迁移 027、step3/step4 路由差量与 step4-acceptance 新增夹具；未在本轮重跑测试，结论基于静态实读。
- 范围说明：本评审只评 aa57247a 的代码回填。同期入仓的 REA 开工回执（`7287b442`）、APK 阻塞记录（`cc516f4d`）、Muse 的 Play 取 APK 派单（`62d7eb9b`）仅作范围确认，不计入通过项；Dot 追加在 `docs/dot-g-insurance-failure-review-2026-10-28.md` 的 07:38 UTC 差量复核已读，下文与之对账。

## 结论：有条件通过

与 Dot 差量复核一致：G-R1、G-R2 新执行路径与 G-R3、G-R4 代码修正经实读成立，但仍有三项小范围补正未做，**补正完成并凭同 SHA 证据复核前，G 不关闭**。本评审不把 Dot 引用的同 SHA CI 数字当作本人复核结果（Actions 运行记录不在本轮已评审只读工具集内，未独立复核）。

## 实读核实（逐项成立）

- **G-R1 补差退出**：`server/src/step4-routes.js` 改为按单逐笔处理：剩余本金 = seat_fee_fen − discount_fen − 已退 ticket_refunded_fen，非法/负值抛错；仅释放仍为 paid/booked 的席位集合；`cancelled_refund_fen`/`ticket_refunded_fen` 累计增加；`refund_obligations` 以 `supplement-exit:<order>` 为 request_key 且 `ON CONFLICT DO NOTHING`。
- **G-R2 补差退款冲账**：新增 `successful_supplement_refund` 调整类型，`source_reference = supplement-refund:<round>` 且 `ON CONFLICT DO NOTHING`；两处汇总查询均改为 CASE 净额（successful_supplement 正、successful_supplement_refund 负），重放不重复的机制在代码层面成立。
- **G-R3 锁后重读**：`server/src/step3-routes.js` 两处保险相关路径均改为先取 departure_id、锁班次行（`FOR UPDATE`），再重读订单状态，弃用锁前 paid 状态；班次归属变化返回 409。
- **G-R4 决定回放**：决定行新增 `refund_fen`/`departure_cancelled` 列，写入时保存本次实测的退款额与班次结果；同 key 回放原样返回两值；新增「同孩子已有家长决定即 409」检查。
- **未发现越界**：规格正本（mvp-plan、设计任务书、鱼种库、p0-flow）未动；无 F 券、会员星级、包船改动；无真实资金、真实保险出单或生产部署改动。

## 必须补正（三项，Muse 独立实读确认，与 Dot 一致）

1. **027 对旧家长决定回放造成金额回归（G-R4，升级缺陷）**：`server/migrations/027_g_insurance_failure_review_fixback.sql:10-11` 只加列给默认值（refund_fen=0、departure_cancelled=false），无回填。新回放直接读这两列，而旧实现从退款义务读实际金额。026 库已有家长退出决定及关联 `insurance-guardian-exit:<guardian>` 的 5000 分退款义务时，027 后同 key 回放由 5000 变 0；若原操作导致整班取消，默认 false 亦不能表示可靠历史结果。须保留/还原可核对的历史退款金额；无法可靠重建原操作班次结果时，不得把默认 false 当作已知历史事实。补一条「026 旧决定及退款义务 → 027 → 同 key 回放」夹具。
2. **`cancelledOrderRaceLock` 夹具不能区分旧代码与修复代码**：夹具在取消订单时同时把整个班次置为 cancelled，旧代码本来也会因班次终态拒绝。须保持班次 open/confirmed，仅令普通订单/席位取消后释放锁，再验证保险请求 409、保障不变、无新增尝试/退款。
3. **`conflictingGuardianReplay` 夹具不能区分旧代码与修复代码**：夹具在整班及候选第二家长都已取消之后执行，旧代码也会先返回 409，尚未覆盖原唯一约束冲突路径。须在第一次家长退出后仍有足够其他付费乘客、订单/班次继续有效且第二家长 active 的场景，发同孩子不同 key，核对受控 409、无新决定/退款。不因此允许多个家长退出。
4. **口径限定（非新增工作）**：G-R2 的关闭仅限本版新执行路径；027 未回补旧版本已失败轮次的历史正向补差账，不得宣称所有留存数据已清理。

## 下一步指令（致 luna开发会话）

- 只做上述三项补正及最终同 SHA 证据，不重开全部历史功能，不重复原生 UI 验收。
- 补正提交后先由 Muse 复核，再送 Dot 复核；未过不启动下一项。
- 不启动包船禁挤人之后的包船/F 补偿券/会员星级之外的事项（按既有队列顺序，G 补正为当前项）；不操作真实资金、真实保险或生产。
- REA 线另行阻塞：APK 尚未取得，Play/模拟器取样派单已发（登录须创始人本人完成、停下回报），REA 拆解交付钟点在样本锁定前不承诺。
