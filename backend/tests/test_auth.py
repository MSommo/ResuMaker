"""Authentication and authorisation: who you are, what you may touch, and the ways it can go wrong."""

import uuid
from datetime import timedelta

import httpx
import pytest
from sqlalchemy import select, update

from app.api.deps import COOKIE, owned_resume, own_persona
from app.db import SessionRow, UserRow, UserTokenRow, utcnow
from app.security import hash_token, normalize_login, password_problem, verify_password
from app.services import auth
from tests.conftest import HEADERS, PASSWORD, make_user
from tests.test_api import create

# /api/metrics needs no session but its own bearer token (METRICS_TOKEN), and is a 404 without one: tests/test_telemetry.py.
PUBLIC = {("GET", "/api/status"), ("GET", "/api/metrics"), ("POST", "/api/auth/login"), ("POST", "/api/auth/accept"), ("POST", "/api/auth/accept/check"), ("POST", "/api/auth/logout")}


# ---------------------------------------------------------------- secure by default


def _operations(app):
    """(METHOD, path) of every API operation, from the OpenAPI schema (independent of how routers are nested)."""
    for path, ops in app.openapi()["paths"].items():
        for method in ops:
            yield method.upper(), path


async def test_every_route_needs_a_session_except_the_public_ones(app, anon):
    seen_public = set()
    for method, path in _operations(app):
        url = path.replace("{", "").replace("}", "")  # placeholder ids: authentication runs before anything looks at them
        r = await anon.request(method, url, json={} if method != "GET" else None)
        if (method, path) in PUBLIC:
            seen_public.add((method, path))
            assert r.status_code != 403 or path == "/api/auth/logout", (method, path)
        else:
            assert r.status_code == 401, f"{method} {path} is reachable without signing in ({r.status_code})"
    assert seen_public == PUBLIC


async def test_every_route_with_an_id_checks_ownership():
    """A new route that forgets the ownership dependency would let any user read anyone's CV: fail loudly instead."""
    from app.api import auth_routes, routes

    checked = 0
    for router in (routes.router, routes.public, auth_routes.public, auth_routes.protected):
        for route in router.routes:
            deps = {d.call for d in route.dependant.dependencies}
            if "{resume_id}" in route.path:
                assert owned_resume in deps, f"{route.path} does not depend on owned_resume"
                checked += 1
            if "{persona_id}" in route.path:
                assert own_persona in deps, f"{route.path} does not depend on own_persona"
                checked += 1
    assert checked >= 20


async def test_admin_routes_are_admin_only(client, make_client):
    r = await client.get("/api/admin/users")
    assert r.status_code == 403
    assert (await (await make_client(role="admin")).get("/api/admin/users")).status_code == 200


# ---------------------------------------------------------------- signing in


async def test_login_sets_a_locked_down_cookie(anon, infra):
    u = await make_user(infra)
    r = await anon.post("/api/auth/login", json={"login": u.login.upper(), "password": PASSWORD})  # logins are case-insensitive
    assert r.status_code == 200 and r.json()["login"] == u.login and r.json()["role"] == "user"
    cookie = r.headers["set-cookie"].lower()
    assert f"{COOKIE}=" in cookie and "httponly" in cookie and "samesite=strict" in cookie and "path=/api" in cookie
    assert "password" not in r.text.lower().replace('"login"', "")  # no hash or secret in the response
    assert (await anon.get("/api/auth/me")).json()["persona"]["id"] == str(u.id)


async def test_the_cookie_holds_a_secret_only_its_hash_is_stored(anon, infra):
    u = await make_user(infra)
    await anon.post("/api/auth/login", json={"login": u.login, "password": PASSWORD})
    token = anon.cookies[COOKIE]
    async with infra.session() as s:
        rows = (await s.scalars(select(SessionRow).where(SessionRow.user_id == u.id))).all()
        assert [r.token_hash for r in rows] == [hash_token(token)] and token not in {r.token_hash for r in rows}
        assert (await s.get(UserRow, u.id)).password_hash.startswith("$argon2id$")


async def test_failures_are_indistinguishable(anon, infra):
    u = await make_user(infra)
    wrong = await anon.post("/api/auth/login", json={"login": u.login, "password": "not the password"})
    unknown = await anon.post("/api/auth/login", json={"login": "nobody@example.com", "password": "not the password"})
    unclaimed = await make_user(infra, password=None)
    nopw = await anon.post("/api/auth/login", json={"login": unclaimed.login, "password": "anything at all"})
    assert wrong.status_code == unknown.status_code == nopw.status_code == 401
    assert wrong.json() == unknown.json() == nopw.json()
    assert COOKIE not in anon.cookies


