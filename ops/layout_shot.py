"""Screenshots of one layout in the dev server's /lab page (screen + print-dialog, on sample / empty / long data).

    cd backend && uv run python ../ops/layout_shot.py <layout-id> <dev-server-port> <out-dir>

Run the dev server first from the same checkout:  DEV_WEB_PORT=<port> npx vite   (no sign-in or API needed for /lab).
Writes <out-dir>/<layout>-<data>-p<N>.png (every page) and <layout>-sample-print-p1.png (what Print gives with default settings).
"""
import sys
from pathlib import Path

import fitz
from playwright.sync_api import sync_playwright

from app.services.pdf import find_chrome

layout, port, out = sys.argv[1], sys.argv[2], Path(sys.argv[3])
out.mkdir(parents=True, exist_ok=True)
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=find_chrome(""), headless=True)
    for data in ("sample", "empty", "long"):
        pg = b.new_page(viewport={"width": 900, "height": 1200}, device_scale_factor=1.5)
        msgs = []
        pg.on("console", lambda m: msgs.append(m.text) if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: msgs.append(str(e)))
        pg.goto(f"http://localhost:{port}/lab/{layout}?data={data}")
        pg.wait_for_selector(".pg-pages > .pg-page")
        pg.evaluate("document.fonts.ready")
        pg.wait_for_timeout(1500)
        pg.add_style_tag(content=".pg-pages{zoom:1 !important}")
        pages = pg.locator(".pg-pages > .pg-page")
        for i in range(pages.count()):
            pages.nth(i).screenshot(path=str(out / f"{layout}-{data}-p{i + 1}.png"))
        print(f"{data}: {pages.count()} page(s)", *(f"\n  console: {m}" for m in msgs[:5]))
        if data == "sample":
            pg.emulate_media(media="print")
            pdf = pg.pdf(prefer_css_page_size=True, print_background=False)
            fitz.open(stream=pdf, filetype="pdf")[0].get_pixmap(dpi=110).save(str(out / f"{layout}-sample-print-p1.png"))
        pg.close()
    b.close()
