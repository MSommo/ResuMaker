from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import PersonaRow, ResumeRow, utcnow
from ..domain.models import Address, PersonalDetails


class PersonaNotFound(Exception):
    pass


def to_details(p: PersonaRow) -> PersonalDetails:
    return PersonalDetails(
        firstName=p.first_name, lastName=p.last_name, email=p.email, phone=p.phone,
        address=Address(street=p.street, city=p.city, postcode=p.postcode, country=p.country),
        birthDate=p.birth_date, birthPlace=p.birth_place, nationality=p.nationality,
    )


def apply_details(p: PersonaRow, d: PersonalDetails) -> bool:
    """Copy `d` onto the row; returns whether anything actually changed."""
    new = {
        "first_name": d.firstName, "last_name": d.lastName, "email": d.email, "phone": d.phone,
        "street": d.address.street, "city": d.address.city, "postcode": d.address.postcode, "country": d.address.country,
        "birth_date": d.birthDate, "birth_place": d.birthPlace, "nationality": d.nationality,
    }
    changed = False
    for col, val in new.items():
        if getattr(p, col) != val:
            setattr(p, col, val)
            changed = True
    if changed:
        p.updated_at = utcnow()
    return changed


async def list_personas(s: AsyncSession) -> list[tuple[PersonaRow, int]]:
    q = (
        select(PersonaRow, func.count(ResumeRow.id))
        .join(ResumeRow, ResumeRow.persona_id == PersonaRow.id, isouter=True)
        .group_by(PersonaRow.id)
        .order_by(PersonaRow.created_at)
    )
    return [(p, n) for p, n in (await s.execute(q)).all()]


async def get_persona(s: AsyncSession, pid: uuid.UUID) -> PersonaRow:
    row = await s.get(PersonaRow, pid)
    if row is None:
        raise PersonaNotFound(str(pid))
    return row


async def create_persona(s: AsyncSession, d: PersonalDetails) -> PersonaRow:
    row = PersonaRow(id=uuid.uuid4())
    apply_details(row, d)
    s.add(row)
    await s.commit()
    return row


async def update_persona(s: AsyncSession, pid: uuid.UUID, d: PersonalDetails) -> PersonaRow:
    row = await get_persona(s, pid)
    apply_details(row, d)
    await s.commit()
    return row


async def delete_persona(s: AsyncSession, pid: uuid.UUID) -> None:
    """Also deletes the persona's CVs and their chat history (database-level cascade)."""
    await s.delete(await get_persona(s, pid))
    await s.commit()


async def persona_resumes(s: AsyncSession, pid: uuid.UUID) -> list[ResumeRow]:
    return list((await s.scalars(select(ResumeRow).where(ResumeRow.persona_id == pid).order_by(ResumeRow.updated_at.desc()))).all())
