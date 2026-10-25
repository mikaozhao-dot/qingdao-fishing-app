# 第 4 步构建记录

状态：v1 非金额履约子集已实现；Muse 于 2026-10-24 有条件通过。第 4 步 v2 已开始，首单冻结、配额隔离、B1 确认时点及保险门禁均有代码切片。Muse 的 F02/Q01–Q03 独立复跑报告（145/146/145 项零失败）已交 Dot 核验，汇总仍待更新。切片 1 已由 Dot 在审查的沙盒范围内通过；切片 2、4 按 Dot 既有结论在限定范围内通过。切片 3 的个人级保险出航 POST 门禁已实现：代码提交 `0d46add7ea545a87dec5068c30bda3a98f36680a` 的 GitHub 数据库验收通过 709 项断言，Flutter 检查、iOS 模拟器与 Android APK 构建均成功；当前等待 Dot 定点复核，详见本文件末尾。天气取消仅验证独立状态读取与保留成团快照，触发、通知及退款仍受待批准 SOP 限制。本文不表示第 4 步 v2 全量验收、创始人验收或真实交易获准。

## 范围

已实现：

- 船长只查看已确认、出海中和已返航的班次。
- 服务端为已确认班次生成行前清单，并在沙盒通知发件箱留记录。
- 船长出航、返航打卡推动班次状态，重复打卡会被拒绝。
- 船长可导出掩码或完整实名名单；两种导出均写入审计记录，完整名单仅船长本人可取。
- 钓友可查看订单对应的出航时间、集合码头和已生成的行前清单。
- 清单与通知不调用真实天气、短信、支付或保险服务。

暂缓：

- 成团金额、违约金池与最低成行总价核算。
- 少人成行、补差报价/扣款与失败回滚。
- 包船结算与候补递补。
- 乘客取消、爽约、退款及退改阶梯执行。

以上涉及 D02 或被 Muse 当前状态注记列入暂缓边界。不能把代码或界面推演当作已获批准的资金规则。

## 交付证据

- 本地后端语法检查：npm run check，通过。
- 本地 Flutter 静态分析：dart analyze .，通过，无问题。flutter analyze 在当前 Flutter 3.47.8 命令行环境中退出于 analysis server LSP 消息不完整，不作为通过证据。
- iOS 模拟器构建：flutter build ios --simulator --no-codesign，通过。
- 沙盒验收：server/scripts/step4-acceptance.mjs 在新建空数据库执行，通过 35 项断言；覆盖清单生成、通知去重、打卡状态流转、名单导出/审计、反向权限、空单复核状态，以及首单前门槛可调整、首单后价格与门槛更新被数据库拒绝。
- iOS 模拟器截图：`design/step4-review-photos/step4-01-captain-itinerary.png`（292,200 字节）与 `step4-02-angler-itinerary.png`（285,027 字节）；截图来自本轮 Flutter integration 驱动，均小于 1 MB。未做真机实测。
- 生产小额验收：未进行；当前不接真实交易通道。

## 未完成项

### 配额隔离基础片（提交 `292eae3`；待来源释放补缺独立复核）

- 新增迁移 `007_departure_quota_isolation.sql`：保存航次模板容量、平台/线下配额、人工确认标记、席位归属和转移审计；历史库存完成回填。未提交配额的旧式发班安全降级为人工确认供给。
- 发班端可指定平台与线下席位数；只有平台专售席位生成线上库存。未分配席位不会出售，人工确认供给不提供平台锁位入口或即时确认承诺。
- 船长调额接口按航次行锁串行执行；已售/已锁席位拒绝调走，重复请求幂等，调出席位先冻结后切换销售渠道。
- 验收：空库应用全部迁移后，`server/scripts/step4-acceptance.mjs` 通过 **68 项断言**，覆盖 4+6 配额、第五席线下归属、第 11 席无库存、锁位拒绝调额、线下转入/调回、幂等、并发只成功一次和未隔离班次的人工确认降级。另做了 001–006 存量数据升级演练，验证 007 回填及旧式插入默认值。
- `npm run check`、`dart analyze .` 和 `flutter build ios --simulator --no-codesign` 通过。`flutter build apk --debug` 未能运行：此环境没有 Android SDK；尚无 Android 构建结果。
- 未提交 CI 新运行链接；Muse 对此提交尚未评审。以上只说明本地实现与验证，不构成 Muse 验收。

