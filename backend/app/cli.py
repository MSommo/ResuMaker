"""Administration from a terminal: the way to create the very first administrator, and to recover when nobody can sign in.

    python -m app.cli list
    python -m app.cli create-user  --login a@b.org --first Ada [--last Lovelace] [--admin]    # prints a one-time invite link
    python -m app.cli invite       --login a@b.org                                            # new link (new user or forgotten password)
    python -m app.cli set-password --login a@b.org                                            # prompts; doesn't echo, nothing in shell history
    python -m app.cli make-admin   --login a@b.org            (or --revoke)
    python -m app.cli token        --login a@b.org --name "Claude Desktop"                    # MCP access token, shown once

Run it where the app runs (`make user-*` wraps it for the scratch and the stable stack).
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import sys

from sqlalchemy import select

from .config import get_settings
from .db import ResumeRow, UserRow, make_engine, make_sessionmaker
from .infra import run_migrations
from .security import normalize_login
from .services import auth


async def _find(s, login: str) -> UserRow:
    norm = normalize_login(login)
    user = await s.scalar(select(UserRow).where(UserRow.login == norm)) if norm else None
    if user is None:
        sys.exit(f"No user signs in as {login!r}. See: python -m app.cli list")
    return user


async def run(args: argparse.Namespace) -> None:
    settings = get_settings()
    await asyncio.to_thread(run_migrations)
    engine = make_engine(settings.database_url)
    try:
        async with make_sessionmaker(engine)() as s:
            if args.cmd == "list":
                from sqlalchemy import func

                q = select(UserRow, func.count(ResumeRow.id)).join(ResumeRow, ResumeRow.persona_id == UserRow.id, isouter=True).group_by(UserRow.id).order_by(UserRow.created_at)
                for u, n in (await s.execute(q)).all():
                    state = "disabled" if not u.is_active else "invited (no password yet)" if not u.password_hash else "active"
                    print(f"{(u.login or '-'):38} {u.role:6} {state:26} {n} CV  {u.display_name}")
            elif args.cmd == "create-user":
                try:
                    user = await auth.create_user(s, login=args.login, first_name=args.first, last_name=args.last, role="admin" if args.admin else "user")
                except auth.LoginTaken:
                    sys.exit("Someone already signs in with that email. Use `invite` to send them a link.")
                except ValueError as e:
                    sys.exit(str(e))
                print(f"Created {user.login} ({user.role}). One-time link, valid {settings.invite_ttl_hours}h:\n  {auth.link_url(settings, await auth.issue_link(s, settings, user, 'invite'))}")
            elif args.cmd == "invite":
                user = await _find(s, args.login)
                token = await auth.issue_link(s, settings, user, "reset" if user.password_hash else "invite")
                await auth.unlock(s, user)
                print(f"One-time link for {user.login}, valid {settings.invite_ttl_hours}h:\n  {auth.link_url(settings, token)}")
            elif args.cmd == "set-password":
                user = await _find(s, args.login)
                pw = getpass.getpass("New password: ")
                if pw != getpass.getpass("Again: "):
                    sys.exit("Passwords differ.")
                try:
                    await auth.set_password(s, settings, user, pw)
                except auth.WeakPassword as e:
                    sys.exit(str(e))
                print("Password set. All of that user's sessions were ended.")
            elif args.cmd == "make-admin":
                user = await _find(s, args.login)
                try:
                    await auth.update_user(s, user, role="user" if args.revoke else "admin")
                except auth.LastAdmin:
                    sys.exit("That would leave no administrator.")
                print(f"{user.login} is now {user.role}.")
            elif args.cmd == "token":
                user = await _find(s, args.login)
                token = await auth.create_api_token(s, user, args.name)
                print(f"Access token for {user.login} ({args.name}). Shown once; it acts as this user:\n  {token}\nSet RESUMAKER_TOKEN to it in the MCP client's environment.")
    finally:
        await engine.dispose()


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    c = sub.add_parser("create-user")
    c.add_argument("--login", required=True), c.add_argument("--first", required=True), c.add_argument("--last", default="")
    c.add_argument("--admin", action="store_true")
    for name in ("invite", "set-password"):
        sub.add_parser(name).add_argument("--login", required=True)
    m = sub.add_parser("make-admin")
    m.add_argument("--login", required=True), m.add_argument("--revoke", action="store_true")
    t = sub.add_parser("token")
    t.add_argument("--login", required=True), t.add_argument("--name", default="MCP")
    asyncio.run(run(p.parse_args()))


if __name__ == "__main__":
    main()
