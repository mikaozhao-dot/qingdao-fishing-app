# dot：配额与过期确认修复验收记录
2026-10-24，复核至 884d1e8e8332be9ba1eb8347eb8269cf23af4419。

## 状态更新
中间提交 de3f65c 已实现来源释放契约，491fbe9 记录本地 131 项断言；不能继续将 Q01–Q03 描述为尚未实现。
- Q01：已加入线下状态登记、所属船长释放声明、同事务审计凭据、已售/已锁/无声明拒绝。界面明确无法核验外部销售。
- Q02：已明确旧库存迁移仅适用于沙盒。真实存量升级仍需专属配额确认，未验收生产迁移。
- Q03：已有真实线下库存 ID 拒售、合法调入后锁位、已售调出拒绝、状态/调额和锁位/调额并发、截止后幂等重放用例。

上述三项由“未实现”更新为“代码和测试用例已补，待独立数据库实跑”，不再重复要求同一修复。

45231f3 在同一弹层内复用失败重试 requestKey，符合本次修正；未证明跨弹层/重启持久化，不将其夸大为跨会话验证。

## F02 已修部分与剩余小边界
884d1e8 对过期 open/forming 转为 formation_overdue，不生成成行快照，任务重跑不重复处理；过期船长确认返回 409 且不写决定。对应新增测试已入脚本。

剩余静态复核点：任务使用整批开始时固定 asOf。若当时尚未出航，等待行锁期间跨过出航时刻，仍可能按旧时间成行。建议最终状态写入前用实际时钟复核，并补“阻塞锁跨越出航时刻”用例。此为静态可达边界，未独立复现，不阻断其他批准开发。

F01 候补授权窗口与确认点的集成问题本轮未涉及，继续保留至相关切片联调。

## 证据
884d1e8 的 analyze、Android debug APK、iOS simulator build 已全部成功：
https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40089573657

工作流未执行数据库交易回归。131 项是旧提交开发侧本地记录，不能替代本提交 F02 新用例实跑结果，也不能替代独立回归。

代码与记录：
- https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/884d1e8e8332be9ba1eb8347eb8269cf23af4419/server/src/step2-routes.js#L603-L930
- https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/884d1e8e8332be9ba1eb8347eb8269cf23af4419/server/scripts/step4-acceptance.mjs#L251-L391
- https://github.com/mikaozhao-dot/qingdao-fishing-app/commit/884d1e8e8332be9ba1eb8347eb8269cf23af4419
- https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/884d1e8e8332be9ba1eb8347eb8269cf23af4419/docs/step4-build-notes.md

仅评审记录，不扩大业务规则、处罚、预算或上线授权。完整 A–E 仍在分片实施。
