"""Accounts, sessions and tokens. The only module that reads or writes credentials."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import Settings
from ..db import SessionRow, UserRow, UserTokenRow, utcnow
from ..security import hash_password, hash_token, needs_rehash, new_token, normalize_login, password_problem, verify_password

ROLES = ("user", "admin")


class AuthError(Exception):
    """Wrong credentials, locked, unclaimed: deliberately one message, so it can't be used to probe for accounts."""


class AccountDisabled(Exception):
    """The right password for an account an administrator turned off. Only someone who knows the password learns this,
    so saying it doesn't reveal which emails have accounts; and it isn't a failed attempt, so it never locks the account."""


class WeakPassword(ValueError):
    pass


class LastAdmin(Exception):
    pass


class LoginTaken(Exception):
    pass


class TokenInvalid(Exception):
    pass


# ------------------------------------------------------------------ passwords


def check_password(settings: Settings, user: UserRow, password: str) -> None:
    problem = password_problem(
        password, minimum=settings.min_password_length,
        personal=(user.login.split("@")[0] if user.login else "", user.first_name, user.last_name),
    )
    if problem:
        raise WeakPassword(problem)


async def set_password(s: AsyncSession, settings: Settings, user: UserRow, password: str, *, keep_session: uuid.UUID | None = None) -> None:
    """Replace the password and end every other session (a stolen session must not survive a password change)."""
    check_password(settings, user, password)
    user.password_hash = hash_password(password)
    user.password_changed_at = utcnow()
    user.failed_logins, user.locked_until = 0, None
    await revoke_sessions(s, user.id, except_id=keep_session)
    await s.execute(delete(UserTokenRow).where(UserTokenRow.user_id == user.id, UserTokenRow.purpose.in_(("invite", "reset"))))
    await s.commit()


async def authenticate(s: AsyncSession, settings: Settings, login: str, password: str) -> UserRow:
    """The user for these credentials, or AuthError. Locks the account after repeated failures."""
    now = utcnow()
    norm = normalize_login(login)
    user = await s.scalar(select(UserRow).where(UserRow.login == norm).with_for_update()) if norm else None
    if user is not None and user.locked_until and user.locked_until > now:
        verify_password(None, password)  # same cost as a real attempt
        raise AuthError()
    ok = verify_password(user.password_hash if user else None, password)
    if user is None:
        raise AuthError()
    if ok and user.password_hash and not user.is_active:
        raise AccountDisabled()
    if not ok or not user.password_hash:
        if user.password_hash:  # unclaimed accounts have nothing to brute-force
            user.failed_logins += 1
            if user.failed_logins >= settings.login_max_failures:
                user.locked_until = now + timedelta(minutes=settings.login_lock_minutes)
                user.failed_logins = 0
            await s.commit()
        raise AuthError()
    user.failed_logins, user.locked_until, user.last_login_at = 0, None, now
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    await s.commit()
    return user


# ------------------------------------------------------------------ sessions


async def create_session(s: AsyncSession, settings: Settings, user: UserRow, *, kind: str = "web", ip: str = "", user_agent: str = "") -> tuple[str, SessionRow]:
    token = new_token()
    now = utcnow()
    life = timedelta(seconds=settings.render_session_seconds) if kind == "render" else timedelta(days=settings.session_max_days)
    row = SessionRow(
        id=uuid.uuid4(), token_hash=hash_token(token), user_id=user.id, kind=kind, created_at=now, last_seen_at=now,
        expires_at=now + life, ip=ip[:64], user_agent=user_agent[:200],
    )
    s.add(row)
    await s.commit()
    return token, row


async def resolve_session(s: AsyncSession, settings: Settings, token: str) -> tuple[UserRow, SessionRow] | None:
    """The user a cookie belongs to, or None (unknown, expired, idle too long, user disabled). Slides the idle window."""
    sess = await s.scalar(select(SessionRow).where(SessionRow.token_hash == hash_token(token)))
    if sess is None:
        return None
    now = utcnow()
    idle = timedelta(seconds=settings.render_session_seconds) if sess.kind == "render" else timedelta(hours=settings.session_idle_hours)
    if sess.expires_at <= now or sess.last_seen_at + idle <= now:
        await s.delete(sess)
        await s.commit()
        return None
    user = await s.get(UserRow, sess.user_id)
    if user is None or not user.is_active:
        return None
    if now - sess.last_seen_at > timedelta(minutes=1):  # don't write on every request
        sess.last_seen_at = now
        await s.commit()
    return user, sess


async def revoke_session(s: AsyncSession, token: str) -> None:
    await s.execute(delete(SessionRow).where(SessionRow.token_hash == hash_token(token)))
    await s.commit()


async def revoke_sessions(s: AsyncSession, user_id: uuid.UUID, *, except_id: uuid.UUID | None = None) -> None:
    q = delete(SessionRow).where(SessionRow.user_id == user_id)
    if except_id is not None:
        q = q.where(SessionRow.id != except_id)
    await s.execute(q)


async def purge_expired(s: AsyncSession, settings: Settings) -> None:
    now = utcnow()
    await s.execute(delete(SessionRow).where((SessionRow.expires_at <= now) | (SessionRow.last_seen_at < now - timedelta(hours=settings.session_idle_hours))))
    await s.execute(delete(UserTokenRow).where(UserTokenRow.purpose.in_(("invite", "reset")), UserTokenRow.expires_at <= now))
    await s.commit()


# ------------------------------------------------------------------ one-time links and access tokens


