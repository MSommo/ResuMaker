"""The single place where CV edits are validated and applied.

Used by the REST API, the LangGraph agent and the MCP server, so all three behave identically.
Ported from the original TypeScript engine (src/ai/ops.ts): same operations, same rules.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable

import pycountry
from pydantic import BaseModel, Field

from .catalog import LAYOUTS, accepts, get_layout, get_template, new_id
from .models import (
    Entry,
    EntriesSection,
    IconId,
    Leveled,
    LevelsSection,
    LinkItem,
    LinksSection,
    Resume,
    Section,
    TextSection,
)

ICONS = set(IconId.__args__)  # type: ignore[attr-defined]
_MONTH = re.compile(r"^\d{4}(-\d{2})?$")
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")

OP_NAMES = (
    "update_basics", "update_section", "add_section", "remove_section", "move_section",
    "add_item", "update_item", "remove_item", "move_item", "set_layout",
)


class Op(BaseModel):
    """One requested change. Deliberately permissive: validation happens in `apply_ops`."""

    op: str
    sectionId: str | None = None  # noqa: N815
    itemId: str | None = None  # noqa: N815
    template: str | None = None
    zone: str | None = None
    position: int | None = None
    layoutId: str | None = None  # noqa: N815
    patch: dict[str, Any] = Field(default_factory=dict)


@dataclass
class ApplyResult:
    resume: Resume
    applied: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    failed: list[tuple[Op, str]] = field(default_factory=list)  # the ops behind `skipped`, with reasons (for agent repair)
    applied_ops: list[Op] = field(default_factory=list)  # the ops behind `applied`, same order (to accept/reject individually)


class OpError(Exception):
    """A single op could not be applied; the message is shown to the user (and fed back to the agent)."""


# ---------------------------------------------------------------- layout helpers


def zone_accepts(layout_id: str, zone: str, kind: str, icon: str = "none") -> bool:
    z = next((z for z in get_layout(layout_id).zones if z.id == zone), None)
    return bool(z and accepts(z, kind, icon))


def pick_zone(layout_id: str, kind: str, prefer: str | None = None, icon: str = "none") -> str | None:
    """The preferred zone if it fits, else the first that does. The header is never picked automatically."""
    if prefer and zone_accepts(layout_id, prefer, kind, icon):
        return prefer
    return next((z.id for z in get_layout(layout_id).zones if z.id != "header" and accepts(z, kind, icon)), None)


def place_at(sections: list[Section], sec: Section, zone: str, position: int | None = None) -> list[Section]:
    """Insert `sec` at `position` (0-based) inside `zone`, or at the end of it."""
    without = [s for s in sections if s.id != sec.id]
    in_zone = [i for i, s in enumerate(without) if s.zone == zone]
    if position is None or position >= len(in_zone):
        idx = in_zone[-1] + 1 if in_zone else len(without)
    else:
        idx = in_zone[max(0, position)]
    sec = sec.model_copy(update={"zone": zone})
    return [*without[:idx], sec, *without[idx:]]


def with_layout(r: Resume, layout_id: str) -> None:
    """Switch layout in place; sections the new layout cannot host move to a zone that accepts them."""
    layout = get_layout(layout_id)
    r.layoutId = layout.id
    for s in r.sections:
        if s.zone is not None and not zone_accepts(layout.id, s.zone, s.kind, s.icon):
            s.zone = pick_zone(layout.id, s.kind, icon=s.icon)


# ---------------------------------------------------------------- patch sanitising


def _s(v: Any) -> str | None:
    return v if isinstance(v, str) else None


def entry_patch(p: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k in ("title", "organisation", "location", "note", "description"):
        if (v := _s(p.get(k))) is not None:
            out[k] = v
    for k in ("start", "end"):
        v = _s(p.get(k))
        if v is not None and (v == "" or _MONTH.match(v)):
            out[k] = v
    if isinstance(p.get("current"), bool):
        out["current"] = p["current"]
    if isinstance(p.get("bullets"), list):
        out["bullets"] = [b for b in p["bullets"] if isinstance(b, str)]
    return out


def _country_code(value: str) -> str:
    if re.fullmatch(r"[A-Za-z]{2}", value):
        return value.upper()
    try:
        return pycountry.countries.lookup(value).alpha_2
    except LookupError:
        return {"uk": "GB", "england": "GB", "scotland": "GB", "wales": "GB", "northern ireland": "GB"}.get(value.strip().lower(), "")


def apply_basics(r: Resume, p: dict[str, Any]) -> list[str]:
    changed: list[str] = []
    b = r.basics
    for k in ("firstName", "lastName", "headline", "email", "phone", "birthPlace", "nationality"):
        if (v := _s(p.get(k))) is not None:
            setattr(b, k, v)
            changed.append(k)
    for k in ("street", "city", "postcode"):
        if (v := _s(p.get(k))) is not None:
            setattr(b.address, k, v)
            changed.append(k)
    if (c := _s(p.get("country"))) is not None:
        code = _country_code(c) if c else ""
        if code or c == "":
            b.address.country = code
            changed.append("country")
    if (d := _s(p.get("birthDate"))) is not None and (d == "" or _DAY.match(d)):
        b.birthDate = d
        changed.append("birthDate")
    return changed


def _item_label(sec: Section, it: Any) -> str:
    if isinstance(sec, EntriesSection):
        return it.title or it.organisation or "item"
    if isinstance(sec, LevelsSection):
        return it.name or "item"
    if isinstance(sec, LinksSection):
        return it.label or "item"
    return "item"


# ---------------------------------------------------------------- contact guard

_URL = re.compile(r"(?:https?://|www\.)[^\s<>\"')\]]+", re.I)
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_PHONE = re.compile(r"(?<![\d-])(?!\d{4}-\d{2}-\d{2}(?!\d))(?!(?:19|20)\d{2}\s*[-–]\s*(?:19|20)\d{2}(?!\d))\+?\d[\d\s().-]{6,}\d")


def contacts_in(text: str) -> set[str]:
    """Links, emails and phone numbers found in `text`, normalised so the same one written differently compares equal."""
    out = {re.sub(r"^(?:https?://)?(?:www\.)?", "", u.lower()).rstrip("/.,;") for u in _URL.findall(text)}
    out |= {e.lower() for e in _EMAIL.findall(text)}
    out |= {d for p in _PHONE.findall(text) if len(d := re.sub(r"\D", "", p)) >= 7}
    return out


def _resume_text(r: Resume) -> str:
    return r.model_dump_json()


# ---------------------------------------------------------------- the engine


def apply_ops(resume: Resume, ops: list[Op], allowed_text: str | None = None) -> ApplyResult:
    """Apply `ops` to a copy of `resume`. Bad ops are skipped with a reason; good ones still apply.

    `allowed_text` switches on the contact guard, used for ops the AI proposed: an op may not introduce a link, email or phone
    number that is neither already in the CV nor in `allowed_text` (what the person wrote or told us). Ops from people don't use it."""
    r = resume.model_copy(deep=True)
    res = ApplyResult(resume=r)
    known = contacts_in(_resume_text(r) + "\n" + allowed_text) if allowed_text is not None else None
    id_map: dict[str, str] = {}  # ids the caller invented for new things → the real ids

    def real(i: str | None) -> str:
        return id_map.get(i, i) if i else ""

    def find(i: str | None) -> Section | None:
        sid = real(i)
        return next((s for s in r.sections if s.id == sid), None)

    def need(i: str | None) -> Section:
        if (s := find(i)) is None:
            raise OpError("unknown section")
        return s

    def fresh(wanted: str | None) -> str:
        taken = {s.id for s in r.sections} | {it.id for s in r.sections for it in getattr(s, "items", [])}
        return wanted if wanted and wanted not in taken and wanted not in id_map else new_id()

    def items_of(s: Section) -> list[Any]:
        if isinstance(s, (EntriesSection, LevelsSection, LinksSection)):
            return s.items
        raise OpError("that section has no items")

    def update_basics(op: Op) -> str:
        fields = apply_basics(r, op.patch)
        if not fields:
            raise OpError("nothing to change")
        return f"Updated personal info ({', '.join(fields)})"

    def update_section(op: Op) -> str:
        s = need(op.sectionId)
        p: dict[str, Any] = {}
        if (v := _s(op.patch.get("title"))) is not None:
            p["title"] = v
        if (v := _s(op.patch.get("icon"))) is not None and v in ICONS:
            p["icon"] = v
        if isinstance(s, TextSection) and (v := _s(op.patch.get("text"))) is not None:
            p["text"] = v
        if isinstance(s, EntriesSection) and isinstance(op.patch.get("job"), bool):
            p["job"] = op.patch["job"]
        if not p:
            raise OpError("nothing to change")
        for k, v in p.items():
            setattr(s, k, v)
        return f"Updated section “{s.title}”"

    def add_section(op: Op) -> str:
        t = get_template(op.template or "")
        if not t:
            raise OpError(f"unknown template “{op.template}”")
        zone = op.zone if op.zone and zone_accepts(r.layoutId, op.zone, t.kind, t.icon) else pick_zone(r.layoutId, t.kind, t.zone, t.icon)
        if not zone:
            raise OpError("no column can hold it")
        sid = fresh(op.sectionId)
        if op.sectionId:
            id_map[op.sectionId] = sid
        from .catalog import make_section

        made = make_section(t, sid)
        if (v := _s(op.patch.get("title"))) is not None:
            made.title = v
        if isinstance(made, TextSection) and (v := _s(op.patch.get("text"))) is not None:
            made.text = v
        r.sections = place_at(r.sections, made, zone, op.position)
        return f"Added section “{made.title}”"

    def remove_section(op: Op) -> str:
        s = need(op.sectionId)
        s.zone = None
        return f"Removed “{s.title}” from the CV (kept in Components)"

    def move_section(op: Op) -> str:
        s = need(op.sectionId)
        if not op.zone or not zone_accepts(r.layoutId, op.zone, s.kind, s.icon):
            raise OpError("that column cannot hold it")
        r.sections = place_at(r.sections, s, op.zone, op.position)
        label = next((z.label for z in get_layout(r.layoutId).zones if z.id == op.zone), op.zone)
        return f"Moved “{s.title}” to {label}"

    def add_item(op: Op) -> str:
        s = need(op.sectionId)
        items = items_of(s)
        p = op.patch
        if isinstance(s, EntriesSection):
            if not ((_s(p.get("title")) or "").strip() or (_s(p.get("organisation")) or "").strip()):
                raise OpError("the new item had no content")
            item: Any = Entry(id="x", **entry_patch(p))
        elif isinstance(s, LevelsSection):
            if not (_s(p.get("name")) or "").strip():
                raise OpError("the new item had no content")
            try:
                lvl = min(5, max(1, round(float(p.get("level") or 3))))
            except (TypeError, ValueError):
                lvl = 3
            item = Leveled(id="x", name=_s(p.get("name")) or "", level=lvl)
        else:
            if not ((_s(p.get("label")) or "").strip() or (_s(p.get("url")) or "").strip()):
                raise OpError("the new item had no content")
            item = LinkItem(id="x", label=_s(p.get("label")) or "", url=_s(p.get("url")) or "")
        item.id = fresh(op.itemId)
        if op.itemId:
            id_map[op.itemId] = item.id
        pos = None if op.position is None else max(0, op.position)
        if pos is None or pos >= len(items):
            items.append(item)
        else:
            items.insert(pos, item)
        return f"Added “{_item_label(s, item)}” to “{s.title}”"

    def get_item(op: Op) -> tuple[Section, list[Any], Any]:
        s = need(op.sectionId)
        items = items_of(s)
        iid = real(op.itemId)
        cur = next((i for i in items if i.id == iid), None)
        if cur is None:
            raise OpError("unknown item")
        return s, items, cur

    def update_item(op: Op) -> str:
        s, _, cur = get_item(op)
        p: dict[str, Any] = {}
        if isinstance(s, EntriesSection):
            p = entry_patch(op.patch)
        elif isinstance(s, LevelsSection):
            if (v := _s(op.patch.get("name"))) is not None:
                p["name"] = v
            if op.patch.get("level") is not None:
                try:
                    p["level"] = min(5, max(1, round(float(op.patch["level"]))))
                except (TypeError, ValueError):
                    pass
        else:
            for k in ("label", "url"):
                if (v := _s(op.patch.get(k))) is not None:
                    p[k] = v
        if not p:
            raise OpError("nothing to change")
        for k, v in p.items():
            setattr(cur, k, v)
        return f"Edited “{_item_label(s, cur)}” in “{s.title}”"

    def remove_item(op: Op) -> str:
        s, items, cur = get_item(op)
        items.remove(cur)
        return f"Removed “{_item_label(s, cur)}” from “{s.title}”"

    def move_item(op: Op) -> str:
        s, items, cur = get_item(op)
        if op.position is None:
            raise OpError("unknown item or position")
        items.remove(cur)
        items.insert(min(max(0, op.position), len(items)), cur)
        return f"Reordered “{_item_label(s, cur)}” in “{s.title}”"

    def set_layout(op: Op) -> str:
        if not op.layoutId or op.layoutId not in LAYOUTS:
            raise OpError("unknown layout")
        with_layout(r, op.layoutId)
        return f"Switched to the {LAYOUTS[op.layoutId].name} layout"

    handlers: dict[str, Callable[[Op], str]] = {
        "update_basics": update_basics, "update_section": update_section, "add_section": add_section,
        "remove_section": remove_section, "move_section": move_section, "add_item": add_item,
        "update_item": update_item, "remove_item": remove_item, "move_item": move_item, "set_layout": set_layout,
    }
    for op in ops:
        try:
            handler = handlers.get(op.op)
            if handler is None:
                raise OpError(f"unsupported operation “{op.op}”")
            if known is not None and (new := contacts_in(op.model_dump_json(exclude_none=True)) - known):
                raise OpError(f"it adds {', '.join(sorted(new))}, which is not in the CV or in what the user wrote; only use links, emails and phone numbers the user provided")
            res.applied.append(handler(op))
            res.applied_ops.append(op)
        except Exception as e:  # OpError, or anything unexpected: never let one bad op abort the rest
            res.skipped.append(f"{op.op}: {e}")
            res.failed.append((op, str(e)))
    return res
