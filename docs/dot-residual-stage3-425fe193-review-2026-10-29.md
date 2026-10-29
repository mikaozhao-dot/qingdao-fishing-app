# Dot 定点复核：425fe193 — 包余位第三级与第 4 级收尾（暂不通过）

## 独立结论与范围

**结论：暂不通过，需回补后重送 Muse → Dot；不关单。** Muse 的代码评审结论与本报告独立保留，不覆盖其文件。本轮确认同实现 SHA 的数据库 CI 原始日志真实通过，但该日志没有覆盖下述出航截止竞态和待支付订单终态漏洞，不能据此认定本项全部边界通过。

- 本轮实际开始核查：2026-10-28 23:55:33 UTC；于 2026-10-28 23:57 UTC 后形成以下静态结论。
- 实现：`425fe19389f7508dd795aef7b5da9d1a0cbef0de`。
- Luna 回执：`932f147140c53bf78a39e9e960986f08e0dfef52` / `docs/charter-residual-stage3-delivery-receipt-2026-10-29.md`。
- Muse 正式移交：`d1a83c5eab97bfe80a10fa8640d29d32679c53b8` / `docs/ui-design-review-932f1471.md`；复核范围为其代码事实 1–9、回执数字和同 SHA Actions。
- 定稿边界：`docs/ui-design-review-5d022a0a.md`；仅售未售余位、B1 收集中阻断、单一截止 `departure_at`、未达标幂等全退/替代活动、不发 F/会员券、不新增整船转换。
- 方法：固定 SHA 实读代码、迁移、验收脚本和 Actions 原始 job 日志；**未运行或重跑测试，未改代码，未触碰生产、真实支付/保险/资金**。下述缺陷为静态可达路径，不冒充新执行的复现日志。

## 阻断项

### D1 / P1：余位支付仍可越过 departure_at，并影响第 4 级成行判定

固定实现 SHA 的证据链：

1. `server/src/step3-routes.js:22,1065–1069`：锁位有效期始终是 `seatLockAt + 10 分钟`，没有截断到 `departure_at`。因此出航前 30 秒合法建单时，锁位可以继续存活到出航后。
2. `server/src/step3-routes.js:1323–1366` 的支付意图入口只校验订单为 `pending_payment`；`:1487–1512` 的沙盒支付入口未补出航截止判断。
3. 支付回调持有班次行锁（`:655–659`），但 `callbackMatchesActiveHold`（`:701–720`）只比较支付事件与授权/锁位截止，并检查锁位仍有效；没有读取或判断 `departure_at`。`:854–886` 随后将交易/订单/订单座位分别置为 `succeeded/paid/paid` 并占用座位。
4. 之后才调用 `confirmResidualDepartureIfMet`（`:888–890`）。超过出航时间时，该函数因 `isResidualSalesOpen` 返回 false 而返回 `unchanged`，**不会撤销刚才的成交**。
5. `server/src/step4-routes.js:608–614` 的收尾按实时成团账判断；`:45–89` 的成团账汇总所有 `paid` 订单，未按出航截止剔除这笔迟到成交。若回调先于下一次收尾 worker 获得行锁，迟到票款可以把本应在截止时未达标的班次改为 `confirmed`。行锁只能串行化，不能弥补缺失的截止校验；worker 每 60 秒检查一次也不是截止门禁。

**最小反例（待授权执行方补测）：** 班次距出航 30 秒、状态 `handling_shortfall`、无活动 B1，创建余位锁位/订单/支付意图；出航后 1 秒且 worker 尚未收尾时成功支付，锁位仍有效。现有分支可把新款计为已付，再由 worker 据此确认。该路径违反“购买窗口严格止于 departure_at”，也使 Muse 事实 4 的“各处均校验”不能成立。

**回补要求：** 在最终成交的服务端裁决中强制执行余位截止，不依赖 worker 调度或仅禁止新锁位；终点后的新成交不得计入成团账。应明确区分截止前已完成支付的延迟通知与截止后的新支付，沿用既定迟到支付/退款幂等规则，不能默默延长救援窗口。补证必须覆盖截止前/恰到点/截止后，以及支付与收尾两种行锁先后顺序，证明迟到款不会让班次反向确认、不会重复退款或挤掉原乘客。

### D2 / P2：第 4 级取消待支付订单时遗留 active 订单座位记录

- `server/src/step4-routes.js:669–700` 会终止待支付订单、支付意图、乘客和锁位，并释放库存，但**没有**将这些订单的 `booking_order_seats.status='pending_payment'` 改为 `released`。
- 同函数 `:643–645` 仅在 `paidOrders` 循环内释放 `status='paid'` 的订单座位，不覆盖上述待支付订单。
- `server/migrations/004_transaction_sandbox.sql` 的 `booking_order_seats_active_seat_idx` 将 `pending_payment` 和 `paid` 都视为 active。结果是订单已取消、库存已释放，但关联订单座位仍占 active 索引，终态不一致。
- `server/src/step3-routes.js:341–385` 的常规过期清理仅选 `seat_holds.status='active'`；第 4 级已经把该 hold 改成 `released`，所以不能指望该清理在之后自动修复。既有 `releaseHoldInTransaction` 的 `:319–323` 则明确会释放待支付订单座位，说明新收尾漏掉了同一终态步骤。

**回补要求：** 在同一事务内释放被收尾取消的待支付订单座位，并补“未付款、有有效 hold、有 pending payment intent”的收尾样例与幂等重放断言；检查订单、乘客、订单座位、库存、锁位和支付状态一致，且未付款订单不得凭空产生退款义务。

