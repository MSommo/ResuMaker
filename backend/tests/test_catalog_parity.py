"""The templates/layouts exist in TypeScript (UI) and Python (agent, MCP). This fails if they drift apart."""

import re
from pathlib import Path

from app.domain.catalog import LAYOUTS, TEMPLATES

SRC = Path(__file__).resolve().parents[2] / "src"


def test_templates_match_frontend():
    ts = (SRC / "model" / "templates.ts").read_text()
    found = re.findall(r"\{ id: '([a-z-]+)', label: '[^']*', blurb: '[^']*', kind: '(\w+)', zone: '(\w+)'", ts)
    assert found, "could not parse templates.ts"
    assert sorted(found) == sorted((t.id, t.kind, t.zone) for t in TEMPLATES)


def test_layouts_and_zones_match_frontend():
    ts = (SRC / "layouts" / "registry.ts").read_text()
    ids = re.findall(r"^\s+id: '([a-z]+)',\n\s+name:", ts, flags=re.M)
    assert sorted(ids) == sorted(LAYOUTS)
    for zone_id, accepts in re.findall(r"const \w+: Zone = \{ id: '(\w+)'.*?accepts: \[([^\]]*)\]", ts):
        want = {a.strip(" '") for a in accepts.split(",")}
        for layout in LAYOUTS.values():
            assert want == set(next(z for z in layout.zones if z.id == zone_id).accepts)