### 线下来源释放契约补缺（提交 `de3f65c`，待 Muse/dot 独立复核）

- 新增迁移 `010_offline_seat_release_contract.sql`：对线下席位登记在售、已锁、已售状态；状态变化留操作人、时间、原状态和新状态。线下已售/已锁席位不可调入平台；开放席位须由班次所属船长勾选固定释放声明，释放凭据、声明版本与调额请求在同一数据库事务中写入。
- 船长“我的班次”新增线下席位登记入口，可更新线下状态或调入平台。界面和接口都明示平台只能证明船长已登记并确认，无法核验或技术性阻止线下事实本身；这不是外部销售系统联控。
- Q02 迁移范围：007 对既有库存的回填仅适用于沙盒数据。未来真实存量升级须逐班次确认平台专属配额、保留已有订单，并冻结未确认部分的新增销售；本片不改动 007 的回填逻辑。
- Q03 空库回归：全量迁移 001–010 后通过 **131 项断言**。新增覆盖真实线下库存 ID 不能锁位、线下已售/已锁/未确认释放拒绝、平台已售拒绝调出、状态登记与调额并发、锁位与调额并发、合法调入后可锁位、截止后幂等重放。
- 本地 `npm run check`、`dart analyze .`、Dart 格式检查与 `git diff --check` 通过。提交 `de3f65c` 的 GitHub CI [run 40088757857](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40088757857) 已完成：Flutter analyze、Android debug APK 和 iOS simulator build 三项均成功。
- 本补缺与 `292eae3` 的配额基础片尚未获 Muse/dot 独立实跑验收；平台外部线下事实仍依赖船长如实登记与确认。

### B1 双账预览首片（提交 `f68530f`，待 Muse 复核）

- 新增船长专属双账查询：按已支付订单逐单计算票款净额（扣除订单折扣后按 90%计），显示门槛与平台账差额；支付中的意向和未支付订单不计入。
- 新增船长线下台账追加接口，带请求编号幂等、记录依据与金额冲减校验；线下金额单独展示，仅标记为船长自报，不进入平台自动达标金额。
- 验收脚本新增 15 项断言，覆盖 5,000 分订单计算为 4,500 分净额、普通钓友和其他船长访问限制、线下账隔离、请求重放与冲减边界。空库应用 001–008 后通过 **83 项断言**；`npm run check` 通过。
- 本片仅交付账本预览与线下登记 API；罚金池和成功补差的业务写入来源不在本提交中。Muse 对提交尚未评审。

### B1 确认时点与双账状态首片（提交 `edcb419`，待 Muse 复核）

- 新增出航前一日 18:00（Asia/Shanghai）后台核算：平台已支付订单净票款按单计算 90%，叠加服务端记录的罚金池与成功补差；平台账达到门槛自动成行，不足则进入待处置并保存一次核算快照。
- 确认点关闭新的线上选位与下单；仍有待支付订单时延后快照，避免将未决支付当作已收款或漏算刚支付成功的订单。
- 船长只可在服务端生成短缺快照后，以平台账＋单独登记的线下台账达到门槛并填写依据，选择“船长已确认成行”。决定记录平台账、线下账、门槛与依据，并明确不构成平台担保。该状态可进入现有行前清单、出航打卡与名单流程。
- 验收：空库应用 001–009 后 `server/scripts/step4-acceptance.mjs` 通过 **103 项断言**，包含自动成行、短缺后船长确认、待支付延后、截止点禁止锁位；`npm run check` 与 `dart analyze .` 通过。未跑本提交的 CI、iOS/Android 构建或原生截图。
- 罚金和补差只有数据表预留，目前没有业务写入流程；手机端的双账展示与船长确认操作控件尚未接入。Muse 对本提交尚未评审。

