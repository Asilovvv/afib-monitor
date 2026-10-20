"""Password hashing (bcrypt) and JWT tokens."""
import os
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from .db import get_db
from .models import User

SECRET = os.getenv("JWT_SECRET") or ""
if len(SECRET) < 32:
    # No (or a weak) secret configured: use a random one for this process. The old fixed fallback was published with the
    # code, so anyone could have signed tokens with it. Logins then last until the server restarts. Render sets JWT_SECRET.
    import logging
    logging.getLogger("afib").warning("JWT_SECRET missing or shorter than 32 characters: using a random secret for this run")
    SECRET = secrets.token_urlsafe(48)
TOKEN_DAYS = 30
bearer = HTTPBearer(auto_error=False)


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def check_password(pw: str, hashed: str) -> bool:
    return bcrypt.checkpw(pw.encode(), hashed.encode())


def make_token(user: User) -> str:
    exp = datetime.now(timezone.utc) + timedelta(days=TOKEN_DAYS)
    return jwt.encode({"sub": str(user.id), "role": user.role, "exp": exp}, SECRET, algorithm="HS256")


def new_invite_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(6))


def user_from_token(token: str, db: Session) -> User:
    try:
        data = jwt.decode(token, SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    user = db.get(User, int(data["sub"]))
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
    return user


def current_user(cred: HTTPAuthorizationCredentials | None = Depends(bearer),
                 db: Session = Depends(get_db)) -> User:
    if cred is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    return user_from_token(cred.credentials, db)


def require_role(role: str):
    def dep(user: User = Depends(current_user)) -> User:
        if user.role != role:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Only for {role}s")
        return user
    return dep
