# Golden Thread app icon

Created October 21, 2026 with OpenAI GPT Image 2.5 Flare on fal.ai (generated through Thinklet), 1024×1024, high quality. Chosen concept: `icon-concepts/a-silk-g.png` (the other three concepts sit beside it). Final source: `golden-thread-icon.png`; native assets: `icon.icns` (macOS) and `icon.png` (Windows, converted by electron-builder).

## Prompt

A polished, premium macOS Big Sur style application icon for an app named Golden Thread, a research and content studio. Rounded-square squircle tile filling the frame with even transparent padding, smooth corners, soft natural drop shadow. No text, no letters other than the single G described, no badges, no watermark. Crisp silhouette that reads clearly at 32px in the Dock. Studio lighting, refined materials, restrained depth. A bold capital G formed by one continuous strand of glowing golden silk thread that loops to draw the letter, the loose end trailing off with a tiny spark of light; deep midnight navy tile with subtle radial gradient and fine woven-fabric texture.

## Cleanup

The model painted a checkerboard instead of returning alpha, so the dark tile was cut out with an anti-aliased rounded-rectangle mask (radius about 239 px at source scale, inset 3 px to drop any checker fringe), scaled to Apple's 824 px body on a 1024 px transparent canvas, and given a soft drop shadow (45% black, 14 px blur, 12 px down).

Run `npm run icons:mac` to rebuild `icon.icns` and `icon.png` from `golden-thread-icon.png`; no image generation occurs during packaging.