其余 B1 双账、一轮补差、退改执行及保险门禁继续按最新批准任务书实现。补偿券预算、G 现金退款/同行责任、包船未定分配、真实通道与生产部署仍明确排除。Muse 对 v1 子集的有条件通过不等于 v2 或全量验收；第 4 步 v2 的独立实跑、CI、双端构建、其余原生截图和真实交易均未完成/未授权。

### 复核 F02 过期成行人工异常与释放重试幂等（代码提交 `45231f3`、`884d1e8`、`0b0bd70`）

- 离线席位调入平台在同一登记弹层内重试时复用原请求编号；只有收到成功响应后才释放该编号，避免服务端已提交但响应丢失时重试重复增库。请求编号未做跨弹层或应用重启持久化。
- 新增迁移 `011_overdue_formation_manual_review.sql` 与 `formation_overdue` 状态。成团任务锁定航次后若已超过出航时刻，只将班次标为待人工处理，不写成团快照或自动确认；后续任务重跑不再处理该异常。船长与钓友行程状态显示“已过出航时间 · 待人工处理”。
- 船长成行确认接口也检查出航时刻；即使短缺快照和船长登记线下金额满足门槛，过期后仍拒绝新增确认记录，保留原短缺状态供人工核查。不新增罚款、取消或退款政策。
- Dot 后续静态复核指出，批次固定的 `asOf` 可能在航次行锁等待期间过时。`0b0bd70` 在取得航次锁后、写入核算快照前均以数据库 `clock_timestamp()` 重查出航时刻。
- 空白临时数据库应用迁移 001–011 后，`server/scripts/step4-acceptance.mjs` 通过 **146 项断言**，覆盖刚过出航时刻的任务处理与重跑、船长过期确认拒绝，以及持有航次行锁跨过出航时刻后仍转人工异常且不写快照。验收数据库在测试完成后已删除。
- 本地 `npm run check`、`dart analyze .`、`dart format --set-exit-if-changed app/lib/step2_flow.dart app/lib/step4_flow.dart` 与 `git diff --check` 均通过。提交 `884d1e8` 的双端 CI [run 40089573657](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40089573657) 已成功，覆盖本轮 Flutter 改动。`0b0bd70` 仅改服务端，当前 GitHub 构建工作流只监听 `app/**`，因此没有新的双端构建；服务端由语法检查和隔离数据库回归验证。
- Muse 在 `docs/ui-design-review-83d28771.md` 对配额、B1 双账与 F02 已交付区间给出**有条件通过**，明确不等于第 4 步 v2 全量验收；Dot 的 F02 定点代码/用例复核已关闭固定 `asOf` 锁等待缺口。146 项本地隔离数据库证据之外，GitHub Actions 独立空库复跑 [run 40095067592](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40095067592) 已在新建 PostgreSQL 17/Redis 7 服务中应用迁移 001–011，并通过 **146 项断言**。首次运行 [run 40094860581](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40094860581) 因工作流未给 64 位十六进制环境变量加引号，YAML 将其解析成数值而失败；提交 `3fe5ddc` 修复后复跑通过。此为独立数据库运行证据，Q01–Q03/F02 的独立评审裁定仍待 Muse/Dot；不等于第 4 步 v2 全量验收。F01 候补补位授权窗口和其余 v2 切片继续开放，未改普通售票截止或扩大业务规则。详情见 `docs/step4-f02-followup-review-request-2026-10-24.md`。

### 保险门禁后端修复（提交 `7cd8c8d`；Dot 定点复核通过）