async def issue_link(s: AsyncSession, settings: Settings, user: UserRow, purpose: str) -> str:
    """A one-time link to set a password (`invite` for a new user, `reset` for a forgotten one). Replaces any earlier one."""
    assert purpose in ("invite", "reset")
    await s.execute(delete(UserTokenRow).where(UserTokenRow.user_id == user.id, UserTokenRow.purpose.in_(("invite", "reset"))))
    token = new_token()
    s.add(UserTokenRow(
        id=uuid.uuid4(), token_hash=hash_token(token), user_id=user.id, purpose=purpose,
        expires_at=utcnow() + timedelta(hours=settings.invite_ttl_hours),
    ))
    await s.commit()
    return token


def link_url(settings: Settings, token: str) -> str:
    return f"{settings.base_url}/accept#{token}"  # in the fragment: never sent to a server, proxy or access log


async def redeem_link(s: AsyncSession, settings: Settings, token: str, password: str) -> UserRow:
    row = await s.scalar(select(UserTokenRow).where(UserTokenRow.token_hash == hash_token(token), UserTokenRow.purpose.in_(("invite", "reset"))).with_for_update())
    if row is None or row.used_at is not None or (row.expires_at and row.expires_at <= utcnow()):
        raise TokenInvalid()
    user = await s.get(UserRow, row.user_id)
    if user is None or not user.is_active or not user.login:
        raise TokenInvalid()
    await set_password(s, settings, user, password)  # raises WeakPassword and leaves the link usable; spends it on success
    return user


async def create_api_token(s: AsyncSession, user: UserRow, name: str, days: int | None = 365) -> str:
    token = "rmk_" + new_token()
    s.add(UserTokenRow(
        id=uuid.uuid4(), token_hash=hash_token(token), user_id=user.id, purpose="api", name=name[:100],
        expires_at=utcnow() + timedelta(days=days) if days else None,
    ))
    await s.commit()
    return token


async def resolve_api_token(s: AsyncSession, token: str) -> UserRow | None:
    row = await s.scalar(select(UserTokenRow).where(UserTokenRow.token_hash == hash_token(token), UserTokenRow.purpose == "api"))
    if row is None or (row.expires_at and row.expires_at <= utcnow()):
        return None
    user = await s.get(UserRow, row.user_id)
    if user is None or not user.is_active:
        return None
    row.last_used_at = utcnow()
    await s.commit()
    return user


# ------------------------------------------------------------------ administration


async def active_admin_count(s: AsyncSession) -> int:
    return await s.scalar(select(func.count()).select_from(UserRow).where(UserRow.role == "admin", UserRow.is_active.is_(True), UserRow.password_hash.is_not(None))) or 0


async def _ensure_not_last_admin(s: AsyncSession, user: UserRow) -> None:
    """The system must never be left without anyone able to administer it."""
    if user.role == "admin" and user.is_active and user.password_hash and await active_admin_count(s) <= 1:
        raise LastAdmin()


async def create_user(s: AsyncSession, *, login: str, first_name: str, last_name: str = "", role: str = "user") -> UserRow:
    """A persona draft: name + sign-in email, no password. The contact email on its CVs starts as the same address."""
    norm = normalize_login(login)
    if norm is None:
        raise ValueError("Enter a valid email address to sign in with.")
    if role not in ROLES:
        raise ValueError("Unknown role.")
    if await s.scalar(select(UserRow.id).where(UserRow.login == norm)):
        raise LoginTaken()
    user = UserRow(id=uuid.uuid4(), login=norm, first_name=first_name.strip(), last_name=last_name.strip(), email=norm, role=role)
    s.add(user)
    await s.commit()
    return user


async def pending_invites(s: AsyncSession) -> set[uuid.UUID]:
    """Users with an unexpired, unused invite link out."""
    rows = await s.scalars(select(UserTokenRow.user_id).where(UserTokenRow.purpose == "invite", UserTokenRow.expires_at > utcnow()))
    return set(rows)


async def update_user(
    s: AsyncSession, user: UserRow, *, role: str | None = None, is_active: bool | None = None, login: str | None = None, ai_enabled: bool | None = None
) -> UserRow:
    if (role is not None and role != "admin") or is_active is False:
        await _ensure_not_last_admin(s, user)
    if role is not None:
        if role not in ROLES:
            raise ValueError("Unknown role.")
        user.role = role
    if login is not None:
        norm = normalize_login(login)
        if norm is None:
            raise ValueError("Enter a valid email address to sign in with.")
        if norm != user.login and await s.scalar(select(UserRow.id).where(UserRow.login == norm)):
            raise LoginTaken()
        user.login = norm
        await revoke_sessions(s, user.id)
    if is_active is not None:
        user.is_active = is_active
        if not is_active:
            await revoke_sessions(s, user.id)
    if ai_enabled is not None:
        user.ai_enabled = ai_enabled
    await s.commit()
    return user


async def delete_user(s: AsyncSession, user: UserRow) -> None:
    await _ensure_not_last_admin(s, user)
    await s.delete(user)  # CVs, history, memories, sessions and tokens go with it (database cascade)
    await s.commit()


async def unlock(s: AsyncSession, user: UserRow) -> None:
    await s.execute(update(UserRow).where(UserRow.id == user.id).values(failed_logins=0, locked_until=None))
    await s.commit()


def is_locked(user: UserRow, now: datetime | None = None) -> bool:
    return bool(user.locked_until and user.locked_until > (now or utcnow()))
