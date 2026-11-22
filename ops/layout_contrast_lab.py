"""WCAG contrast audit of one or all layouts on the dev server's /lab page (sample CV, every page).

    cd backend && uv run python ../ops/layout_contrast_lab.py <dev-server-port> [layout-id ...]

For every element with its own text, the text colour is compared with the colour behind it (nearest opaque ancestor background, rgba blended;
the page colour otherwise). Needs 4.5:1, or 3:1 for large text (>= 18pt, or >= 14pt bold). Gradients and images are not understood: text over
one is reported as "?" (check those by hand). Exit 1 on any failure."""
import sys

from playwright.sync_api import sync_playwright

from app.domain.catalog import LAYOUTS
from app.services.pdf import find_chrome

JS = """(() => {
  const parse = (c) => { const m = c.match(/[\\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 } }
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4 }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b) }
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 })
  const out = new Map()
  for (const el of document.querySelectorAll('.pg-pages *')) {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(' ')
    if (!own) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    let fg = parse(cs.color), chain = [], uncertain = false
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n)
      if (s.backgroundImage !== 'none') uncertain = true
      const bg = parse(s.backgroundColor)
      if (bg.a > 0) { chain.push(bg); if (bg.a >= 1) break }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 }
    for (const bg of chain.reverse()) base = over(bg, base)
    fg = over(fg, base)
    const L1 = lum(fg), L2 = lum(base), ratio = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05)
    const pt = parseFloat(cs.fontSize) * 0.75, large = pt >= 18 || (pt >= 14 && +cs.fontWeight >= 700)
    const need = large ? 3 : 4.5
    if (ratio < need || uncertain) {
      const key = `${el.className} | ${cs.color} on ${uncertain ? '? (gradient/image behind)' : `rgb(${base.r|0},${base.g|0},${base.b|0})`}`
      if (!out.has(key)) out.set(key, { ratio: +ratio.toFixed(2), need, pt: +pt.toFixed(1), text: own.slice(0, 30), uncertain })
    }
  }
  return [...out].map(([k, v]) => ({ k, ...v }))
})()"""

port, only = sys.argv[1], sys.argv[2:]
bad = 0
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=find_chrome(""), headless=True)
    for layout in only or sorted(LAYOUTS):
        pg = b.new_page(viewport={"width": 1200, "height": 1400})
        pg.goto(f"http://localhost:{port}/lab/{layout}?data=sample")
        pg.wait_for_selector(".pg-pages > .pg-page")
        pg.evaluate("document.fonts.ready")
        pg.wait_for_timeout(1000)
        rows = pg.evaluate(JS)
        pg.close()
        fails = [r for r in rows if not r["uncertain"]]
        bad += bool(fails)
        print(("FAIL " if fails else "ok   ") + layout + (f"  (+{len(rows) - len(fails)} over gradients/images: check by hand)" if len(rows) > len(fails) else ""))
        for r in rows[:12]:
            print(f"      {'?' if r['uncertain'] else f'{r['ratio']}<{r['need']}'}  {r['k']}  ({r['pt']}pt) \"{r['text']}\"")
    b.close()
sys.exit(1 if bad else 0)
