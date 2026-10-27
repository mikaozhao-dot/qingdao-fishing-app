# Dot 独立定点复核：Step 6 切片 1 修复回单（2026-10-26）

> 最新状态见文末“B 修复及024补证定点复核：63d17328”：本批B回修限定沙盒技术通过，B-R1/B-E1关闭；此前R1/R2/R3关闭保持，R4原生证据仍开放。不关单、不进切片2。


## 结论：暂不整体通过，R1 迁移漏项与 R4 原生链路补证仍开放

给 Muse / Luna：本轮实读固定代码 `6da12f70d63c3347771d2f4ebf20bec6e280b0ce`、迁移、用例和四个 CI job 原始日志。R2 可关闭；R3 原两条误报反例可关闭；R1 新写入路径已有修复，但升级迁移仍漏掉可恢复的历史资格；R4 配置修复通过，原要求的原生端到端证据仍缺，不能整体关闭。本结论不批准切片 2、产品验收、真实资金/打款或生产。

回执提交 [`1db3ec9`](https://github.com/mikaozhao-dot/qingdao-fishing-app/commit/1db3ec9213097871f4ed4ac5f86cdbf16318e5a0) 是文档，不是代码 SHA。代码后两笔提交仅改 README、交付回执和 Muse 评审。复核前 main 仍为 `1db3ec9`；检索 2026-10-26 14:10 UTC 后提交未发现已发布的本轮 Dot 复核，避免重复出结论。

## R1：新路径有效；升级历史数据仍有一个确定漏项（必须补）

[迁移 022，第 21–30 行](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/6da12f70d63c3347771d2f4ebf20bec6e280b0ce/server/migrations/022_step6_promotion_identity_and_refund_baseline.sql#L21-L30) 只为 **当前账本 `amount_fen > 0`** 的归因补种资格，不等于“历史曾消费资格”。这与 [新服务路径](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/6da12f70d63c3347771d2f4ebf20bec6e280b0ce/server/src/promotion-service.js#L94-L127) 在正佣金时永久消费身份、退款不删除消费事实的语义不一致。

可由代码确定、但本次未实际运行的升级反例：

1. 旧版本 A 用 X 实名并产生正佣金，随后冻结期全退，账本变为 `reversed / amount_fen=0`；A 的 X 尚未被更正，`qualified_at` / 历史 `commission_created` 事实仍在。
2. 升级 022：因当前金额为 0，该行被排除，X 未写入资格表。
3. 升级后 A 更正为 Y；[实名接口仍允许更正并同步](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/6da12f70d63c3347771d2f4ebf20bec6e280b0ce/server/src/step1-routes.js#L302-L339)，但原单净佣金为 0，服务跳过资格插入。
4. B 再用 X 实名并支付首单，资格表不存在 X，可产生第二次消费。

**这不是 Q1 所披露的“迁移前身份已经被替换、无法恢复”**：此例迁移时 X 完整存在，曾计佣事实也存在，是可修复的回填筛选遗漏。请沿 R1 修复升级路径，以历史资格事实而非当前余额识别已消费资格，并补旧版本数据 → 升级 → 更正身份 → B 复用的升级 fixture；含已归零与仍正额、未曾计佣三种对照。已应用 022 的数据库也须有可验证的补救路径，不仅修改未执行的初始化迁移。不得借此选择退款重订 A/B 或禁止实名更正。

已有证据认可：[验收 233–293 行](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/6da12f70d63c3347771d2f4ebf20bec6e280b0ce/server/scripts/step6-promotion-acceptance.mjs#L233-L293) 覆盖新路径 A/X→A/Y→B/X 排除；身份摘要主键、用户/归因唯一约束及插入冲突检查提供幂等与竞争保护。但资格竞争用例是**直接并发 SQL 插入**，不是两套真实 API 同时完成资格流程；CI 空库先迁移后造数据，也没有验证上述旧库升级反例。

### Q1 裁定边界

不能把“身份已丢失”的声明视为历史去重全面通过，也不能将上述可恢复漏项并入残留风险。无法从现有记录恢复的旧身份可继续作为**明确披露、未验证的沙盒历史风险**保留，不要求凭空重建数据；但本轮不作真实历史数据迁移安全批准。请提供影响范围/已有数据核对或明确隔离处置证据；真实数据风险接受仍需相应授权。无论如何，先补可恢复漏种。

## R2：原反例关闭（代码与 widget 接线层面）

[AppShell](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/6da12f70d63c3347771d2f4ebf20bec6e280b0ce/app/lib/main.dart#L179-L224) 已读取响应，仅 `claimed=true` / `already_attributed` 视为终态；无效结果不写入 claimed 缓存，旧请求只清理自己的 pending，并循环处理期间到达的新 token。

[接线测试](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/6da12f70d63c3347771d2f4ebf20bec6e280b0ce/app/test/main_app_promotion_attribution_test.dart) 覆盖冷启动注入→登录→自推无效→同 token 再投递成功，以及旧无效请求在途时收到新 token。CI 原始日志中这两项均成功。这里的“可重试”是后续触点再次投递可处理，不应描述为无效请求无限自动重试。未声称真实插件/设备跳转通过。

## R3：两条历史退款误报反例关闭（限定现有异常标记语义）

[异常分支](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/6da12f70d63c3347771d2f4ebf20bec6e280b0ce/server/src/promotion-service.js#L181-L200) 限定已解冻/提现状态并比较解冻退款基线；[两条释放路径](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/6da12f70d63c3347771d2f4ebf20bec6e280b0ce/server/src/promotion-service.js#L208-L266) 均记录基线。冻结期全退反复同步、解冻前部分退款后无新增退款，均不应再误报；[验收](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/6da12f70d63c3347771d2f4ebf20bec6e280b0ce/server/scripts/step6-promotion-acceptance.mjs#L305-L397) 和 [全退反例](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/6da12f70d63c3347771d2f4ebf20bec6e280b0ce/server/scripts/step6-promotion-acceptance.mjs#L446-L468) 对应原要求，CI 通过。

**Q2：接受本切片“一账本曾发生解冻后退款异常”的布尔语义**，不在本次擅自扩成逐笔退款审计。首条事件只描述首次检测到的新增差额，后续另一笔退款不会产生第二条事件；不得把该事件金额合计当成完整的解冻后累计退款或逐笔流水。若后续需逐笔审计，另按审批明确范围。现有规则“不追缴、不扣款”不变。迁移给旧已解冻行采用迁移时累计退款为基线，不证明已重建真实历史解冻时点退款；旧异常修复/历史重建未获本轮验证。

## R4：配置修复通过，原生链路证据未完成

Android / iOS 默认深链开关已置 false，配置断言与两端构建通过（[客户端修复提交](https://github.com/mikaozhao-dot/qingdao-fishing-app/commit/6da12f70d63c3347771d2f4ebf20bec6e280b0ce)）。但注入式 URI 流 + mocked API 的 widget 测试绕过真实插件和设备，不能替代 **H5 点击→原生冷/热启动→token 保留→登录后真实 claim**。

回执对此披露准确，认可其没有冒充真机结果；**如实披露不等于完成原补证要求**。R4 配置部分关闭、交互证据部分保持开放。请补相应固定构建在 iOS/Android 的冷/热路径证据（环境/构建 SHA、步骤、画面与 claim 结果；令牌脱敏），或由有权方明确变更验收边界。本复核不自行豁免。

## 随修复补证核对

- **提现负向**：[脚本 348–397 行](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/6da12f70d63c3347771d2f4ebf20bec6e280b0ce/server/scripts/step6-promotion-acceptance.mjs#L348-L397) 包含并发一胜一拒、他人账本、无/错管理员口令、非法流转、拒绝后重申、重复标记。认可沙盒覆盖，不等同真实打款。
- **返航 + 7 天**：脚本精确比较返航时间加 7 天，并调整返航 fixture 测边界前后 ±60 秒；不再直接改 `release_at` 冒充计算验证。
- **互推并发**：[脚本末段](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/6da12f70d63c3347771d2f4ebf20bec6e280b0ce/server/scripts/step6-promotion-acceptance.mjs#L494-L526) 并发读看板后重试，两账本 available；服务释放查询使用 `SKIP LOCKED`。认可此回归，不把未复现的风险称为已发生死锁，也不把一次测试解释为全部并发交错证明。
- **海报**：[widget 测试](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/6da12f70d63c3347771d2f4ebf20bec6e280b0ce/app/test/promotion_flow_test.dart#L120-L208) 实际渲染 PNG，断言魔数、大小及分享回调文件 MIME/名称。编码/分享通过测试注入；没有原生保存/系统分享面板目检，不能称真机分享验收。

## 已实读原始 CI（四个 job 均实际检出同一完整代码 SHA）

| 证据 | 实际结果 |
| --- | --- |
| [数据库 run 40333231826 / job 121607856817](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40333231826/job/121607856817) | 022 已应用；Step 4 709、Step 5 133、直播 77、推广 182 项断言通过 |
| [Flutter analyze job 121605476997](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40332556101/job/121605476997) | 26 tests passed；No issues found |
| [Android job 121605476350](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40332556101/job/121605476350) | debug APK 构建成功 |
| [iOS job 121605476673](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40332556101/job/121605476673) | simulator Runner.app 构建成功 |

回执的本地 Step 4 710、npm 10/10 等保留为 Luna 本地报告，不冒充本次独立运行。CI 数字核实不代表未覆盖升级反例通过。

## 状态与下一步

Muse 请同步本结论：**R1 保留、R2 关闭、R3 原误报反例关闭、R4 配置已修且原生链路补证开放；整体暂不通过。** Luna 沿原切片修复 R1 升级漏项并补 R4，不另开重复开发范围。

H5 免下载首单仍未交付/未验收；本轮不扩围实现整套 H5。退款重订 A/B 仍待创始人选择，marina 是正本已有渠道而非新待裁定项。切片不关闭、不进入切片 2。

本次仅独立静态审查与 CI 原始日志核查，未在本执行环境重跑空库、升级 fixture、Flutter、真机或交互模拟器，未做截图视觉验收。以上升级缺陷是源码可确定的路径，不冒称已在运行环境复现。

## 增量复核：`4d75e579`（2026-10-26 16:42 UTC / 2026-10-27 00:42 CST）

**当前结论：R1 原静态漏种条件已被代码针对修正，升级验收仍待交；R4 原生交互补证仍开放，暂不整体通过。** 不应继续把上文针对 `6da12f70` 的“仅按当前金额回填”描述为新 SHA 仍未修改，也不应因新 CI 绿色提前关闭 R1。

### 提交及交付阶段

已核 main 为 [`4d75e5795734592847adc490c86ac3d29fa573f7`](https://github.com/mikaozhao-dot/qingdao-fishing-app/commit/4d75e5795734592847adc490c86ac3d29fa573f7)。该代码提交只改 `app/pubspec.yaml`、`app/pubspec.lock` 和新增 migration 023；未改业务服务、测试脚本或交付回执。

[本轮开工回执](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/4d75e5795734592847adc490c86ac3d29fa573f7/docs/step6-slice1-r1-upgrade-fix-ack-2026-10-26.md) 明确分三批提交：开工范围、实现代码、升级 fixture/回归/交付回执。因此当前是中间代码批次，不把尚待下一笔提交的证据描述成“最终交付已失败”。交付回执仍只记录 `6da12f70`，尚未收到这一批的新完整复核请求。[Muse 对 1db3ec92 的“通过”](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/4d75e5795734592847adc490c86ac3d29fa573f7/docs/ui-design-review-1db3ec92.md) 仅为旧证据文档补齐，不是本次新代码或 R1/R4 的技术放行。

### R1：代码层面认可的进展与关闭条件

[023 全文](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/4d75e5795734592847adc490c86ac3d29fa573f7/server/migrations/023_backfill_historic_promotion_identity_qualifications.sql#L1-L24) 将筛选改为当前正余额、非空 `qualified_at`、或历史正额 `commission_created` 事件三者之一，并从仍已核验用户取身份摘要；不再漏掉“曾正额计佣、冻结期全退归零、原身份仍在”的原反例。新的编号迁移可作用于已应用 022 的库，且 `ON CONFLICT DO NOTHING` 保留已有消费事实，满足不只修改初始化 SQL 的方向。

**未关闭的部分是证据，不是重复要求重写这段筛选。** 最新源码比对无新增升级 fixture；实读 `step6-promotion-acceptance.mjs` 也没有 022→023 升级测试。本次 CI 在验收数据生成之前先应用全部迁移，故“023 应用成功 + 182 项通过”不能证明有历史数据的回填反例已经执行。

沿既定计划补交即可：022 状态下的仍正额、历史正额后全退、从未计佣三组；验证 023 的选中/排除及重复执行不增行，再走 A/X→A/Y→B/X 的实际 API 拒绝链。历史事件备用路径最好单独覆盖，避免只依赖 `qualified_at` 而遗漏该分支。旧身份已经丢失的 Q1 风险边界不因 023 自动消失；不据此改变退款重订 A/B。

### app_links 跨主版本升级对 R4 的影响

依赖约束由 `^6.4.1` 改为 `^7.0.0`，锁文件实际为 **7.2.2**，并非只改迁移。已查看维护者[官方 changelog](https://pub.dev/packages/app_links/changelog)：7.x 涉及 iOS scene 生命周期与最低 SDK 更新；7.2.2 更改早期链接缓冲、Android Activity 重建重发以及 iOS 链接/engine 行为。官方[7.x iOS 配置文档](https://github.com/llfbandit/app_links/blob/main/doc/README_ios_7.md)仍要求关闭 Flutter 默认深链，支持 application/scene 两种生命周期，不能因为升级而移除既有 false 配置。

CI 用 Flutter **3.47.8**，双端构建与既有 26 项回归成功，未见这批提交带来的构建阻断；但注入式 widget 仍绕过真实插件分发。升级既不能证明 R4 已完成，也不能据此断言发生了新的原生故障。R4 后续证据应绑定 **7.2.2 的当前构建 SHA**，至少包含原要求的 H5→冷/热启动→token→登录→真实 claim，并检查重复链接/重建后不重复归因；无需另开全套新业务范围。

### 新 SHA 原始 CI，已独立实读

| 原始日志 | 核实结果 |
| --- | --- |
| [数据库 run 40360278983 / job 121703529329](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40360278983/job/121703529329) | 实际检出完整 `4d75e579…`；023 应用成功；Step 4 **710**、Step 5 **133**、直播 **77**、推广 **182** 项 |
| [Flutter job 121703529519](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40360278886/job/121703529519) | 同 SHA；**26 tests passed**，**No issues found** |
| [iOS job 121703529051](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40360278886/job/121703529051) | 同 SHA；模拟器构建成功 |
| [Android job 121703529704](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40360278886/job/121703529704) | 同 SHA；debug APK 构建成功 |

710 是本次新 run 的实际输出，不覆盖此前 run 的 709，也不据此推断旧差额原因。

### 给 Muse / Luna 的当前状态

请保留原开工计划，提交剩余升级 fixture、对应执行结果和新交付回执；R4 仍按实际原生证据收口。R2/R3 本次无相应实现改动且回归通过，维持上次限定结论。本增量仅静态代码/文档审查、官方依赖文档核查和原始 CI 实读，未独立运行升级库或原生交互。切片不关闭、不进入切片 2，不构成产品验收、业务规则变更或生产授权。


## 补证终轮定点复核：`db9972ab`（2026-10-26 17:43 UTC / 2026-10-27 01:43 CST）

**R1 历史全退资格升级漏种在限定沙盒技术范围关闭。R2/R3 维持已关闭的限定结论。R4 配置及非原生回归通过，原生双端证据尚未完整收口；不整体关单、不进切片 2。**

本次对象为测试/验收提交 [`db9972abf356cd546f64edb403230287813cfea5`](https://github.com/mikaozhao-dot/qingdao-fishing-app/commit/db9972abf356cd546f64edb403230287813cfea5) 和回执 [`f1eb302d`](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/f1eb302d5b0c7acb99b6dfa94671e024a1531c64/docs/step6-slice1-dot-followup-2026-10-27.md)。写入前 main 为 `f1eb302d`。已比对 `4d75e579→db9972ab`：App 运行时代码、插件版本与 migration 023 未再改变，新增测试、夹具、截图及文档。因此不会把仅测试变化要求为一次新的原生运行时代码验证。

### R1：所要求的升级证据已经具备，不再重复索要

已逐段实读 [验收脚本 550–741 行](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/db9972abf356cd546f64edb403230287813cfea5/server/scripts/step6-promotion-acceptance.mjs#L550-L741)：

- 通过实际沙盒接口构造正佣金、历史正佣金后冻结期全退归零、实名但从未计佣对照。
- 另构造全退后 `qualified_at=NULL`、仅正额 `commission_created` 事件仍在的对照，独立覆盖事件备用分支。
- 在隔离库中删除两条应漏种的资格及 023 迁移记录，模拟 022 后漏种状态，再调用真实 `server/src/migrate.js`；断言原身份摘要被补回、正余额原记录保留、未计佣身份未被消费。
- 再次删除 023 版本记录并重跑真实迁移入口，断言总资格数不增且事件备用行仍只有一条。
- 回填后通过实名 API 执行 A/X→A/Y，再让 B 使用 X 付首单；结果为 `identity_already_qualified`，第二份佣金账本数为 0。

这不是直接使用旧版本服务从零部署的历史重放，而是**可控升级状态 fixture + 真实迁移执行 + 实际 API 后验**，足以验证本次明确的可恢复漏种反例。原始 CI 已执行含这些断言的完整脚本并通过 251 项，故 R1 本次缺陷及补证可关闭。不要求重新做相同 fixture。Q1 中已丢失历史摘要的真实数据仍不在可恢复证明范围，本次仍不构成真实数据风险接受或生产迁移批准。

### R4 重复归因回归：认可实际层级，不越级解释

[新增 widget](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/db9972abf356cd546f64edb403230287813cfea5/app/test/main_app_promotion_attribution_test.dart#L198-L279) 在同一 AppShell 中重复投递相同链接，确认不再请求；销毁并重建 AppShell 后重新登录，允许一次新请求并处理 mocked `already_attributed`。测试中“不新增归因”使用的是 mock 内存 Set，不能单独证明真实服务端幂等。

真实服务端的独立证明来自 [验收 210–225 行](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/db9972abf356cd546f64edb403230287813cfea5/server/scripts/step6-promotion-acceptance.mjs#L210-L225)：重复实际 claim 返回 `already_attributed`，并查数据库确认归因只有一条。两层证据合起来满足本轮重复归因补证；仍不是 Android Activity 重建或真实插件分发测试。

### iOS 证据已提交；独立核验到哪里

[原生回执](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/db9972abf356cd546f64edb403230287813cfea5/docs/step6-slice1-r1-r4-followup-2026-10-27.md) 记录运行时代码 `4d75e579`、app_links 7.2.2、iOS 模拟器环境，以及 Safari H5 冷/热启动、登录、claim 和数据库状态核对。该运行时代码与本次测试 SHA 的 App 实现一致，故不因测试文件变化要求重复跑 iOS。

Dot 已实际查看 [cold PNG](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/db9972abf356cd546f64edb403230287813cfea5/docs/evidence/step6-slice1-r4/ios-cold-claim-account.png) 和 [hot PNG](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/db9972abf356cd546f64edb403230287813cfea5/docs/evidence/step6-slice1-r4/ios-hot-claim-account.png)：二者展示登录态“我的/账号与入驻”，无账户或访客 token。它们支持“App 处于登录态”的画面事实，**不能单独证明来自 H5 的冷/热启动过程、具体 claim 或数据库结果**。这部分端到端成功当前仍是 Luna 书面运行报告，不写成 Dot 独立复现或已核实请求链。

H5 PNG 在仓库树中存在，大小 1,814,379 bytes；当前 GitHub connector 对该文件 base64 内容返回空，二进制/Blob 读取不支持，因此本次未目检该图，不将读取限制归责为图片损坏。仓内该证据目录目前只有三张 PNG，未发现相应脱敏 claim 原始日志/SQL 结果或连贯操作记录。请优先补挂**已有实测**的最小脱敏证据（冷/热各自步骤与对应请求/数据库结果、构建关联）；无须因为本次工具读取限制或测试文件变化重新实施相同 iOS 测试。此为审计关联补齐，不否认报告已经做过实测。

Android 原生 H5 冷/热→登录/claim 仍未交付；回执明确本机无 SDK/adb/emulator/AVD，当前只有 APK 构建。此处保持原门槛，不把 widget 或 APK 当成设备证明，也不据此杜撰实际 Android 故障。

### 原始 CI 已逐 job 核实，同一完整 SHA `db9972abf356cd546f64edb403230287813cfea5`

| 证据 | 结果 |
| --- | --- |
| [数据库 run 40364146459 / job 121717159381](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40364146459/job/121717159381) | 实际 checkout 同 SHA；Step 4 **710**、Step 5 **133**、直播 **77**、Step 6 **251** 项通过 |
| [Flutter job 121717162424](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40364147015/job/121717162424) | 同 SHA；**27 tests passed**；**No issues found** |
| [Android job 121717162656](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40364147015/job/121717162656) | 同 SHA；debug APK 构建成功 |
| [iOS job 121717162964](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40364147015/job/121717162964) | 同 SHA；simulator Runner.app 构建成功 |

本地 Flutter analysis server 故障与直接 `dart analyze` 成功是回执报告，未冒充 Dot 独立执行；同 SHA CI 的 Flutter analyze 实际已通过。README 中段仍有“本轮同 SHA CI 待”的旧句，顶部及新回执已写成功：这是文档状态待对齐，不是要求重跑已成功 CI 的理由。

### 给 Muse 的收口状态

请按最新结论同步：**R1/R2/R3 限定技术项关闭；R4 配置、widget 和服务端幂等补证认可，Android 原生路径仍开放，iOS 已有运行报告与画面但完整链的可核验关联待补。** 本次不重复索要已通过的升级测试，不扩展 H5 免下载首单实现范围。产品验收、退款重订 A/B、切片 2 与生产授权均不由本技术复核代批。

Dot 本次进行了源码/夹具审查、同 SHA 原始 CI 核查和两张已取得图片的目检；未独立运行数据库或原生交互。上述范围与限制随结论一起保留。

### 与 Muse 后续巡检的对齐（2026-10-26 22:52 UTC）

已只读核对 main `437666ce6bbb7c8af888e92694631061c4a3f9ff` 的 [Muse 巡检](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/437666ce6bbb7c8af888e92694631061c4a3f9ff/docs/ui-design-review-f1eb302.md)。该提交只新增巡检文档，不改变本次受审实现、夹具或 CI。Muse 已明确列出已入仓的 Dot 增量 `e79a2b1b`，其“代码认可、证据待交”是较早阶段的正确历史状态；本节之前的 db9972ab 补证终轮结论用于更新这一阶段，不将 Muse 巡检当成 Dot 已经发布最终结论。

Muse 对 R1 夹具、双端证据边界与本次结论基本一致；但 AppShell 重建测试的服务器响应来自 mock，不能单独证明原生链路或真实服务端，真实幂等证据仍是上文实际 API + 数据库断言。Muse 未独立实读 CI；Dot 已在上文逐 job 核对，无需因旧文字要求重跑。Muse 将 README 描述为一致，不消除其中“同 SHA CI 仍待”的过期句；请只对齐文档状态，不重复跑已通过测试。

双方均未目检 1.81MB H5 图，不能将其记为已验证；即使补看单张 H5 图，也不能单独证明完整冷/热启动及 claim 链。R4 剩余收口仍按上述已有实测关联和 Android 原生证据办理。退款重订 A/B 仍由创始人决定，转述评审不构成该业务选择或下一切片授权。



## 退款重订 B 增量定点复核 — 4b628710

审阅时间：2026-10-26 23:40 UTC。初次核对 main 为 `2de9faeae8f634b49ae0741dff374649e374a6ce`；2026-10-27 04:03 UTC 再核 main 为 `2532fc183a691f8567e8a859462b79daef1a1b40`，其后只有 README 与复核追单文档变动，未新增修复代码、024夹具或原生证据。

### 结论

暂不作本批 B 技术整体通过：主路径代码和 304 项同 SHA CI 已核实，但发现“身份更正失败 + 已有后续订单 + 原首单全退”会跳过旧佣金冲正的确定静态路径；另有 migration 024 有数据升级及失败回滚未实际验证的独立证据缺口。前者是行为缺陷，后者是验证缺口，不混写。

比较基准为仓内 [B 决定单](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/2de9faeae8f634b49ae0741dff374649e374a6ce/docs/founder-decision-step6-slice1-refund-reorder-b-2026-10-27.md)，不由本技术审阅确认侧聊创始人授权真实性、代选业务口径或批准生产。受审代码 4b6287109352e8b77753f7a832afd25059317e96；[交付回执](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/f7f402aeb5153d107787d8f08c2310f9d6766835/docs/step6-slice1-refund-reorder-b-delivery-receipt-2026-10-27.md)；[Muse 巡检](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/2de9faeae8f634b49ae0741dff374649e374a6ce/docs/ui-design-review-f7f402ae.md)。

### B-R1：旧单已全退，身份守卫仍可阻断旧账本冲正（需最小修复）

[服务层 114–119 行](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/4b6287109352e8b77753f7a832afd25059317e96/server/src/promotion-service.js#L114-L119) 在新选中的有效订单存在、当前用户非 verified/无摘要时，更新归因为 pending 后直接返回；[旧账本冲正在 154 行](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/4b6287109352e8b77753f7a832afd25059317e96/server/src/promotion-service.js#L154)，位于该返回之后。

确定静态反例（本次未运行）：
1. A 实名有效，先支付 O1，产生冻结佣金；在 O1 仍未取消时支付 O2，O2 不另计佣。
2. A 再提交校验格式合法、沙盒序列 999 的实名样例，返回 rejected；[身份适配器](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/4b6287109352e8b77753f7a832afd25059317e96/server/src/identity-adapter.js#L21-L23) 与 [实名接口 329–339 行](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/4b6287109352e8b77753f7a832afd25059317e96/server/src/step1-routes.js#L329-L339) 会清空当前身份 hash，失败时不触发佣金同步。
3. A 在满足全退窗口时取消 O1（例如出航前超过72小时）。[真实取消接口](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/4b6287109352e8b77753f7a832afd25059317e96/server/src/step3-waitlist-routes.js#L237-L328) 只要求合法会话/订单状态，不要求当前 verified；先将 O1 cancelled、全额 ticket_refunded，再调用 sync。
4. B 选单逻辑转而取 O2，但身份守卫先返回，O1 旧账本仍 frozen、金额非零，未按全退归零。
5. 如果 O1 对应航次随后正常完成，[返航同步](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/4b6287109352e8b77753f7a832afd25059317e96/server/src/promotion-service.js#L306-L322) 仍按该历史订单找到 frozen/pending_unlock 账本；该查询及 syncCompletedCommission 不核订单取消/净票款，可把这一笔无效佣金推进待解冻/可用。

需要修复的是：旧订单全退的账务纠正不应依赖后续订单能否通过新资格守卫；未实名时不可创建新佣金，但也不可保留旧全退佣金。请用上述真实 API 顺序补反例，至少验证旧账本归零/反转、未实名 O2 不新增佣金、原航次返航不会恢复旧佣金；重新实名后本人合格重订可正常计佣。不得以禁止实名更正、取消实名要求或改费率解决。

此身份守卫与退款同步的弱点在旧代码也存在，本结论不宣称“完全由 B 新引入”。但它直接落在本批订单顺延、旧账本冲正受影响路径，违反新回执“旧全退佣金保持归零”的承诺。不是重新打开已关闭的 R1 历史身份消费去重问题。

### B-E1：migration 024 静态设计可理解，但缺有数据升级实证

[024](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/4b6287109352e8b77753f7a832afd25059317e96/server/migrations/024_step6_refund_reorder_commission_orders.sql) 在 BEGIN/COMMIT 内完成：增加 booking_order_id；按旧 attribution.order_id 回填；如仍为 NULL 则 RAISE EXCEPTION；再设 NOT NULL、每订单唯一、每归因至多一份非 reversed。

旧模型每归因至多一条账本，且旧服务将 order_id 固定，故用既有归因订单回填具有合理静态依据。零额历史账本仍有固定旧订单，换用 l.booking_order_id 后不随新首单漂移。无法映射时是在提交前抛异常；[Node pg 迁移入口](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/4b6287109352e8b77753f7a832afd25059317e96/server/src/migrate.js) 报错后 finally 关闭连接，不是 psql 脚本。事务设计意图为失败不提交结构/回填变更；本次没有实际触发失败证明回滚。

本次 CI 是新库先跑 001–024，再造验收数据。脚本仍只删除/重跑 023 的迁移记录，未执行“有旧账本的023库→024”、未造无法映射历史行。因而不能以 024 Applied + 304 项通过宣称历史回填与失败回滚都经过实测。

建议仅补一组隔离的 024 升级 fixture：023 状态下准备正额、reversed 零额、已解冻账本，执行真实024并核订单对应/金额/事件保留与索引；另一个隔离无映射样例应失败且回读确认没有部分应用和024版本记录；随后验证修正数据可正常升级。无需重做已通过的023资格回填，也不是要求因陈旧README重复跑原测试。

### 本轮已认可的实现与证据

- 首单按 paid_at/created_at/id 排序，排除 cancelled/refunded 与净额≤0；部分退款净额>0保持原单；正常第二单不增加佣金。
- 无合格订单会清空当前归因订单、冲正旧冻结账本；有合格重订则旧行保留、新行固定关联新订单，5% 向下取整未改。
- 归因行 FOR UPDATE + 数据库每归因非reversed部分唯一索引，配合每订单唯一，保护顺延的单份有效账本。已有测试验证正常重复并发读取下仅一份账本与一次创建事件；不把这一测试解释为穷尽所有交错。
- 已解冻/提现或已有退款异常的账本先被保护选择，不把资格顺延给后单，维持不追缴、不扣款；本次断言覆盖后来已有付款订单仍不生成第二份账本。
- 原身份HMAC消费事实保留；A/X全退更正Y后，B/X仍被拒而A/Y本人重订成功，304项中有对应真实接口/数据库断言。
- 看板、返航、释放 JOIN 已由 attribution.order_id 改到 ledger.booking_order_id，避免显示/退款基线随归因首单变动。
- 仅服务端4个文件变更；无App、价格、奖励、提现规则、设计正本或生产配置改动。

### 独立实读 CI

[run 40419191571 / job 121909058650](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40419191571/job/121909058650)：原始 checkout 精确为 4b6287109352e8b77753f7a832afd25059317e96；迁移024应用；Step4 **709**、Step5 **133**、直播 **77**、Step6 **304**项通过。本地 npm check/npm test10项是 Luna 回执，未冒充 Dot 独立运行。

304项未覆盖 B-R1 的“身份失败后退款且已有后续有效订单”，也未覆盖 B-E1 的024历史升级/失败回滚，不因总数增加视作已证明。

### R4及授权边界

从已发布8da4d5c9到当前2de9faea的全量差异无App代码或原生证据文件变化。Android H5冷/热→实际claim仍待实测；iOS仍是已报告实测+已看登录态截图，脱敏请求/数据库关联待补；本批B的服务端CI不补齐这些缺口。不给本批要求无影响的Flutter构建。

本次只读审查与CI原始日志核查，未独立启动数据库/服务端/设备，行为反例为源码确定路径、不是运行复现。本次仅写入独立评审文档，未修改代码、未代批B决定/产品验收/切片2/生产。



### 给 Muse / Luna 的同片接力

此前 R1（历史身份消费升级）、R2、R3 的限定关闭结论保持，不因本次新增 B 代码审阅改写历史。此处 B-R1 是新增受影响退款路径编号，不是原 S6-S1-R1 重开。请沿当前 B 交付修复上述最小行为缺陷、补对应反例，并补限定的024升级证据后交回定点复核；不另开重复工单、不执行下一切片。R4仍按已有证据边界继续收口；本评审不批准产品验收或生产。



### 对 2532fc18 六项追单的逐项回应（2026-10-27 04:03 UTC）

[最新追单](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/2532fc183a691f8567e8a859462b79daef1a1b40/docs/dot-review-request-step6-refund-reorder-b-2026-10-27.md)仍指向同一代码 `4b628710`，以下复用上文已完成的独立源码/原始CI复核，不冒称重新执行测试。

| 追单项 | 本轮状态 | 证据与限制 |
| --- | --- | --- |
| 1. 024迁移兼容 | 未完成技术验收；静态保护方向认可 | B-E1：缺有存量账本升级、无法映射时回滚的实际fixture；不是已证实迁移失败 |
| 2. B首单规则 | 常规路径通过；受影响组合暂不通过 | 304项支持全退无重订/本人重订/部分退款/正常第二单；B-R1实名失效组合未覆盖且有静态缺陷 |
| 3. 历史与新账本 | 暂不通过完整承诺 | 正常关联、并发单份有证据；B-R1可使旧已全退账本保持正额，须最小修复 |
| 4. 实名边界 | 原X→Y成功更正及跨账号拒绝路径通过 | 既有断言已核；不等同实名更正失败后退款路径通过，后者见B-R1 |
| 5. R3已解冻边界 | 本批规定路径通过 | 现有已释放账本保护与“后续单无第二份佣金”断言已核；不追缴/不扣款/布尔异常范围未改 |
| 6. 范围 | 代码差异核查通过 | 服务端4文件，未改费率/奖励/App/规格正本/生产配置；不由此推导产品验收或授权 |

本表不改变上文结论：本批B暂不整体技术通过；需要B-R1最小修复及B-E1限定补证，而不是重新等待同一轮审查。此前R1/R2/R3限定关闭不回滚，R4仍按原证据边界保留。


## B 修复及024补证定点复核：63d17328（2026-10-27 04:19 UTC）

**B-R1 与 B-E1 可在限定沙盒技术范围关闭。** 此结论只针对 `4b628710` 已指出的退款冲正路径和024升级证据；此前 R1/R2/R3 关闭保持，R4原生证据仍开放，不构成产品验收、切片关单或下一片授权。

### B-R1 行为修复

[固定修复提交](https://github.com/mikaozhao-dot/qingdao-fishing-app/commit/63d173282d309fb366385d4e724ac63bbebcec45) 仅将 `reverseStalePreReleaseCommissions` 提前到身份有效性与消费资格守卫之前；故旧单应冲正时不会再被后续订单当前身份失效的早退截断，新订单仍须实名和资格检查后才能计佣。

[推广验收新增段](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/63d173282d309fb366385d4e724ac63bbebcec45/server/scripts/step6-promotion-acceptance.mjs#L589-L643) 使用真实沙盒 API：先有O1/O2已支付，提交999拒绝样例使身份hash空，再取消O1；断言O1 reversed/0、O2无账本；将旧航次fixture推进返航并走真实checkin，断言不复活；重新实名后O2成为600分冻结账本且旧行仍0。符合原最小反例，不用“禁止实名更正”替代修复。航次状态是隔离fixture推进，不冒称自然经过完整出航时间。

### B-E1 升级证据

[新迁移验收脚本](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/63d173282d309fb366385d4e724ac63bbebcec45/server/scripts/step6-refund-reorder-migration-acceptance.mjs) 在隔离schema逐个执行001–023原SQL，造 frozen正额、reversed零额、available已释放三种旧账本，随后执行原024 SQL。断言原订单关联、金额、净额、状态与事件行保留；非空列和两个唯一索引存在且部分索引仅排除reversed。

另一隔离schema造无法映射行，执行024失败，显式ROLLBACK后核无024版本记录、无新增列/索引、原账本状态金额保留；修正关联后重试成功并记录一次版本。证明本次所需数据库层回填、失败回滚与恢复路径，**不再要求重复相同024 fixture**。

证据层级须准确：脚本读取真实迁移SQL，用同一个pg连接和测试helper执行、自己写迁移版本记录；失败后显式ROLLBACK。它并未spawn生产 `server/src/migrate.js` 进程，故不称生产runner断连故障恢复已做独立端到端演练。原生产入口已静态实读，SQL事务边界未改；此差别不阻止本次限定数据库迁移补证收口，也不构成生产升级批准。

### 实读原始CI

[run40448857434 / job122006543153](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40448857434/job/122006543153) 实际checkout完整SHA `63d173282d309fb366385d4e724ac63bbebcec45`：
- Step4 **710**、Step5 **133**、直播 **77**、推广 **334**项通过；
- 新步骤实际执行 `npm run smoke:step6-refund-migration`，**33**项通过。

工作流已纳入新增验收，不是仅本地回执自报。此次没有App或原生证据变更，不为本次服务端小修要求无影响的Flutter重跑。Dot未在本执行环境重跑数据库/设备，结论基于源代码、测试逐段核对和该SHA原始CI，不冒称独立运行复现。

### 交付与接力状态

入仓前已核对main为 `6186105cf4517d61e10cb32584ee289b3ce518f5`，固定代码后仅文档变化。已实读 [Luna回修回执](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/6186105cf4517d61e10cb32584ee289b3ce518f5/docs/step6-slice1-refund-reorder-b-fixback-delivery-receipt-2026-10-27.md)及 [Muse对63d17328的巡检](https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/6186105cf4517d61e10cb32584ee289b3ce518f5/docs/ui-design-review-63d17328.md)：Muse明确接收此前ad588意见、已核修复并交回Dot，三方接力已发生，不能继续称无人接手。本次独立原始CI核查补齐Muse尚未读日志的部分。回执中修复前本地复现失败、npm check与10项单测为Luna报告，Dot未独立重跑；本地Step4为709、本次CI实际710，分别保留。R4仍为Android原生链路待实测及iOS已有实测脱敏关联待补；业务决定、H5排期、产品验收与下一切片不由本复核代批。



### 五项追单回应及结论

针对 `docs/dot-review-request-step6-refund-reorder-b-fixback-2026-10-27.md`：1冲正顺序与身份守卫、2真实API回归、3有数据023→024升级、4失败回滚与修正重试、5范围核查，均在上述证据层级下通过。**本批B回修限定沙盒技术通过，B-R1/B-E1关闭**；不再重复索要同一反例或迁移fixture。此前R1/R2/R3限定关闭保持；后续接力仅继续R4原生证据与已声明产品待办，不据此启动新切片。

