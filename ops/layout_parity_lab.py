"""Credential-free version of tests/test_layout_parity.py, on the dev server's /lab page (no sign-in, no stack needed).

    cd backend && uv run python ../ops/layout_parity_lab.py <dev-server-port> [layout-id ...]

For each layout, page 1 of the sample CV is compared screen vs Print dialog (print_background=False) vs a PDF with backgrounds on:
every painted background box on the page must have the same colour at its centre. Same rule and tolerance as the real check
(`make check-layouts`, which stays the gate). Writes <layout>.png side by side into backend/layout-parity-lab/. Exit 1 on any failure."""
import sys
from pathlib import Path

import fitz
from playwright.sync_api import sync_playwright

from app.domain.catalog import LAYOUTS
from app.services.pdf import find_chrome

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend" / "tests"))
from test_layout_parity import BACKGROUNDS, TOLERANCE, px, raster  # noqa: E402

port, only = sys.argv[1], sys.argv[2:]
out = Path(__file__).resolve().parents[1] / "backend" / "layout-parity-lab"
out.mkdir(exist_ok=True)
bad = 0
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=find_chrome(""), headless=True)
    for layout in only or sorted(LAYOUTS):
        pg = b.new_page(viewport={"width": 1200, "height": 1400})
        pg.goto(f"http://localhost:{port}/lab/{layout}?data=sample")
        pg.wait_for_selector(".pg-pages > .pg-page")
        pg.evaluate("document.fonts.ready")
        pg.wait_for_timeout(1200)
        pg.add_style_tag(content=".pg-pages{zoom:1 !important}")
        shot = fitz.Pixmap(pg.locator(".pg-pages > .pg-page").first.screenshot())
        boxes = pg.evaluate(BACKGROUNDS)
        pg.emulate_media(media="print")
        pdfs = {"print dialog": raster(pg.pdf(prefer_css_page_size=True, print_background=False)), "PDF": raster(pg.pdf(prefer_css_page_size=True, print_background=True))}
        pg.close()
        missing = [f"{n}: .{x['cls']} at ({x['x']:.0f},{x['y']:.0f})px is {px(p, x['x'], x['y'])}, on screen {px(shot, x['x'], x['y'])}"
                   for n, p in pdfs.items() for x in boxes if max(abs(a - g) for a, g in zip(px(shot, x['x'], x['y']), px(p, x['x'], x['y']))) > TOLERANCE]
        if not boxes:
            missing = ["paints no backgrounds at all (page 1 needs at least one coloured background)"]
        bad += bool(missing)
        print(("FAIL " if missing else "ok   ") + layout)
        for m in missing[:8]:
            print("     ", m)
        fitz.Pixmap(shot).save(str(out / f"{layout}-screen.png"))
        pdfs["print dialog"].save(str(out / f"{layout}-print.png"))
    b.close()
sys.exit(1 if bad else 0)