async def test_account_locks_after_repeated_failures_even_for_the_right_password(anon, infra):
    u = await make_user(infra)
    for _ in range(infra.settings.login_max_failures):
        assert (await anon.post("/api/auth/login", json={"login": u.login, "password": "wrong wrong wrong"})).status_code == 401
    assert (await anon.post("/api/auth/login", json={"login": u.login, "password": PASSWORD})).status_code == 401  # locked
    async with infra.session() as s:  # ...until the lock runs out
        await s.execute(update(UserRow).where(UserRow.id == u.id).values(locked_until=utcnow() - timedelta(seconds=1)))
        await s.commit()
    assert (await anon.post("/api/auth/login", json={"login": u.login, "password": PASSWORD})).status_code == 200


async def test_sign_in_attempts_are_rate_limited_per_ip(anon, infra, monkeypatch):
    from app.api import deps

    # Fixed 10-minute windows: a run that straddles a boundary (12:59:59 -> 13:00:00) would start counting again. Pin one window.
    monkeypatch.setattr(deps, "window_key", lambda prefix, who, seconds=60: f"rl:{prefix}:{who}:pinned")
    infra.settings.login_rate_limit_per_ip = 3
    codes = [(await anon.post("/api/auth/login", json={"login": "x@example.com", "password": "nope nope nope"})).status_code for _ in range(5)]
    assert codes == [401, 401, 401, 429, 429]


async def test_a_disabled_user_cannot_sign_in_and_loses_their_session(client, make_client, infra):
    boss = await make_client(role="admin")
    assert (await client.get("/api/auth/me")).status_code == 200
    assert (await boss.patch(f"/api/admin/users/{client.user.id}", json={"isActive": False})).status_code == 200
    assert (await client.get("/api/auth/me")).status_code == 401
    r = await client.post("/api/auth/login", json={"login": client.user.login, "password": PASSWORD})
    assert r.status_code == 403 and "administrator" in r.json()["error"]
    await boss.patch(f"/api/admin/users/{client.user.id}", json={"isActive": True})
    assert (await client.post("/api/auth/login", json={"login": client.user.login, "password": PASSWORD})).status_code == 200



async def test_a_disabled_account_only_says_so_to_the_right_password_and_never_locks(client, make_client, infra):
    boss = await make_client(role="admin")
    await boss.patch(f"/api/admin/users/{client.user.id}", json={"isActive": False})
    wrong = await client.post("/api/auth/login", json={"login": client.user.login, "password": "not the password"})
    assert wrong.status_code == 401 and "administrator" not in wrong.json()["error"]  # no hint for someone guessing
    for _ in range(infra.settings.login_max_failures + 1):
        assert (await client.post("/api/auth/login", json={"login": client.user.login, "password": PASSWORD})).status_code == 403
    await boss.patch(f"/api/admin/users/{client.user.id}", json={"isActive": True})
    assert (await client.post("/api/auth/login", json={"login": client.user.login, "password": PASSWORD})).status_code == 200


# ---------------------------------------------------------------- sessions


async def test_logout_ends_the_session_even_if_the_cookie_is_replayed(client, app):
    stolen = client.cookies[COOKIE]
    assert (await client.post("/api/auth/logout")).status_code == 204
    assert (await client.get("/api/auth/me")).status_code == 401
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS, cookies={COOKIE: stolen}) as thief:
        assert (await thief.get("/api/auth/me")).status_code == 401


async def test_sessions_expire_when_idle_and_at_their_absolute_end(client, infra):
    async with infra.session() as s:
        await s.execute(update(SessionRow).where(SessionRow.user_id == client.user.id).values(last_seen_at=utcnow() - timedelta(hours=infra.settings.session_idle_hours + 1)))
        await s.commit()
    assert (await client.get("/api/auth/me")).status_code == 401
    await client.post("/api/auth/login", json={"login": client.user.login, "password": PASSWORD})
    async with infra.session() as s:
        await s.execute(update(SessionRow).where(SessionRow.user_id == client.user.id).values(expires_at=utcnow() - timedelta(seconds=1)))
        await s.commit()
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_signing_in_replaces_a_cookie_planted_beforehand(anon, infra):
    u = await make_user(infra)
    await anon.post("/api/auth/login", json={"login": u.login, "password": PASSWORD})
    first = anon.cookies[COOKIE]
    await anon.post("/api/auth/login", json={"login": u.login, "password": PASSWORD})
    assert anon.cookies[COOKIE] != first
    async with infra.session() as s:
        assert await auth.resolve_session(s, infra.settings, first) is None


