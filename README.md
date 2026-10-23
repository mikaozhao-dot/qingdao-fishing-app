# qingdao-fishing-app · 拼船海钓（青岛首发）

海钓拼船 + 游客体验预订平台：iOS/安卓双端 App（Flutter 一套代码），船长发班→系统生成统一活动→用户按时间/鱼种/海域/舒适度/船大小选位下单；含船长口碑数据、推广分销、保险外接与拼船成团/取消保底机制。

## 文件索引
- `docs/mvp-plan-v1.md` — 产品计划正本（§一–§二十四，全部已定版规则与测算）
- `docs/p0-flow-v1.md` — P0 页面流程一页纸
- `docs/fish-library-v1.md` — 青岛鱼种库 v1（17 种：习性/窗口期/钓法）
- `docs/codex-ui-design-brief-v1.md` — **当前任务：App 界面视觉设计任务书（Codex 先行）**
- `docs/b-direction-review-v1.md` — B 深海高级两屏小样的评审说明
- `design/content-prototype-v1.html` — 内容正本原型（10 屏，创始人已验收内容、视觉待重做）
- `design/b-direction-sample-v1.html` — B「深海高级」审核小样（首页 + 活动详情）
- `design/b-direction-sample-v1-photos/` — B 方案手机预览图片（首页、活动详情）

## 协作规矩
- 内容与规格由 Muse 评审定版；Codex 按任务书交付，评审意见与新任务直接写回本仓。
- 本次按创始人最新指示仅交付 B「深海高级」两屏小样，A 方案不纳入审核；首页与活动详情分别可切换查看。

## 本地预览

在仓库根目录运行 `python3 -m http.server 8083 --bind 127.0.0.1`，再访问 <http://localhost:8083/design/b-direction-sample-v1.html>。
