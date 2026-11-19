"""Typed CV document. Mirrors src/model/types.ts: keep the two in sync (tests/test_catalog_parity.py checks the catalog)."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

IconId = Literal["none", "user", "briefcase", "badge", "cap", "star", "bookmark"]
SectionKind = Literal["details", "text", "entries", "levels", "links"]


class _Model(BaseModel):
    model_config = ConfigDict(extra="ignore")  # tolerate unknown keys from older/newer clients


class Entry(_Model):
    id: str
    title: str = ""
    organisation: str = ""
    location: str = ""
    start: str = ""  # YYYY-MM
    end: str = ""
    current: bool = False
    note: str = ""
    description: str = ""
    bullets: list[str] = Field(default_factory=list)  # a line starting with "#" is a subheading


class Leveled(_Model):
    id: str
    name: str = ""
    level: int = Field(default=3, ge=0, le=5)


class LinkItem(_Model):
    id: str
    label: str = ""
    url: str = ""


class Address(_Model):
    street: str = ""
    city: str = ""
    postcode: str = ""
    country: str = ""  # ISO 3166-1 alpha-2


class PersonalDetails(_Model):
    """Who the person is. Stored once on the persona and shared by all of their CVs."""

    firstName: str = ""  # noqa: N815  (camelCase on purpose: this is the JSON contract with the frontend)
    lastName: str = ""  # noqa: N815
    email: str = ""
    phone: str = ""
    address: Address = Field(default_factory=Address)
    birthDate: str = ""  # noqa: N815  (YYYY-MM-DD)
    birthPlace: str = ""  # noqa: N815
    nationality: str = ""


class Basics(PersonalDetails):
    """What a CV shows at the top: the persona's details plus this CV's own headline (e.g. the role it targets)."""

    headline: str = ""


class _SectionBase(_Model):
    id: str
    title: str = ""
    zone: str | None = None  # None = stashed in the drawer (content kept)
    icon: IconId = "none"


class DetailsSection(_SectionBase):
    kind: Literal["details"] = "details"


class TextSection(_SectionBase):
    kind: Literal["text"] = "text"
    text: str = ""


class EntriesSection(_SectionBase):
    kind: Literal["entries"] = "entries"
    items: list[Entry] = Field(default_factory=list)
    job: bool = False


class LevelsSection(_SectionBase):
    kind: Literal["levels"] = "levels"
    items: list[Leveled] = Field(default_factory=list)


class LinksSection(_SectionBase):
    kind: Literal["links"] = "links"
    items: list[LinkItem] = Field(default_factory=list)


Section = Annotated[
    DetailsSection | TextSection | EntriesSection | LevelsSection | LinksSection,
    Field(discriminator="kind"),
]


class Resume(_Model):
    layoutId: str = "sidebar"  # noqa: N815
    basics: Basics = Field(default_factory=Basics)
    sections: list[Section] = Field(default_factory=list)

    @property
    def display_name(self) -> str:
        name = f"{self.basics.firstName} {self.basics.lastName}".strip()
        return name or "Untitled CV"