- 首片代码提交 `9ef52cdb` 与夹具修正 `611483f` 已入 main。Dot 的 I01/I02 修复复核见 `docs/dot-insurance-gate-review-2026-10-24.md`。
- I01：航次沙盒接口保存并返回 INSERT 结果；UUID 与 `varchar(24)` 状态比较均显式定型。乘客和订单级沙盒状态写入也修正了同类状态参数推断冲突，并补成功响应断言。
- I02：门禁查询仅读取与数据库中当前出航和返航时刻完全匹配的乘客保障记录。移除每次读取时把旧订单级 `issued` 状态补成当前时段有效保障的逻辑；迁移 012 的一次性兼容回填保留。查询在 PostgreSQL 内直接联结两个时段边界，避免 JavaScript `Date` 往返丢失时间戳微秒精度。
- 新增用例：订单级沙盒投保虽仍为 `issued`，班次时段改变后乘客保障不自动移到新时段、该乘客仍不能登船；并验证航次沙盒接口返回已保存状态。
- 本地 `npm run check` 通过；PostgreSQL 17.11/Redis 7 空库应用迁移 001–012 后，验收脚本通过 **174 项断言**。GitHub Actions [run 40097350087](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40097350087) 在 PostgreSQL 17/Redis 7 新环境应用迁移 001–012 并通过 **175 项断言**。计数相差 1 来自现有并发竞态用例的条件断言是否触发；两边都没有失败断言。
- 双端构建 [run 40096010858](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40096010858) 已通过首片 UI/模型代码；修复提交只改服务端与验收脚本，没有改移动端。
- Dot 确认本批门禁 API、状态标记及覆盖时段边界阻塞已关闭，毋须再派重复复跑。**后续待验收：** 完整 D 四例、其余第 4 步 v2 切片。未接真实保险、支付、退款或生产服务；本片通过不代表 Muse 已全量验收或第 4 步 v2 完成。

### 保险门禁原生 UI 走查（Codex 本地沙盒，等待独立评审）

- 使用 Flutter 集成驱动在 iPhone Duo（iOS 27.1 模拟器）完成实际 UI 操作：钓友登录、打开活动、进入选位页；切换船长身份查看平台成行状态，再打开登船门禁。
- 本地演示数据包含一名保障已核实乘客和一名保障失败乘客；航次必需保障有效。门禁页显示前者可登船、后者因资料有误暂不能登船，并保留“单个乘客问题不自动拦停其他乘客、不能人工跳过门禁”的说明。
- 原生截图：`design/step4-review-photos/step4-03-seat-selection.png`（304,400 字节）、`step4-04-captain-formation-status.png`（305,910 字节）、`step4-05-insurance-gate.png`（345,640 字节），均小于 1 MB。临时集成走查的三个页面断言均通过；未做 Android 或真机走查。
- 本记录只证明本地沙盒中这条路径和该门禁状态的模拟器显示。完整 D 的其余保险例、补差界面、真实保险回查以及 Muse/Dot 对本轮截图的独立评审仍待完成；不构成产品验收或真实保险出单授权。

### 切片 1：成团补差与 F01 候补窗口（2026-10-25 本地交付，待 Muse/Dot 复核）

