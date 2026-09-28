# Trace identity

**Selected: 04 — Folded Blueprint · 28 September 2026.**

<img src="folded-blueprint.png" alt="Trace's Folded Blueprint icon" width="192" height="192" />

A cobalt-blue folded **T**, with a violet underside, sits on a porcelain rounded
tile. The mark connects Trace's two directions: understanding an implementation
and inspecting a plan before it becomes code. Planner remains a proposed workflow.

Use the same full-color icon in light and dark appearances. Retain the tile and
the transparent outer margin. Do not recolor the mark to communicate review,
finding, validation, or planning status.

## Assets

| File | Purpose | Size |
| --- | --- | --- |
| [`folded-blueprint.png`](folded-blueprint.png) | Selected raster master | 1254 × 1254, RGBA |
| [`trace-icon.png`](../../../apps/trace/public/trace-icon.png) | Sidebar, compact header, and repository README | 256 × 256, RGBA |
| [`favicon.png`](../../../apps/trace/public/favicon.png) | Browser tab icon | 32 × 32, RGBA |
| [`icons/`](../../../apps/trace/src-tauri/icons) | Native PNG representations and `icon.icns` | 32, 64, 128, 256, 512 px PNGs; ICNS representations through 1024 px |

The master received a finishing pass using the built-in image generation tool.
Its [prompt](folded-blueprint.prompt.txt) is saved for provenance. Tauri's installed
icon generator created the platform exports; the PNGs retain alpha transparency.
This is raster artwork, not an editable vector master. A close inspection of the
full-resolution master still reveals small cutout-edge artifacts; the app-sized
exports should be judged at their display sizes rather than assumed vector-clean.

The [five original concepts](2026-09-28-variants/index.html) remain available as
historical exploration. Use this selected master for subsequent exports.

## Validation

The folded T remains recognizable at 16, 24, and 32 px on white and dark
backgrounds. The shared 256 px PNG is 43,506 bytes; the 32 px favicon is 1,715
bytes. Type checks and the frontend production build pass, and macOS `iconutil`
successfully decodes the generated ICNS. The native application bundle has not
been rebuilt or installed with this change.

## Regenerate the exports

From the repository root, after `npm ci`:

```sh
npx --no-install tauri icon docs/trace/branding/folded-blueprint.png \
  --output /tmp/trace-icon-export
for name in 32x32.png 64x64.png 128x128.png 128x128@2x.png icon.png icon.icns; do
  cp "/tmp/trace-icon-export/$name" "apps/trace/src-tauri/icons/$name"
done
cp /tmp/trace-icon-export/128x128@2x.png apps/trace/public/trace-icon.png
cp /tmp/trace-icon-export/32x32.png apps/trace/public/favicon.png
```

Only the Mac and shared PNG assets are copied into the app. Tauri also emits
other platforms' files into the temporary export directory; those are not part
of Trace's current distribution.

The [design-system proposal](../DESIGN-SYSTEM-PROPOSAL.md) records the selected
identity alongside the broader, still-proposed component system.
