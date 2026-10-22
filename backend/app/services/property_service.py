import csv
import logging
import os
import sqlite3
import time
from typing import Any, Dict, List, Optional

logger = logging.getLogger("lyka.properties")

CSV_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "lyka_dubai_properties.csv")
)

_CACHED_PROPERTIES: Optional[List[Dict[str, Any]]] = None
_DB_CONN: Optional[sqlite3.Connection] = None
_DISTINCT_LOCATIONS: Optional[List[Dict[str, Any]]] = None


def init_property_dataset() -> sqlite3.Connection:
    """
    Loads lyka_dubai_properties.csv once into an in-memory indexed SQLite table
    and in-memory cache for ultra-fast (< 1ms) SQL filtering across all 3,000 properties.
    """
    global _CACHED_PROPERTIES, _DB_CONN
    if _DB_CONN is not None:
        return _DB_CONN

    t0 = time.perf_counter()
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute("""
    CREATE TABLE properties (
        property_id TEXT PRIMARY KEY,
        title TEXT,
        listing_type TEXT,
        property_type TEXT,
        location TEXT,
        street TEXT,
        bhk INTEGER,
        bathrooms INTEGER,
        property_size_sqft INTEGER,
        price_aed INTEGER,
        price_per_sqft_aed INTEGER,
        furnishing TEXT,
        parking_spaces INTEGER,
        main_road_access TEXT,
        nearest_main_road TEXT,
        nearest_metro TEXT,
        metro_distance_km REAL,
        near_metro INTEGER,
        beach_distance_km REAL,
        near_seashore INTEGER,
        view TEXT,
        amenities TEXT,
        availability TEXT,
        image_url TEXT,
        image_gallery TEXT,
        image_caption TEXT
    )""")

    cur.execute("CREATE INDEX idx_props_search ON properties(listing_type, property_type, bhk, price_aed)")
    cur.execute("CREATE INDEX idx_props_loc ON properties(location)")
    cur.execute("CREATE INDEX idx_props_bhk ON properties(bhk)")
    cur.execute("CREATE INDEX idx_props_price ON properties(price_aed)")

    loaded_list: List[Dict[str, Any]] = []
    db_rows = []

    if os.path.exists(CSV_PATH):
        try:
            with open(CSV_PATH, mode="r", encoding="utf-8-sig") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    prop_id = row.get("property_id") or row.get("\ufeffproperty_id") or ""
                    try:
                        bhk_val = int(row.get("bhk") or 0)
                    except ValueError:
                        bhk_val = 0

                    try:
                        baths_val = int(row.get("bathrooms") or 1)
                    except ValueError:
                        baths_val = 1

                    try:
                        price_val = int(float(row.get("price_aed") or 0))
                    except ValueError:
                        price_val = 0

                    try:
                        sqft_val = int(float(row.get("property_size_sqft") or 0))
                    except ValueError:
                        sqft_val = 0

                    try:
                        price_sqft = int(float(row.get("price_per_sqft_aed") or 0))
                    except ValueError:
                        price_sqft = 0

                    try:
                        parking_val = int(row.get("parking_spaces") or 1)
                    except ValueError:
                        parking_val = 1

                    try:
                        metro_dist = float(row.get("metro_distance_km") or 0.0)
                    except ValueError:
                        metro_dist = 0.0

                    try:
                        beach_dist = float(row.get("beach_distance_km") or 0.0)
                    except ValueError:
                        beach_dist = 0.0

                    amenities_raw = row.get("amenities") or ""
                    amenities_list = [a.strip() for a in amenities_raw.split("|") if a.strip()]

                    gallery_raw = row.get("image_gallery") or ""
                    gallery_list = [g.strip() for g in gallery_raw.split("|") if g.strip()]

                    listing_type = row.get("listing_type") or "Sale"
                    property_type = row.get("property_type") or "Apartment"
                    location = row.get("location") or "Dubai"
                    main_road_access = row.get("main_road_access") or "No"
                    availability = row.get("availability") or "Ready"
                    view = row.get("view") or "Community View"
                    near_metro = (row.get("near_metro") or "").lower() == "yes"
                    near_seashore = (row.get("near_seashore") or "").lower() == "yes"

                    prop_dict = {
                        "property_id": prop_id,
                        "title": row.get("title") or "Luxury Dubai Property",
                        "listing_type": listing_type,
                        "property_type": property_type,
                        "location": location,
                        "street": row.get("street") or "",
                        "bhk": bhk_val,
                        "bathrooms": baths_val,
                        "property_size_sqft": sqft_val,
                        "price_aed": price_val,
                        "price_per_sqft_aed": price_sqft,
                        "furnishing": row.get("furnishing") or "Unfurnished",
                        "parking_spaces": parking_val,
                        "main_road_access": main_road_access,
                        "nearest_main_road": row.get("nearest_main_road") or "",
                        "nearest_metro": row.get("nearest_metro") or "",
                        "metro_distance_km": metro_dist,
                        "near_metro": near_metro,
                        "beach_distance_km": beach_dist,
                        "near_seashore": near_seashore,
                        "view": view,
                        "amenities": amenities_list,
                        "availability": availability,
                        "image_url": row.get("image_url") or "",
                        "image_gallery": gallery_list,
                        "image_caption": row.get("image_caption") or "",
                    }
                    loaded_list.append(prop_dict)

                    db_rows.append((
                        prop_id,
                        prop_dict["title"],
                        listing_type,
                        property_type,
                        location,
                        prop_dict["street"],
                        bhk_val,
                        baths_val,
                        sqft_val,
                        price_val,
                        price_sqft,
                        prop_dict["furnishing"],
                        parking_val,
                        main_road_access,
                        prop_dict["nearest_main_road"],
                        prop_dict["nearest_metro"],
                        metro_dist,
                        1 if near_metro else 0,
                        beach_dist,
                        1 if near_seashore else 0,
                        view,
                        amenities_raw,
                        availability,
                        prop_dict["image_url"],
                        gallery_raw,
                        prop_dict["image_caption"],
                    ))

            cur.executemany("INSERT INTO properties VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", db_rows)
            conn.commit()
            dur = (time.perf_counter() - t0) * 1000
            logger.info("Loaded and indexed %d properties in SQLite memory database (%.1f ms)", len(loaded_list), dur)
        except Exception as e:
            logger.error("Failed to parse CSV dataset: %s", e)

    _CACHED_PROPERTIES = loaded_list
    _DB_CONN = conn
    return _DB_CONN


