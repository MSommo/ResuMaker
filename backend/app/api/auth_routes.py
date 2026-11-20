"""Sign-in, sign-out, the signed-in user's own account, and user administration."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import ResumeRow, UserRow
from ..infra import Infra
from ..services import ai_usage, auth
from . import schemas as sc
from .deps import COOKIE, Principal, clear_session_cookie, client_ip, current, get_infra, get_session, login_rate_limit, parse_id, require_admin, set_session_cookie

log = logging.getLogger("resumaker.auth")

# Reachable without a session. Everything else hangs off `protected`, so a new route is private unless someone opts it out.
public = APIRouter(prefix="/auth", tags=["auth"])
protected = APIRouter(dependencies=[Depends(current)])
admin = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])

BAD_LOGIN = "Wrong email or password."  # one message for unknown account, wrong password, locked and unclaimed
DISABLED = "You can't sign in right now. Contact the administrator."


async def _count(s: AsyncSession, user_id: uuid.UUID) -> int:
    return await s.scalar(select(func.count()).select_from(ResumeRow).where(ResumeRow.persona_id == user_id)) or 0


async def _start_session(request: Request, response: Response, infra: Infra, s: AsyncSession, user: UserRow) -> None:
    token, _ = await auth.create_session(s, infra.settings, user, ip=client_ip(request), user_agent=request.headers.get("user-agent", ""))
    set_session_cookie(response, infra.settings, token)


@public.post("/login", response_model=sc.MeOut, dependencies=[Depends(login_rate_limit)])
async def login(body: sc.LoginIn, request: Request, response: Response, infra: Infra = Depends(get_infra), s: AsyncSession = Depends(get_session)):
    try:
        user = await auth.authenticate(s, infra.settings, body.login, body.password)
    except auth.AuthError:
        log.warning("failed sign-in from %s", client_ip(request))
        raise HTTPException(401, BAD_LOGIN) from None
    except auth.AccountDisabled:
        log.info("sign-in to a disabled account from %s", client_ip(request))
        raise HTTPException(403, DISABLED) from None
    # A fresh token on every sign-in: a cookie planted before login (session fixation) never becomes authenticated.
    if old := request.cookies.get(COOKIE):
        await auth.revoke_session(s, old)
    await _start_session(request, response, infra, s, user)
    return sc.MeOut.of(user, await _count(s, user.id))


@public.post("/accept/check", response_model=sc.LinkInfoOut, dependencies=[Depends(login_rate_limit)])
async def accept_check(body: sc.LinkCheckIn, s: AsyncSession = Depends(get_session)):
    """Does this one-time link still work, and must the person give their sign-in email? Reveals nothing else."""
    try:
        return sc.LinkInfoOut(needsEmail=await auth.link_needs_email(s, body.token))
    except auth.TokenInvalid:
        raise HTTPException(400, "This link is invalid or has expired. Ask for a new one.") from None


@public.post("/accept", response_model=sc.MeOut, dependencies=[Depends(login_rate_limit)])
async def accept(body: sc.AcceptIn, request: Request, response: Response, infra: Infra = Depends(get_infra), s: AsyncSession = Depends(get_session)):
    """Set a password with a one-time invite / reset link, and sign in."""
    try:
        user = await auth.redeem_link(s, infra.settings, body.token, body.password, body.login)
    except auth.TokenInvalid:
        raise HTTPException(400, "This link is invalid or has expired. Ask for a new one.") from None
    except auth.LoginTaken:
        raise HTTPException(409, "Someone already signs in with that email.") from None
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    except auth.WeakPassword as e:
        raise HTTPException(422, str(e)) from None
    await _start_session(request, response, infra, s, user)
    return sc.MeOut.of(user, await _count(s, user.id))


@public.post("/logout", status_code=204)
async def logout(request: Request, infra: Infra = Depends(get_infra), s: AsyncSession = Depends(get_session)):
    if token := request.cookies.get(COOKIE):
        await auth.revoke_session(s, token)
    resp = Response(status_code=204)
    clear_session_cookie(resp, infra.settings)
    return resp


@protected.get("/auth/me", response_model=sc.MeOut)
async def me(who: Principal = Depends(current), s: AsyncSession = Depends(get_session)):
    return sc.MeOut.of(who.user, await _count(s, who.id))


@protected.post("/auth/password", status_code=204)
async def change_password(body: sc.PasswordIn, who: Principal = Depends(current), infra: Infra = Depends(get_infra), s: AsyncSession = Depends(get_session)):
    """Needs the current password even with a valid session, so a borrowed browser can't lock the owner out. Other sessions end."""
    user = await s.get(UserRow, who.id)
    assert user is not None
    if not await _check_own_password(s, infra, user, body.current):
        raise HTTPException(403, "Your current password is wrong.")
    try:
        await auth.set_password(s, infra.settings, user, body.new, keep_session=who.session.id)
    except auth.WeakPassword as e:
        raise HTTPException(422, str(e)) from None
    return Response(status_code=204)