- 新增迁移 `015_waitlist_closeout.sql` 与 `016_supplement_rounds.sql`，实现 F01 候补登记/授权、18:10 收尾冻结、退款义务，以及航次最多一轮补差的快照、全员确认、支付和服务端复验。全额退款及补差支付目前只运行在沙盒，不接真实资金通道。
- 钓友行程页新增补差卡片，可确认/拒绝本轮，并通过沙盒支付面板模拟成功、失败或超时；明确显示演示不会扣款，不会自动开第二轮。
- 交易验收通过 365 项断言：创始人 12×¥500 算例（4 人 T−30h 取消、补偿池 ¥600、候补补 1 人、缺口 ¥350、全员成功后服务端复核达到 ¥5,000）；补差全成功、拒绝全退且不扣违约金、单人付款失败、超时后迟到成功退款、重复回调只记一次、退款三次失败转人工；F01 18:00/18:10 边界、剩余窗口限时、18:00 后释放席位拒绝进入候补、18:10 冻结、迟到成功退款后下一位候补接续，以及支付回调与收尾并发。
- 验收运行于新建隔离 PostgreSQL 17.11 数据库，依序应用迁移 001–016；连接 Redis 8.10.2。`npm test` 为 8/8 通过，`npm run check` 通过。Flutter 3.47.8/Dart 3.13.7 的 `flutter analyze --no-pub` 无问题，Dart 格式检查无改动。
- iPhone Duo（iOS 模拟器）Flutter 集成走查通过，依次操作确认、沙盒支付与完成页。原生截图：`design/step4-review-photos/18-step4-supplement-consent.png`（352,365 字节）、`19-step4-supplement-payment.png`（338,483 字节）、`20-step4-supplement-complete.png`（328,123 字节），均为原始 PNG 且小于 1 MB。
- GitHub Actions 空库复跑 [run 40175115167](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40175115167) 已通过，应用迁移并完成 **365 项断言**。首次运行 [run 40174877606](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40174877606) 因工作流缺少演示支付沙盒开关而在模拟支付接口返回 503；提交 `533a95a` 加入 CI 专用演示开关和测试密钥后复跑成功。
- 本地 iOS 模拟器原生截图已入仓：`design/step4-review-photos/18-step4-supplement-consent.png`、`19-step4-supplement-payment.png`、`20-step4-supplement-complete.png`，均为未压缩 PNG 且小于 1 MB。
- **状态：代码和证据已提交，待 Muse/Dot 独立评审。** 本记录不是 Muse/Dot 验收结论。尚无 Android 构建或真机结果，也未连接真实支付、真实退款或生产服务；第 4 步 v2 其他切片仍开放。完整回执见 `docs/luna-step4-slice1-status-receipt-2026-10-25.md`。

#### Dot R1–R6 定点修复跟进（2026-10-25，本地验证完成，待复核）

本段记录针对 `docs/dot-step4-slice1-review-2026-10-25.md` 的 R1–R6 修复；365 项是原提交基线。本次核心验收 426 项加 API 截图夹具 4 项，共 **430 项断言**。

- R1：补差支付已标记失败后收到合法成功回调时，记录实际到账、保持轮次失效、建立一次退款义务并排除成团账；覆盖失败后成功、新事件号重复成功和退款三次失败转人工。
- R2：候补派发、候补登记、普通座位锁定和建单均在取得班次行锁后读取当前时钟。验收让每条请求在行锁上等待并跨过 18:00，确认截止后的请求不创建候补、锁位或订单；候补派发跨过 18:10 后不发出过期授权。
- R3：18:10 收尾取得班次锁后复查时间；直接关闭待支付候补订单、支付交易、座位锁和候补项，不依赖 hold reaper。验收覆盖支付回调先于收尾，以及收尾在锁等待后先完成、随后成功回调走退款且不复活订单。
- R4：参与者已支付后，在其他参与者仍待支付时刷新/重试支付意向，返回原成功交易而不重复创建。
- R5：mock 集成截图已改名为 `mock-18` 至 `mock-20`。另用本地运行的沙盒 API 和 PostgreSQL/Redis 执行原生 iOS 集成流程，成功完成同意、支付、成行复核；完成截图显示“平台已成行”。数据库复核为 departure=`confirmed`、round/payment=`succeeded`，成功补差账只有一条。三张图通过 `flutter drive` 原生驱动重新采集，1398×2034 PNG，分别 359,788、347,169、353,926 字节，均小于 1 MB。
- R6：首位拒绝使多人补差轮次失效后，其他参与者仍可主动退出。服务端创建每单独立的全额票款退款义务、取消订单且不收退改违约金；多人用例覆盖两个参与者和重复退出请求。

验证环境为新建隔离 PostgreSQL 17.11 和 Redis 8.10.2，应用迁移 001–016，并为本地沙盒配置一次性测试密钥；`server/scripts/step4-acceptance.mjs` 在生成 API 截图夹具的运行中通过 **430 项断言**。`npm test` 8/8、`npm run check`、`flutter analyze`、`flutter test`、Dart 格式检查和 iPhone Duo iOS 27.1 原生 API 集成驱动均通过。集成驱动命令与逐项证据见 `docs/step4-slice1-r1-r6-followup-review-request-2026-10-25.md`。