async def test_changing_the_password_needs_the_old_one_and_ends_other_sessions(client, make_client, app, infra):
    second = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS)
    await second.post("/api/auth/login", json={"login": client.user.login, "password": PASSWORD})
    assert (await client.post("/api/auth/password", json={"current": "wrong", "new": "a brand new passphrase"})).status_code == 403
    assert (await client.post("/api/auth/password", json={"current": PASSWORD, "new": "short"})).status_code == 422
    assert (await client.post("/api/auth/password", json={"current": PASSWORD, "new": "a brand new passphrase"})).status_code == 204
    assert (await client.get("/api/auth/me")).status_code == 200  # this one stays
    assert (await second.get("/api/auth/me")).status_code == 401  # the other one is gone
    assert (await client.post("/api/auth/login", json={"login": client.user.login, "password": PASSWORD})).status_code == 401
    await second.aclose()


# ---------------------------------------------------------------- CSRF


async def test_unsafe_requests_need_the_app_header_and_our_origin(anon, infra):
    u = await make_user(infra)
    body = {"login": u.login, "password": PASSWORD}
    assert (await anon.post("/api/auth/login", json=body, headers={"x-resumaker": "0"})).status_code == 403
    assert (await anon.post("/api/auth/login", json=body, headers={"origin": "https://evil.example"})).status_code == 403
    assert (await anon.post("/api/auth/login", json=body, headers={"origin": "http://test"})).status_code == 200  # same host as the request


# ---------------------------------------------------------------- authorisation: your data is yours


async def test_nobody_can_reach_another_users_cv(client, make_client):
    mine = await create(client)
    other = await make_client()
    admin = await make_client(role="admin")  # admins administer accounts; they do not read CVs
    rid, vid = mine["id"], str(uuid.uuid4())
    calls = [
        ("GET", f"/api/resumes/{rid}", None), ("PUT", f"/api/resumes/{rid}", {"resume": mine["resume"]}), ("DELETE", f"/api/resumes/{rid}", None),
        ("POST", f"/api/resumes/{rid}/ops", {"ops": []}), ("GET", f"/api/resumes/{rid}/versions", None),
        ("GET", f"/api/resumes/{rid}/versions/{vid}", None), ("GET", f"/api/resumes/{rid}/versions/{vid}/diff", None),
        ("POST", f"/api/resumes/{rid}/versions/{vid}/restore", None), ("POST", f"/api/resumes/{rid}/chat", {"message": "hi"}),
        ("POST", f"/api/resumes/{rid}/chat/stream", {"message": "hi"}), ("POST", f"/api/resumes/{rid}/tailor/stream", {"posting": "x" * 60}),
        ("POST", f"/api/resumes/{rid}/chat/abc/decide", {"accept": "all"}), ("GET", f"/api/resumes/{rid}/chat", None),
        ("DELETE", f"/api/resumes/{rid}/chat", None), ("POST", f"/api/resumes/{rid}/pdf", None),
    ]
    for who in (other, admin):
        for method, url, body in calls:
            r = await who.request(method, url, json=body)
            assert r.status_code == 404, f"{method} {url} as another user: {r.status_code}"
    # a missing CV is indistinguishable from someone else's
    assert (await other.get(f"/api/resumes/{uuid.uuid4()}")).json() == (await other.get(f"/api/resumes/{rid}")).json()
    assert (await client.get(f"/api/resumes/{rid}")).status_code == 200  # and it was never touched


async def test_nobody_can_use_another_users_profile_memories_or_import(client, make_client):
    other = await make_client()
    pid = (await client.get("/api/auth/me")).json()["persona"]["id"]
    for method, url, body in [
        ("GET", f"/api/personas/{pid}", None), ("PUT", f"/api/personas/{pid}", {"firstName": "Hacked"}),
        ("POST", f"/api/personas/{pid}/resumes", {"template": "blank"}), ("GET", f"/api/personas/{pid}/memories", None),
        ("POST", f"/api/personas/{pid}/memories", {"kind": "fact", "text": "evil"}),
    ]:
        assert (await other.request(method, url, json=body)).status_code == 404, (method, url)
    assert (await other.post(f"/api/personas/{pid}/imports/cv", files={"file": ("a.pdf", b"x")})).status_code == 404
    assert (await client.get(f"/api/personas/{pid}")).json()["persona"]["firstName"] == "Jane"