## Muse 事实 1–9 对照

| 项 | Dot 独立观察 |
|---|---|
| 1 窄购买路径/不翻 open | 列表、座位、锁位、建单确有独立 `handling_shortfall` 分支；不是把状态翻回 open。该结论不抵消 D1。 |
| 2 B1 双向互斥 | 锁位与 B1 创建都先锁班次；收集中座位查询/锁位受阻；建 B1 前检查快照后订单或有效 hold。代码支持。新增脚本覆盖收集中锁位 409，但未见余位先开始后再建 B1 的专门新增断言。 |
| 3 冻结票价/服务端成团/保留原乘客 | 订单复用锁位价与实名流程；成功支付后调用服务端账重算；新增脚本覆盖 10000 分、原 paid/booked 不变、并发 201/409 和达标确认。终点外成交另见 D1。 |
| 4 单一终点 | 锁位/建单有 `departure_at` 校验；最终支付路径缺失，D1 阻断。 |
| 5 第 4 级幂等全退 | 班次/快照行锁、已确认不触碰、未达标全退剩余本金及平台费、request_key 幂等、待支付意图终止均可见；D2 阻断完整终态声明。已有新增脚本只覆盖已付订单退款样例。 |
| 6 替代活动 | 查询限已取消且原因为 `formation_shortfall_auto_cancel` 的本人订单；同码头、同一上海自然日、未来开放且有平台可售座位、最多 5 条；未新增推荐引擎。 |
| 7 不新增整船/F券 | 本次 diff 没有整船转换、券表/发券调用；实读注册路由清单，未见整船转换入口，`whole_boat_price_fen` 在 step2 中只作读取。本轮没有执行整船请求；不能将路由不存在等同于已执行动态不变量验收。 |
| 8 规则索引 | 只同步该规则行，明确实现待评审/创始人验收；未改规格正本。 |
| 9 迁移 | 029 仅扩展退款义务 reason 约束；原始 CI 日志确认应用成功。 |

比较 `f7813e18 → d1a83c5e` 为 3 个提交、8 个文件：实现相关 6 个文件，加 Luna 交付回执和 Muse 自有评审；无删除，无 app/design/.github/规格正本或构建产物改动。本轮未出现 R1 证书分页或 REA 新交付。

## 同 SHA Actions 原始证据

- [run 40727985248](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40727985248)，`Step 4-6 isolated database acceptance`，push/main，attempt 1，head SHA 精确为 `425fe19389f7508dd795aef7b5da9d1a0cbef0de`，状态 completed / success。
- [job 122956314799](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40727985248/job/122956314799)，步骤全部 success；本轮实际拉取其完整解码日志并核对以下原始记录，不只引用 Luna/Muse 转述。
- checkout 日志于 2026-10-28 16:39:06.7714377Z 输出上述精确实现 SHA；16:39:10.4649600Z 记录 `Applied migration 029_shortfall_departure_refunds.sql`。

| 原始日志 UTC | 检查 | 日志结果 |
|---|---|---|
| 16:39:17.9632704 | Step 4 | 904 assertions passed |
| 16:39:18.3949812 | G guardian migration | 4 assertions passed |
| 16:39:19.7278554 | Step 5 | 133 assertions passed |
| 16:39:20.6159026 | Step 5 live | 77 assertions passed |
| 16:39:22.8359437 | Step 6 promotion | 334 assertions passed |
| 16:39:23.4666937 | refund-reorder migration | 33 assertions passed |
| 16:39:25.3284947 | Step 6 certificate | 70 assertions passed |

证据边界：

- 该 workflow 不运行 `npm run check` 或 `npm test`；同 SHA 查询只返回该 run，且其 artifacts 为空。因此 Luna 回执的本地 check 通过与 test 10/10，本轮**未取得独立原始日志证明**，仍标作回执自述；没有重跑来填补。
- Step 4 新增段 `server/scripts/step4-acceptance.mjs:3276–3464` 是立即成功的余位成交与已付订单到点退款，未包含 D1 的跨截止支付竞态或 D2 的待支付终态用例；904 总数不能替代这些缺失边界。
- 定稿要求余位路径完整的实名/保险名单及禁整船/无 F 券不变量证据。当前新增段创建了实名乘客，但未见余位新乘客保险名单/保险门禁的专门断言，亦未见零预订与已有预订整船请求无副作用的动态断言。无整船 API 的证据已确认；回补交付应清楚区分静态“无入口”与实际执行的拒绝/不变量证据，不得为补测试创造新转换功能。
- 已核 CI 成功是真实证据，但不能覆盖未执行场景，不能代替创始人产品验收或生产放行。

## 下一步与权限边界

1. 本项保持未验收/未关单；请既有执行责任链对 D1、D2 回补并补上有界原始验收证据，固定新 SHA 后仍按 Muse → Dot 重送。此处为独立评审结论，不是创建外部任务、改派责任或扩大实现范围。
2. 回补不得新增整船转换、第二套补差、F/会员券，亦不得把本项扩大到生产、真实支付/保险或真实资金；其他队列事项不由本报告放行。
3. Dot 本轮只新增本评审文件，不修改代码、Luna/Muse 记录或规格正本；发布使用最新 main 的 compare-and-swap/非强推保护并行提交，发布后按实际提交 SHA 全文回读。
4. 创始人产品验收须另行确认；技术复核通过也不等同于产品验收、关单或生产放行。
