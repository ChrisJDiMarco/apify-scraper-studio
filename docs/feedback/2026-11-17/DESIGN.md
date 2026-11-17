---
kind: operate
scene: "The existing Golden Thread app on a laptop or desktop; browser also supports a narrow phone view."
scheme: both
colour-plan: quiet
tokens: "src/renderer/src/studio-frame.css (.studio-frame), reused without replacing the established design"
colors: { bg: "#f4f6f5", surface: "#ffffff", text: "#181e15", muted: "#62685e", line: "#cfd6d0", accent: "#c190ff", on-accent: "#181e15", good: "#1f5a4c", warn: "#6b5413", bad: "#8a2f1c" }
colors-dark: { bg: "#121611", surface: "#1a1f19", text: "#eef2ee", muted: "#a3aaa1", line: "#3a423a", accent: "#c190ff", on-accent: "#181e15", good: "#8fe0c8", warn: "#f0d58a", bad: "#f0a08e" }
fonts: { body: "Lazzer, -apple-system, BlinkMacSystemFont, Segoe UI, Arial, sans-serif", display: "Lazzer, -apple-system, BlinkMacSystemFont, Segoe UI, Arial, sans-serif", mono: "ui-monospace, monospace" }
sizes: "12, 14, 16, 20, 28, 40"
space: "4, 8, 12, 16, 24, 40, 64"
radius: "12, 16, 20"
allows: ""
---

## What this is for
Keep the established working app familiar while making workspace, research and channel decisions clearer.

## Colour
Use the existing --s-* tokens. Semrush retains lavender actions; General retains its existing lime accent. Status text always names the status, with colour as a secondary cue.

## Type
Reuse the app's body and heading styles. Long program names, channel names and descriptions wrap rather than overflowing.

## Space and layout
Retain the sidebar and pipeline. Board columns share available desktop width and stack at narrow widths. Dialog content scrolls within the viewport.

## Shape and depth
Reuse existing card, menu and dialog styles. No new decorative layers or visual language.

## Motion
Use existing transitions and reduced-motion behavior. Tours must not trap navigation or start generation.

## Parts
Workspace picker: existing keyboard-accessible menu. Membership: existing dialog/field/button components. Research: count and explanatory copy. Board: explicit stages and existing trend actions. Examples: thumbnails, required descriptions, removable records. Tour: readable step, progress, next/back, skip and replay.

## Never, and the exceptions
Do not expose model names or money to Channel Owners. Do not use colour alone to communicate state, auto-send messages, or activate a paid operation in a tour. Preserve the existing branding; this update does not replace it.