状态仍为待 Muse/Dot 复核，不表示已验收。代码与证据提交 head `f16c248` 的 [隔离数据库验收 run 40180869625](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40180869625) 和 [双平台构建 run 40180869639](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40180869639) 均成功；双平台 run 中 Flutter 分析、iOS 模拟器构建和 Android debug APK 构建均通过。没有 Android 真机交互、生产部署、真实支付或真实退款证据。

#### Dot / Muse M1、M2 补充复核（2026-10-25，代码提交 `74f1740`）

- M1 / R3：18:10 closeout 现直接取消已过期普通待支付订单并超时其 pending 交易，释放订单座位和锁位；成团检查不再因该过期单 deferred。有效锁位和已支付订单不受影响。迟到成功只记账并产生 `late_booking_payment` 退款义务，订单、座位及冻结快照不恢复。新增迁移 `017_late_booking_refund_reason.sql`。
- M2 / R2：新增 PostgreSQL 行锁竞争用例，直接让候补派发在 18:09:59 开始、等待至 18:10:01 后继续；断言无候补授权、活动锁位或 Redis key，并用同一注入时钟收尾。验收位置见 `docs/step4-slice1-r2-r3-followup-review-request-2026-10-25.md`。
- 新建 PostgreSQL 17.11 / Redis 隔离环境，应用迁移 001–017；不生成此前已通过的截图夹具，本地 `server/scripts/step4-acceptance.mjs` 通过 **463 项断言**。`npm run check`、`npm test`（8/8）和 `git diff --check` 通过。
- GitHub Actions [Step 4 隔离数据库验收 run 40184399073](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40184399073) 在提交 head `9562c3b` 成功，CI 输出 464 项断言通过。本地和 CI 均无失败。状态仍是待 Dot 对 M1/M2 复核；既有 R1/R4/R5/R6 结论按 dot 的巡检记录，不表示切片 1 已验收。沿用已经目检的 18–20 PNG，本次没有重做截图，也没有扩到其他切片。

#### Dot 对切片 1 的结论（2026-10-25）

- Dot 在 `docs/dot-step4-slice1-review-2026-10-25.md` 的最终定点复审中确认 R1–R6 全部关闭，并将切片 1 在已审沙盒范围内判为通过；对应 main 提交 `0393743`。
- 结论只覆盖已审源码、测试、CI 与 18–20 PNG。Dot 未独立空库复跑；本地沙盒 API 片段不是完整真实交易链，不包含真实支付/退款、生产环境、Android 真机交互或第 4 步其他切片。

#### 退改四档验收补充（代码提交 `8a881f6`，待 Dot 复核）

- 现有计算逻辑未改业务口径；新增边界单测覆盖 73h、72h、24h+1ms、24h、6h+1ms、6h，固定左开右闭的费率切换点。
- 空库验收新增四个 API 例子：T−80h 罚金 ¥0/退款 ¥500；T−48h 罚金 ¥150/退款 ¥350；T−12h 罚金 ¥300/退款 ¥200；T−4h 罚金 ¥500/退款 ¥0。每例核对订单的分币记录、座位释放、航次罚金池、船长账目可见的池金额、沙盒退款义务与重复取消幂等。
- 另验收出航后取消请求返回 409、不产生退款义务或罚金池记录；该用例证明不允许出航后自助退款，不新增爽约识别流程。
- 修正创始人 12 人算例，让四笔 T−30h 取消从距出航约 30h 的班次发起，再经候补 API 补位、沙盒付款、18:10 成团核算及补差 API；现有算例仍逐项核对 ¥600 罚金池、¥4,500 毛票款（平台净额 ¥4,050）、¥4,650 可核验金额及 ¥350 缺口。
- 本地隔离 PostgreSQL 17.11 / Redis 8.10.2 应用迁移 001–017，`server/scripts/step4-acceptance.mjs` **539 项断言通过**；`npm test` 8/8、`npm run check`、`git diff --check` 通过。GitHub Actions [run 40186183656](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40186183656) 对 `8a881f6` 成功，日志确认 539 项断言通过。
- 本片只验证退改 API 与沙盒账目，无 App 页面变化，因此未生成截图。罚金池记录不等于已向船长实际结算；未连接真实支付或真实退款。当前状态为待 Dot 复核，不能记为 Muse 验收或第 4 步全量验收。

