from __future__ import annotations

import asyncio
import os

from playwright.async_api import Browser, Playwright, async_playwright

_CANDIDATES = (
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
)


def find_chrome(configured: str = "") -> str | None:
    return next((p for p in (configured, *_CANDIDATES) if p and os.path.exists(p)), None)


class PdfRenderer:
    """Renders the React app's own print view with headless Chrome, so the PDF is real selectable text identical to Print."""

    def __init__(self, chrome_path: str = "", no_sandbox: bool = False):
        self.executable = find_chrome(chrome_path)
        self.no_sandbox = no_sandbox
        self._pw: Playwright | None = None
        self._browser: Browser | None = None
        self._lock = asyncio.Lock()

    @property
    def available(self) -> bool:
        return self.executable is not None

    async def _get_browser(self) -> Browser:
        async with self._lock:  # one shared browser; each render gets its own context
            if self._browser is None or not self._browser.is_connected():
                if self._pw is None:
                    self._pw = await async_playwright().start()
                args = ["--font-render-hinting=none"]
                if self.no_sandbox:  # containers: no user namespaces for the sandbox, and a tiny /dev/shm
                    args += ["--no-sandbox", "--disable-dev-shm-usage"]
                self._browser = await self._pw.chromium.launch(executable_path=self.executable, headless=True, args=args)
            return self._browser

    async def render(self, url: str) -> bytes:
        if not self.available:
            raise RuntimeError("Chrome was not found. Set CHROME_PATH in .env.")
        browser = await self._get_browser()
        ctx = await browser.new_context(viewport={"width": 1200, "height": 900})
        try:
            page = await ctx.new_page()
            await page.goto(url, wait_until="load", timeout=30_000)
            await page.evaluate("document.fonts.ready")
            # Wait until the paginator has produced a stable number of pages.
            last, stable = -1, 0
            for _ in range(24):
                n = await page.evaluate("document.querySelectorAll('.pg-pages > .pg-page').length")
                stable = stable + 1 if n > 0 and n == last else 0
                last = n
                if stable >= 2:
                    break
                await asyncio.sleep(0.25)
            if last < 1:
                raise RuntimeError("The CV did not render (is the frontend running at FRONTEND_URL?).")
            await page.emulate_media(media="print")
            return await page.pdf(prefer_css_page_size=True, print_background=True)
        finally:
            await ctx.close()

    async def close(self) -> None:
        if self._browser:
            await self._browser.close()
        if self._pw:
            await self._pw.stop()
        self._browser = self._pw = None
