# 第 4 步切片 1 · R2 / R3 定点补充复核请求

日期：2026-10-25。对应 Muse 巡检 `docs/step4-slice1-repair-review-d8fb5dc9.md` 的 M1、M2，以及 Dot 17:44 复审中的 R3、R2 剩余项。代码提交：`74f1740`。状态：本地实现和验收完成，等待 Dot 复核；不代表切片 1 已验收。

## M1 / R3：18:10 收口过期普通待支付订单

- `server/src/step3-waitlist.js` 的 `processWaitlistCloseouts` 在取得航次行锁并确认 18:10 已到后，将普通订单中持有有效但 `expires_at <= closeoutAt` 的 hold 与候补待支付单一并纳入收尾。普通订单仅在 `pending_payment` 且锁位已过期时关闭；仍有效的 hold 和已支付订单不在该筛选范围。
- 收尾把待支付交易改为 `timed_out`、订单改为 `cancelled`、订单座位与锁位释放，再由同一 `processFormationChecks` 批次继续成团检查。它不依赖 15 秒 reaper，也不需要 GET seats 请求触发清理。
- `server/src/step3-routes.js` 对过期订单的迟到成功回调记录 `late_success` 和 `late_booking_payment` 退款义务；订单保持取消、座位保持释放、已冻结成团快照和班次状态不恢复。迁移 `server/migrations/017_late_booking_refund_reason.sql` 为退款义务增加对应原因。
- 验收用例在 17:59 建普通订单，支付保持 pending；不调用 reaper 或 GET seats，在 18:10 运行同一收尾/成团批次，检查交易超时、订单取消、座位释放、名单不进入成团账、检查不再 deferred。随后发送迟到成功回调，检查只入退款、不会恢复订单/座位/班次；重复回调幂等。位置：`server/scripts/step4-acceptance.mjs` 1804–1889 行。

## M2 / R2：派发本身跨越 18:10 的锁等待

- 新用例直接调用 `dispatchWaitlistCandidates`，在 18:09:59 启动并持有同一航次行锁至 18:10:01；调用传入的 `clockNow` 与截止收尾及回调验收使用同一测试时钟。
- 释放行锁后，派发返回空结果；候补仍未授权、座位仍可用、无活动 hold，Redis key 不存在（TTL 为 `-2`）。随后用同一时钟收尾并关闭队列。位置：`server/scripts/step4-acceptance.mjs` 1589–1639 行。

## 验证记录

- 新建隔离 PostgreSQL 17.11 / Redis，应用迁移 001–017；未配置 `STEP4_SCREENSHOT_FIXTURE_PATH`，不重做已通过的截图夹具：Step 4 数据库验收通过 **463 项断言**。
- `npm run check` 通过；`npm test` 8/8；`git diff --check` 通过。
- 已有 18–20 原生 PNG 沿用上次复核版本，本次没有重新生成或替换。
- GitHub Actions：本次提交推送后补录数据库验收与构建 run 状态。

## 复核请求与边界

请 Dot 重点复核 M1 的过期普通待支付收口、迟到成功退款及 R2 的 18:09:59→18:10:01 派发锁等待。按 Muse 指令不重复制作已通过截图、不扩大到其他切片。R1、R4、R5、R6 的既有复核结论沿用；在 Dot 对 M1/M2 复核前，切片 1 继续标为**暂不通过 / 待复核**，不得宣称已验收。所有资金与退款证据仍是本地沙盒流程。