async def test_an_agent_proposal_cannot_be_decided_through_someone_elses_cv(client, make_client):
    mine, theirs = await create(client), await create(await make_client())
    r = await client.post(f"/api/resumes/{mine['id']}/chat/some-run/decide", json={"accept": "all"})
    assert r.status_code == 410  # nothing pending: a normal answer for the owner...
    other = await make_client()
    assert (await other.post(f"/api/resumes/{mine['id']}/chat/some-run/decide", json={"accept": "all"})).status_code == 404  # ...and not found for anyone else
    assert theirs["id"] != mine["id"]


async def test_the_pdf_renderer_gets_a_short_read_only_session_that_is_revoked_afterwards(client, infra):
    doc = await create(client)
    r = await client.post(f"/api/resumes/{doc['id']}/pdf")
    assert r.status_code == 200
    cookie = infra.pdf.cookie
    assert not ({"url", "path"} <= set(cookie)), "Playwright rejects a cookie with both url and path"
    assert cookie["name"] == COOKIE and cookie["httpOnly"] and cookie["value"] != client.cookies[COOKIE]  # not the user's own session
    async with infra.session() as s:
        assert await auth.resolve_session(s, infra.settings, cookie["value"]) is None  # already spent
        token, sess = await auth.create_session(s, infra.settings, client.user, kind="render")
    ro = httpx.AsyncClient(transport=httpx.ASGITransport(app=client._transport.app), base_url="http://test", headers=HEADERS, cookies={COOKIE: token})
    assert (await ro.get(f"/api/resumes/{doc['id']}")).status_code == 200  # can read the CV it renders...
    assert (await ro.delete(f"/api/resumes/{doc['id']}")).status_code == 403  # ...and nothing else
    assert (await ro.put(f"/api/resumes/{doc['id']}", json={"resume": doc["resume"]})).status_code == 403
    await ro.aclose()


# ---------------------------------------------------------------- administration


async def test_admin_prepares_a_persona_then_invites_then_the_person_completes_it(make_client, anon, infra):
    boss = await make_client(role="admin")
    r = await boss.post("/api/admin/users", json={"firstName": "New", "lastName": "Person", "login": " New.Person@Example.com "})
    assert r.status_code == 201
    uid = r.json()["id"]
    assert r.json()["status"] == "draft" and r.json()["login"] == "new.person@example.com"
    assert (await anon.post("/api/auth/login", json={"login": "new.person@example.com", "password": "anything goes here"})).status_code == 401  # a draft can't sign in
    out = (await boss.post(f"/api/admin/users/{uid}/invite")).json()
    assert out["user"]["status"] == "invited"
    token = out["link"].split("#", 1)[1]  # in the fragment: never reaches a server log
    assert out["link"].startswith(infra.settings.base_url + "/accept#")
    assert (await anon.post("/api/auth/accept", json={"token": token, "password": "short"})).status_code == 422  # weak: the link survives
    assert (await anon.post("/api/auth/accept", json={"token": token, "password": "new.person is my name"})).status_code == 422  # contains their name
    ok = await anon.post("/api/auth/accept", json={"token": token, "password": "a fine long passphrase"})
    assert ok.status_code == 200 and ok.json()["role"] == "user" and ok.json()["persona"]["firstName"] == "New" and COOKIE in anon.cookies
    assert (await anon.post("/api/auth/accept", json={"token": token, "password": "another fine passphrase"})).status_code == 400  # one use
    assert next(u for u in (await boss.get("/api/admin/users")).json() if u["id"] == uid)["status"] == "active"


async def test_there_is_no_self_registration(app):
    paths = {p for p in app.openapi()["paths"] if p.startswith("/api/auth") or p.startswith("/api/account")}
    assert paths == {"/api/auth/login", "/api/auth/accept", "/api/auth/accept/check", "/api/auth/logout", "/api/auth/me", "/api/auth/password", "/api/auth/logout-all", "/api/account/delete"}
    for p in ("/api/auth/register", "/api/auth/signup", "/api/users", "/api/personas"):
        assert p not in app.openapi()["paths"]


