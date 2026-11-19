"""Human-readable differences between two versions of a CV. Pure functions, no I/O.

Used for version history ("what did the assistant change?"), dry-run previews, and the approve/reject step.
"""

from __future__ import annotations

from typing import Any

from .catalog import get_layout
from .models import Resume, Section


def _short(text: str, n: int = 40) -> str:
    text = " ".join(text.split())
    return text if len(text) <= n else text[: n - 1] + "…"


def _items(sec: Section) -> list[Any]:
    return list(getattr(sec, "items", []))


def _item_label(sec: Section, it: Any) -> str:
    kind = sec.kind
    label = (it.title or it.organisation) if kind == "entries" else it.name if kind == "levels" else it.label if kind == "links" else ""
    return label or "item"


def _changed_fields(a: Any, b: Any) -> list[str]:
    da, db = a.model_dump(exclude={"id"}), b.model_dump(exclude={"id"})
    return [k for k in db if da.get(k) != db[k]]


def _zone_label(layout_id: str, zone: str) -> str:
    return next((z.label for z in get_layout(layout_id).zones if z.id == zone), zone)


def diff_resumes(old: Resume, new: Resume) -> list[str]:
    """What changed from `old` to `new`, one short line per change; empty if nothing did."""
    out: list[str] = []

    if old.layoutId != new.layoutId:
        out.append(f"Layout: {old.layoutId} → {new.layoutId}")
    if old.basics.headline != new.basics.headline:
        out.append(f"Headline: “{_short(old.basics.headline)}” → “{_short(new.basics.headline)}”")
    personal = _changed_fields(old.basics, new.basics)
    personal = [k for k in personal if k != "headline"]
    if personal:
        out.append(f"Personal info changed ({', '.join(personal)})")

    olds = {s.id: s for s in old.sections}
    news = {s.id: s for s in new.sections}

    for sid, s in news.items():
        if sid not in olds:
            where = f" in {_zone_label(new.layoutId, s.zone)}" if s.zone else " (not shown in the CV)"
            out.append(f"Added section “{s.title}”{where}")
    for sid, s in olds.items():
        if sid not in news:
            out.append(f"Deleted section “{s.title}”")

    for sid, n in news.items():
        o = olds.get(sid)
        if o is None:
            continue
        if o.title != n.title:
            out.append(f"Renamed section “{o.title}” → “{n.title}”")
        title = n.title
        if o.zone != n.zone:
            if n.zone is None:
                out.append(f"Removed “{title}” from the CV")
            elif o.zone is None:
                out.append(f"Restored “{title}” to the CV")
            else:
                out.append(f"Moved “{title}” to {_zone_label(new.layoutId, n.zone)}")
        if o.icon != n.icon:
            out.append(f"Changed the icon of “{title}”")
        if o.kind == "text" and n.kind == "text" and o.text != n.text:
            out.append(f"Edited the text of “{title}”")
        if o.kind == "entries" and n.kind == "entries" and o.job != n.job:
            out.append(f"Changed the title format of “{title}”")

        if o.kind == n.kind and o.kind in ("entries", "levels", "links"):
            oi = {i.id: i for i in _items(o)}
            ni = {i.id: i for i in _items(n)}
            for iid, it in ni.items():
                if iid not in oi:
                    out.append(f"Added “{_item_label(n, it)}” to “{title}”")
            for iid, it in oi.items():
                if iid not in ni:
                    out.append(f"Removed “{_item_label(o, it)}” from “{title}”")
            for iid, it in ni.items():
                if iid in oi:
                    fields = _changed_fields(oi[iid], it)
                    if fields:
                        out.append(f"Edited “{_item_label(n, it)}” in “{title}” ({', '.join(fields)})")
            common_old = [i for i in oi if i in ni]
            common_new = [i for i in ni if i in oi]
            if common_old != common_new:
                out.append(f"Reordered the items in “{title}”")

    # Section order within the CV (only among sections present in both and shown).
    shown_old = [s.id for s in old.sections if s.zone is not None and s.id in news and news[s.id].zone is not None]
    shown_new = [s.id for s in new.sections if s.zone is not None and s.id in olds and olds[s.id].zone is not None]
    if sorted(shown_old) == sorted(shown_new) and shown_old != shown_new:
        # Moves between columns are already reported above; report order changes only when everything stayed put.
        if all(olds[i].zone == news[i].zone for i in shown_old):
            out.append("Reordered the sections")
    return out
