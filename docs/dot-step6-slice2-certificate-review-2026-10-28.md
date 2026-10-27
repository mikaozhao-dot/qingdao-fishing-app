# Dot 独立定点复核：第6步切片2渔获证书（2026-10-28）

## 结论：暂不整体技术通过，三项最小修复后交回差量复核

固定实现：`458c4a2d626d6f88f70e598af372f32efd030830`。已确认[正式请求1bdc1e77](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/1bdc1e7709a9438659af9929e197d50a6d2533f1/docs/dot-review-request-step6-slice2-certificate-2026-10-27.md)生效及[Muse评审](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/77f3b534261e46571ba2be0452ad63adf92f2092/docs/ui-design-review-1bdc1e77.md)。不是等待草案生效；本次即正式回复。复核前main为77f3b534，固定实现之后仅文档/截图变化。

两条CI原始日志核查通过，但绿灯未覆盖以下边界，不能据此整体放行。以下行为反例为源码确定路径的静态复核，Dot未在本执行环境启动App/数据库运行复现。

## 必修项

### S6-S2-R1：证书静默截断的是前4条来源记录，不只是超过4种鱼

[CertificateArtwork 602–604](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/458c4a2d626d6f88f70e598af372f32efd030830/app/lib/step6_certificate_flow.dart#L602-L604)将itemCount限制为4；记录区不可滚动，PNG只捕获当前证书RepaintBoundary，无剩余条数提示、下一页或完整明细。服务端完整fishItems快照没有丢失，但用户看到/分享的图会遗漏事实。

确定边界：5条合法fishItems，第5条不会构建；本人记录和本人补充/船长确认是分别追加的来源行，同一种鱼可出现多行，因此即使不足5个不同鱼种也可触发。不能将修复范围只定为“超过4种鱼”。

建议完整呈现所有来源行（自适应高度、分页或另定清楚的摘要设计）；若产品选择只出摘要，必须明确标识未展示记录与完整信息获取方式，不能静默省略。具体视觉方案由Muse/创始人定性，Dot不替选产品方案；未定性/未修复前该项开放。最小用例覆盖1/4/5条、同鱼不同来源超过4条，以及实际图像输出的可见内容/不溢出，不仅检查快照长度。

### S6-S2-R2：生成成功返回“我的证书”后列表不会自动刷新

[中心页95–105](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/458c4a2d626d6f88f70e598af372f32efd030830/app/lib/step6_certificate_flow.dart#L95-L105)只在push结果为true时_load；预览页生成方法仅更新自身snapshot/id，成功后没有返回true的接线，AppBar/系统返回默认返回null。故“列表→预览→生成成功→返回”仍保留旧可生成航次和旧已生成列表，直到用户手动刷新/重进。没有证据表明后端重复发证（后端唯一键仍保护），但这是主流程界面状态缺陷。

最小修复：成功生成后返回路径携带变更信号或返回时安全刷新；覆盖AppBar/系统返回和不生成返回，断言新证书出现、原可生成项消失。现widget只测生成后分享，未覆盖返回。

### S6-S2-R3：本人可生成航次被全站最近100航次截断

[服务端265–286](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/458c4a2d626d6f88f70e598af372f32efd030830/server/src/step6-certificate-routes.js#L265-L286)先查询全站有门禁乘客的已完成航次并LIMIT100，再逐条loadCertificateFacts匹配当前用户。反例：本人有1个符合条件的旧航次，其他用户另有100个更晚已完成航次，列表的eligibleDepartures漏掉本人的航次，虽然直接preview可成功。

最小修复：分页/限额必须在正确本人候选范围内处理，或继续分页查找，不把其他用户航次消耗本人的候选额度；不得以只按购票人userId过滤替代实名乘客匹配（可能代订）。补“本人旧航次+100个他人新航次”定向fixture，确认无他人数据泄露且本人项仍可达。

## 对Muse四个问题逐项答复

1. **截断**：见R1，事实不完整，不能默认可接受；且应称来源行而非鱼种数。
2. **本人记录与补充**：代码[155–202](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/458c4a2d626d6f88f70e598af372f32efd030830/server/src/step6-certificate-routes.js#L155-L202)是追加带source标签的行，不是算术相加或同鱼合计。Step5合法写入可同时产生本人报告与本人补充；不能未经规则决定就按鱼种相加（可能同一事实）或去重（可能独立事实）。当前保留来源标签、不声称个人总计的做法可作为已披露保守口径；需补混合来源fixture证明标签/数量忠实、与R1展示策略相容。已有补充测试只覆盖无本人报告的单源补充。
3. **其他乘客待核对**：anyPending只拦截船长整船确认源，不拦截请求者自身非待核对报告/补充；本人pending仍不入证书。可认可当前保守排除共享船长事实的技术实现，不扩称“全航次所有证书都禁用”，也不替创始人改变事实口径。
4. **隐藏仍占唯一键**：与“只从列表隐藏、冻结快照保留、不撤码”相容。列表不再显示/不再列为可生成，但直接本人preview/POST返回原hidden证书，不会生成新快照；不是彻底删除或撤销分享码。无需为了隐藏自动再生；产品若需恢复入口另行明确，不自行增加。

## 已核通过的范围和证据限制

- 服务端要求completed及同船长出/返航打卡；实名解密匹配实际乘客与allowed门禁，不只按下单人；本人/明确确认船长源/本人补充均来自事实表，无输入鱼种数量路径。
- 已生成快照重复POST返回原数据；属主+航次唯一键及事务防止重复行。公开响应不返回内部订单/乘客引用；snapshot只含展示字段与推广码等，不能据此保证用户自选昵称绝不含个人信息。
- 025新增证书表与索引，同时**修改两张既有表的source_channel CHECK约束**以追加certificate，并非字面“完全不改既有表”；这是所需枚举扩展，无既有事实重写/费率变更。既有推广服务计佣代码未改，source仅新增certificate。
- 实读33项证书脚本：无记录/零渔获/pending/未返航/他人乘客拒绝、本人预览与快照、重复生成、源字段、隐藏不撤码、船长确认/补充及全航次待核对案例。它只验证certificate H5触点写入；没有执行本证书码后续claim自推/重复归因/首单计佣全链。现334项推广回归不等于certificate主链专用用例已跑。请随本轮修复补一个复用既有推广接口的certificate来源定向关联用例，不要求重写推广模块或生产测试。
- Flutter新增测试使用MockClient、注入imageEncoder返回4字节PNG签名、注入分享回调；证明参数/交互接线，不证明真实PNG编码可解码、设备分享保存或扫码成功。已实际查看移动列表、预览和成品三张PNG：三条样例内容与二维码可见，无明显溢出；这是Web固定样例，不是原生实测，也未覆盖4/5条边界。宽屏列表本轮未像素目检。不因截图存在宣称设备保存/分享实测。

## 两条CI原始日志（精确实现SHA）

四个job的checkout均为458c4a2d626d6f88f70e598af372f32efd030830，非仅看run绿灯：
- [数据库run40527102743 / job122269528328](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40527102743/job/122269528328)：Step4 **710**，Step5 **133**，直播 **77**，推广 **334**，024迁移fixture **33**，本切片证书 **33**项通过。
- [Flutter run40527160072 / analyze122269744467](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40527160072/job/122269744467)：**28 tests passed**；analyze **No issues found**。
- 同run [iOS job122269744797](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40527160072/job/122269744797) 成功产出Simulator Runner.app；[Android job122269744914](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40527160072/job/122269744914)成功产出debug APK。均为构建，不是新设备端到端验收。
- 本地check/10单测等仍为交付方报告，Dot未重新运行。旧失败run不冒称为最终SHA失败。

## 接力

请Muse/Luna沿本切片处理R1–R3最小修复及上述受影响定向补证，固定新SHA、更新对应CI后交回差量复核；不另开重复功能、不推进下一切片。R1产品展示定性与创始人最终验收仍由有权者完成。切片1已记录的限定风险接受不被此文重写为技术验证通过；H5、真实资金、保险及生产授权边界不变。本次只新增独立评审文档，无代码、规则或运行环境变更。


## 2026-10-28 06:56 CST 巡检差量：aac590ac（尚非通过结论）

固定实现：[aac590ac9874d9707833c0b5c14282e764bfeab1](https://github.com/mikaozhao-dot/qingdao-fishing-app/commit/aac590ac9874d9707833c0b5c14282e764bfeab1)。Dot 已静态读取这次 4 文件差量及数据库 CI 原始日志；没有自行运行测试或修改实现。该提交尚不含新正式送审回执，以下反馈直接针对已收到的实际代码，不等待转述。

- **R2：修复方向及定向用例已收到，暂不关闭。** 预览页新增生成标记及 PopScope，在生成后 AppBar/系统返回时传回 true；中心原有 changed==true 刷新逻辑因此可被触发。新增 widget 用例覆盖生成后两种返回，以及未生成返回不刷新。此刻同 SHA Flutter run [40598302378](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40598302378) 仍运行中，不将代码存在等同测试通过；也不将 widget 返回测试等同原生手势实测。
- **R3：原静态反例的修复方向已收到，执行证据尚未成立。** 候选查询改为按 departure_at、id 降序 keyset 分页，继续匹配实际乘客，直到收集 100 个合格航次或候选耗尽，不再被全局首 100 条直接截断。新夹具包含本人旧航次由另一账号代订、100 条他人较新航次，检查旧航次仍可见。仍逐候选读取事实，未做规模性能验证。
- **证书来源补证：** 新脚本已加入 certificate touch→claim、重复领取、自荐排除及首单佣金来源/比例/冻结状态断言；这是已读测试代码，不是本次已执行通过的结果。

### 本轮已确认的 CI 阻点（请沿原回修任务处理）

同 SHA 数据库 run [40598302377](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40598302377)，原始 job [122519733488](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40598302377/job/122519733488) 已失败。checkout 日志明确为 aac590ac；前序 Step4 710、Step5 133、live 77、promotion 334、refund migration 33 断言通过，但 certificate 脚本在第 279 行首次 makeUser（第 57 行 INSERT）即报 PostgreSQL 23505：users_identity_number_hash_unique_idx 冲突。因此不能引用旧 33 断言或新增断言数量为本次证书通过证据，后面的 R3/归因新增用例也未执行到。

此次 makeUser 新增写入 identity_number_hash，而身份号仍来自脚本内递增序列。请检查共享验收数据库中测试身份的命名空间/隔离与清理，使夹具与既存唯一约束兼容；**不要删改真实身份唯一约束以让测试通过**。这里只确认实际冲突及其发生位置，不据此推断线上身份或计佣逻辑已坏。沿原任务提交修正后的固定 SHA 和对应 CI 即可，不新增整套无关复测要求。

R1 展示选择与 1/4/5 来源行、同鱼多来源、真实成图边界证据仍按原评审，未见本次决定或实现；Dot 不代选。整体仍暂不技术通过。切片 1 的风险接受口径不变，不作下一切片或生产许可。
