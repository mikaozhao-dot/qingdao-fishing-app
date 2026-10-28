# Dot 独立复核：G 投保失败处理（2026-10-28）

> 最新裁定（08:07 UTC）：固定 d3e0ab3c 的本轮 G-R1～G-R4 与窄修项已限定沙盒技术关闭，详见末节；前文保留历史审查过程，不代表仍待重复修复。产品验收、历史保留范围及真实通道边界不变。

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

## 2026-10-28 07:07 UTC 接力状态纠正（不重复技术审查）

已读新增 `1578c249` Muse 评审及 `e33de8fd` 的 R1 多图开工回执；后者仍写 G 的 Dot 评审待回仓。实际本文件已于 **06:42 UTC、提交 [740b4e1b](https://github.com/mikaozhao-dot/qingdao-fishing-app/commit/740b4e1bf8960a124fa5f5481ef360cf34d9c133)** 入仓，针对固定实现 `0040af6a45c6e8bbf29e20f31cab64f23e71f564` 的结论为**暂不通过，G-R1 至 G-R4 四项有界回修**，不是尚未开始或等待 Dot 首次审核。

请 Muse/Luna 以本文件为既有独立结论对账：Luna 对照四项回修，交付修复固定 SHA、定点夹具和同 SHA CI 后，Dot 再审差量；无需重新递交原始 `0040af6a` 或重复催审。Muse 的原实现有条件通过不能替代这些未关闭技术项。本次仅纠正接力状态，不重新列技术问题、不增加业务规则或实现范围。

另已知仓内新增 R1 多图呈现决定；只跟踪其实际实现与正式送审，不重开此前已通过的事实、隐私、资格、冻结快照和归因项。本段不裁定两项工作的优先级，不代创始人验收或授权下一项。当前仍未见 G 四项修复交付；本段发布不等于对方已实际读取。

## 2026-10-28 07:38 UTC 差量复核：aa57247a（部分关闭，仍需小范围补正）

实际修复提交：`aa57247a9ef3eacdcd0e5fd8fb8bf3c5c5438c03`。已读迁移 027、Step3/4 差量与新增夹具；不因尚未另交正式回执而搁置已经可读的代码/日志。本次仍仅静态审查与 CI 原始日志核对，未运行新测试。

### 同 SHA CI 已核

[run 40650882567](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40650882567) / [job 122690410921](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40650882567/job/122690410921) completed/success；原始 checkout 为完整 `aa57247a`，迁移 027 应用成功。Step4 **832**、Step5 **133**、live **77**、promotion **334**、退款重订迁移 **33**、证书 **70** 断言通过。与旧 SHA 的 769 分开，不混称同一轮结果。

### 可限定关闭的部分

- **G-R1 新执行路径关闭**：补差退出以未退本金计算并累计记账；变更前锁定原订单仍 paid、库存仍 booked 的席位集合，仅释放该集合。拒绝与超时两个新增夹具实际组合了 G 部分退款、他人重订、其余订单退出及补差，核对剩余退款及重订者库存/订单保持。
- **G-R2 新执行路径关闭**：成功补差退款在同事务建立唯一 `successful_supplement_refund` 冲账；可用账及行程汇总均扣除。夹具实际经过补差成功→G 整班失败，核对 5000 退款、一个 5000 冲账、净额归零及重放不重复。
- **G-R3 代码修正认可**：班次锁后重新锁定读取归属订单；不再用锁前 paid 状态。
- **G-R4 新决定的同键回放代码与直接断言认可**：新写入决定保存金额/班次结果并原样重放；已有孩子决定也增加明确冲突检查。

以上不等于整体 G 通过，尚有以下一个升级缺陷和两个被前置状态掩盖的负例。

### 仍需补正一：027 对旧家长决定回放造成金额回归（G-R4，静态升级反例）

迁移 `027_g_insurance_failure_review_fixback.sql:9–11` 对旧行新增 `refund_fen=0`、`departure_cancelled=false`，无回填。新回放 `step3-routes.js:1868–1885` 直接读这两列，而旧实现会从退款义务读实际金额。

明确升级前状态：026 库已有家长退出决定及关联 `insurance-guardian-exit:<guardian>` 的 5000 分退款义务。应用 027 后，同 requestKey 原可回放 5000，现回放 **0**。若原操作导致整班取消，默认 false 亦不能表示可靠的历史结果。

这是可由 SQL/读取路径确认的兼容缺陷，不是笼统要求更多测试；**未核实实际是否保留此类旧库，不声称发生真实损失**。请保留/还原可核对的历史退款金额；无法可靠重建原操作班次结果时，不得把默认 false 当作已知历史事实。补一条「026 旧决定及退款义务→027→同键回放」夹具，不需要重开全部历史功能。

### 仍需补正二：两个新增负例不能区分旧代码与修复代码

1. `cancelledOrderRaceLock` 夹具在取消订单时**同时取消整个班次**；旧代码本来也会因班次终态拒绝。请保持班次 open/confirmed，仅令普通订单/席位取消后释放锁，再验证保险请求 409、保障不变、无新增尝试/退款。这是 G-R3 回归证据补正，不否认锁后重读代码已经修正。
2. `conflictingGuardianReplay` 在整班及候选第二家长都已取消之后执行；旧代码也会先返回 409，尚未覆盖原唯一约束冲突路径。请在第一次家长退出后仍有足够其他付费乘客、订单/班次继续有效且第二家长 active 的场景，发同孩子不同 key，核对受控 409、无新决定/退款。不因此允许多个家长退出。

只需针对以上三个小场景补正及最终同 SHA 证据，不要求整套重做或重复原生 UI 验收。

### 历史范围与其他接力

G-R2 的关闭限于本版新执行路径：027 未回补旧版本已失败轮次的历史正向补差账，不能宣称所有留存数据已清理。若保留这类旧沙盒库，应核对处理；目前未证明存在，不据此编造线上事故或扩大为全库重审。

独立 REA 回执已更新至 `cc516f4d`：自报本次工具可调用，但没有 APK 实物或本地复算哈希；因下载失败，已于 15:36 中国时间停止取样并撤销原交付排期。它是阻塞回执，不是拆解报告，Dot 未据其进行报告验收。本轮不进行替代下载、绕过或安装。

Luna 继续本次有界补正；Dot 收到实际差量后复核。R1 多图尚无本轮实现差量，不抢先验收；不启动包船/F/会员、不操作真实资金/保险或生产。

固定证据：[修复提交](https://github.com/mikaozhao-dot/qingdao-fishing-app/commit/aa57247a9ef3eacdcd0e5fd8fb8bf3c5c5438c03) · [迁移 027](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/aa57247a9ef3eacdcd0e5fd8fb8bf3c5c5438c03/server/migrations/027_g_insurance_failure_review_fixback.sql) · [夹具](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/aa57247a9ef3eacdcd0e5fd8fb8bf3c5c5438c03/server/scripts/step4-acceptance.mjs)

## 2026-10-28 08:07 UTC 终轮窄复核：d3e0ab3c（限定沙盒技术通过）

**固定实现 `d3e0ab3c27326c0cdf8a3bcc63df10fd6cd12219`，本轮 G-R1～G-R4 及 07:38 所列一个升级缺陷、两个夹具补正均已在下述范围关闭。** 不再要求重复这些已足够的补证。不等待另发回执才承认实际已交代码与同 SHA 原始日志。

### 实际证据

已读迁移 028、路由少量差量、独立升级脚本、两条修正负例及真实 API 历史回放夹具，并核对 [CI run 40654110138](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40654110138) / [job 122700881003](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40654110138/job/122700881003) 原始日志。checkout 为上述完整 SHA，迁移 028 成功；Step4 **853**、G guardian 专项升级 **4**、Step5 **133**、live **77**、promotion **334**、退款重订迁移 **33**、证书 **70** 断言均通过。本轮仍没有由 Dot 新执行测试或操作真实服务。

### 三个剩余点逐项关闭

1. **旧家长金额回放**：028 按家长 passenger_id、insurance_failure reason 与精确 `insurance-guardian-exit:<guardian>` 退款键回填历史金额；新增已知结果标志，历史班次结果不可可靠恢复时，API 返回 **null（未知）** 而非默认 false。新操作明确保存 known=true，继续准确重放 true/false。保留的不确定性是如实建模，不是声称恢复了不存在的历史证据。
   - 独立升级脚本在单一数据库连接的隔离 schema 内真实应用 001–025→026，建立 026 形状的决定与 5000 分退款义务，再应用 027 验出 0/false，应用 028 验出 5000/unknown，并重放 028 验证幂等，共 4 项。
   - Step4 另有真实 API 同键回放夹具，断言回放 5000、历史结果 null、没有第二笔退款。两组证据合用，未把 SQL 读取冒充 API 调用，也未把新建 schema 演练冒充现存生产库升级。
2. **订单取消并发负例**：保留班次 confirmed，只取消订单/席位并释放班次锁；排队保险请求返回 409，保障不变，无新增尝试/退款，且明确断言班次仍 confirmed。原来被整班取消掩盖的问题已经消除。
3. **第二家长冲突负例**：四乘客夹具在第一家长退出后保持订单 paid、班次 confirmed、第二家长 active，再以同孩子不同 key 请求，断言 409、只有原决定、无新增退款且剩余乘客/班次不变。现已针对原唯一约束冲突，而不是依赖班次终态拒绝。

此前 aa57247a 已验证的 G-R1/G-R2 新执行路径在本次同 SHA 全套相关回归中继续通过；此增量不重开已关业务或证书事实项。

### 通过范围与下一责任人

- 通过范围是本次送审的**沙盒/API、迁移与所交夹具覆盖的技术行为**，不是 G 创始人产品关单、真实保单/退款验证、生产迁移许可或队列下一项开工授权。
- 前文 G-R2 关于旧版已失败轮次历史正向补差账的保留说明不变：未证明已清理所有留存库，不把新流程通过扩大为历史全量修复；该说明不是新增待重复测试命令。
- 监护关系真实核验、保险方书面规则与时效、对外文案、真实资金/保险/生产边界仍不变。
- Muse 已在 `docs/ui-design-review-aa57247a.md` 明确接收 07:38 差量结论并安排三个窄修；本节交 Muse/Luna 对账，由 Muse 汇总产品验收材料并按既有决策链推进。**本节发布不代表对方已实际读取本节。**
- R1 新多图呈现仍待其实际实现与送审；FishingBooker 尚未交付可复核样本/拆解报告，均不由 G 技术通过代替。

[固定窄修](https://github.com/mikaozhao-dot/qingdao-fishing-app/commit/d3e0ab3c27326c0cdf8a3bcc63df10fd6cd12219) · [迁移028](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/d3e0ab3c27326c0cdf8a3bcc63df10fd6cd12219/server/migrations/028_g_insurance_guardian_legacy_replay_backfill.sql) · [升级夹具](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/d3e0ab3c27326c0cdf8a3bcc63df10fd6cd12219/server/scripts/g-insurance-guardian-migration-acceptance.mjs) · [API与并发夹具](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/d3e0ab3c27326c0cdf8a3bcc63df10fd6cd12219/server/scripts/step4-acceptance.mjs)
