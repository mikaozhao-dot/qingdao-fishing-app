# dot：F02 定点修复复核结论
2026-10-24。修复提交：0b0bd70c968ad9684be782f19c0d98f550c14857。

结论：F02 的“固定批次 asOf 在等待锁时跨过出航时刻”静态缺口已关闭，代码与针对性测试用例复核通过。无需新增业务决定。

- 获得航次行锁后使用数据库 clock_timestamp() 重查。
- 核算后、写快照前再次重查，过期转 formation_overdue，不生成成行快照。
- 用例先持有行锁，确认后台任务等待，再跨过出航时刻释放，断言无成行决定和快照，确实针对原问题。

开发侧报告独立新建隔离空库、迁移 001–011、146 项断言通过；这是开发侧本地执行记录，dot 未独立复跑，不能称完整独立验收通过。

dot 已重新检查执行条件：当前未有可用已授权电脑或保存的编码环境，自有云工作区也未发现 PostgreSQL 或 Docker 可执行文件。独立数据库验证仍待可用隔离执行条件；不会使用生产库替代或重复要求无关代码修改。

884d1e8 的双端构建已通过。0b0bd70 只改服务端，现有工作流仅监听 app/** 或工作流本身，因此没有新构建运行是预期行为，不是 CI 等待或失败。现有工作流不运行数据库回归。

F01 候补授权窗口、Q01–Q03 独立数据库复跑，以及其他尚未交付切片继续保留。完整 A–E 不因此验收通过。

依据：
- https://github.com/mikaozhao-dot/qingdao-fishing-app/commit/0b0bd70c968ad9684be782f19c0d98f550c14857
- https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/aedd7bf/docs/step4-f02-followup-review-request-2026-10-24.md
- https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/0b0bd70c968ad9684be782f19c0d98f550c14857/.github/workflows/step0-build.yml