@protected.post("/auth/logout-all", status_code=204)
async def logout_everywhere(who: Principal = Depends(current), s: AsyncSession = Depends(get_session)):
    """End every other session of this user (keeps this one)."""
    await auth.revoke_sessions(s, who.id, except_id=who.session.id)
    await s.commit()
    return Response(status_code=204)


async def _check_own_password(s: AsyncSession, infra: Infra, user: UserRow, password: str) -> bool:
    """Re-authentication for sensitive actions. Shares the sign-in lockout, so it can't be used to guess the password."""
    try:
        await auth.authenticate(s, infra.settings, user.login or "", password)
        return True
    except (auth.AuthError, auth.AccountDisabled):  # a disabled user has no session to get here with, but never say yes
        return False


@protected.post("/account/delete", status_code=204)
async def delete_own_account(body: sc.ConfirmIn, request: Request, who: Principal = Depends(current), infra: Infra = Depends(get_infra), s: AsyncSession = Depends(get_session)):
    """Delete the signed-in user with all their CVs, history and memories. Irreversible, so it re-asks for the password."""
    user = await s.get(UserRow, who.id)
    assert user is not None
    if not await _check_own_password(s, infra, user, body.password):
        raise HTTPException(403, "Your password is wrong.")
    try:
        await auth.delete_user(s, user)
    except auth.LastAdmin:
        raise HTTPException(409, "You are the only administrator. Make someone else an admin first.") from None
    resp = Response(status_code=204)
    clear_session_cookie(resp, infra.settings)
    return resp


# ------------------------------------------------------------------ administration (no access to anyone's CVs)


async def _user(s: AsyncSession, user_id: str) -> UserRow:
    row = await s.get(UserRow, parse_id(user_id, "User"))
    if row is None:
        raise HTTPException(404, "User not found.")
    return row


def _invite_out(infra: Infra, user: UserRow, token: str, n: int = 0) -> sc.InviteOut:
    return sc.InviteOut(user=sc.AdminUserOut.of(user, n, user.password_hash is None), link=auth.link_url(infra.settings, token), expiresInHours=infra.settings.invite_ttl_hours)


def _usage_out(infra: Infra, found: dict[uuid.UUID, ai_usage.Summary], user_id: uuid.UUID) -> sc.AiUsageSummaryOut:
    return sc.AiUsageSummaryOut.of(found.get(user_id) or ai_usage.Summary(), infra.settings.ai_daily_limit)


async def _admin_out(s: AsyncSession, u: UserRow, infra: Infra | None = None) -> sc.AdminUserOut:
    usage = _usage_out(infra, await ai_usage.summaries(s, [u.id]), u.id) if infra is not None else None
    return sc.AdminUserOut.of(u, await _count(s, u.id), u.id in await auth.pending_invites(s), usage)


@admin.get("/users", response_model=list[sc.AdminUserOut])
async def list_users(infra: Infra = Depends(get_infra), s: AsyncSession = Depends(get_session)):
    q = select(UserRow, func.count(ResumeRow.id)).join(ResumeRow, ResumeRow.persona_id == UserRow.id, isouter=True).group_by(UserRow.id).order_by(UserRow.created_at)
    invited = await auth.pending_invites(s)
    rows = (await s.execute(q)).all()
    found = await ai_usage.summaries(s, [u.id for u, _ in rows])  # one query for everyone, not one per row
    return [sc.AdminUserOut.of(u, n, u.id in invited, _usage_out(infra, found, u.id)) for u, n in rows]


MAX_USAGE_DAYS = 90  # = the retention period: older rows are gone anyway


