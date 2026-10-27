"""Database setup: SQLite by default, any SQLAlchemy URL via DATABASE_URL (e.g. PostgreSQL)."""
import os
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./afib.db")
for _p in ("postgres://", "postgresql://"):            # Render/Neon/Heroku URLs -> psycopg 3 driver
    if DATABASE_URL.startswith(_p):
        DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL[len(_p):]

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
    pool_pre_ping=True,                                # cloud databases drop idle connections
    pool_size=10, max_overflow=30, pool_timeout=10,    # >= the 40 worker threads; fail fast instead of piling up
)
if DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(conn, _):
        """WAL lets readers work while a writer commits; busy_timeout waits for the lock instead of failing."""
        cur = conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA busy_timeout=5000")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.execute("PRAGMA foreign_keys=ON")         # enforce references like PostgreSQL does, so tests catch order bugs
        cur.close()

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