async def test_invite_links_expire_and_are_stored_hashed(make_client, anon, infra):
    boss = await make_client(role="admin")
    uid = (await boss.post("/api/admin/users", json={"firstName": "Late", "login": "late@example.com"})).json()["id"]
    out = (await boss.post(f"/api/admin/users/{uid}/invite")).json()
    token = out["link"].split("#", 1)[1]
    async with infra.session() as s:
        assert await s.scalar(select(UserTokenRow).where(UserTokenRow.token_hash == token)) is None
        await s.execute(update(UserTokenRow).where(UserTokenRow.token_hash == hash_token(token)).values(expires_at=utcnow() - timedelta(seconds=1)))
        await s.commit()
    assert (await anon.post("/api/auth/accept", json={"token": token, "password": "a fine long passphrase"})).status_code == 400
    assert (await anon.post("/api/auth/accept", json={"token": "x" * 40, "password": "a fine long passphrase"})).status_code == 400
    assert next(u for u in (await boss.get("/api/admin/users")).json() if u["id"] == uid)["status"] == "draft"  # expired: back to draft


async def test_reset_link_keeps_the_old_password_until_used_and_then_ends_sessions(make_client, client, anon):
    boss = await make_client(role="admin")
    out = (await boss.post(f"/api/admin/users/{client.user.id}/invite")).json()
    assert out["user"]["status"] == "active"
    assert (await client.get("/api/auth/me")).status_code == 200  # issuing a link changes nothing yet
    await anon.post("/api/auth/accept", json={"token": out["link"].split("#", 1)[1], "password": "a replacement passphrase"})
    assert (await client.get("/api/auth/me")).status_code == 401  # their old session ended
    assert (await anon.post("/api/auth/login", json={"login": client.user.login, "password": PASSWORD})).status_code == 401


async def test_only_unique_logins_and_valid_input(make_client):
    boss = await make_client(role="admin")
    ok = {"login": "dup@example.com", "firstName": "Dup"}
    assert (await boss.post("/api/admin/users", json=ok)).status_code == 201
    assert (await boss.post("/api/admin/users", json={**ok, "login": "DUP@example.com"})).status_code == 409
    assert (await boss.post("/api/admin/users", json={**ok, "login": "not-an-email"})).status_code == 422
    assert (await boss.post("/api/admin/users", json={**ok, "login": "x@y.z", "role": "root"})).status_code == 422


async def test_the_last_administrator_cannot_be_removed_or_demoted(make_client, infra):
    async with infra.session() as s:  # other tests leave admins behind: start from none
        await s.execute(update(UserRow).values(role="user"))
        await s.commit()
    only = await make_client(role="admin")
    assert (await only.patch(f"/api/admin/users/{only.user.id}", json={"role": "user"})).status_code == 409
    assert (await only.patch(f"/api/admin/users/{only.user.id}", json={"isActive": False})).status_code == 409
    assert (await only.post("/api/account/delete", json={"password": PASSWORD})).status_code == 409
    second = await make_client(role="admin")
    assert (await second.patch(f"/api/admin/users/{only.user.id}", json={"role": "user"})).status_code == 200  # fine with two
    assert (await second.patch(f"/api/admin/users/{second.user.id}", json={"role": "user"})).status_code == 409  # not yourself, ever
    assert (await only.get("/api/admin/users")).status_code == 403  # demoted: the role is checked on every request


async def test_deleting_accounts_asks_for_the_password_and_takes_everything_with_it(make_client, client, infra):
    boss = await make_client(role="admin")
    other = await make_client()
    doc = await create(other)
    url = f"/api/admin/users/{other.user.id}/delete"
    assert (await boss.post(url, json={"password": "wrong password"})).status_code == 403
    assert (await boss.post(url, json={"password": PASSWORD})).status_code == 204
    assert (await other.get("/api/auth/me")).status_code == 401
    async with infra.session() as s:
        assert await s.get(UserRow, other.user.id) is None
        from app.db import ResumeRow

        assert await s.get(ResumeRow, uuid.UUID(doc["id"])) is None