@admin.get("/users/{user_id}/ai-usage", response_model=sc.AiUsageDetailOut)
async def user_ai_usage(user_id: str, start: datetime | None = Query(None, alias="from"), end: datetime | None = Query(None, alias="to"),
                        infra: Infra = Depends(get_infra), s: AsyncSession = Depends(get_session)):
    """One person's AI use between `from` and `to` (default: the last 30 days): per UTC day, per feature, per model, and the
    latest requests. Metadata only: no prompt, CV or chat text is ever stored."""
    user = await _user(s, user_id)
    end = _aware(end) or datetime.now(timezone.utc)
    start = _aware(start) or end - timedelta(days=30)
    if start >= end:
        raise HTTPException(422, "`from` must be before `to`.")
    if end - start > timedelta(days=MAX_USAGE_DAYS):
        raise HTTPException(422, f"At most {MAX_USAGE_DAYS} days at a time.")
    d = await ai_usage.detail(s, infra.settings, user.id, start, end)
    return sc.AiUsageDetailOut(
        userId=str(user.id), start=start, end=end, summary=_usage_out(infra, await ai_usage.summaries(s, [user.id]), user.id),
        series=d["series"], byFeature=d["byFeature"], byModel=d["byModel"], recent=[sc.AiUsageRecordOut.of(r) for r in d["recent"]],
        pricesConfigured=all(m["model"] in infra.settings.ai_prices for m in d["byModel"]),
    )


def _aware(t: datetime | None) -> datetime | None:
    return t.replace(tzinfo=timezone.utc) if t is not None and t.tzinfo is None else t


@admin.post("/users", response_model=sc.AdminUserOut, status_code=201)
async def create_draft(body: sc.AdminUserIn, infra: Infra = Depends(get_infra), s: AsyncSession = Depends(get_session)):
    """Prepare a persona (name + sign-in email). Nobody can sign in yet: generate the invite link when ready (POST .../invite)."""
    try:
        user = await auth.create_user(s, login=body.login, first_name=body.firstName, last_name=body.lastName, role=body.role)
    except auth.LoginTaken:
        raise HTTPException(409, "Someone already signs in with that email.") from None
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    return await _admin_out(s, user, infra)


@admin.patch("/users/{user_id}", response_model=sc.AdminUserOut)
async def update_user(user_id: str, body: sc.AdminUserPatch, who: Principal = Depends(current), infra: Infra = Depends(get_infra), s: AsyncSession = Depends(get_session)):
    user = await _user(s, user_id)
    if user.id == who.id and (body.isActive is False or body.role == "user"):
        raise HTTPException(409, "You can't lock yourself out. Ask another administrator.")
    try:
        user = await auth.update_user(s, user, role=body.role, is_active=body.isActive, login=body.login, ai_enabled=body.aiEnabled)
    except auth.LastAdmin:
        raise HTTPException(409, "That would leave no administrator.") from None
    except auth.LoginTaken:
        raise HTTPException(409, "Someone already signs in with that email.") from None
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    return await _admin_out(s, user, infra)


@admin.post("/users/{user_id}/invite", response_model=sc.InviteOut)
async def reissue_link(user_id: str, infra: Infra = Depends(get_infra), s: AsyncSession = Depends(get_session)):
    """Generate the one-time link that lets a person complete their account (or, if they already have one, reset a forgotten
    password: their current password keeps working until the link is used)."""
    user = await _user(s, user_id)
    purpose = "reset" if user.password_hash else "invite"
    await auth.unlock(s, user)
    return _invite_out(infra, user, await auth.issue_link(s, infra.settings, user, purpose), await _count(s, user.id))


@admin.post("/users/{user_id}/sign-out", status_code=204)
async def sign_user_out(user_id: str, s: AsyncSession = Depends(get_session)):
    user = await _user(s, user_id)
    await auth.revoke_sessions(s, user.id)
    await s.commit()
    return Response(status_code=204)


@admin.post("/users/{user_id}/delete", status_code=204)
async def delete_user(user_id: str, body: sc.ConfirmIn, who: Principal = Depends(current), infra: Infra = Depends(get_infra), s: AsyncSession = Depends(get_session)):
    """Delete a user and everything they own. Needs the administrator's own password."""
    admin_row = await s.get(UserRow, who.id)
    assert admin_row is not None
    if not await _check_own_password(s, infra, admin_row, body.password):
        raise HTTPException(403, "Your password is wrong.")
    user = await _user(s, user_id)
    try:
        await auth.delete_user(s, user)
    except auth.LastAdmin:
        raise HTTPException(409, "That would leave no administrator.") from None
    log.warning("admin %s deleted user %s", who.id, user_id)
    return Response(status_code=204)
