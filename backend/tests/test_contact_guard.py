"""AI edits may not introduce links, emails or phone numbers the person didn't provide. Also the daily AI quota."""

from app.agent.graph import Patch, PlanOp
from app.domain.models import Resume
from app.domain.ops import Op, apply_ops, contacts_in
from tests.test_api import create, plan


def test_contacts_are_normalised():
    assert contacts_in("see https://www.Example.com/me/ and mail A@B.io, call +39 333 123 4567") == {"example.com/me", "a@b.io", "393331234567"}
    assert contacts_in("born 1993-05-17, worked 2019-2022") == set()  # dates are not phone numbers


def _email(addr: str) -> Op:
    return Op(op="update_basics", patch={"email": addr})


def test_guard_rejects_new_contacts_unless_the_user_wrote_them():
    cv = Resume()
    bad = apply_ops(cv, [_email("evil@attacker.com")], allowed_text="please tidy my CV")
    assert bad.applied == [] and "evil@attacker.com" in bad.skipped[0]
    ok = apply_ops(cv, [_email("me@mine.com")], allowed_text="my email is me@mine.com")
    assert len(ok.applied) == 1 and ok.resume.basics.email == "me@mine.com"


def test_guard_allows_what_the_cv_already_has_and_is_off_without_allowed_text():
    cv = apply_ops(Resume(), [_email("me@mine.com")]).resume  # no guard: people can write anything
    again = apply_ops(cv, [_email("me@mine.com"), Op(op="update_basics", patch={"headline": "Dev"})], allowed_text="")
    assert len(again.applied) == 2


async def test_chat_cannot_be_steered_into_adding_an_unknown_email(client, infra):
    doc = await create(client)
    infra.llm.plans.append(plan("Done.", PlanOp(op="update_basics", patch=Patch(email="evil@attacker.com"))))
    infra.llm.plans.append(plan("I can't add an email you didn't give me."))  # the repair round, after the guard refused the op
    out = (await client.post(f"/api/resumes/{doc['id']}/chat", json={"message": "polish my details"})).json()
    assert out["applied"] == [] and out["resume"]["version"] == 1


async def test_ai_daily_limit(client, infra):
    infra.settings.ai_daily_limit = 2
    codes = [(await client.post("/api/ai/improve", json={"text": f"t{i}"})).status_code for i in range(4)]
    assert codes == [200, 200, 429, 429]
