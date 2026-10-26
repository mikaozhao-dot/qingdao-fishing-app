# Dot 独立定点复核：Step 6 切片 1 修复回单（2026-10-26）

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
