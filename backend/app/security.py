"""Credential primitives: password hashing, password policy and opaque tokens. No database or HTTP in here."""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

# Argon2id with the library's current defaults (RFC 9106 low-memory profile); parameters are stored in each hash, so they
# can be raised later and `needs_rehash` upgrades hashes at the next sign-in.
_hasher = PasswordHasher()

MAX_PASSWORD = 128  # bounds the work an attacker can make us do per request
_COMMON = {
    "password", "password1", "123456789012", "qwertyuiopas", "letmein12345", "iloveyou1234", "administrator", "welcome12345",
    "changeme1234", "passw0rd1234", "resumaker1234", "abcdefghijkl",
}


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(stored: str | None, password: str) -> bool:
    """Constant-ish time: with no stored hash it still burns an Argon2 verification, so unknown accounts cost the same."""
    if len(password) > MAX_PASSWORD:
        return False
    try:
        return _hasher.verify(stored or _DUMMY_HASH, password) and stored is not None
    except (VerificationError, InvalidHashError):
        return False


def needs_rehash(stored: str) -> bool:
    return _hasher.check_needs_rehash(stored)


_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))


def password_problem(password: str, *, minimum: int, personal: tuple[str, ...] = ()) -> str | None:
    """Why this password is unacceptable, or None. Length over composition rules (NIST SP 800-63B)."""
    if len(password) < minimum:
        return f"Use at least {minimum} characters."
    if len(password) > MAX_PASSWORD:
        return f"Use at most {MAX_PASSWORD} characters."
    low = password.lower()
    if low in _COMMON or len(set(low)) < 5:
        return "That password is too easy to guess."
    for bit in personal:
        bit = bit.strip().lower()
        if len(bit) >= 4 and bit in low:
            return "Don't put your name or email in your password."
    return None


def new_token() -> str:
    """256 bits from the OS CSPRNG: a bearer secret, shown once and stored only as a hash."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    # Tokens are high-entropy random strings, so a fast hash is right (a slow one protects only guessable secrets).
    return hashlib.sha256(token.encode()).hexdigest()


def same(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


_LOGIN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalize_login(login: str) -> str | None:
    """Lower-cased, trimmed e-mail address, or None if it isn't one."""
    login = login.strip().lower()
    return login if len(login) <= 254 and _LOGIN.match(login) else None