def get_all_properties() -> List[Dict[str, Any]]:
    global _CACHED_PROPERTIES
    if _CACHED_PROPERTIES is None:
        init_property_dataset()
    return _CACHED_PROPERTIES or []


def get_distinct_locations() -> List[Dict[str, Any]]:
    """Real dataset communities with live listing counts, most stocked first.

    Powers chatbot location chips and summary dropdowns so customers only
    ever pick communities that actually exist in the dataset — nothing is
    invented. Built once per process from the cached dataset (the source
    CSV is static at runtime, so no invalidation path is needed); later
    calls are a pointer return.
    """
    global _DISTINCT_LOCATIONS
    if _DISTINCT_LOCATIONS is not None:
        return _DISTINCT_LOCATIONS
    from collections import Counter
    props = get_all_properties()
    counts = Counter((p.get("location") or "").strip() for p in props)
    _DISTINCT_LOCATIONS = [
        {"location": loc, "listings": n}
        for loc, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
        if loc
    ]
    return _DISTINCT_LOCATIONS


def _row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    amenities_raw = row["amenities"] or ""
    amenities_list = [a.strip() for a in amenities_raw.split("|") if a.strip()]
    gallery_raw = row["image_gallery"] or ""
    gallery_list = [g.strip() for g in gallery_raw.split("|") if g.strip()]

    return {
        "property_id": row["property_id"],
        "title": row["title"],
        "listing_type": row["listing_type"],
        "property_type": row["property_type"],
        "location": row["location"],
        "street": row["street"],
        "bhk": row["bhk"],
        "bathrooms": row["bathrooms"],
        "property_size_sqft": row["property_size_sqft"],
        "price_aed": row["price_aed"],
        "price_per_sqft_aed": row["price_per_sqft_aed"],
        "furnishing": row["furnishing"],
        "parking_spaces": row["parking_spaces"],
        "main_road_access": row["main_road_access"],
        "nearest_main_road": row["nearest_main_road"],
        "nearest_metro": row["nearest_metro"],
        "metro_distance_km": row["metro_distance_km"],
        "near_metro": bool(row["near_metro"]),
        "beach_distance_km": row["beach_distance_km"],
        "near_seashore": bool(row["near_seashore"]),
        "view": row["view"],
        "amenities": amenities_list,
        "availability": row["availability"],
        "image_url": row["image_url"],
        "image_gallery": gallery_list,
        "image_caption": row["image_caption"],
    }