#### 退改四档后的保险门禁补充状态（代码提交 `f28e9e9`，待 Dot 复核）

- 按 D 口径补齐航次必需保障 `pending_verification` 阻断整船、乘客保障 `pending_verification` 和 `not_insured` 在航次保障有效时仅阻断该乘客的隔离数据库 API 用例；原有 `not_verified`、`failed`、有效、出返航时段变化后旧 `issued` 不构成新保障、不得人工绕过等断言保留。
- 未改生产实现、业务规则或 UI。继续使用此前 Dot 已目检的门禁截图 `design/step4-review-photos/step4-05-insurance-gate.png`；本片没有重做截图。
- 本地隔离 PostgreSQL 17.11 / Redis 8.10.2 应用迁移 001–017，验收脚本通过 **554 项断言**；`npm test` 8/8、`npm run check` 与 `git diff --check` 通过。GitHub Actions [run 40186663165](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40186663165) 的 `acceptance` job `121148792529` 成功，输出 554 项断言通过。
- 状态：待 Dot 对补充状态矩阵独立复核。本记录不是 Muse 验收、真实保单核验或第 4 步 v2 全量通过；未接真实保险服务。

### 成行五态联调（代码提交 `1a5bcdb`，数据库 CI 与双平台构建通过，待 Dot 复核）

- 订单行程接口仅在服务端已写入 `shortfall` 快照且班次仍为 `handling_shortfall` 时返回冻结差额；钓友行程页以“平台可核验金额尚差 ¥X，班次待处置”显示该数，不把船长线下自报金额计入自动成行。
- 隔离数据库脚本核对 18:00（Asia/Shanghai）确认点前的待确认状态、自动成行、船长已确认成行、8 席全部付款但平台账低于门槛的待处置状态，以及成行后的天气取消独立状态。8 席样例：票款 ¥40.00、平台净额 ¥36.00、门槛 ¥50.00、差额 ¥14.00；登记 ¥14.00 线下账只支持船长确认，不改变平台账。自动成行样例为平台净票款 ¥45.00＋本航次违约金池 ¥6.00，超过 ¥50.00 门槛。
- 天气取消用例仅在隔离测试夹具中把已经自动成行的记录改为 `weather_cancelled`，通过真实订单行程 API 检查独立状态，并核对原自动成行快照与已付订单仍在。天气触发条件、决策人、通知、改期与退款 SOP 尚未批准；本提交没有增加天气取消接口或资金处置。
- 本地迁移 001–017 的空数据库验收通过 **574 项断言**；`npm test` 8/8、`npm run check`、`git diff --check`、Flutter 单测 2 项、`flutter analyze --no-pub` 和 Dart 格式检查通过。iPhone Duo（iOS 27.1 模拟器）通过真实本地 API/PostgreSQL/Redis 的 `flutter drive` 补差完整流程；新截图 `21-step4-formation-shortfall.png`（372,819 字节）展示冻结差额，刷新后的 18–20 号原生截图展示补差中及服务端确认成行。四张均为 1398×2034 PNG、小于 1 MB，未压缩。
- GitHub Actions 空库验收 [run 40187392359](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40187392359) 成功，输出 **571 项断言通过**；CI 未启用只用于本地原生截图的三项夹具断言。本机启用截图夹具共通过 574 项。Flutter 双平台构建 [run 40187392338](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40187392338) 全部成功：analyze（含 Flutter 回归测试）、iOS simulator build 与 Android debug APK build 均通过。状态保持待 Dot 复核，不代表 Muse 或创始人验收，也不代表天气取消流程获准。

