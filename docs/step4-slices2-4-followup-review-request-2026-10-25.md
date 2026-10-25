# 第 4 步切片 2–4 定点跟进：待 Dot 复核

日期：2026-10-25。依据：Dot `docs/dot-step4-slices2-4-review-2026-10-25.md` 的补充结论及 Muse `docs/step4-slice4-formation-five-states-patrol-review-96cce0c0.md`。本记录只交接实现、证据和待复核事项，不是 Muse、Dot 或创始人验收。

## 切片 2：确认后的乘客取消

- 订单取消接口现在接受仍未出航的 `open`、`confirmed` 与 `captain_confirmed` 班次；继续使用已批准的出航时间阶梯退款/违约金，不调整费率。
- 成行后取消的座位回到平台配额，但 `releaseEligible` 仍依据确认截止点判断。截止后不设置候补释放标记、不派发候补授权；待确认班次的原有 F01 窗口仍照旧工作。
- 取消一位乘客不会改写班次状态、冻结成行快照、另一位乘客的订单或船长原确认记录。罚金进入实时该航次账本；历史快照保留确认时账面值。
- 新隔离验收覆盖 `confirmed` T−12h（罚金 ¥300、退款 ¥200）和 `captain_confirmed` T−4h（罚金 ¥500、退款 ¥0），以及座位释放、无候补授权、实时账本与快照分离、重复取消幂等。
- 沙盒生产保护未改；出航后请求仍拒绝。`handling_shortfall`、天气取消、真实退款及航次整体撤销不在本次实现范围内。

## 切片 3：保险复核请求措辞

- 已把“沙盒接口不允许人工绕过门禁”更正为“GET 状态标记未提供人工放行字段；实际出航动作强制约束尚未验证/接通”。
- 真实出航门禁仍未接入 `POST /captain/departures/:id/checkin`，本次没有实现保险强制拦截或接入真实保险服务。

## 切片 4：成行五态接口与页面

- 乘客行程 API 新增 `preConfirmationMeetsThreshold`：只有班次仍处于 `open/forming` 且尚未到确认点时，才按当前已付款订单净额、罚金池和成功补差汇总计算平台账是否达门槛；未到服务端确认点仍保持“待确认”。确认点之后或其他状态返回 `null`。
- 钓友端将达门槛显示为“已达最低成行 · 待确认”，未达显示为“待确认 · 尚未达最低门槛”，不把达门槛误写成已成行。
- 钓友行程接口、船长行程列表和船长行程详情对 `captain_confirmed` 返回 `platformGuarantee:false`。两端页面均展示“平台未补足差额，也不担保整船收入。”
- 船长 `captain_confirmed` 行程现在与 `confirmed` 一样提供服务端已允许的出航打卡、行前清单、名单和登船门禁入口；钓友行程页的清单生成提示也涵盖 `captain_confirmed`。
- 更新了 iOS 模拟器真实沙盒 API 画面证据：`design/step4-review-photos/22-step4-captain-confirmed.png`、`23-step4-captain-confirmed-angler.png`。连同重新生成的 18–21 号图，六张均小于 1 MB。

## 验证与评审

- 本地新隔离 PostgreSQL 17 / Redis 运行完整 Step 4 验收：**616 项断言通过**；包括此次确认后退改与成行五态新增断言。CI 的 612 项不启用本地截图夹具；夹具增加 4 项断言（3 项夹具状态检查，以及补差轮次 API 的 1 项状态检查）。
- 后端 `npm run check`、`npm test`（8/8）通过；Flutter `flutter test --no-pub`（6 项）、`flutter analyze --no-pub` 与 iPhone Duo iOS 27.1 的真实沙盒 API 集成截图流程通过。
- 新增界面回归覆盖门槛达成/未达成文案、船长确认非担保文案、船长确认后的全部支持操作入口。截图与测试不代表真实保单、真实退款或生产行为。
- GitHub Actions [Step 4 隔离数据库 run 40192792416](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40192792416) 已通过，日志为 612 项断言；[双平台构建 run 40192792442](https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40192792442) 的 Flutter analyze、iOS simulator 和 Android debug APK jobs 均通过。代码提交为 `fef5f58`。
- 请 Dot 复核确认后取消状态链、接口字段与 UI 一致性、22–23 号截图，并继续保留切片 3 的未接通边界。当前状态：CI 通过，等待 Dot 复核；没有记录 Muse 或创始人验收结论。
