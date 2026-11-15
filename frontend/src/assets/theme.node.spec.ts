// @vitest-environment node
/**
 * Color-contrast guard for both themes (WCAG 2.1 AA, which is what Section 508
 * points at). Reads the token values straight out of main.css, so a palette
 * tweak that drops any pairing below its minimum fails the build here instead
 * of shipping text someone can't read.
 *
 * Pairings checked are the ones the app actually uses: body/secondary/accent
 * text on every surface, text on accent buttons, form-field edges and the
 * focus ring (3:1, WCAG 1.4.11), and the theme-independent status/gold chips.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

type Oklch = [l: number, c: number, h: number]

// Read from disk (a `.node.spec`, so it runs in Node, see the top line):
// Vitest stubs out CSS imports, so `?raw` would come back empty.
const css = readFileSync(fileURLToPath(new URL('./main.css', import.meta.url)), 'utf8')

/** `--color-x: oklch(L% C H)` declarations inside the first block opened by `opener`. */
function tokensIn(opener: string): Record<string, Oklch> {
  const start = css.indexOf(opener)
  if (start < 0) throw new Error(`main.css has no "${opener}" block`)
  const body = css.slice(start, css.indexOf('\n}', start))
  const tokens: Record<string, Oklch> = {}
  // Opaque colors only — alpha values (scrim) aren't text or controls.
  const decl = /--color-([\w-]+):\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)/g
  for (const [, name, l, c, h] of body.matchAll(decl)) {
    tokens[name!] = [Number(l) / 100, Number(c), Number(h)]
  }
  return tokens
}

/** OKLCH → linear sRGB (clipped to gamut) → WCAG relative luminance. */
function luminance([l, c, h]: Oklch): number {
  const a = c * Math.cos((h * Math.PI) / 180)
  const b = c * Math.sin((h * Math.PI) / 180)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clip = (x: number) => Math.min(1, Math.max(0, x))
  const r = clip(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_)
  const g = clip(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_)
  const bl = clip(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_)
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl
}

function contrast(x: Oklch, y: Oklch): number {
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p)
  return (hi! + 0.05) / (lo! + 0.05)
}

const dark = tokensIn('@theme {')
const light = { ...dark, ...tokensIn(":root[data-theme='light'] {") }
const SURFACES = ['canvas', 'surface', 'elevated'] as const

describe.each([
  ['dark', dark],
  ['light', light],
])('%s theme contrast', (_name, t) => {
  const pair = (fg: string, bg: string) => contrast(t[fg]!, t[bg]!)

  it.each(SURFACES)('text on %s meets 4.5:1', (bg) => {
    for (const fg of ['ink', 'muted', 'accent']) {
      expect(pair(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(SURFACES)('form-field edges and the focus ring on %s meet 3:1', (bg) => {
    expect(pair('control', bg), `control on ${bg}`).toBeGreaterThanOrEqual(3)
    expect(pair('accent', bg), `focus ring on ${bg}`).toBeGreaterThanOrEqual(3)
  })

  it('text on an accent button meets 4.5:1, resting and hovered', () => {
    expect(pair('accent-ink', 'accent')).toBeGreaterThanOrEqual(4.5)
    expect(pair('accent-ink', 'accent-hover')).toBeGreaterThanOrEqual(4.5)
  })
})

describe('theme-independent chips', () => {
  it.each(['success', 'warning', 'error', 'gold'])('%s ink on its fill meets 4.5:1', (name) => {
    expect(contrast(dark[`${name}-ink`]!, dark[name]!)).toBeGreaterThanOrEqual(4.5)
  })
})
