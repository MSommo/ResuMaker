"""Every layout must look the same on screen, in the browser's Print dialog and in the downloaded PDF (opt-in: `make check-layouts`, needs `make stack`).

For each layout in the catalog a sample CV is opened in headless Chrome and page 1 is compared three ways, side by side:

    screen  |  Print dialog (backgrounds NOT printed unless the page forces them)  |  the PDF the server makes

Every painted background on the page (skill bars, rules, dots, tracks, tinted blocks...) must appear, with the same colour, at the same place in both
PDFs. That is what once made skill-bar values vanish from the sidebar layout. The images are saved to `layout-parity/` for a human look.
A NEW LAYOUT needs no test code: it is picked up from `app.domain.catalog.LAYOUTS` and must pass this before it is merged."""

import base64
import os
from pathlib import Path

import httpx
import pytest

pytest.importorskip("fitz")  # PyMuPDF rasterises the PDFs
import fitz  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

from app.domain.catalog import LAYOUTS  # noqa: E402
from app.services.pdf import find_chrome  # noqa: E402

pytestmark = pytest.mark.stack
HOST = os.environ.get("APP_HOST", "localhost")
API = os.environ.get("EVAL_API") or f"http://{HOST}:{os.environ.get('API_PORT', '8180')}/api"
WEB = os.environ.get("EVAL_WEB") or f"http://{HOST}:{os.environ.get('WEB_PORT', '5180')}"
H = {"x-resumaker": "1"}
OUT = Path(__file__).resolve().parents[1] / "layout-parity"
TOLERANCE = 48  # per colour channel: font smoothing and 1px edges, not a missing fill

# Every element on page 1 that paints a non-white background, with its box in CSS px relative to the page.
BACKGROUNDS = """(() => {
  const page = document.querySelector('.pg-pages > .pg-page'), o = page.getBoundingClientRect(), out = []
  for (const el of page.querySelectorAll('*')) {
    const cs = getComputedStyle(el), m = cs.backgroundColor.match(/[\\d.]+/g)
    if (!m || (m[3] !== undefined && +m[3] < 0.5) || (+m[0] > 250 && +m[1] > 250 && +m[2] > 250)) continue
    const r = el.getBoundingClientRect()
    if (r.width >= 1 && r.height >= 1) out.push({ cls: String(el.className.baseVal ?? el.className), x: r.x - o.x + r.width / 2, y: r.y - o.y + r.height / 2 })
  }
  return out
})()"""


def raster(pdf: bytes) -> fitz.Pixmap:
    return fitz.open(stream=pdf, filetype="pdf")[0].get_pixmap(dpi=96, alpha=False)


def px(p: fitz.Pixmap, x: float, y: float) -> tuple[int, int, int]:
    x, y = min(max(int(x), 0), p.width - 1), min(max(int(y), 0), p.height - 1)
    return tuple(p.pixel(x, y))[:3]  # type: ignore[return-value]


def side_by_side(shots: dict[str, bytes], path: Path) -> None:
    cells = "".join(f"<figure><img src='data:image/png;base64,{base64.b64encode(b).decode()}'><figcaption>{k}</figcaption></figure>" for k, b in shots.items())
    path.parent.mkdir(exist_ok=True)
    path.with_suffix(".html").write_text(f"<style>body{{display:flex;gap:12px;margin:0;font:12px sans-serif}}img{{width:400px;border:1px solid #ccc}}</style>{cells}")
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=find_chrome(os.environ.get("CHROME_PATH", "")), headless=True)
        pg = b.new_page(viewport={"width": 1250, "height": 620})
        pg.goto(path.with_suffix(".html").as_uri())
        pg.screenshot(path=str(path), full_page=True)
        b.close()
    path.with_suffix(".html").unlink()


@pytest.fixture(scope="module")
def stack():
    if not find_chrome(os.environ.get("CHROME_PATH", "")):
        pytest.skip("Chrome not found (set CHROME_PATH)")
    with httpx.Client(base_url=API, headers=H, timeout=60) as c:
        try:
            if os.environ.get("EVAL_LOGIN"):
                c.post("/auth/login", json={"login": os.environ["EVAL_LOGIN"], "password": os.environ["EVAL_PASSWORD"]}).raise_for_status()
            me = c.get("/auth/me")
            me.raise_for_status()
        except (httpx.HTTPError, KeyError) as e:
            pytest.skip(f"needs `make stack` and a sign-in (EVAL_LOGIN / EVAL_PASSWORD): {e}")
        yield c, me.json()["persona"]["id"]  # the CVs made here are deleted again; the person is untouched


@pytest.mark.parametrize("layout", sorted(LAYOUTS))
def test_layout_prints_like_it_shows(stack, layout):
    c, persona = stack
    doc = c.post(f"/personas/{persona}/resumes", json={"template": "sample", "layoutId": layout}).json()
    assert any(s["kind"] == "levels" and s["items"] for s in doc["resume"]["sections"]), "the sample CV must have skill levels to compare"
    server_pdf = c.post(f"/resumes/{doc['id']}/pdf")
    assert server_pdf.status_code == 200, "the server could not render the PDF"

    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=find_chrome(os.environ.get("CHROME_PATH", "")), headless=True)
        ctx = browser.new_context(viewport={"width": 1200, "height": 1400})
        for ck in c.cookies.jar:
            ctx.add_cookies([{"name": ck.name, "value": ck.value, "domain": HOST, "path": "/api"}])
        page = ctx.new_page()
        page.goto(f"{WEB}/preview/{doc['id']}")
        page.wait_for_selector(".pg-pages > .pg-page")
        page.evaluate("document.fonts.ready")
        page.wait_for_timeout(1200)  # the paginator settles
        page.add_style_tag(content=".pg-pages{zoom:1 !important}")
        screen = page.locator(".pg-pages > .pg-page").first.screenshot()
        boxes = page.evaluate(BACKGROUNDS)
        page.emulate_media(media="print")
        dialog_pdf = page.pdf(prefer_css_page_size=True, print_background=False)  # what Print gives with default settings
        browser.close()

    assert boxes, "the layout paints no backgrounds at all?"
    shot, dialog, server = fitz.Pixmap(screen), raster(dialog_pdf), raster(server_pdf.content)
    side_by_side({"screen": screen, "print dialog": dialog.tobytes("png"), "downloaded PDF": server.tobytes("png")}, OUT / f"{layout}.png")

    missing = []
    for name, pdf in (("print dialog", dialog), ("downloaded PDF", server)):
        for b in boxes:
            want, got = px(shot, b["x"], b["y"]), px(pdf, b["x"], b["y"])
            if max(abs(a - g) for a, g in zip(want, got)) > TOLERANCE:
                missing.append(f"{name}: .{b['cls']} at ({b['x']:.0f},{b['y']:.0f})px is {got}, on screen {want}")
    assert not missing, f"{layout}: backgrounds differ between screen and print (see layout-parity/{layout}.png):\n" + "\n".join(missing[:15])
    c.delete(f"/resumes/{doc['id']}")
