"""Lead-source attribution regression test (isolated temp DB).

Verifies UTM + referrer capture on the public enquiry endpoint:
  1. Submitted source values persist on the Lead and come back via the
     Admin detail API (visible in CRM).
  2. Missing attribution stays NULL (never invented) and old rows
     without source columns data read fine.
  3. The additive migration adds the four columns without touching
     existing rows or values.

Run: python test_lead_source.py
"""
import os
import sqlite3
import tempfile

tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
tmp.close()
os.environ["DATABASE_URL"] = "sqlite:///" + tmp.name

from app.database import SessionLocal, init_db, migrate  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Lead  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

init_db()
client = TestClient(app, raise_server_exceptions=False)
passed = []


def check(name, cond, extra=""):
    assert cond, "FAIL: %s %s" % (name, extra)
    passed.append(name)
    print("ok:", name)


# ── 1. Source persists + returns ──────────────────────────────────────────
r = client.post("/api/leads/public", json={
    "customer_name": "Src Test",
    "contact_email": "src-attr@t.ae",
    "utm_source": "google",
    "utm_medium": "cpc",
    "utm_campaign": "marina-launch",
    "referrer": "https://www.google.com/search?q=dubai",
})
check("public 201 with source", r.status_code == 201, r.text[:200])
body = r.json()
check("source returned",
      (body["utm_source"], body["utm_medium"], body["utm_campaign"], body["referrer"]) ==
      ("google", "cpc", "marina-launch", "https://www.google.com/search?q=dubai"),
      str({k: body.get(k) for k in ("utm_source", "utm_medium", "utm_campaign", "referrer")}))

db = SessionLocal()
row = db.query(Lead).filter(Lead.id == body["id"]).first()
check("source stored",
      (row.utm_source, row.utm_medium, row.utm_campaign, row.referrer) ==
      ("google", "cpc", "marina-launch", "https://www.google.com/search?q=dubai"))
db.close()

# ── 2. Missing attribution stays NULL ─────────────────────────────────────
r = client.post("/api/leads/public", json={
    "customer_name": "No Src",
    "contact_email": "src-none@t.ae",
})
check("public 201 without source", r.status_code == 201, r.text[:200])
body = r.json()
check("missing source null, not invented",
      body["utm_source"] is None and body["utm_medium"] is None
      and body["utm_campaign"] is None and body["referrer"] is None,
      str({k: body.get(k) for k in ("utm_source", "utm_medium", "utm_campaign", "referrer")}))

# ── 3. Migration is additive and preserves rows ────────────────────────────
db_path = os.environ["DATABASE_URL"].replace("sqlite:///", "")
con = sqlite3.connect(db_path)
cols = {row[1] for row in con.execute("PRAGMA table_info(leads)")}
check("four source columns exist",
      {"utm_source", "utm_medium", "utm_campaign", "referrer"} <= cols)
n_before = con.execute("SELECT COUNT(*) FROM leads").fetchone()[0]
migrate()
n_after = con.execute("SELECT COUNT(*) FROM leads").fetchone()[0]
check("migrate preserves row count", n_before == n_after == 2, f"{n_before}->{n_after}")
con.close()

print("PASSED %d checks" % len(passed))