async def test_deleting_your_own_account(client):
    assert (await client.post("/api/account/delete", json={"password": "wrong password"})).status_code == 403
    assert (await client.post("/api/account/delete", json={"password": PASSWORD})).status_code == 204
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_the_admin_listing_exposes_no_cv_content(make_client, client):
    await create(client)
    boss = await make_client(role="admin")
    rows = (await boss.get("/api/admin/users")).json()
    mine = next(u for u in rows if u["id"] == str(client.user.id))
    assert mine["resumeCount"] == 1
    assert set(mine) == {"id", "login", "firstName", "lastName", "role", "isActive", "aiEnabled", "status", "resumeCount", "lastLoginAt", "createdAt", "aiUsage"}
    # AI usage is counts only (tests/test_ai_usage.py checks nothing typed is stored either)
    assert set(mine["aiUsage"]) == {"today", "week", "month", "tokens", "costUsd", "errors", "rejected", "offTopicShare", "lastUsedAt", "dailyLimit"}


# ---------------------------------------------------------------- access tokens and the MCP server


async def test_access_tokens_act_as_their_user_and_can_expire(infra):
    u = await make_user(infra)
    async with infra.session() as s:
        token = await auth.create_api_token(s, u, "test", days=1)
        assert token.startswith("rmk_") and (await auth.resolve_api_token(s, token)).id == u.id
        assert await auth.resolve_api_token(s, "rmk_nope") is None
        await s.execute(update(UserTokenRow).where(UserTokenRow.token_hash == hash_token(token)).values(expires_at=utcnow() - timedelta(seconds=1)))
        await s.commit()
        assert await auth.resolve_api_token(s, token) is None
        # an invite link is not an access token, and vice versa
        link = await auth.issue_link(s, infra.settings, u, "reset")
        assert await auth.resolve_api_token(s, link) is None


async def test_mcp_tools_are_scoped_to_the_token_owner(client, make_client, infra, monkeypatch):
    from app import mcp_server

    mine, theirs = await create(client), await create(await make_client())
    monkeypatch.setattr(mcp_server, "_infra", infra)
    monkeypatch.setattr(mcp_server, "_user_id", client.user.id)
    assert [r["id"] for r in await mcp_server.list_resumes()] == [mine["id"]]
    assert (await mcp_server.get_resume(mine["id"]))["layoutId"]
    for call in (mcp_server.get_resume(theirs["id"]), mcp_server.list_versions(theirs["id"]), mcp_server.export_pdf(theirs["id"]),
                 mcp_server.apply_operations(theirs["id"], [], dry_run=True), mcp_server.ask_assistant(theirs["id"], "hi")):
        with pytest.raises(ValueError, match="CV not found"):
            await call
    assert (await mcp_server.whoami())["id"] == str(client.user.id)


# ---------------------------------------------------------------- primitives


def test_password_policy():
    assert password_problem("short", minimum=12)
    assert password_problem("aaaaaaaaaaaaaaaa", minimum=12)  # long but one character
    assert password_problem("password", minimum=8)
    assert password_problem("my name is ada lovelace", minimum=12, personal=("Lovelace",))
    assert password_problem("x" * 129, minimum=12)
    assert password_problem("correct horse battery staple", minimum=12, personal=("jane", "doe")) is None


def test_verifying_without_a_stored_hash_is_always_false():
    assert verify_password(None, "anything") is False
    assert verify_password("not a hash", "anything") is False
    assert verify_password(None, "x" * 5000) is False


def test_login_normalisation():
    assert normalize_login("  Ada@Example.COM ") == "ada@example.com"
    for bad in ("", "ada", "a@b", "a b@c.d", "@x.org", "x" * 260 + "@a.b"):
        assert normalize_login(bad) is None


async def test_invite_without_email_lets_the_person_choose_one(make_client, anon):
    admin = await make_client(role="admin")
    r = await admin.post("/api/admin/users", json={"firstName": "No", "lastName": "Mail"})
    assert r.status_code == 201 and r.json()["login"] is None
    link = (await admin.post(f"/api/admin/users/{r.json()['id']}/invite")).json()["link"]
    token = link.split("#")[1]
    assert (await anon.post("/api/auth/accept/check", json={"token": token})).json() == {"needsEmail": True}
    assert (await anon.post("/api/auth/accept", json={"token": token, "password": PASSWORD})).status_code == 422  # no email given
    ok = await anon.post("/api/auth/accept", json={"token": token, "password": PASSWORD, "login": "Chosen.Mail@Example.com"})
    assert ok.status_code == 200 and ok.json()["login"] == "chosen.mail@example.com"