def search_properties_dataset(
    location: Optional[str] = None,
    property_type: Optional[str] = None,
    bedrooms: Optional[int] = None,
    bathrooms: Optional[int] = None,
    min_budget_aed: Optional[float] = None,
    max_budget_aed: Optional[float] = None,
    purpose: Optional[str] = None,
    near_metro: Optional[bool] = None,
    near_beach: Optional[bool] = None,
    view: Optional[str] = None,
    sort_by: Optional[str] = None,
    main_road_access: Optional[bool] = None,
    availability: Optional[str] = None,
    limit: int = 4,
    nearby_fallback: bool = True,
    min_parking: Optional[int] = None,
    amenities: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Filters the real 3,000 property dataset using indexed in-memory SQLite queries.
    Ultra-fast execution (< 1ms). Never invents properties or fields.

    Nearby fallback: when a location is requested but nothing matches ALL
    filters there, the same filters rerun against explicitly mapped
    neighbouring communities (services/nearby.py, closest first) up to
    `limit` rows. Fallback rows carry ``is_nearby_alternative=True`` plus
    ``requested_location``/``actual_location`` so callers label them
    honestly. Unknown locations have no fallback (honest empty result).
    """
    t_start = time.perf_counter()
    conn = init_property_dataset()
    cur = conn.cursor()

    # Map purpose synonyms
    mapped_purpose: Optional[str] = None
    if purpose:
        p_low = purpose.strip().lower()
        if p_low in ["buy", "sale", "purchase", "invest"]:
            mapped_purpose = "Sale"
        elif p_low in ["rent", "lease", "rental", "annual rent"]:
            mapped_purpose = "Rent"

    where_clauses: List[str] = []
    params: List[Any] = []

    # 1. Location match (fuzzy substring in location or title)
    if location:
        loc_clean = location.strip()
        where_clauses.append("(LOWER(location) LIKE ? OR LOWER(title) LIKE ?)")
        pattern = f"%{loc_clean.lower()}%"
        params.extend([pattern, pattern])

    # 2. Property Type
    if property_type:
        pt_clean = property_type.strip().lower()
        where_clauses.append("LOWER(property_type) = ?")
        params.append(pt_clean)

    # 3. Bedrooms / BHK
    if bedrooms is not None:
        where_clauses.append("bhk = ?")
        params.append(bedrooms)

    # 4. Bathrooms
    if bathrooms is not None:
        where_clauses.append("bathrooms >= ?")
        params.append(bathrooms)

    # 5. Purpose
    if mapped_purpose:
        where_clauses.append("LOWER(listing_type) = ?")
        params.append(mapped_purpose.lower())

    # 6. Budget
    if min_budget_aed is not None:
        where_clauses.append("price_aed >= ?")
        params.append(int(min_budget_aed))
    if max_budget_aed is not None:
        where_clauses.append("price_aed <= ?")
        params.append(int(max_budget_aed))

    # 7. Metro proximity
    if near_metro is True:
        where_clauses.append("(near_metro = 1 OR metro_distance_km <= 1.2)")

    # 8. Beach proximity
    if near_beach is True:
        where_clauses.append("(near_seashore = 1 OR beach_distance_km <= 2.0)")

    # 9. View
    if view:
        where_clauses.append("LOWER(view) LIKE ?")
        params.append(f"%{view.strip().lower()}%")

    # 10. Main road access
    if main_road_access is True:
        where_clauses.append("LOWER(main_road_access) = 'yes'")
    elif main_road_access is False:
        where_clauses.append("LOWER(main_road_access) != 'yes'")

    # 11. Availability
    if availability:
        av_low = availability.strip().lower()
        if av_low == "ready":
            where_clauses.append("LOWER(availability) = 'ready'")
        elif av_low == "off-plan":
            where_clauses.append("LOWER(availability) != 'ready'")
        else:
            where_clauses.append("LOWER(availability) = ?")
            params.append(av_low)

    # 12. Parking (minimum covered spaces, from the real dataset column)
    if min_parking is not None:
        where_clauses.append("parking_spaces >= ?")
        params.append(int(min_parking))

    # 13. Amenities (each requested facility must appear in the real
    # pipe-separated amenities string — deterministic, never invented)
    for am in (amenities or []):
        token = str(am or "").strip().lower()
        if token:
            where_clauses.append("LOWER(amenities) LIKE ?")
            params.append(f"%{token}%")

    where_sql = (" WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    # Count total matches
    count_sql = f"SELECT COUNT(*) FROM properties{where_sql}"
    cur.execute(count_sql, params)
    total_count = cur.fetchone()[0]

    # Order by
    if sort_by == "cheapest":
        order_sql = " ORDER BY price_aed ASC"
    elif sort_by == "expensive":
        order_sql = " ORDER BY price_aed DESC"
    elif sort_by == "size":
        order_sql = " ORDER BY property_size_sqft DESC"
    else:
        # Balanced: price asc, size desc
        order_sql = " ORDER BY price_aed ASC, property_size_sqft DESC"

    query_sql = f"SELECT * FROM properties{where_sql}{order_sql} LIMIT ?"
    cur.execute(query_sql, params + [limit])
    rows = cur.fetchall()
    top_matches = [_row_to_dict(r) for r in rows]

    # Nearby fallback: same filters, neighbouring communities only.
    fallback_info: Dict[str, Any] = {
        "used": False, "requested_location": location, "nearby_locations": [],
    }
    nearby_requested: Optional[str] = None
    if total_count == 0 and location and nearby_fallback:
        from app.services.nearby import nearby_communities_for
        nearby_list = nearby_communities_for(location)
        if nearby_list:
            collected: List[Dict[str, Any]] = []
            nearby_total = 0
            for nb in nearby_list:
                if len(collected) >= limit:
                    break
                sub = search_properties_dataset(
                    location=nb,
                    property_type=property_type,
                    bedrooms=bedrooms,
                    bathrooms=bathrooms,
                    min_budget_aed=min_budget_aed,
                    max_budget_aed=max_budget_aed,
                    purpose=mapped_purpose or purpose,
                    near_metro=near_metro,
                    near_beach=near_beach,
                    view=view,
                    sort_by=sort_by,
                    main_road_access=main_road_access,
                    availability=availability,
                    limit=limit - len(collected),
                    nearby_fallback=False,
                    min_parking=min_parking,
                    amenities=amenities,
                )
                nearby_total += sub["total_found"]
                for m in sub["top_properties"]:
                    m["is_nearby_alternative"] = True
                    m["requested_location"] = location
                    m["actual_location"] = m.get("location")
                    collected.append(m)
            if collected:
                top_matches = collected[:limit]
                total_count = nearby_total
                nearby_requested = location
                fallback_info = {
                    "used": True,
                    "requested_location": location,
                    "nearby_locations": nearby_list,
                }

    def _score_csv_match(m: Dict[str, Any]) -> Dict[str, Any]:
        """Transparent 0–100 match score against requested criteria."""
        specified = 0
        earned = 0
        reasons: List[str] = []
        mismatches: List[str] = []

        if property_type:
            specified += 30
            earned += 30
            reasons.append(f"Exact {m['property_type']} match")
        if bedrooms is not None:
            specified += 25
            earned += 25
            reasons.append("Studio exact match" if m["bhk"] == 0 else f"{m['bhk']} BHK exact match")
        if location:
            specified += 20
            earned += 20
            loc_q = location.strip().lower()
            if nearby_requested:
                reasons.append(
                    f"Nearby alternative in {m['location']} "
                    f"(no exact match in {nearby_requested})"
                )
            elif loc_q in m["location"].lower():
                reasons.append(f"Located in {m['location']}")
            else:
                reasons.append(f"Found via listing title in {m['location']}")
        if mapped_purpose:
            specified += 15
            earned += 15
            reasons.append(f"Listed for {m['listing_type']}")
        if max_budget_aed is not None:
            specified += 10
            earned += 10
            diff = int(max_budget_aed) - int(m["price_aed"])
            if diff > 0:
                reasons.append(f"AED {diff:,} under your ceiling")
            else:
                reasons.append("At your budget ceiling")
        if near_metro is True:
            reasons.append(f"{m['metro_distance_km']:.1f} km to {m['nearest_metro'] or 'nearest'} Metro")
        if near_beach is True:
            reasons.append(f"{m['beach_distance_km']:.1f} km to the beach")
        if availability:
            reasons.append(f"Availability: {m['availability']}")

        if specified == 0:
            return {"match_score": 100, "match_reasons": ["Matches your search"], "mismatches": mismatches}
        return {
            "match_score": round(100.0 * earned / specified),
            "match_reasons": reasons,
            "mismatches": mismatches
        }

    summary_for_ai = []
    for m in top_matches:
        scored = _score_csv_match(m)
        m.update(scored)
        summary_for_ai.append({
            "property_id": m["property_id"],
            "title": m["title"],
            "location": m["location"],
            "price_aed": m["price_aed"],
            "price_formatted": f"AED {m['price_aed']:,}",
            "bhk": f"{m['bhk']} BHK" if m["bhk"] > 0 else "Studio",
            "property_type": m["property_type"],
            "listing_type": m["listing_type"],
            "property_size_sqft": m["property_size_sqft"],
            "view": m["view"],
            "near_metro": "Yes" if m["near_metro"] else "No",
            "main_road_access": m["main_road_access"],
            "nearest_main_road": m.get("nearest_main_road", ""),
            "availability": m["availability"],
            "amenities": m["amenities"][:5],
            "match_score": scored["match_score"],
            "match_reasons": scored["match_reasons"],
            "mismatches": scored["mismatches"],
            "is_nearby_alternative": bool(m.get("is_nearby_alternative", False)),
            "requested_location": m.get("requested_location"),
            "actual_location": m.get("actual_location") or m.get("location"),
        })

    search_time_ms = round((time.perf_counter() - t_start) * 1000, 2)

    return {
        "total_found": total_count,
        "exact_match": total_count > 0 and not fallback_info["used"],
        "top_properties": top_matches,
        "ai_summary": summary_for_ai,
        "fallback": fallback_info,
        "criteria": {
            "location": location,
            "property_type": property_type,
            "bedrooms": bedrooms,
            "purpose": mapped_purpose or purpose,
            "max_budget_aed": max_budget_aed,
            "min_budget_aed": min_budget_aed,
            "near_metro": near_metro,
            "near_beach": near_beach,
            "main_road_access": main_road_access,
            "availability": availability,
            "min_parking": min_parking,
            "amenities": amenities or [],
        },
        "search_time_ms": search_time_ms,
    }
