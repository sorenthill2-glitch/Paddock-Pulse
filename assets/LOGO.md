# Paddock Pulse logo

The logo is a heartbeat pulse line laid down as a tyre skid mark. It fades in from the left, spikes, and drifts off at the end. Do not redraw it: use the files in this folder as they are.

## Files
| File | Use |
|---|---|
| `logo-mark-dark-bg.svg` | Main mark for dark backgrounds (the app's navy theme). Header, splash, about screen. |
| `logo-mark-light-bg.svg` | Same mark in dark rubber for light backgrounds (the app's Light theme, docs, README). |
| `logo-mark-solid.svg` | Simplified solid line. Use for anything under about 48px: tab icon, tiny header icon, favicon. |
| `icon.svg` | App icon (navy rounded square with the mark). Source for the PNG and ICO. |
| `icon-small.svg` | Same icon, solid line. Source for the 16 to 48px sizes in the ICO. |
| `icon-256.png`, `icon-512.png` | PNG exports of the app icon. Use `icon-512.png` as the electron-builder source if it wants a PNG. |
| `icon.ico` | Windows icon with 16, 24, 32, 48, 64, 128 and 256px sizes. Use for the installer and shortcuts. |

## Colours
- Navy ground: `#0A1128` (raised panels `#141C3A`)
- Accent (red-coral): `#FF5A4F`. Alternates tried: amber `#FFB020`, teal `#2EE6C5`, blue `#5B8CFF`
- Text on dark: `#F4F6FC`
- Light-background version: rubber `#161A26`, accent `#D3262B`, ground `#F7F8FC`

## Wordmark
"PADDOCK PULSE" in Barlow Condensed, Bold Italic (Google Fonts), uppercase, letter-spacing about 0.05em. "PADDOCK" is in the text colour and "PULSE" in the accent. It is live text, not an image, so load the font (bundle it locally in the app, since the app may run offline) or fall back to a bold condensed sans.

## Rules
- Do not recolour the line, change its shape or add effects. A changed accent colour is fine if the app theme needs it.
- The groove down the middle of the dark mark is drawn in the navy ground colour, so keep the dark mark on `#0A1128` or very close to it. On other dark backgrounds, edit the groove stroke to match.
- Under about 48px, always use the solid version, never the textured one.
- Keep clear space around the mark of at least the height of the line's thickness.
