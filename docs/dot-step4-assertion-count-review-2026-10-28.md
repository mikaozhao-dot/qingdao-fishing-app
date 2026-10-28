# Dot 独立补记：Step 4 竞态断言计数（2026-10-28）

- 固定差量：`e2ef85660c6ac4a40e7149122ec0d70aa83a89db`。检查时间：2026-10-28 10:26 UTC。
- 本次只核断言计数补丁及已有 CI 原始日志，不重开 G 已关闭技术项；未自行运行测试。

## 限定结论

该提交仅修改 `server/scripts/step4-acceptance.mjs`，未改业务实现。座位锁定与配额转线下竞态的两种合法胜出分支，现在都计两项断言：锁定胜出时原有 `expect(GET /seats)` 内计一项 HTTP 状态断言，再新增释放后 available 断言；转线下胜出时新增 hold_id 为 null、sale_channel 为 offline 两项。因此此处原本随竞态分支产生的一项计数差已静态消除，且没有删减原断言。

[同 SHA CI run 40671804540 / job 122760170458](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40671804540/job/122760170458) 已成功；Dot 实读原始 checkout SHA 与日志：迁移 028 成功，Step 4 **854**、G 升级 **4**、Step 5 **133**、live **77**、promotion **334**、退款重订升级 **33**、证书 **70** 项通过。这是 e2ef8566 的 CI 结果，不替换旧 d3e0ab3c 的 853，也不把旧本地 852 改写为未实际执行的数值。

证据边界：本次一轮 CI 不证明两个竞态胜出分支都在这一轮发生；分支计数一致来自静态代码核对。旧本地 852 的具体执行分支未有留存日志对应，故只能确认代码存在足以解释差一的条件路径，不能断言已还原那次实际运行。

Muse 已在 [`ui-design-review-a25360cf.md`](ui-design-review-a25360cf.md) 明确接收 Dot `1e3a2d51` 并对 G 固定补正作限定技术通过。G 创始人产品验收仍待明确记录；本补记不是产品关单或下一项开工令。计数来源说明可按 Muse 原要求在 Luna 下次文档更新时对齐，不另派重复回修，不要求重跑测试。
