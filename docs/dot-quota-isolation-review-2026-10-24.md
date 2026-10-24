# dot：配额隔离首片独立复核（2026-10-24）

## 范围与结论
复核实现提交 292eae343a5f5e3c247ebfd77ac2cc118bdfddbe，以及进度记录 d08a673、0b40cf8。仅限已批准第 4 步 v2 的配额隔离，不批准新业务规则、预算、生产上线或真实交易。

结论：线上配额隔离首片已实现、构建通过；完整配额验收仍待来源侧释放保护和交易实跑证据。其他已批准切片继续，不必停整个项目。以下为静态代码复核，未声称观察到真实超售。

## 已确认的进展
- 平台锁位过滤 sale_channel='platform'；锁位与调额均先锁航次行，避免线上侧并发穿透。
- 平台已锁、已售库存不能调出；同 requestKey 同内容重放不重复增库；不同请求争抢同一席位只有一个成功。
- 新发班漏填配额时降级人工确认，不生成平台库存。
- 292eae3 的 GitHub CI 已通过 Flutter analyze、Android debug APK、iOS simulator build：
  https://github.com/mikaozhao-dot/qingdao-fishing-app/actions/runs/40086879029
- 这关闭了该提交的 Android 构建缺证，不代表数据库交易回归通过。68 断言仍是开发侧本地记录，工作流未运行该数据库脚本。

## Q01：线下归属不能代替线下可释放证明
007 migration 第 43–49 行的 departure_seat_quotas 只有渠道，没有线下可售、锁定、已售状态或撤售确认；step2-routes.js 第 645–657 行验证来源渠道，第 685–720 行线下转入只检查平台历史引用，原本没有平台库存时会直接创建 available 席位。

因此，当前能证明“不直接卖 offline 座位”，不能证明“线下已经售出或锁定的座位不会被调入平台”。这是已批准的“已售/已锁不可调、先冻结来源”的未完成边界，而不是要求新增完整商户系统。

建议 Muse 明确最小来源释放契约，让 Codex 在无法核实来源释放时拒绝开放该席位。来源释放依据、操作人、时间和关联调额记录应可追溯；如果只能靠船长人工确认，必须明确其事实边界，不能把平台数据库事务包装成已控制外部销售。补线下已售、线下已锁、未释放来源三类拒绝用例，再验收完整双向调额。

## Q02：旧数据迁移的适用范围
007 第 18–22、39–41、53–59 行把已有 inventory 视为平台配额，并对有库存航次设置 manual_supply=false。历史模板生成库存本身不证明船长已经专售给平台。
若此次只处理沙盒数据，请在迁移/验收记录明确；未来真实存量升级应先确认专属配额，保留已有订单并冻结未确认部分的新增销售。此项是上线迁移门槛，不阻断沙盒其他开发。

## Q03：第五席的直接拒售证据
step4-acceptance.mjs 第 233–240 行检查第 5 号为线下且无库存，方向正确；第 244–245 行传随机不存在 UUID，只能证明不存在库存被拒。
建议复用第 264–271 行“转入再转出”产生的真实库存 ID，再调用锁位接口，验证实际线下库存不能锁位。同时补已售席位调出拒绝、锁位与调额并发，以及合法调入后可锁位的用例。请按明确提交提供独立数据库回归结果，不以构建绿灯替代。

## 非阻断稳健性项
step2 第 608–622 行先检查报名状态后查幂等结果，因此成功调额在截止后重试可能返回 409 而非原结果。它不重复增库，可作为接口稳健性修正：验证身份/归属后优先读取既有幂等结果。

## 后续边界
B1 双账、补差、保险等尚未交付部分继续按 v2 分片推进，不混记为本次新增缺陷。截图、构建、本地交易测试、独立交易回归分别记账，不互相替代。

代码：
- https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/292eae343a5f5e3c247ebfd77ac2cc118bdfddbe/server/src/step2-routes.js#L588-L768
- https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/292eae343a5f5e3c247ebfd77ac2cc118bdfddbe/server/src/step3-routes.js#L436-L488
- https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/292eae343a5f5e3c247ebfd77ac2cc118bdfddbe/server/migrations/007_departure_quota_isolation.sql
- https://github.com/mikaozhao-dot/qingdao-fishing-app/blob/292eae343a5f5e3c247ebfd77ac2cc118bdfddbe/server/scripts/step4-acceptance.mjs#L222-L299
