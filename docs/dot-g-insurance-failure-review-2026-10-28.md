# Dot 独立复核：G 投保失败处理（2026-10-28）

## 结论与固定范围

**暂不通过，需以下有界回修；不是要求整套重做。** 固定实现 `0040af6a45c6e8bbf29e20f31cab64f23e71f564`，送审 `172d54eb81f828400aa4d158722d8a945a1a56f9`。依据 G 决定、剩余开发工单及本次正式请求。

本次实际完成：静态读取迁移 026、Step3/4 变更及相关既有调用路径、增量验收夹具，读取精确 SHA 的 CI 原始日志。**没有运行新测试、没有复现运行中的故障、没有操作真实资金或保险。下列反例均为静态控制流/SQL 反例，不冒充实跑结果。**

## CI：已核实成功，但未覆盖下列组合路径

[run 40644144920](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40644144920) / [job 122668937191](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40644144920/job/122668937191)，attempt 1，completed/success；原始 checkout 为上述完整实现 SHA。日志确认迁移 026 应用成功：
- Step4：**769** 断言；
- Step5：133；live：77；
- Step6 promotion：334；退款重订迁移：33；证书：70。

回执的本地 Step4 768 与本次 CI 769 分开记录，不把本地自报当成 Dot 执行，也不把 33 项既有退款重订迁移夹具称为迁移 026 专项升级测试。本次没有新 Flutter 改动；未要求为此重复运行双平台构建。

## G-R1（高）：G 部分退款后，补差拒绝路径仍全额重复退款，并可能释放他人重订席位

位置：`server/src/step4-routes.js:203–237` 的 `refundSupplementDecliners`，调用点含 947、958、973；G 的逐席退款由 `server/src/step3-routes.js:97–170` 引入新状态组合。

静态反例（金额均为分，平台费为零）：
1. 售票期内，A 订单两席各 5000，B 订单一席 5000，成团净门槛 9000。
2. A 一席三次拒保，G 建立 5000 退款义务；A 仍 paid，`ticket_refunded_fen=5000`。剩余 A+B 净额为 9000，G 不取消班次。
3. B 在距出航大于 72 小时正常退出；随后确认点进入既有一轮补差，A 拒绝。
4. 旧函数按 `o.total_amount_fen=10000` 再建立补差退出退款，而不是剩余 5000。A 累计退款义务为 **15000，超过实付 10000**；订单累计字段被改成 10000 也不能消除已存在的两笔义务。

该函数 224–227 另按订单**全部历史座位**更新库存，没有将释放范围限定于这次仍占用的 paid 座位。G 释放过的座位若已被其他订单买走，会被旧订单补差退出再次置为 available，而新买家的订单仍有效。这不是正常取消路径 286–309 已有的 active-seat 限制。可达库存反例：A 两席共 10000、B 两席共 10000、门槛 13500；G 退 A 一席后净额仍 13500；将该席售给 C 后净额 18000；B 在大于 72 小时正常取消两席后净额 9000，确认点进入补差。A 拒绝时，其历史座位会被释放，而 C 订单仍 paid。

有界要求：补差拒绝/超时退款只处理剩余应退本金，保留累计及逐笔审计；释放前锁定并仅处理该订单本次仍占用的座位，不能碰历史释放后售给他人的座位。补增量夹具覆盖「G 部分退款→后续补差拒绝/超时」，以及「G 释放→他人重订→旧订单补差退出」，断言累计退款不超实付、他人库存/订单不变、重放不重复退款。

## G-R2（中）：整班失败退回已成功补差，但成团可用账仍保留该补差

位置：`server/src/step4-routes.js:168–200`、45–57、298–302、1392。

成功补差会写 `departure_formation_adjustments.successful_supplement`。新关闭函数将 succeeded 轮次改为 failed、建立补差退款义务，却未冲销该调整项；`loadFormationAccounts` 及列表汇总仍无条件求和。

静态反例：两笔票各 5000，净票款 9000，门槛 10000，以成功补差 1000 成行。一席 G 取消后净额 4500+1000 不达标，整班取消并退票/退补差，但该 1000 仍留在可用资金汇总中。**这证明账目不一致，不表示已证明取消班次会重新出航或发生真实扣款。**

有界要求：退款义务产生时，相关补差即退出可用资金；保留可追溯记录，不能只改显示。补「成功补差→G 整班失败」夹具，核对轮次、退款义务、实际可用账及重复回调/重放不双退不重新计入。

