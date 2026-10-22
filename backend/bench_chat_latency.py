"""Latency benchmark: per-stage timings for representative chat turns.

Measures (direct in-process calls, then HTTP end-to-end):
  greeting, gate turns, dataset search, full model turn.
Prints median/p95 per scenario. No assertions here — this is the
measurement tool; budgets are enforced in test_chat_latency.py.
Run: python bench_chat_latency.py
"""
import statistics
import time

from app.services.ollama_chat_service import (
    extract_criteria_from_text,
    process_ollama_chat_message,
)
from app.services.property_service import (
    get_distinct_locations,
    search_properties_dataset,
)


def bench(name, fn, reps=15):
    ds = []
    for _ in range(reps):
        t0 = time.perf_counter()
        fn()
        ds.append((time.perf_counter() - t0) * 1000)
    ds.sort()
    p50 = statistics.median(ds)
    p95 = ds[min(len(ds) - 1, int(len(ds) * 0.95))]
    print(f"{name:34s} reps={reps:3d} p50={p50:9.1f} ms  p95={p95:9.1f} ms")
    return p50, p95


n = {"i": 0}


def fresh_sid():
    n["i"] += 1
    return f"bench-{n['i']}-{time.time_ns()}"


bench("extract_criteria (regex pass)", lambda: extract_criteria_from_text(
    "I want a 2 BHK apartment in Dubai Marina under AED 2 million"), reps=50)
bench("get_distinct_locations", get_distinct_locations, reps=20)
bench("dataset search (filtered)", lambda: search_properties_dataset(
    location="Dubai Marina", property_type="Apartment", bedrooms=2,
    max_budget_aed=2000000, purpose="Sale", limit=3), reps=20)
bench("instant greeting turn", lambda: process_ollama_chat_message("Hi", fresh_sid()))
bench("location-gate turn", lambda: process_ollama_chat_message(
    "I want to buy a 2 BHK apartment under 2 million", fresh_sid()))

sid = fresh_sid()
process_ollama_chat_message("I want to buy a 2 BHK apartment under 2 million", sid)
process_ollama_chat_message("Dubai Marina", sid)
process_ollama_chat_message("under 2 million", sid)
process_ollama_chat_message("within 3 months", sid)
process_ollama_chat_message("no", sid)
process_ollama_chat_message("no preference", sid)
bench("model search turn (warmed session)", lambda: process_ollama_chat_message(
    "show me something cheaper", fresh_sid()), reps=3)