### 切片 2–4 定点跟进（代码提交 `fef5f58`，CI 通过，待 Dot 复核）

- 切片 2 接受未出航的 `open`、`confirmed`、`captain_confirmed` 订单取消，沿用既有退款/违约金阶梯；确认后不改写冻结快照或班次确认状态，且仅在原 F01 截止前释放候补资格。切片 3 只更正评审请求的能力描述：GET 状态未提供人工放行字段，实际出航动作的保险强制约束仍未验证/接通；本提交未实现该门禁。
- 切片 4 完成确认点前平台账达标提示、`captain_confirmed` 的 `platformGuarantee:false` 与双端解释文案，并让船长确认班次使用既有支持的清单、名单、出航打卡和登船门禁入口。iOS 沙盒 API 原生截图为 22–23 号；更新的 18–21 号图与其余回归结果见 `docs/step4-slices2-4-followup-review-request-2026-10-25.md`。
- 本地隔离数据库验收 616 项；GitHub Actions [run 40192792416](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40192792416) 通过 612 项。差异是本地截图夹具额外的 4 项检查：3 项夹具状态检查和补差轮次 API 的 1 项响应状态检查。双平台构建 [run 40192792442](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40192792442) 的 analyze、iOS simulator 与 Android debug APK jobs 均成功。
- 状态：等待 Dot 复核；没有记录 Muse 或创始人验收。切片 3 的真实出航门禁仍未接通；无真实保险、支付或退款服务，也不构成第 4 步 v2 全量验收。

### 切片 3 保险出航 POST 个人级门禁修复（代码提交 `0d46add7ea545a87dec5068c30bda3a98f36680a`，CI 通过，待 Dot 定点复核）

- 船长出航 POST 现在必须提交完整且不重复的已支付乘客名单。服务端锁定班次、航次必需保障和乘客保障后，按当前出航与返航时段核验：航次保障缺失、待核实或失败时整船返回 409；航次保障有效时，逐名记录准入结果，保障有效者获准，未投保、待核实、失败或不属于当前时段者被阻断。
- 只要至少一名乘客保障有效，该班次可按获准乘客出航；阻断者有乘客级决定记录，且不进入出航后的实际名单。无人获准时返回 409，只保留预期的乘客阻断决定，不写 `departed` 事件或改变班次状态。门禁没有取消订单、退款或重算成团。
- `confirmed` 与 `captain_confirmed` 均覆盖；全员有效、重复出航请求、客户端伪造保障状态、旧订单级 `issued` 不适用于新时段，以及保障更新与出航两种并发顺序均有验收。保障更新和出航使用班次优先的统一锁顺序，准入读取发生在同一事务持有锁期间。
- 迁移 `018_departure_passenger_boardings.sql` 新增当前准入结果表。船长出航弹层展示被阻断乘客和可继续出航人数；widget 交互用例 `app/test/step4_insurance_gate_test.dart` 验证阻断提示、确认按钮人数和完整乘客名单提交。此次没有生成单独原生截图。
- 本地：隔离 PostgreSQL 17.11 / Redis 验收通过 **709 项断言**；`npm run check`、`npm test`（8/8）、Flutter 回归/widget 测试、`flutter analyze --no-pub` 和 `git diff --check` 通过。
- GitHub Actions 数据库验收 [run 40213532254](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40213532254) 对固定代码提交成功；`acceptance` job `121229676333` 日志确认迁移 018 已应用，**709 项断言通过**。双平台工作流 [run 40213532287](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40213532287) 的 analyze（含 Flutter 回归测试）、iOS simulator 与 Android debug APK jobs 均成功。
- 状态：待 Dot 对本次修复定点复核；不记为 Muse/创始人验收或 D 闭环完成。仅限沙盒准入记录，不接真实保险、不出真实保单、不碰真实资金，也不构成第 4 步 v2 全量验收。

