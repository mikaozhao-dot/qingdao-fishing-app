# R1 证书运行图证据

固定代码批次：`45682879962fc996c6726d7e8c9f81d42e29f69a`。图面实现来自 `3040a298835674672a3016ff76754da5a4e1dca9`；从该实现至固定代码批次，Flutter 证书图面文件未变。

## 生成方式

- 在 iOS Simulator 的 iPhone Duo 运行 Flutter App 中的生产 `CertificateArtwork` 组件。
- 临时运行时夹具调用 `RenderRepaintBoundary.toImage(pixelRatio: 3)`，再由 Flutter PNG 编码器导出原始 PNG；没有从测试占位图片或设计稿导出。
- 三张图片尺寸均为 1080 × 1656 px。
- 目检结果：1 条与 4 条全部显示且没有遗漏提示；5 条显示前 4 条，并在图内写明总数、展示数、未展示数及 App 明细路径。鱼名、来源标签、数量和摘要均可读，未见裁切或溢出。

## 夹具与文件

| 图片 | 来源行夹具 | 结果 |
| --- | --- | --- |
| [1 条来源行](certificate-1-source-rows-iphone-simulator.png) | 小黄鱼 × 1，`本人记录` | 显示 1 条；无遗漏提示 |
| [4 条来源行](certificate-4-source-rows-iphone-simulator.png) | 同为小黄鱼的 4 条独立来源行，`本人记录` 与 `本人补充` 交替；数量 1–4 | 全部显示；无遗漏提示 |
| [5 条混合来源行](certificate-5-source-rows-iphone-simulator.png) | 小黄鱼 × 2、海鲈鱼 × 1（`本人记录`）；小黄鱼 × 3、黑头 × 1、带鱼 × 1（`本人补充`） | 保留同鱼跨来源两行；显示前 4 条，标注共 5 条、另有 1 条未展示及完整明细入口 |

5 条夹具对应服务端验收脚本 `server/scripts/step6-certificate-acceptance.mjs` 的混合来源场景；该脚本在固定 SHA 的隔离数据库 CI 中经过 preview/create API 检查，冻结快照保留五条来源记录及两条小黄鱼的各自数量。截图是客户端图面证据，CI 是服务端来源与冻结证据，两者职责不同。

## 文件校验值

| 文件 | SHA-256 |
| --- | --- |
| `certificate-1-source-rows-iphone-simulator.png` | `eca99436b33246d54394159e3f6beefd0ee874a800a41d3a63cf8d6f04ec889c` |
| `certificate-4-source-rows-iphone-simulator.png` | `acfd360141c35f06b013324e35ad9a9d1f817325d52ca86adf2e0529f198a16b` |
| `certificate-5-source-rows-iphone-simulator.png` | `a014c9c70a75b854a4bb914e5a78ae1e5f6e49fdf1408fa4d43614923ed01ae5` |
