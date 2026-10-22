"""Staff-creation regression tests (isolated temp DB).

Covers the Team-page "Add member" path: successful creation with all
fields, malformed bodies rejected without touching data, the single-admin
invariant, exact role assignment, and manager/reporting handling.
Run: python test_staff_create.py
"""
import os
import tempfile
from unittest.mock import patch

tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
tmp.close()
os.environ["DATABASE_URL"] = "sqlite:///" + tmp.name

import app.services.roles as roles  # noqa: E402
from app.database import SessionLocal, init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import StaffUser  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

init_db()
db = SessionLocal()
db.add(StaffUser(email="admin@s.ae", name="AD", role="admin", is_active=True,
                 firebase_uid="UID-AD"))
db.add(StaffUser(email="mgr@s.ae", name="MG", role="manager", is_active=True))
db.commit()
db.close()

client = TestClient(app, raise_server_exceptions=False)
passed = []


def check(name, cond, extra=""):
    assert cond, "FAIL: %s %s" % (name, extra)
    passed.append(name)
    print("ok:", name)


def as_user(email, uid=None):
    return patch.object(roles, "verify_bearer_token",
                        return_value={"uid": uid or ("u-" + email), "email": email})


def count_staff():
    d = SessionLocal()
    try:
        return d.query(StaffUser).count()
    finally:
        d.close()


BEFORE = count_staff()

# 1. Bodies without a JSON object are rejected (the reported Add-member bug).
with as_user("admin@s.ae", uid="UID-AD"):
    r = client.post("/api/staff", content="not json",
                    headers={"Content-Type": "text/plain"})
    check("non-object body 422", r.status_code == 422, str(r.status_code))
    r = client.post("/api/staff", content='{"email": "x@s.ae"')
    check("truncated body 422", r.status_code == 422, str(r.status_code))
    check("no rows created by bad bodies", count_staff() == BEFORE, str(count_staff()))
    # Field-level validation still enforced.
    r = client.post("/api/staff", json={"email": "bad", "name": "B", "role": "salesperson"})
    check("bad email 422", r.status_code == 422, r.text[:120])
    r = client.post("/api/staff", json={"email": "ok@s.ae", "name": "", "role": "salesperson"})
    check("empty name 422", r.status_code == 422, r.text[:120])
    r = client.post("/api/staff", json={"email": "ok@s.ae", "name": "O", "role": "superadmin"})
    check("unknown role 422", r.status_code == 422, r.text[:120])
    check("no rows created by invalid bodies", count_staff() == BEFORE, str(count_staff()))

# 2. Successful creation keeps every field's meaning; admin untouched.
with as_user("admin@s.ae", uid="UID-AD"):
    r = client.post("/api/staff", json={
        "email": "sp1@s.ae", "name": "S1", "role": "salesperson",
        "manager_email": "mgr@s.ae",
    })
    check("create 201", r.status_code == 201, r.text[:200])
    body = r.json()
    check("exact role assigned", body["role"] == "salesperson", str(body))
    check("manager link stored", body["manager_email"] == "mgr@s.ae", str(body))
    check("active by default", body["is_active"] is True, str(body))
    check("uid unbound until login", body["firebase_uid"] is None, str(body))
    sp1_id = body["id"]

    d = SessionLocal()
    admin = d.query(StaffUser).filter(StaffUser.email == "admin@s.ae").first()
    check("admin row preserved",
          admin.role == "admin" and admin.is_active is True
          and admin.firebase_uid == "UID-AD" and admin.name == "AD",
          "%s %s %s %s" % (admin.role, admin.is_active, admin.firebase_uid, admin.name))
    check("exactly one active admin",
          d.query(StaffUser).filter(StaffUser.role == "admin",
                                    StaffUser.is_active == True).count() == 1)  # noqa: E712
    d.close()

# 3. Second admin blocked; duplicate email blocked.
with as_user("admin@s.ae", uid="UID-AD"):
    r = client.post("/api/staff", json={"email": "a2@s.ae", "name": "A2", "role": "admin"})
    check("second admin 409", r.status_code == 409, r.text[:120])
    r = client.post("/api/staff", json={"email": "sp1@s.ae", "name": "Dup", "role": "salesperson"})
    check("duplicate email 409", r.status_code == 409, r.text[:120])

# 4. Non-admins cannot grant (themselves or anyone) elevated roles.
with as_user("mgr@s.ae"):
    r = client.post("/api/staff", json={"email": "x@s.ae", "name": "X", "role": "salesperson"})
    check("manager create 403", r.status_code == 403, str(r.status_code))
with as_user("customer@gmail.com"):
    r = client.post("/api/staff", json={"email": "me@gmail.com", "name": "Me", "role": "admin"})
    check("customer self-admin 403", r.status_code == 403, str(r.status_code))

# 5. Manager/reporting updates: reassign, then clear; deactivation preserved.
with as_user("admin@s.ae", uid="UID-AD"):
    r = client.patch("/api/staff/%d" % sp1_id, json={"manager_email": None})
    check("clear manager 200", r.status_code == 200 and r.json()["manager_email"] is None,
          r.text[:160])
    r = client.patch("/api/staff/%d" % sp1_id, json={"is_active": False})
    check("deactivate 200", r.status_code == 200 and r.json()["is_active"] is False,
          r.text[:160])
    d = SessionLocal()
    sp1 = d.query(StaffUser).filter(StaffUser.email == "sp1@s.ae").first()
    check("deactivation keeps identity",
          sp1.role == "salesperson" and sp1.name == "S1", "%s %s" % (sp1.role, sp1.name))
    d.close()
    r = client.patch("/api/staff/%d" % sp1_id, json={"is_active": True})
    check("reactivate 200", r.status_code == 200 and r.json()["is_active"] is True,
          r.text[:160])

print("PASSED %d checks" % len(passed))