## G-R3（中）：等待班次锁后仍使用锁前 paid 状态

位置：`server/src/step3-routes.js:1667–1722`，家长退出对应 1840–1877；普通取消见 `server/src/step3-waitlist-routes.js:251,294–302`。

新入口先读订单 paid，再等班次行锁。普通取消若先持锁并提交，会取消订单/释放座位，但没有改 `order_passengers.booking_status`。后到的保险请求取得锁后检查的仍是旧订单状态，乘客又仍为 active：
- 第一/二次失败或 effective 可继续改变已取消订单的保障与尝试记录并返回成功；
- 第三次拒保/家长退出到逐席退款函数才重新发现订单不是 paid，抛错回滚，表现为 500，而不是受控状态冲突。

有界要求：遵守既有锁序，在取得班次锁后重新读取/锁定归属订单并校验当前状态；补确定性「普通取消先持锁、保险结果排队」用例，断言不改保险/尝试/退款账并返回明确状态。此项未证明重复退款，不夸大为资金漏洞。

## G-R4（中）：家长退出的重放结果与冲突响应不稳定

位置：`server/src/step3-routes.js:1851–1872,1909–1929`；迁移 026 的 `UNIQUE(child_passenger_id)`。

- 初次家长退出可能返回 `departureCancelled:true`，相同 requestKey 重放却硬编码 false。现有 guardian 夹具初次恰为 true，但重放只断言幂等标识与退款条数，没有比对取消结果。
- 若一个孩子已关联家长 A 退出、订单/班次仍有效，再以新 key 为同一孩子请求仍有效的家长 B，会撞唯一约束而成为未处理的 500。指出此异常**不等于允许多名家长退出**。

有界要求：保存并重放原操作结果；对已使用的孩子退出决定返回明确冲突/既有结果，不泄漏数据库异常。补同 key 原结果一致、不同 key/不同家长受控冲突且无新退款的夹具。

## 已认可范围与保留项

- 迁移 026 使用事务；尝试唯一键、逐乘客审计及退款关联具备基础约束。
- 已读夹具验证前两次保留席位、第三次逐席退款、普通同行保留、同 key 不重复计次、第四次拒绝、孩子/成年家长检查、普通门槛下降整班退款。
- 登船门禁、名单、清单增加 active 乘客过滤；没有取消保险未生效不得登船原则。F01 释放沿用既有确认时间界限；本轮未发现需另定新期限。
- 监护关系仍为沙盒自我确认，不能描述为真实关系核验。真实保单、供应商时效、年龄健康准入、退保和文案条件仍未解除。
- 未自行要求历史拒保次数回填或改变三次规则；未把「历史升级测试未单独交付」编成已证实迁移缺陷。
- 本批 G 夹具未验证上述跨流程/并发/成功补差组合。请针对回修补证并给出最终固定 SHA 与同 SHA CI，不因本结论重复全部已有原生验收。

## 接力与边界

Luna 按四项有界问题回修并送审；Muse 核对规则符合性，Dot 复核实际差量与同 SHA 证据。此前切片 2 关单及已关闭 R2/R3 等结论不重开；本文件不代创始人产品验收，不启动队列下一项，不改规则或实现。

REA 前置澄清已被 Luna 开工回执明确读取，Muse 在 `docs/ui-design-review-6411f8f9.md` 明确接受并纳入后续标准。尚无 FishingBooker 拆解报告，不提前验收，也不挤占 G 开发。

### 固定源码与送审依据
- [实现差量](https://github.com/mikaozhao-dot/qingdao-fishing-app/commit/0040af6a45c6e8bbf29e20f31cab64f23e71f564)
- [Step3](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/0040af6a45c6e8bbf29e20f31cab64f23e71f564/server/src/step3-routes.js)
- [Step4](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/0040af6a45c6e8bbf29e20f31cab64f23e71f564/server/src/step4-routes.js)
- [普通取消](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/0040af6a45c6e8bbf29e20f31cab64f23e71f564/server/src/step3-waitlist-routes.js)
- [增量验收脚本](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/0040af6a45c6e8bbf29e20f31cab64f23e71f564/server/scripts/step4-acceptance.mjs)
- [正式请求](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/172d54eb81f828400aa4d158722d8a945a1a56f9/docs/g-insurance-failure-review-request-2026-10-28.md)
