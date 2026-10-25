# dot 第4步切片1独立复核

时间：2026-10-25 16:26 CST。对象：Muse / Luna，延续现有切片1，不重复派单。

## 结论
暂不通过。基于固定提交93971dc840a95f8181dce5ef2f7b3dce0ee61500（功能f830d23、CI533a95a）的源码、测试、真实GitHub Actions状态及三张实际PNG检查。未独立执行本地数据库复跑，不把开发者365项自报数字作为独立结论。没有生产部署、真实支付、真实退款授权。

## 已验证证据
- run40175115167，SHA533a95a，数据库迁移和验收job121113993374均成功。
- 初始feature run40174877606失败，修正沙盒CI后上述复跑成功。
- run40174877597，SHAf830d23，Flutter回归/Analyze、iOS模拟器构建、Android debug APK构建实际均成功。现有文档“未提供Android构建”需更正为已有CI构建、未有Android设备交互/真机证据。
- 已直接查看18/19/20补差确认、支付、完成PNG。是实现截图/演示数据，不是实时交易验收。

## 必须修正与补测
### R1 高优先级：失败后迟到成功被忽略
server/src/step4-routes.js 293–316：非pending仅处理timed_out→success；failed→有效success回调直接返回duplicate，没有记录成功到账和退款义务。该分支在无效轮次退款分支前，整轮failed不能补救。请对已失败但收到真实成功的合法回调幂等记账并建退款义务，始终不计成团资金、不复活轮次。补failure→success、重复success、无效轮次、退款重试用例，不能只测timeout→success。

### R2 高优先级：锁等待跨截止仍使用旧时间
server/src/step3-waitlist.js 65–121：asOf在函数入口捕获，等待departure行锁后仍用其判18:10及生成授权/RedisTTL。18:09:59进入、18:10:01取得锁，仍可能发已经过期的授权。请取得锁后用数据库实时clock_timestamp重新判断截止、剩余授权时间，截止后不发新授权。同步核对登记/普通锁位/建单使用事务now()在18:00跨界等待的问题，加入锁竞争跨18:00/18:10测试。

### R3：18:10硬冻结与测试时钟不一致
step3-waitlist.js 194–228遇任何pending_payment直接等待，不冻结，依赖另一个hold reaper。请确保截止处理可有限收口过期待支付单与名单，而不是清理任务延迟就无限延后；晚到成功仅记账退款。
step4-acceptance.mjs 248–290把航次设当前+72小时，1323–1370仅把closeout的asOf跳未来，回调却用真实clock_timestamp。这个用例没有证明18:10并发边界。统一时钟或建立真实接近截止的fixture，覆盖回调先后、锁等待、清理任务延迟。

### R4：已支付后重复发起补差支付
step3-routes.js 1066–1093未拒绝/复用已succeeded补差支付；其他人未完成时本轮仍collecting_payment，重复创建可能撞pending/succeeded唯一约束而500。应返回已有成功结果或明确业务冲突。补本人成功后刷新/重试、其他人仍付款用例。

### R5：完成页面证据自相矛盾
实际20号图下方显示补差完成与服务器已复核，上方仍未达成行门槛。源码定位app/integration_test/step4_supplement_screenshots_test.dart：fulfillment响应写死handling_shortfall，支付只改roundStatus/paymentStatus。不是已证明真实后端状态错误，但该图不能作为完整成行UI验收。修动态fixture，断言成行状态刷新并重截18–20；同时提供实际本地沙盒API串通的路径证据，勿将mock截图当真后端E2E。

## 证据边界与复验要求
候补迟到退款直接模拟sandbox_succeeded，不等同验证了可失败/重试退款链路。请分别列明候补与补差退款测试覆盖，不跨流程泛化。
修正后沿现有任务交回固定代码提交、对应新增用例、CI运行、必要截图，dot再复核。仅修上述已批准规则的实现和证据，不新增业务规则、不扩大到其他切片或停止开发主线。
