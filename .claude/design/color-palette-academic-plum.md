# Chalk Talk — Academic Plum Palette (saved 2026-06-04)

Saved for later evaluation. Source: ChatGPT design rec (after Slides v2 critique).
Potential successor to the current `--plum-rich` / `--plum-deep` brand colors.

## Primary purple palette

| Token | Hex | Role |
|---|---|---|
| Primary | `#43215A` | Deep Aubergine — display headers, hero gradient start |
| Secondary | `#5B357A` | Accent — body emphasis, secondary buttons |
| Tertiary | `#7A4FA3` | Light Purple — pill chips, light accents |
| Tint | `#F2EBF8` | Background — section bg, callout fills |
| Surface | `#F7F4FB` | Soft Background — page bg, drawer fills |

## Neutrals

| Token | Hex | Role |
|---|---|---|
| Text Primary | `#1F1F23` | Body text |
| Text Secondary | `#6B7280` | Meta text, captions |
| Border | `#E5E7EB` | Hairline borders |
| Dividers | `#F3F4F6` | Section dividers |
| White | `#FFFFFF` | Pure surface |

## Hero gradient

`linear-gradient(145deg, #43215A 0%, #5B357A 55%, #7A4FA3 100%)`

## How this compares to current tokens

Current Chalk Talk plum tokens (from index.html `:root`):
- `--plum-deep`: deeper, redder violet
- `--plum-rich`: brighter violet
- `--plum`: mid-tone

The proposed palette is **slightly cooler and more aubergine** — leans NEJM/JAMA editorial vs. the current more vibrant violet. The mid-purple `#7A4FA3` is close to current `--plum`, but the dark `#43215A` is meaningfully more academic/restrained than current `--plum-deep`.

## Migration cost (if adopted)

Low. Change is centralized in CSS custom properties at the top of `index.html`. About 8 `:root` variables would need to swap. ~10 minutes of work + 1 test cycle.

## Decision: deferred

Keep current plum brand for now. Revisit after sharing feature ships and visual identity needs another critique pass.
