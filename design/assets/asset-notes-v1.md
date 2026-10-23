# 视觉小样素材记录

## 船只概念图

- 文件：`fishing-boat-concept-v1.png`
- 工具：内置 ImageGen（imagegen 技能），非 CLI。
- 用途：A / B 两套视觉方向共用的船图占位。不是任何真实船只的实拍照片。
- 生成日期：2026-10-23。
- 原始输出：`/Users/mikao/.codex/generated_images/01a166c8-0541-77e2-84f7-079c39cd791c/exec-a6f510dd-2ca8-44ba-930b-5bae8abd0159.png`。
- 交付已复制入项目，预览无外部图片依赖。

完整生成提示词：

> Use case: photorealistic-natural. Asset type: one editorial boat image for a Chinese sea-fishing booking app visual prototype, reused in light and dark style directions. Create a premium natural documentary photograph of a plausible 13-meter white Chinese recreational fishing motorboat on the calm blue-green Yellow Sea near Qingdao, three-quarter view from slightly above water height, bow pointing left, boat centered with the complete hull visible and generous sea margins for responsive cropping. Compact enclosed wheelhouse with dark windows, dark charcoal canopy over the aft open fishing deck, stainless rails, two outboard engines, subtle orange life ring. No people. Quiet low pale green coastal hills in the far background, soft clear morning light, a small wake, authentic textured water, restrained cinematic color grading, crisp boat detail, horizontal 3:2 composition. This is a conceptual image, not an actual named vessel. No text, numbers, logos, watermarks, UI, flags, collage, or tourist advertisement effects.

## 首页鱼种实拍照片

首页当季鱼种卡片改用对应鱼类实拍图。页面以 CSS 在深色卡片内缩放展示；图片仅用于视觉样稿，物种窗口与分布以 `docs/fish-library-v1.md` 为准。正式产品上线前应采购或取得适用于商业产品的授权，并优先换成中国海域本地渔获实拍。

| 页面文件 | 物种 | 图片来源与作者 | 许可 |
|---|---|---|---|
| `fish-photos/yellowtail-amberjack.jpg` | 黄条鰤（Seriola lalandi） | [Wikimedia Commons: Yellowtail amberjack.jpg](https://commons.wikimedia.org/wiki/File:Yellowtail_amberjack.jpg)，Brian Gratwicke | CC BY 2.0 |
| `fish-photos/ribbonfish.jpg` | 带鱼（Trichiurus lepturus） | [Wikimedia Commons: Trichiurus lepturus Umitamago (rotated).jpg](https://commons.wikimedia.org/wiki/File:Trichiurus_lepturus_Umitamago_(rotated).jpg)，Totti | CC BY-SA 4.0 |
| `fish-photos/cuttlefish.jpg` | 墨鱼 / 金乌贼（Sepia esculenta） | [Wikimedia Commons: Golden Cuttlefish (Sepia esculenta) (49152874797).jpg](https://commons.wikimedia.org/wiki/File:Golden_Cuttlefish_(Sepia_esculenta)_(49152874797).jpg)，Rickard Zerpe | CC BY 2.0 |
| `fish-photos/black-rockfish.jpg` | 黑头（Sebastes schlegelii） | [Wikimedia Commons: Sebastes schlegelii by OpenCage 2.jpg](https://commons.wikimedia.org/wiki/File:Sebastes_schlegelii_by_OpenCage_2.jpg)，OpenCage | CC BY-SA 2.5 |

这些许可要求保留作者署名、来源和许可链接；带 SA 的图片及其改编素材须按相同或兼容许可共享。
