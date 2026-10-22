"""
Database engine and session factory.
Supports PostgreSQL (production) and SQLite (local dev).
Set DATABASE_URL in backend/.env to switch.
"""
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./lyka_realty.db")

# SQLite: use check_same_thread=False; PostgreSQL: no extra args needed
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    echo=False,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI dependency: yields a DB session and closes it when done."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Create all tables. Call on startup."""
    from app import models  # noqa: F401 — ensure models are registered
    Base.metadata.create_all(bind=engine)
    migrate()


def migrate():
    """Safe additive migrations for existing databases.

    Adds columns introduced after the initial schema without touching
    existing rows (all new columns are nullable). New tables are handled
    by create_all above. SQLite only — other engines rely on create_all
    for fresh databases.
    """
    wanted: dict[str, dict[str, str]] = {
        "staff_users": {
            "firebase_uid": "firebase_uid VARCHAR(128)",
            "manager_email": "manager_email VARCHAR(200)",
        },
        "assignments": {
            "staff_uid": "staff_uid VARCHAR(128)",
        },
        "follow_ups": {
            "staff_uid": "staff_uid VARCHAR(128)",
        },
        "viewings": {
            "staff_uid": "staff_uid VARCHAR(128)",
        },
        "recommendations": {
            "is_nearby": "is_nearby BOOLEAN DEFAULT 0",
        },
        "leads": {
            "utm_source": "utm_source VARCHAR(255)",
            "utm_medium": "utm_medium VARCHAR(255)",
            "utm_campaign": "utm_campaign VARCHAR(255)",
            "referrer": "referrer VARCHAR(500)",
            "discovery_source": "discovery_source VARCHAR(50)",
        },
        "customer_profiles": {
            "utm_source": "utm_source VARCHAR(255)",
            "utm_medium": "utm_medium VARCHAR(255)",
            "utm_campaign": "utm_campaign VARCHAR(255)",
            "referrer": "referrer VARCHAR(500)",
            "discovery_source": "discovery_source VARCHAR(50)",
            "country": "country VARCHAR(100)",
        },
    }
    if not DATABASE_URL.startswith("sqlite"):
        return
    with engine.connect() as conn:
        for table, cols in wanted.items():
            try:
                existing = {row[1] for row in conn.exec_driver_sql(f"PRAGMA table_info({table})")}
            except Exception:
                continue
            for col, ddl in cols.items():
                if col not in existing:
                    conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {ddl}")
        # Pre-migration rows have NULL in the new flag; normalise to false
        # so API schemas (bool, not optional) always validate.
        try:
            conn.exec_driver_sql("UPDATE recommendations SET is_nearby = 0 WHERE is_nearby IS NULL")
        except Exception:
            pass
        conn.commit()
