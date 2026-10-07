# Scraper Studio Mac icon

Created September 27, 2026 with the built-in ImageGen tool (not the app's OpenAI API connection). Final generated source: `scraper-studio-icon.png`; native bundle asset: `icon.icns`.

## Final design brief

Create a polished macOS application icon for Scraper Studio, a research and content workspace. Use a rounded lavender tile, matching the current Semrush lavender (#C190FF), with a bold dimensional folded S in near-black green (#181E15). Subtle mint edge lighting, satin material, restrained depth, clean lighting, and a simple silhouette legible in the Dock. The S is Scraper Studio's own mark, distinct from Semrush's official comet. No text or additional badges. Transparent exterior with smooth rounded corners.

## Final edit direction

Preserve the lavender tile, dark folded S, lighting, and interior detail. Remove all exterior white, pink, and magenta fringe or patches outside the rounded tile; use transparent padding and a clean alpha edge. This was an edit of the lavender concept, which was itself an edit of the original orange concept.

The generated alpha is preserved. Near-transparent exterior pixels have alpha 1/255 and may appear exaggerated in viewers that display RGB without correctly compositing alpha. Standard `sips` resizing and `iconutil` conversion produce the app's 16–1024 px macOS icon representations. Run `npm run icons:mac` to rebuild; no image generation occurs during packaging.
