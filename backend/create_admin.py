"""
Bootstrap the single LYKA Realty Admin (run once, locally, by the operator).

Creates exactly one active admin row in staff_users. Refuses to run when an
admin already exists — further staff are added via POST /api/staff by the
admin, never by this script.

Usage:
    python create_admin.py --email admin@lykarealty.ae --name "Site Admin" [--uid FIREBASE_UID]

The admin must ALSO sign in once via the app (Firebase Authentication) with
the same email so the backend can match the verified token to this row.
Pass --uid (copied from Firebase Console -> Authentication -> Users) to
pre-bind the stable identity; otherwise it binds automatically on the
admin's first verified sign-in.
To enable Realtime Database admin branches, set a custom claim afterwards:
    Firebase Console -> Authentication -> Users -> (admin user) -> Custom claims: {"role": "admin"}
(or run the equivalent Admin SDK snippet documented in the PRD handover).
"""
import argparse
import sys

from app.database import SessionLocal, init_db
from app.models import StaffUser


def main() -> int:
    ap = argparse.ArgumentParser(description="Create the single LYKA Admin.")
    ap.add_argument("--email", required=True, help="Admin sign-in email (must match Firebase user)")
    ap.add_argument("--name", required=True, help="Admin display name")
    ap.add_argument("--uid", default=None, help="Optional Firebase UID to pre-bind (else bound on first sign-in)")
    args = ap.parse_args()

    email = args.email.strip().lower()
    if "@" not in email:
        print("Refusing: '%s' is not a valid email." % args.email)
        return 2

    init_db()
    db = SessionLocal()
    try:
        existing_admin = (
            db.query(StaffUser)
            .filter(StaffUser.role == "admin", StaffUser.is_active == True)  # noqa: E712
            .first()
        )
        if existing_admin:
            print("Refusing: an active Admin already exists (%s). "
                  "Add further staff via POST /api/staff as that admin." % existing_admin.email)
            return 1
        if db.query(StaffUser).filter(StaffUser.email == email).first():
            print("Refusing: '%s' is already registered as staff." % email)
            return 1
        uid = (args.uid or "").strip() or None
        if uid and db.query(StaffUser).filter(StaffUser.firebase_uid == uid).first():
            print("Refusing: UID '%s' is already bound to another staff row." % uid)
            return 1
        db.add(StaffUser(email=email, name=args.name.strip(), role="admin",
                         is_active=True, firebase_uid=uid))
        db.commit()
        print("Admin created: %s. Next: sign in with this email, then set the "
              "Firebase custom claim {\"role\": \"admin\"} for RTDB admin branches." % email)
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
