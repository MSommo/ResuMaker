"""Turning an uploaded file into something the model can read. The file is untrusted: we check what it really is (not its name),
cap its size, never execute anything from it, and keep nothing on disk."""

from __future__ import annotations

import io
import re
import zipfile
from typing import Literal

from bs4 import BeautifulSoup, NavigableString, Tag

MAX_BYTES = 10 * 1024 * 1024          # upload limit
MAX_UNZIPPED = 60 * 1024 * 1024       # a .docx is a zip: refuse zip bombs
MAX_ZIP_ENTRIES = 3000
MAX_TEXT = 150_000                    # characters handed to the model

FileKind = Literal["pdf", "docx", "html"]


class ImportRejected(Exception):
    """The file can't be imported; `status` is the HTTP code and the message is safe to show to the user."""

    def __init__(self, message: str, status: int = 415):
        super().__init__(message)
        self.status = status


def _docx_zip(data: bytes) -> zipfile.ZipFile | None:
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ImportRejected("This file looks corrupt. Try exporting it again.") from None
    infos = zf.infolist()
    if len(infos) > MAX_ZIP_ENTRIES or sum(i.file_size for i in infos) > MAX_UNZIPPED:
        raise ImportRejected("This file is too large or complex to import.", 413)
    return zf


def sniff(data: bytes) -> FileKind:
    """What the bytes really are. The file name is ignored on purpose."""
    if not data:
        raise ImportRejected("The file is empty.", 422)
    if len(data) > MAX_BYTES:
        raise ImportRejected(f"The file is larger than {MAX_BYTES // (1024 * 1024)} MB.", 413)
    if data[:5] == b"%PDF-":
        return "pdf"
    if data[:4] == b"PK\x03\x04":
        names = set(_docx_zip(data).namelist())  # type: ignore[union-attr]
        if "word/document.xml" in names:
            return "docx"
        if "content.xml" in names:
            raise ImportRejected("OpenDocument files are not supported. Save it as DOCX or PDF.")
        raise ImportRejected("Unsupported file type. Use PDF, DOCX or HTML.")
    if data[:8] == bytes.fromhex("D0CF11E0A1B11AE1"):
        raise ImportRejected("Old .doc files are not supported. Save it as DOCX or PDF and try again.")
    head = data[:4096]
    if b"\x00" not in head and re.search(rb"<\s*(!doctype\s+html|html|head|body|div|p|h1|h2|section|table)\b", head, re.I):
        return "html"
    raise ImportRejected("Unsupported file type. Use PDF, DOCX or HTML.")


# ---------------------------------------------------------------- DOCX


def docx_to_text(data: bytes) -> str:
    """Body in reading order (headings, lists, tables, hyperlinks with their URLs), plus headers and text boxes, which CV
    templates love to put contact details in."""
    from docx import Document
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    _docx_zip(data)
    try:
        doc = Document(io.BytesIO(data))
    except Exception:  # noqa: BLE001  python-docx raises many things on odd files
        raise ImportRejected("This DOCX file could not be read. Try exporting it again.") from None

    def paragraph(p: Paragraph) -> str:
        parts: list[str] = []
        for item in p.iter_inner_content():
            if hasattr(item, "url"):  # a hyperlink
                text = item.text.strip()
                parts.append(f"{text} ({item.url})" if item.url and text and item.url not in text else text)
            else:
                parts.append(item.text)
        text = "".join(parts).strip()
        if not text:
            return ""
        style = (p.style.name if p.style is not None else "") or ""
        if style.startswith("Heading"):
            level = int(style.split()[-1]) if style.split()[-1].isdigit() else 2
            return f"{'#' * min(level, 4)} {text}"
        if style == "Title":
            return f"# {text}"
        if "List" in style or p._p.pPr is not None and p._p.pPr.numPr is not None:
            return f"- {text}"
        return text

    lines: list[str] = []
    for section in doc.sections:  # headers and footers
        for part in (section.header, section.footer):
            lines += [f"(header/footer) {t}" for p in part.paragraphs if (t := paragraph(p))]
    for child in doc.element.body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            if t := paragraph(Paragraph(child, doc)):
                lines.append(t)
        elif tag == "tbl":
            for row in Table(child, doc).rows:
                seen: set[int] = set()
                cells = []
                for c in row.cells:
                    if id(c._tc) in seen:  # merged cells repeat
                        continue
                    seen.add(id(c._tc))
                    if t := " ".join(x for p in c.paragraphs if (x := paragraph(p))).strip():
                        cells.append(t)
                if cells:
                    lines.append(" | ".join(cells))
    for p in doc.element.body.xpath(".//w:txbxContent//w:p"):  # text boxes (python-docx doesn't expose them)
        t = "".join(p.xpath(".//w:t/text()")).strip()
        if t:
            lines.append(f"(text box) {t}")
    out: list[str] = []
    for line in lines:  # text boxes appear twice in the XML (modern and fallback copies)
        if not out or out[-1] != line:
            out.append(line)
    return "\n".join(out)[:MAX_TEXT]


# ---------------------------------------------------------------- HTML

_BLOCK = {"p", "div", "section", "article", "header", "footer", "main", "aside", "nav", "ul", "ol", "li", "tr", "table", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "dl", "dt", "dd", "blockquote"}
_DROP = ["script", "style", "noscript", "template", "svg", "iframe", "object", "embed", "canvas", "head"]


def html_to_text(data: bytes) -> str:
    """Visible text with structure (headings, list items, table rows, links with URLs). Scripts and hidden elements are dropped."""
    soup = BeautifulSoup(data, "html.parser")  # picks the charset itself
    for t in soup(_DROP):
        t.decompose()
    for el in list(soup.find_all(True)):
        try:
            style = re.sub(r"\s+", "", el.get("style") or "").lower()
            if el.has_attr("hidden") or el.get("aria-hidden") == "true" or "display:none" in style or "visibility:hidden" in style:
                el.decompose()
        except Exception:  # noqa: BLE001  already removed with its parent
            continue

    lines: list[str] = []
    buf: list[str] = []

    def flush() -> None:
        text = re.sub(r"[ \t ]+", " ", "".join(buf)).strip()
        buf.clear()
        if text:
            lines.append(text)

    def walk(node: Tag) -> None:
        for ch in node.children:
            if isinstance(ch, NavigableString):
                if type(ch).__name__ in ("Comment", "Doctype", "CData", "ProcessingInstruction", "Declaration"):
                    continue
                buf.append(str(ch))
                continue
            name = (ch.name or "").lower()
            if name in ("td", "th"):
                walk(ch)
                buf.append(" | ")
                continue
            if name == "a" and ch.get("href", "").startswith(("http", "mailto:", "tel:")):
                text = ch.get_text(" ", strip=True)
                href = ch["href"].replace("mailto:", "").replace("tel:", "")
                buf.append(f"{text} ({href})" if text and href not in text else (text or href))
                continue
            block = name in _BLOCK
            if block:
                flush()
            if name.startswith("h") and len(name) == 2 and name[1].isdigit():
                buf.append("#" * min(int(name[1]), 4) + " ")
            elif name == "li":
                buf.append("- ")
            walk(ch)
            if block:
                flush()

    walk(soup)
    flush()
    cleaned = [re.sub(r"\s*\|\s*$", "", ln) for ln in lines]
    return "\n".join(ln for ln in cleaned if ln.strip(" |"))[:MAX_TEXT]
