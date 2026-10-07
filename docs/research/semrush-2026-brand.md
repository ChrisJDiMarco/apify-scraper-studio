# Semrush 2026 brand verification

Verified on September 27, 2026 from Semrush’s public brand site, stylesheet and downloadable logo package. This is implementation guidance for this workspace, not a substitute for a full licensed brand manual.

## Current identity

Semrush announced its refresh on **March 12, 2026**. Its stated direction expands brand visibility beyond traditional search into AI and social, with a clearer identity and more consistent voice. Treat that as brand positioning, not evidence of any particular product capability or performance. [Official announcement](https://www.semrush.com/blog/semrush-new-brand/)

The current brand site describes a comet-inspired mark, visual momentum, and flexible patterns that express intelligence and data. Main-brand and Enterprise applications share a palette; brighter expressions convey energy and deeper expressions convey authority. The site now identifies Semrush as an Adobe company, and its downloadable full lockups include that line. [Official brand site](https://brand.semrush.com/)

## Exact colors verified in official site code

These are **named tokens in the brand site’s shipped stylesheet**, not an assertion that they are the entire corporate palette. No additional guessed palette colors are presented as official. [Official stylesheet](https://brand.semrush.com/css/index-Dbd_UmNb.css)

| Official token | Value | Observed role |
| --- | --- | --- |
| `--black` | `#181E15` | Main ink; also the black logo’s actual SVG fill |
| `--white` | `#FFFFFF` | White backgrounds |
| `--dark` | `#000000` | Video background |
| `--Lavender` | `#C190FF` | Filled primary button |
| Secondary button hover / pressed | `#E0C7FF` | Interaction shade |
| `--Core-Mint` | `#DCEEEB` | Pale mint |
| `--Core-Dark-grey` | `#747873` | Neutral grey |
| `--Core-Light-grey` | `#F3F6F6` | Light neutral surface |
| `--Accent-Aqua` | `#18F0BF` | Bright accent |
| Background gradient | `#DCEEEB` → `#E8E1FF` at 75% → `#FFFFFF` | 180° vertical gradient |
| Product gradient | `#DCEEEB` → `#EEE9FF` | 180° vertical gradient |

The older orange `#FF642D` is not one of these current official brand-page tokens and should no longer be the default Semrush workspace accent. That does not establish a universal ban on orange in every Semrush product or campaign.

## Typography and layout

The official stylesheet declares **Lazzer**, with **Arial, sans-serif** fallbacks. It maps Regular 400, Medium 500, SemiBold 600, Bold 700 and Heavy 900 to official WOFF files; the HTML also preloads a Light file. Example primary asset URLs: [Regular](https://static.semrush.com/file/fonts/lazzer/Lazzer-Regular.woff), [SemiBold](https://static.semrush.com/file/fonts/lazzer/Lazzer-SemiBold.woff), [Bold](https://static.semrush.com/file/fonts/lazzer/Lazzer-Bold.woff). Public asset availability is not a verified redistribution license; this implementation does not bundle the fonts.

Observed website styling includes large tightly tracked headlines, generous whitespace, rounded pill buttons, restrained mint/lavender backgrounds and substantial image/video fields. These are observed properties of the public brand site, not mandatory sizes for a dense research application. [Official stylesheet](https://brand.semrush.com/css/index-Dbd_UmNb.css)

## Official assets

- [Header SVG](https://brand.semrush.com/semrush_black.svg): current dark full mark; actual fill `#181E15`.
- [Footer SVG](https://brand.semrush.com/semrush.svg): current dark wordmark artwork; actual fill `#181E15`.
- [Official logo ZIP](https://brand.semrush.com/Semrush%20Logo.zip): inspected archive includes black/white comet icons and full **SEMRUSH / An Adobe Company** lockups in SVG and PNG. The full black 1000 px PNG was visually inspected, confirming the new comet, uppercase wordmark and Adobe-company line.
- [Official pattern SVG](https://brand.semrush.com/pattern.svg): referenced by the official footer stylesheet; location verified in CSS, artwork not separately audited here.

The archive names are literal: `Semrush+Adobe_Logo_Full_Black_RGB.svg.svg`, `Semrush+Adobe_Logo_Full_White_RGB.svg.svg`, `Semrush_Logo_Icon_Black_RGB.svg.svg`, and `Semrush_Logo_Icon_White_RGB.svg.svg` inside `Semrush logos/svg/`. PNG variants include 1000 px / 3000 px full lockups and 1024 px icons. Do not redraw the mark or ask the image model to invent a lockup; use an approved supplied asset and preserve its proportions.

## Recommended app application — design judgment

Use `#181E15` for readable primary text, white/light-grey work surfaces, lavender for primary actions and selection, and mint for supporting surfaces. Use aqua sparingly for emphasis and verify contrast for each text/background pair. Keep Enterprise surfaces quieter and deeper within the shared palette. Use clean sans-serif typography with a locally available Lazzer only when appropriately licensed; otherwise use the existing readable fallback. Adapt the website’s space, hierarchy and purposeful motion to working screens without copying its oversized marketing-page headings.

These app choices are **inferences from the official identity**. The researched site does not prescribe this app’s exact component radii, navigation, table density, icon set, accessibility tokens or generated chart style. Keep Search Engine Land’s separate editorial directions and the General workspace unchanged. Existing owner-approved campaign preferences can refine defaults without being mistaken for new research evidence.

## Implemented content-contract update

`src/shared/content-studio.js` now exposes versioned `SEMRUSH_BRAND_2026` metadata, official source URLs, updated Semrush edition colors, a `semrush-brand-2026` knowledge preset and current Semrush campaign-image directions. General and SEL image directions remain unchanged. Source validation, product evidence requirements and editorial safeguards remain in place; no product capabilities, corporate statistics or private source lists were imported. Custom knowledge input is preserved.

Persisted workspace knowledge is owned by the host service. The startup migration below refreshes only demonstrably unchanged legacy defaults and records current brand metadata while retaining user edits. New plans receive the current image direction independently of saved prose knowledge.

## Existing workspace migration

Startup refreshes only exact, unchanged legacy Semrush positioning and editorial defaults. Custom text and products remain intact. Current brand metadata is recorded separately from editable knowledge; General, Search Engine Land policies, and saved run inputs are preserved. Migration tests cover custom, mixed, unchanged and repeated-start cases.

## Workspace design application

The follow-up UI pass uses a mint navigation surface, lavender active selections, and a contained mint/lavender overview header. Two primary paths are visually distinct: lavender for market research, near-black for creating campaign content. Activity counts come from the selected workspace's records; brand-readiness indicators reflect saved fields rather than inferred product knowledge.

Working pages use compact contextual headings instead of repeating the overview hero. Research forms, deliverable steps, saved assets and brand knowledge share the same typography, focus treatment, selection colors and spacing. Connection settings have separate white cards and visible section accents. Secondary search, reports, markdown and review screens use edition-scoped colors. Warning, error and source-platform colors keep their semantic meaning. These are app-design choices informed by the official identity, not claimed official product templates.
