from fastapi import FastAPI, HTTPException, Query, UploadFile, File, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
import os
import json
import logging
import pandas as pd
import simplekml
import geopandas as gpd
from typing import Literal
from shapely.geometry import box
import tempfile
import io
import re
from threading import Timer, Lock
import numpy as np

# ============================================================
# FastAPI app setup
# ============================================================

app = FastAPI(root_path="/geo-api")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# Logging & ENV
# ============================================================
# ============================================================
# Global Caches
# ============================================================

QUERY_CACHE: dict[tuple[str, str], dict] = {}


logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:12345@10.133.132.90:5432/TPGA01")
TEMPLATE_DIR = "./templates"
os.makedirs(TEMPLATE_DIR, exist_ok=True)

# Default engine (used only in a few legacy endpoints like /tables, /grid-map/from-table)
engine = create_engine(DATABASE_URL)

# Config DB (project configuration)
CONFIG_DB_URL = "postgresql://postgres:postgres@10.129.7.247:5431/GLOBE"
config_engine = create_engine(CONFIG_DB_URL)

# (Kept for completeness; most logic uses DB_ENGINES instead)
DATA_DB_URL = os.getenv("DATABASE_URL", "postgresql://postgres:12345@10.133.132.90:5432/postgres")
data_engine = create_engine(DATA_DB_URL)

# ============================================================
# Global stores & caches
# ============================================================

# Dynamic engines
DB_ENGINES: dict[str, any] = {}
TABLE_DB_CACHE: dict[str, str | None] = {}
TABLE_COLUMNS_CACHE: dict[tuple[str, str], list[str]] = {}

# Drive test and grid data
drive_test_store = {"df": None, "columns": []}
grid_data = None

# Progress tracker
progress_status = {"progress": 0, "stage": "Idle"}
_progress_status_lock = Lock()

# Refresh lock for DB engines
_refresh_lock = False


# ============================================================
# Utility: band extraction
# ============================================================

def extract_band(val):
    """
    Extracts normalized band identifiers for 2G/3G/4G/5G.
    Examples handled:
      - N78, N41 (5G)
      - L800, L1800, L2100 (4G)
      - U900, W2100 (3G)
      - G900, G1800 (2G)
      - BAND 8, Band 1 → B8, B1
    """
    if not val:
        return None

    s = str(val).upper().replace(" ", "")

    # 5G pattern: N78, N41, N28, etc.
    m = re.search(r"\bN\d{2,4}\b", s)
    if m:
        return m.group(0)

    # 4G LTE pattern: L800, L1800, L2100, etc.
    m = re.search(r"\bL\d{2,4}\b", s)
    if m:
        return m.group(0)

    # 3G UMTS/WCDMA pattern: U900, U2100, W2100, etc.
    m = re.search(r"\b[UW]\d{3,4}\b", s)
    if m:
        return m.group(0)

    # 2G GSM pattern: G900, G1800, etc.
    m = re.search(r"\bG\d{3,4}\b", s)
    if m:
        return m.group(0)

    # Fallback: “Band 8”, “BAND8” → “B8”
    m = re.search(r"BAND\s?(\d+)", s)
    if m:
        return f"B{m.group(1)}"

    return None

def infer_db_from_project(project: str) -> str | None:
    """
    Infer DB name from project_name.
    Example: BHAZ01_3G → BHAZ01, VF3UK1_4G → VF3UK1
    """
    if not project:
        return None
    base = project.split("_")[0].strip()
    return base or None

# ============================================================
# Dynamic DB engine loading
# ============================================================

def load_all_db_engines():
    """
    Dynamically loads SQLAlchemy engines for all databases 
    from multiple PostgreSQL hosts.
    Works safely and merges results into DB_ENGINES.
    """
    db_hosts = [
        {
            "host": "10.133.132.90",
            "user": "postgres",
            "password": "12345",
            "port": 5432,
        },
        {
            "host": "10.129.5.29",
            "user": "postgres",
            "password": "postgres",
            "port": 5430,
        },
        {
            "host": "10.164.165.206",
            "user": "postgres",
            "password": "12345",
            "port": 5432,
        },
        {
            "host": "10.129.7.247",
            "user": "postgres",
            "password": "postgres",
            "port": 5431,
        },
    ]

    loaded_count = 0

    for db_info in db_hosts:
        host, user, password, port = (
            db_info["host"],
            db_info["user"],
            db_info["password"],
            db_info["port"],
        )

        try:
            base_url = f"postgresql+psycopg2://{user}:{password}@{host}:{port}/postgres"
            base_engine = create_engine(base_url)

            with base_engine.connect() as conn:
                dbs = [
                    r[0]
                    for r in conn.execute(
                        text("SELECT datname FROM pg_database WHERE datistemplate = false")
                    )
                ]

            for db_name in dbs:
                try:
                    url = f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{db_name}"
                    DB_ENGINES[db_name] = create_engine(
                        url,
                        pool_size=5,
                        max_overflow=10,
                        pool_timeout=30,
                        pool_recycle=1800,
                        pool_pre_ping=True,
                    )
                    loaded_count += 1
                except Exception as e:
                    print(f" Skipping DB {db_name} on {host}: {e}")

            print(f" Loaded {len(dbs)} databases from {host}:{port} → {dbs}")

        except Exception as e:
            print(f" Failed to connect to {host}:{port} → {e}")

    print(f" Total databases loaded: {loaded_count}")
    return DB_ENGINES


def refresh_db_engines():
    """Refresh dynamic DB engines once a day (guarded by a simple lock)."""
    global _refresh_lock
    if _refresh_lock:
        return
    _refresh_lock = True
    try:
        print("Refreshing DB engines...")
        load_all_db_engines()
    finally:
        _refresh_lock = False


# Schedule refresh once every 24h
Timer(86400, refresh_db_engines).start()

# Initial load at startup
load_all_db_engines()
refresh_db_engines()


# ============================================================
# DB helper functions
# ============================================================

def get_engine_for_db(db_name: str):
    """
    Returns a SQLAlchemy engine for the given database name.
    Uses the dynamically loaded engines from DB_ENGINES.
    """
    if db_name not in DB_ENGINES:
        raise HTTPException(status_code=400, detail=f"Unknown or inaccessible database: {db_name}")
    return DB_ENGINES[db_name]


def find_db_for_table_cached(tbl_name: str):
    """
    Global helper:
    - Normalize table name
    - Check cache first
    - If not cached, scan DB_ENGINES with to_regclass
    - Cache result (including None) to avoid repeated scans
    """
    if not tbl_name:
        return None

    norm_name = tbl_name.strip().replace('"', '')
    if norm_name in TABLE_DB_CACHE:
        return TABLE_DB_CACHE[norm_name]

    for db_name, eng in DB_ENGINES.items():
        try:
            with eng.connect() as conn:
                exists = conn.execute(
                    text("SELECT to_regclass(:tbl)"),
                    {"tbl": f'public."{norm_name}"'},
                ).scalar()
                if exists:
                    TABLE_DB_CACHE[norm_name] = db_name
                    return db_name
        except Exception:
            continue

    TABLE_DB_CACHE[norm_name] = None
    return None


def get_columns_for_table_cached(db_name: str, table_name: str):
    """
    Returns list of columns for a table in a DB with caching.
    table_name can be schema-qualified; last part is used.
    """
    if not db_name or not table_name:
        return []

    base_table = table_name.split(".")[-1].replace('"', "")
    cache_key = (db_name, base_table.lower())

    if cache_key in TABLE_COLUMNS_CACHE:
        return TABLE_COLUMNS_CACHE[cache_key]

    eng = get_engine_for_db(db_name)
    with eng.connect() as conn:
        cols = [
            r[0]
            for r in conn.execute(
                text(
                    """
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_name=:t OR lower(table_name)=lower(:t)
                    """
                ),
                {"t": base_table},
            )
        ]

    TABLE_COLUMNS_CACHE[cache_key] = cols
    return cols


def qualify_table(table_name: str, default_schema="public"):
    """
    Helper to schema-qualify a table if needed.
    """
    if "." in table_name:
        return table_name
    return f'{default_schema}."{table_name}"'


# ============================================================
# Simple endpoints: DB list, project configs, etc.
# ============================================================

@app.get("/databases")
def list_databases():
    """Returns the list of dynamically loaded databases."""
    try:
        return list(DB_ENGINES.keys())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/projects")
def get_projects():
    with config_engine.connect() as conn:
        res = conn.execute(
            text("SELECT DISTINCT project_name FROM geolytics_projectconfiguration")
        )
        return [r[0] for r in res]


@app.get("/projects/{project}/types")
def get_project_table_types(project: str):
    with config_engine.connect() as conn:
        res = conn.execute(
            text(
                "SELECT DISTINCT table_type FROM geolytics_projectconfiguration WHERE project_name=:p"
            ),
            {"p": project},
        )
        return [r[0] for r in res]


@app.get("/projects/{project}/config")
def get_project_config(project: str, table_type: str):
    """
    Returns the full configuration rows for a given project and table_type.
    Returns ALL columns (including color_column, thresholds, KPI columns, etc.)
    Normalizes table_type safely
    Filters correctly by project_name and table_type
    """
    table_type_clean = table_type.strip().replace("’", "'").lower()

    with config_engine.connect() as conn:
        cols_result = conn.execute(
            text(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = 'geolytics_projectconfiguration'
                ORDER BY ordinal_position
                """
            )
        )
        all_columns = [r[0] for r in cols_result]

        query = text(
            f"""
            SELECT {', '.join(f'"{c}"' for c in all_columns)}
            FROM geolytics_projectconfiguration
            WHERE lower(trim(project_name)) = :p
              AND lower(trim(table_type)) = :t
            """
        )

        res = conn.execute(
            query, {"p": project.lower().strip(), "t": table_type_clean}
        )
        rows = [dict(r) for r in res.mappings()]

        if not rows:
            raise HTTPException(
                status_code=404,
                detail="No configuration found for this project/type",
            )

        return {
            "project": project,
            "table_type": table_type,
            "columns": all_columns,
            "rows": rows,
        }


@app.get("/tables")
def get_tables():
    with engine.connect() as conn:
        res = conn.execute(
            text(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                """
            )
        )
        return [row[0] for row in res]


# ============================================================
# /columns/{project_name}
# ============================================================

@app.get("/columns/{project_name}")
def get_table_columns(project_name: str):
    """
    Returns column names for a given project or raw table.
    ✅ Resolves project_name → actual source_table from config
    ✅ If not found, auto-checks RCA target_table as fallback
    ✅ Auto-detects correct DB via DB_ENGINES
    ✅ Handles schema-qualified names
    ✅ Returns list of column names
    """
    print(f" /columns called for: {project_name}")

    clean_name = re.sub(r"\s+$", "", project_name.strip().replace('"', ""))
    print(f" Normalized: {clean_name}")

    with config_engine.connect() as conn:
        cfg = conn.execute(
            text(
                """
                SELECT source_table
                FROM geolytics_projectconfiguration
                WHERE lower(trim(project_name)) = lower(:p)
                LIMIT 1
                """
            ),
            {"p": clean_name.lower()},
        ).fetchone()

    if cfg:
        source_table = cfg[0]
        print(f" Mapped project '{clean_name}' → source_table='{source_table}'")
    else:
        source_table = clean_name
        print(f" No config mapping, using raw name '{source_table}'")

    db_for_table = find_db_for_table_cached(source_table)

    if not db_for_table:
        print(f"⚠️ Table '{source_table}' not found in any DB. Trying RCA fallback...")
        with config_engine.connect() as conn:
            rca_cfg = conn.execute(
                text(
                    """
                    SELECT target_table
                    FROM geolytics_projectconfiguration
                    WHERE lower(trim(project_name)) = lower(:p)
                      AND lower(table_type) LIKE '%rca%'
                    LIMIT 1
                    """
                ),
                {"p": clean_name.lower()},
            ).fetchone()

        if rca_cfg and rca_cfg[0]:
            rca_table = rca_cfg[0]
            db_for_table = find_db_for_table_cached(rca_table)
            if db_for_table:
                print(f"🧭 RCA fallback → Using target_table='{rca_table}' (DB={db_for_table})")
                source_table = rca_table
            else:
                print(
                    f"❌ RCA fallback table '{rca_table}' also not found in any DB"
                )
                raise HTTPException(
                    status_code=404, detail=f"Table '{source_table}' not found"
                )
        else:
            raise HTTPException(
                status_code=404, detail=f"Table '{source_table}' not found"
            )

    cols = get_columns_for_table_cached(db_for_table, source_table)
    print(f"✅ Found {len(cols)} columns in '{source_table}' (DB={db_for_table})")
    return cols


# ============================================================
# /distinct-values/{table}
# ============================================================

@app.get("/distinct-values/{table}")
async def get_distinct_values(
    table: str,
    col: str = Query(..., description="Column name to get distinct values for"),
):
    """
    Dynamic distinct-value detector:
    - If column is numeric → return min & max
    - If column is text   → return distinct list
    """

    if not table or not col:
        raise HTTPException(status_code=400, detail="Table and column required")

    try:
        logger.info(f" /distinct-values → table={table}, col={col}")

        db_for_table = find_db_for_table_cached(table)
        if not db_for_table:
            raise HTTPException(status_code=404, detail=f"Table '{table}' not found")

        eng = get_engine_for_db(db_for_table)
        qualified = f'public."{table}"'

        # Fetch all columns
        all_cols = get_columns_for_table_cached(db_for_table, table)

        # Match column safely
        match_col = next(
            (c for c in all_cols if c.lower() == col.lower()),
            next(
                (c for c in all_cols
                 if re.sub(r"[^a-z0-9]", "", c.lower())
                 == re.sub(r"[^a-z0-9]", "", col.lower())),
                None,
            ),
        )

        if not match_col:
            raise HTTPException(status_code=404, detail=f"Column '{col}' not found")

        logger.info(f"🎯 Using column '{match_col}'")

        # 🔍 Detect data type
        with eng.connect() as conn:
            dtype = conn.execute(
                text(
                    f"""
                    SELECT data_type 
                    FROM information_schema.columns
                    WHERE table_name = :tbl
                    AND column_name = :col
                    """
                ),
                {"tbl": table, "col": match_col},
            ).scalar()

        logger.info(f"📌 Data type for {match_col} = {dtype}")

        # ───────────────────────────────────────────────
        #  CASE 1: Numeric column → Return MIN & MAX
        # ───────────────────────────────────────────────
        if dtype and ("int" in dtype.lower() or "numeric" in dtype.lower() or "double" in dtype.lower() or "real" in dtype.lower()):
            with eng.connect() as conn:
                q = conn.execute(
                    text(
                        f'''
                        SELECT 
                            MIN(CAST("{match_col}" AS DOUBLE PRECISION)) AS min_val,
                            MAX(CAST("{match_col}" AS DOUBLE PRECISION)) AS max_val
                        FROM {qualified}
                        WHERE "{match_col}" IS NOT NULL
                        '''
                    )
                ).fetchone()

            return {
                "type": "number",
                "min": float(q.min_val) if q.min_val is not None else None,
                "max": float(q.max_val) if q.max_val is not None else None,
            }

        # ───────────────────────────────────────────────
        #  CASE 2: Text column → Return DISTINCT values
        # ───────────────────────────────────────────────
        with eng.connect() as conn:
            result = conn.execute(
                text(
                    f'''
                    SELECT DISTINCT "{match_col}"
                    FROM {qualified}
                    WHERE "{match_col}" IS NOT NULL AND TRIM("{match_col}") <> ''
                    LIMIT 10000
                    '''
                )
            )
            values = [str(r[0]).strip() for r in result if r[0] is not None]

        return {
            "type": "string",
            "values": sorted(values, key=lambda x: x.lower()),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"💥 /distinct-values error: {e}")
        raise HTTPException(status_code=500, detail=str(e))



# ============================================================
# Progress utilities + /progress
# ============================================================

def set_progress(progress: int, stage: str = ""):
    """Thread-safe progress update."""
    with _progress_status_lock:
        progress_status["progress"] = int(progress)
        if stage:
            progress_status["stage"] = stage


def reset_progress_later(delay: float = 3.0):
    """
    Reset progress back to Idle after a short delay.
    """
    def _reset():
        with _progress_status_lock:
            progress_status["progress"] = 0
            progress_status["stage"] = "Idle"
            progress_status.pop("error", None)

    Timer(delay, _reset).start()


@app.get("/progress")
def get_progress():
    """Frontend polls this endpoint to get live progress updates."""
    return progress_status

def resolve_table_any(engine, raw_name: str, db_label: str):
    """
    Resolve a table/view name in a DB.
    Looks in information_schema.tables AND information_schema.views.
    Returns: qualified_name, schema, table
    """
    base = raw_name.strip().replace('"', "").split(".")[-1]

    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT table_schema, table_name
                FROM information_schema.tables
                WHERE lower(trim(table_name)) = lower(trim(:t))
                UNION ALL
                SELECT table_schema, table_name
                FROM information_schema.views
                WHERE lower(trim(table_name)) = lower(trim(:t))
                LIMIT 1
                """
            ),
            {"t": base},
        ).fetchone()

    if not row:
        raise HTTPException(
            status_code=404,
            detail=f"Table/View {raw_name} not found in {db_label}",
        )
    return f'"{row[0]}"."{row[1]}"', row[0], row[1]
def make_threshold_mask(series: pd.Series, expr: str | None) -> pd.Series:
    """
    Supported:
      - None or ''        → everything True
      - <>NULL, !=NULL,
        NOT NULL          → non-null values
      - =NULL, IS NULL    → only null/blank values
      - >x, <x, >=x, <=x  → numeric comparisons
      - =VALUE            → string match (case-insensitive)
      - VALUE             → string match (case-insensitive)
    """
    if series is None:
        # Should not normally happen, but keep it safe
        return pd.Series([True] * 0, dtype=bool)

    if not expr or str(expr).strip() == "":
        return pd.Series([True] * len(series), index=series.index)

    expr = str(expr).strip()
    expr_up = expr.upper()

    # ----- NULL / NOT NULL -----
    if expr_up in ("<>NULL", "!=NULL", "NOT NULL"):
        # non-null and not empty string
        return series.notna() & (series.astype(str).str.strip() != "")

    if expr_up in ("=NULL", "IS NULL"):
        # null or blank string
        return series.isna() | (series.astype(str).str.strip() == "")

    # ----- Numeric comparisons (>1, <=0.5, etc.) -----
    m = re.match(r"(>=|<=|>|<)\s*([\d\.]+)", expr)
    if m:
        op, val_str = m.groups()
        try:
            val = float(val_str)
            num = pd.to_numeric(series, errors="coerce")
            if op == ">":
                return num > val
            if op == "<":
                return num < val
            if op == ">=":
                return num >= val
            if op == "<=":
                return num <= val
        except Exception:
            # If something goes wrong, don't filter anything out
            return pd.Series([True] * len(series), index=series.index)

    # ----- Explicit string: =Something -----
    if expr.startswith("="):
        val = expr[1:].strip().lower()
        return series.astype(str).str.strip().str.lower() == val

    # ----- Implicit string: Something -----
    val = expr.strip().lower()
    return series.astype(str).str.strip().str.lower() == val


def apply_color_config(
    df: pd.DataFrame,
    color_column: str | None,
    threshold_expr: str | None,
):
    """
    Generic coloring logic for any table_type using
    geolytics_projectconfiguration.color_column + thersold1.

    STRICT BEHAVIOR (Option A):
      - threshold_expr decides which rows are "active"
      - Only active rows get colors
      - All non-active rows are grey (#CCCCCC)
    """
    features = []
    all_bands = set()

    # --------------------------------------------------
    # No color column → basic features, no special color
    # --------------------------------------------------
    if not color_column or color_column not in df.columns:
        for _, r in df.iterrows():
            try:
                lon, lat = float(r["Long"]), float(r["Lat"])
                if not np.isfinite(lon) or not np.isfinite(lat):
                    continue
                props = {k: (None if pd.isna(v) else v) for k, v in r.items()}
                norm_band = extract_band(props.get("band") or props.get("cellname"))
                if norm_band:
                    props["band"] = norm_band
                    all_bands.add(norm_band)
                features.append(
                    {
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [lon, lat]},
                        "properties": props,
                    }
                )
            except Exception:
                continue

        return features, sorted(all_bands), {
            "mode": "none",
            "color_column": None,
            "legend": [],
        }

    series = df[color_column]
    mask = make_threshold_mask(series, threshold_expr)

    # Decide type (numeric vs categorical)
    numeric_series = pd.to_numeric(series, errors="coerce")
    is_numeric = numeric_series.notna().sum() > 0 and not pd.api.types.is_string_dtype(
        series
    )

    palette = [
        "#e6194b",
        "#3cb44b",
        "#ffe119",
        "#4363d8",
        "#f58231",
        "#911eb4",
        "#46f0f0",
        "#f032e6",
        "#bcf60c",
        "#fabebe",
        "#008080",
        "#e6beff",
        "#9a6324",
        "#fffac8",
        "#800000",
        "#aaffc3",
        "#808000",
        "#ffd8b1",
        "#000075",
        "#808080",
    ]

    color_meta = {
        "mode": "numeric" if is_numeric else "categorical",
        "color_column": color_column,
        "threshold": threshold_expr,
        "legend": [],
    }

    # --------------------------------------------------
    # NUMERIC MODE  (e.g. >1, <>NULL on numeric KPI)
    # --------------------------------------------------
    if is_numeric:
        # Use only rows that pass the mask AND are numeric for legend
        vals = numeric_series[mask & numeric_series.notna()]
        if vals.empty:
            # Nothing to color, fall back to grey everywhere
            value_to_color = {idx: "#CCCCCC" for idx in df.index}
        else:
            vmin, vmax = float(vals.min()), float(vals.max())
            bins = np.linspace(vmin, vmax, 6)  # 5 buckets
            labels = []
            for i in range(5):
                labels.append((bins[i], bins[i + 1]))

            def bucket_color(v):
                if np.isnan(v):
                    return "#CCCCCC"
                for i, (a, b) in enumerate(labels):
                    if (i < 4 and a <= v < b) or (i == 4 and a <= v <= b):
                        return palette[i % len(palette)]
                return "#CCCCCC"

            color_meta["min"] = vmin
            color_meta["max"] = vmax
            color_meta["legend"] = [
                {
                    "label": f"{a:.2f} – {b:.2f}",
                    "from": a,
                    "to": b,
                    "color": palette[i % len(palette)],
                }
                for i, (a, b) in enumerate(labels)
            ]

            # STRICT: apply mask when assigning colors
            value_to_color = {}
            for idx, v in numeric_series.items():
                if not mask.loc[idx] or pd.isna(v):
                    # outside threshold or NaN → grey
                    value_to_color[idx] = "#CCCCCC"
                else:
                    value_to_color[idx] = bucket_color(v)

    # --------------------------------------------------
    # CATEGORICAL MODE  (Alarm / RCA / Responsibility, etc.)
    # --------------------------------------------------
    else:
        vals = series[mask & series.notna()].astype(str)
        uniques = sorted(vals.unique())
        color_map = {v: palette[i % len(palette)] for i, v in enumerate(uniques)}

        color_meta["unique_values"] = uniques
        color_meta["legend"] = [
            {"value": v, "color": color_map[v]} for v in uniques
        ]

        # STRICT: only masked rows get their category color
        value_to_color = {}
        for idx, v in series.items():
            if not mask.loc[idx] or pd.isna(v):
                value_to_color[idx] = "#CCCCCC"
            else:
                value_to_color[idx] = color_map.get(str(v), "#CCCCCC")

    # --------------------------------------------------
    # Build final GeoJSON-like features with "color" property
    # --------------------------------------------------
    for idx, r in df.iterrows():
        try:
            lon, lat = float(r["Long"]), float(r["Lat"])
            if not np.isfinite(lon) or not np.isfinite(lat):
                continue

            props = {k: (None if pd.isna(v) else v) for k, v in r.items()}
            norm_band = extract_band(props.get("band") or props.get("cellname"))
            if norm_band:
                props["band"] = norm_band
                all_bands.add(norm_band)

            # attach color
            if color_column in df.columns:
                props["color"] = value_to_color.get(idx, "#CCCCCC")

            features.append(
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [lon, lat],
                    },
                    "properties": props,
                }
            )
        except Exception:
            continue

    return features, sorted(all_bands), color_meta


# ============================================================
# /query – main site/KPI/RCA join
# ============================================================

@app.get("/query")
def query_sites(project: str, table_type: str):
    """
    Builds dataset for GeoJSON visualization.

    Modes:
      A) Source-only (no target)
      B) Normal Join (KPI / CM Change)
      C) RCA (categorical issue analysis)
    """

    import time

    start_time = time.time()
    set_progress(0, "Initializing...")
    cache_key = (project.lower().strip(), table_type.lower().strip())

    # If cached → return instantly
    from fastapi.responses import JSONResponse

    if cache_key in QUERY_CACHE:
        logger.info(f"⚡ Cache HIT → {cache_key}")
        return JSONResponse(
            content=QUERY_CACHE[cache_key],
            headers={"X-Cache": "HIT"}   # ⭐ VERY IMPORTANT
        )
    
    
    logger.info(" /query endpoint called")
    logger.info(f" Input → project={project}, table_type={table_type}")

    try:
        # ------------------------------------------------------------------
        # 1) Read config row strictly from mapping table
        # ------------------------------------------------------------------
        table_type_clean = (
            table_type.strip()
            .replace("’", "'")
            .replace("`", "'")
            .replace("%27", "'")
            .lower()
        )
        candidates = [table_type_clean]
        if "kpi's" in table_type_clean:
            candidates.append("kpis")
        if "kpis" in table_type_clean:
            candidates.append("kpi's")

        set_progress(10, "Fetching configuration...")
        with config_engine.connect() as conn:
            cfg = None
            for cand in candidates:
                query = text(
                    """
                    SELECT source_table, source_column, target_db, target_table, target_column, color_column, band,
                           column1, column2, column3, column4, column5, 
                           column6, column7, column8, column9, column10, column11,
                           thersold1, thersold2, thersold3, thersold4, thersold5,
                           thersold6, thersold7, thersold8, thersold9, thersold10, thersold11
                    FROM geolytics_projectconfiguration
                    WHERE lower(trim(project_name)) = :p
                      AND lower(trim(table_type)) = :t
                    """
                )
                cfg = conn.execute(
                    query, {"p": project.lower().strip(), "t": cand}
                ).mappings().first()
                if cfg:
                    cfg = dict(cfg)
                    break

        if not cfg:
            logger.warning(f"No config found for {project}/{table_type}")
            return {
                "status": "missing_config",
                "message": f"No configuration found for {project} ({table_type})",
                "features": [],
                "bands": [],
            }

        def clean_name(v: str):
            if not v:
                return ""
            v = v.strip().replace('"', "").replace("`", "").replace("’", "'")
            return " ".join(v.split())  # collapse multiple spaces → single space

        # STRICT: use names exactly as mapping table says (after simple trim)
        source_table = clean_name(cfg.get("source_table"))
        target_table = clean_name(cfg.get("target_table"))
        source_col = clean_name(cfg.get("source_column"))
        target_col = clean_name(cfg.get("target_column"))

        # ------------------------------------------------------------------
        # 2) Resolve DBs (no fuzzy table name changes, just DB detection)
        # ------------------------------------------------------------------
        source_db = find_db_for_table_cached(source_table)
        target_db = find_db_for_table_cached(target_table) if target_table else None

        # Prevent join key from being mistaken as DB name (very defensive)
        if source_db and source_col and source_db.lower() == source_col.lower():
            source_db = None
        if target_db and target_col and target_db.lower() == target_col.lower():
            target_db = None

        inferred_db = infer_db_from_project(project)

        if not source_db:
            if inferred_db and inferred_db in DB_ENGINES:
                source_db = inferred_db
            else:
                source_db = find_db_for_table_cached(source_table)

        if not target_db and target_table:
            if inferred_db and inferred_db in DB_ENGINES:
                target_db = inferred_db
            else:
                target_db = find_db_for_table_cached(target_table)

        if not source_db:
            raise HTTPException(
                status_code=400,
                detail=f"Could not resolve DB for source_table '{source_table}'",
            )
        if target_table and not target_db:
            raise HTTPException(
                status_code=400,
                detail=f"Could not resolve DB for target_table '{target_table}'",
            )

        logger.info(
            f" Source={source_table} (DB={source_db}) → Target={target_table or '—'} (DB={target_db or '—'})"
        )
        source_engine = get_engine_for_db(source_db)

        # ------------------------------------------------------------------
        # 3) Detect source schema + columns
        # ------------------------------------------------------------------
        set_progress(20, "Resolving source schema...")
        qualified_source, s_schema, s_table = resolve_table_any(
            source_engine, source_table, source_db
        )

        with source_engine.connect() as conn:
            src_cols = [
                r[0]
                for r in conn.execute(
                    text(
                        """
                        SELECT column_name FROM information_schema.columns
                        WHERE table_schema=:s AND table_name=:t
                        """
                    ),
                    {"s": s_schema, "t": s_table},
                )
            ]

        def pick_cellname_col(all_cols, configured):
            if configured:
                for c in all_cols:
                    if c.lower().strip() == configured.lower().strip():
                        return c
            for c in all_cols:
                if re.search(
                    r"cellname|cell_name|cell id|cellid|element|enbcell|d2el",
                    c,
                    re.IGNORECASE,
                ):
                    return c
            for c in all_cols:
                if "site" in c.lower():
                    return c
            return all_cols[0] if all_cols else configured

        # STRICT: if mapping gives source_column, we trust it;
        # but we MUST still ensure it exists in DB, otherwise hard error.
        if source_col and source_col not in src_cols:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Source column '{source_col}' does not exist in source table '{source_table}'. "
                    f"Available columns: {src_cols}"
                ),
            )

        # If mapping didn't provide source_col, auto-detect it
        if not source_col:
            source_col = pick_cellname_col(src_cols, None)

        def find_col(cands):
            for name in src_cols:
                ln = name.lower()
                for c in cands:
                    if c in ln:
                        return name
            return None

        az_col = find_col(["azimuth"])
        lat_col = find_col([" lat", "lat ", "lat", "latitude"])
        lon_col = find_col([" lon", "lon ", "lon", "long", "longitude"])
        site_col = find_col(["sitename", "site_id", "siteid", "site"])

        band_col = cfg.get("band")
        if band_col not in src_cols:
            band_col = None

        city_col = find_col(["city", "region", "town", "hq", "LAYER"])

        logger.info(
            f" Detected lat={lat_col}, lon={lon_col}, site={site_col}, band={band_col}, city={city_col}"
        )
        if not lat_col or not lon_col:
            raise HTTPException(
                status_code=400,
                detail=f"Could not detect Lat/Lon columns in {source_table}",
            )

        # ------------------------------------------------------------------
        # 4) Build source SQL – IMPORTANT: alias join key as "cellname"
        # ------------------------------------------------------------------
        def build_source_sql():
            az_expr = f'"{az_col}" AS "Azimuth"' if az_col else 'NULL::text AS "Azimuth"'
            site_expr = (
                f'"{site_col}" AS "site_id"' if site_col else 'NULL::text AS "site_id"'
            )
            band_expr = f'"{band_col}" AS "band"' if band_col else 'NULL::text AS "band"'
            city_expr = f'"{city_col}" AS "city"' if city_col else 'NULL::text AS "city"'
            return f"""
                SELECT
                    "{source_col}" AS "cellname",
                    "{lat_col}" AS "Lat",
                    "{lon_col}" AS "Long",
                    {az_expr},
                    {site_expr},
                    {band_expr},
                    {city_expr}
                FROM {qualified_source}
                WHERE "{lat_col}" IS NOT NULL AND "{lon_col}" IS NOT NULL
                LIMIT 40000
            """

        # ------------------------------------------------------------------
        # 5) CASE A: Source-only (no target join)
        # ------------------------------------------------------------------
        if not target_table or not target_col:
            set_progress(40, "Fetching source data...")
            df = pd.read_sql(text(build_source_sql()), source_engine.connect())
            logger.info(f" Source rows: {len(df)}")

            features, all_bands = [], set()
            for _, r in df.iterrows():
                try:
                    lon, lat = float(r["Long"]), float(r["Lat"])
                    if not np.isfinite(lon) or not np.isfinite(lat):
                        continue
                    props = {k: (None if pd.isna(v) else v) for k, v in r.items()}
                    norm_band = extract_band(props.get("band") or props.get("cellname"))
                    if norm_band:
                        props["band"] = norm_band
                        all_bands.add(norm_band)
                    features.append(
                        {
                            "type": "Feature",
                            "geometry": {
                                "type": "Point",
                                "coordinates": [lon, lat],
                            },
                            "properties": props,
                        }
                    )
                except Exception:
                    continue

            safe_rows = json.loads(
                df.to_json(orient="records", default_handler=str)
            )
            set_progress(100, "Complete ✅")
            logger.info(
                f" GeoJSON ready (Source-only) | Features={len(features)} | Bands={sorted(all_bands)}"
            )
            final_payload = json.loads(
                
                  
                        {
                            "type": "FeatureCollection",
                            "features": features,
                            "bands": sorted(all_bands),
                            "source_columns": src_cols,
                            "target_columns": [],
                            "rca_column": None,
                            "available_kpis": [],
                            "columns": list(df.columns),
                            "rows": safe_rows,
                        },
                        default=str,
                    )
                
                
            
            QUERY_CACHE[cache_key] = final_payload
            return JSONResponse(content=final_payload)

        # ------------------------------------------------------------------
        # 6) GENERIC JOIN MODE (KPI / CM / RCA / Alarm / Traffic / anything)
        # ------------------------------------------------------------------
        # Dynamic color column reading
        color_column = None
        for c in [
            "color_column",
            "column1",
            "column2",
            "column3",
            "column4",
            "column5",
            "column6",
            "column7",
            "column8",
            "column9",
            "column10",
            "column11",
        ]:
            val = cfg.get(c)
            if val not in [None, "", "NONE", "none", "Null"]:
                color_column = val.strip()
                break

        # Dynamic threshold
        threshold_expr = None
        for t in [
            "thersold1",
            "thersold2",
            "thersold3",
            "thersold4",
            "thersold5",
            "thersold6",
            "thersold7",
            "thersold8",
            "thersold9",
            "thersold10",
            "thersold11",
        ]:
            val = cfg.get(t)
            if val not in [None, "", "NONE", "none", "Null"]:
                threshold_expr = val.strip()
                break

        set_progress(40, "Fetching joined data...")

        target_engine = get_engine_for_db(target_db)
        qualified_target, t_schema, t_table = resolve_table_any(
            target_engine, target_table, target_db
        )

        # Load source data
        src_df = pd.read_sql(text(build_source_sql()), source_engine.connect())

        # Discover target columns STRICTLY
        with target_engine.begin() as conn:
            tgt_cols = conn.execute(
                text(
                    """
                    SELECT column_name, data_type
                    FROM information_schema.columns
                    WHERE table_schema=:s AND table_name=:t
                    """
                ),
                {"s": t_schema, "t": t_table},
            ).fetchall()

        tgt_colnames = [c for (c, _) in tgt_cols]

        if not target_col:
            raise HTTPException(
                status_code=400,
                detail=f"Config missing target_column for {project}/{table_type}",
            )

        # STRICT: target_col must exist exactly in target table
        if target_col not in tgt_colnames:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Join column '{target_col}' does not exist in target table '{target_table}'. "
                    f"Available columns: {tgt_colnames}"
                ),
            )

        real_join_key = target_col  # no fuzzy; direct
        join_key = target_col

        logger.info(f"✔ Resolved join key → {real_join_key}")
        logger.info(f" Generic join key → {join_key}")
        logger.info(f" Color column from config → {color_column or 'NONE'}")
        logger.info(f" Threshold expression → {threshold_expr or 'NONE'}")

        # Pull full target table
        tgt_sql = text(
            f'''
            SELECT *
            FROM {qualified_target}
            WHERE "{real_join_key}" IS NOT NULL
            LIMIT 50000
        '''
        )
        tgt_df = pd.read_sql(tgt_sql, target_engine.connect())

        # ------------------------------------------------------------------
        # 7) STRICT JOIN: left_on = "cellname" (alias of source_column), right_on = target_col
        # ------------------------------------------------------------------
        if "cellname" not in src_df.columns:
            raise HTTPException(
                status_code=500,
                detail=(
                    f"Internal error: 'cellname' column missing from source DataFrame for table '{source_table}'"
                ),
            )

        # Normalize join columns to string
        src_df["cellname"] = src_df["cellname"].astype(str)
        tgt_df[real_join_key] = tgt_df[real_join_key].astype(str)

        merged = pd.merge(
            src_df,
            tgt_df,
            left_on="cellname",
            right_on=real_join_key,
            how="left",
        )

        merged = merged.replace([np.inf, -np.inf], np.nan).where(
            pd.notnull(merged), None
        )

        # ------------------------------------------------------------------
        # 8) DEBUG: unique values for alarm/traffic/KPI
        # ------------------------------------------------------------------
        def dump_unique(colname):
            if colname in merged.columns:
                try:
                    vals = (
                        merged[colname]
                        .dropna()
                        .astype(str)
                        .str.strip()
                        .unique()
                        .tolist()
                    )
                    print(f"🔎 UNIQUE [{colname}] → {vals[:50]}")
                except Exception as e:
                    print(f"⚠️ Failed printing unique for {colname}: {e}")

        print("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        print(f"🔍 DEBUG COLUMN CHECK for table_type={table_type}")

        # Vendor detection (Alarm)
        for v_col in ["vendor", "Vendor", "VENDOR", "NE_TYPE", "NE"]:
            dump_unique(v_col)

        # Alarm specifics
        for a_col in [
            "alarm_name",
            "Alarm Name",
            "ALARM_NAME",
            "alarm",
            "ALARM",
            "severity",
            "SEVERITY",
            "status",
        ]:
            dump_unique(a_col)

        # Traffic KPIs common columns
        for t_col in [
            "DL_Traffic",
            "UL_Traffic",
            "traffic",
            "TOTAL_TRAFFIC",
            "User_Traffic",
            "Data_Volume",
            "THROUGHPUT",
        ]:
            dump_unique(t_col)

        # Also print the color column being used for polygons
        if color_column:
            print(f"🎨 Color Column = {color_column}")
            dump_unique(color_column)
        else:
            print("🎨 No color_column detected from config!")

        print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")

        # ------------------------------------------------------------------
        # 9) Apply generic coloring based on config
        # ------------------------------------------------------------------
        features, all_bands, color_meta = apply_color_config(
            merged, color_column=color_column, threshold_expr=threshold_expr
        )

        safe_rows = json.loads(
            merged.to_json(orient="records", default_handler=str)
        )
        set_progress(100, "Complete ✅")
        logger.info(
            f" GeoJSON ready (GENERIC JOIN) | Features={len(features)} | Bands={all_bands}"
        )

        target_columns = [c for c in tgt_colnames if c != join_key]

        final_payload = json.loads(
            
                json.dumps(
                    {
                        "type": "FeatureCollection",
                        "features": features,
                        "bands": all_bands,
                        "source_columns": src_cols,
                        "target_columns": target_columns,
                        "color_config": color_meta,
                        "columns": merged.columns.tolist(),
                        "rows": safe_rows,
                    },
                    default=str,
                )
            )
        
        QUERY_CACHE[cache_key] = final_payload
        return JSONResponse(content=final_payload)


    except Exception as e:
        with _progress_status_lock:
            progress_status["progress"] = -1
            progress_status["stage"] = "Error"
            progress_status["error"] = str(e)
        reset_progress_later(5.0)
        logger.error(f" Error occurred: {e}")
        return JSONResponse(
            status_code=500,
            content=json.loads(json.dumps({"error": str(e)}, default=str)),
        )



# ============================================================
# Drive test helper endpoints
# ============================================================

@app.get("/drive-test/columns")
def get_drive_test_columns():
    df = drive_test_store["df"]

    if df is None:
        raise HTTPException(status_code=404, detail="No drive test data uploaded")

    available_kpis = drive_test_store.get("columns", [])

    if not available_kpis:
        available_kpis = [
            col for col in df.columns if pd.api.types.is_numeric_dtype(df[col])
        ]

    return {"columns": available_kpis}


@app.post("/upload-grid-map")
async def upload_grid_map(file: UploadFile = File(...)):
    global grid_data
    contents = await file.read()
    df = pd.read_csv(io.BytesIO(contents), encoding="utf-8-sig")

    if df.empty:
        raise HTTPException(status_code=400, detail=" Uploaded file is empty")

    grid_data = df.copy()

    lat_col, lon_col = None, None
    if "Lat" in df.columns and "Long" in df.columns:
        lat_col, lon_col = "Lat", "Long"
    else:
        lat_keywords = ["lat", "latitude", "y", "gps_lat", "positioning_lat"]
        lon_keywords = ["lon", "lng", "long", "longitude", "x", "gps_lon", "gps_lng"]
        lat_col = next(
            (
                c
                for c in df.columns
                if any(
                    k in c.lower().replace(" ", "").replace("_", "")
                    for k in lat_keywords
                )
            ),
            None,
        )
        lon_col = next(
            (
                c
                for c in df.columns
                if any(
                    k in c.lower().replace(" ", "").replace("_", "")
                    for k in lon_keywords
                )
            ),
            None,
        )

    if not lat_col or not lon_col:
        return {
            "error": "Could not detect latitude/longitude columns",
            "columns": df.columns.tolist(),
            "sample_rows": df.head(3).to_dict(orient="records"),
        }

    print(f" Using lat_col={lat_col}, lon_col={lon_col}")

    df = df.dropna(subset=[lat_col, lon_col])
    df = df.replace([float("inf"), float("-inf")], None)

    features = []
    for _, row in df.iterrows():
        try:
            lon, lat = float(row[lon_col]), float(row[lat_col])
            if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                continue

            props = {
                k: (None if pd.isna(v) or v in [float("inf"), float("-inf")] else v)
                for k, v in row.to_dict().items()
            }

            if "city" in props:
                props["city"] = props.get("city")
            elif "City" in props:
                props["city"] = props.get("City")
            else:
                props["city"] = "Unknown"

            features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    "properties": props,
                }
            )
        except Exception as e:
            print(" Skipped row:", e)
            continue

    geojson = {"type": "FeatureCollection", "features": features}

    exclude_cols = {lat_col, lon_col}
    numeric_cols = (
        df.drop(columns=list(exclude_cols), errors="ignore")
        .select_dtypes(include=["number"])
        .columns.tolist()
    )

    return {"geojson": geojson, "available_kpis": numeric_cols}


# ============================================================
# Template endpoints
# ============================================================

@app.post("/save-template")
def save_template(template: dict):
    name = template.get("name")
    config = template.get("config")
    if not name or not config:
        raise HTTPException(
            status_code=400, detail="Template must have a name and config."
        )
    if not isinstance(config.get("target_joins", []), list):
        raise HTTPException(
            status_code=400, detail="Expected 'target_joins' to be a list."
        )
    path = os.path.join(TEMPLATE_DIR, f"{name}.json")
    with open(path, "w") as f:
        json.dump(template, f, indent=2)
    return JSONResponse(content={"message": "Template saved"}, status_code=200)


@app.get("/templates")
def list_templates():
    return [f[:-5] for f in os.listdir(TEMPLATE_DIR) if f.endswith(".json")]


@app.get("/template/{name}")
def get_template(name: str):
    path = os.path.join(TEMPLATE_DIR, f"{name}.json")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Template not found.")
    with open(path, "r") as f:
        return json.load(f)


# ============================================================
# /column-range – FINAL robust version
# ============================================================

@app.get("/column-range")
def get_column_range(table: str, column: str):
    """
    FINAL robust /column-range endpoint
    ✅ Automatically maps project_name → target_table via geolytics_projectconfiguration
    ✅ Fuzzy, case-insensitive matching for columns
    ✅ Detects correct DB automatically
    ✅ Resolves schema dynamically (no hard-coded public)
    """
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print(f"📡 /column-range called → table={table}, column={column}")

    try:
        def normalize_colname(name: str) -> str:
            if not name:
                return ""
            return re.sub(r"[^a-z0-9]+", "", str(name).lower().strip())

        def fuzzy_match_column(cols, target):
            norm_target = normalize_colname(target)

            for c in cols:
                if normalize_colname(c) == norm_target:
                    return c

            for c in cols:
                nc = normalize_colname(c)
                if norm_target in nc or nc in norm_target:
                    return c

            tnums = re.findall(r"\d+", target)
            for c in cols:
                cnums = re.findall(r"\d+", c)
                if cnums and tnums and cnums[0] == tnums[0]:
                    return c

            return None

        raw_table = table.strip().replace('"', "")
        _ = normalize_colname(column)  # normalized_column (not used outside, kept for clarity)

        # Step 0: try project_name → target_table from config
        with config_engine.connect() as conn:
            mapping = conn.execute(
                text(
                    """
                    SELECT target_table, target_db
                    FROM geolytics_projectconfiguration
                    WHERE lower(trim(project_name)) = lower(:t)
                    LIMIT 1
                    """
                ),
                {"t": raw_table.lower()},
            ).fetchone()

        if mapping:
            mapped_table, mapped_db = mapping
            print(f"🔄 Auto-mapped '{raw_table}' → '{mapped_table}' (DB={mapped_db})")
            raw_table = mapped_table
        else:
            print(f"⚠️ No direct project mapping for '{raw_table}'")

        db_for_table = find_db_for_table_cached(raw_table)
        if not db_for_table:
            print(f"❌ Could not locate DB for '{raw_table}'")
            return {
                "min": None,
                "max": None,
                "error": f"Table '{raw_table}' not found",
            }

        eng = DB_ENGINES[db_for_table]

        with eng.connect() as conn:
            row = conn.execute(
                text(
                    """
                    SELECT table_schema, table_name
                    FROM information_schema.tables
                    WHERE lower(table_name) = lower(:t)
                    LIMIT 1
                    """
                ),
                {"t": raw_table.lower()},
            ).fetchone()

        if not row:
            return {
                "min": None,
                "max": None,
                "error": f"Table '{raw_table}' not found in DB {db_for_table}",
            }

        schema, real_table = row
        qualified = f'"{schema}"."{real_table}"'

        with eng.connect() as conn:
            cols = [
                r[0]
                for r in conn.execute(
                    text(
                        """
                        SELECT column_name
                        FROM information_schema.columns
                        WHERE table_schema=:s AND table_name=:t
                        """
                    ),
                    {"s": schema, "t": real_table},
                )
            ]

        print(f"📑 Columns in table '{qualified}': {cols[:15]} ...")

        match_col = fuzzy_match_column(cols, column)
        if not match_col:
            print(f"❌ No fuzzy match for column '{column}'")
            return {
                "min": None,
                "max": None,
                "error": f"Column '{column}' not found",
            }

        print(f"✅ Matched to column → '{match_col}'")

        with eng.connect() as conn:
            result = conn.execute(
                text(
                    f'''
                    SELECT MIN("{match_col}") AS min_val,
                           MAX("{match_col}") AS max_val
                    FROM {qualified}
                    WHERE "{match_col}" IS NOT NULL
                    '''
                )
            ).fetchone()

        if result and result.min_val is not None and result.max_val is not None:
            print(f"🎯 Range → min={result.min_val}, max={result.max_val}")
            return {
                "min": float(result.min_val),
                "max": float(result.max_val),
                "column": match_col,
                "table": qualified,
            }

        print(f"⚠️ '{match_col}' exists but has no numeric data")
        return {
            "min": None,
            "max": None,
            "error": f"Column '{match_col}' is non-numeric or empty",
        }

    except Exception as e:
        import traceback

        traceback.print_exc()
        print(f"❌ Exception in /column-range: {e}")
        return {"min": None, "max": None, "error": str(e)}


# ============================================================
# Export endpoints
# ============================================================

@app.post("/export")
async def export_data(request: Request):
    body = await request.json()
    format = body.get("format")
    data = body.get("data", {}).get("features", [])
    if not data:
        raise HTTPException(status_code=400, detail="No data provided.")

    df = pd.json_normalize(data)

    if format == "csv":
        stream = io.StringIO()
        df.to_csv(stream, index=False)
        stream.seek(0)
        return StreamingResponse(
            iter([stream.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=export.csv"},
        )

    elif format == "kml":
        kml = simplekml.Kml()
        for feature in data:
            coords = feature.get("geometry", {}).get("coordinates")
            props = feature.get("properties", {})
            if coords and len(coords) == 2:
                kml.newpoint(
                    name=str(props.get("Site_ID", "")),
                    coords=[(coords[0], coords[1])],
                )
        kml_bytes = kml.kml()
        return StreamingResponse(
            io.BytesIO(kml_bytes.encode("utf-8")),
            media_type="application/vnd.google-earth.kml+xml",
            headers={"Content-Disposition": "attachment; filename=export.kml"},
        )

    else:
        raise HTTPException(status_code=400, detail="Invalid format requested.")


@app.get("/grid-map/column-range")
async def get_grid_map_column_range(column: str):
    global grid_data
    if grid_data is None:
        return {"min": None, "max": None}

    if column not in grid_data.columns:
        return {"min": None, "max": None}

    col_min = grid_data[column].min()
    col_max = grid_data[column].max()
    return {"min": float(col_min), "max": float(col_max)}


# ============================================================
# Drive test upload + column-range
# ============================================================

@app.post("/upload-drive-test")
async def upload_drive_test(file: UploadFile = File(...)):
    try:
        print("🚀 upload-drive-test called")

        if not file:
            raise HTTPException(status_code=400, detail="❌ No file uploaded")

        print(f"📂 File received: {file.filename}, ContentType: {file.content_type}")

        contents = await file.read()
        print(f"📏 File size: {len(contents)} bytes")
        print("🔎 First 200 bytes of file:\n", contents[:200])

        df = None
        if file.filename.lower().endswith(".csv"):
            df = pd.read_csv(io.BytesIO(contents), encoding="utf-8-sig")
        elif file.filename.lower().endswith((".xls", ".xlsx")):
            df = pd.read_excel(io.BytesIO(contents), engine="openpyxl")
        else:
            raise HTTPException(
                status_code=400, detail="❌ Unsupported file format"
            )

        if df is None or df.empty:
            raise HTTPException(
                status_code=400,
                detail="❌ Uploaded file is empty or unreadable",
            )

        print("✅ DataFrame loaded:", df.shape)
        print("📑 Columns:", df.columns.tolist())
        print("🔍 First 5 rows:\n", df.head().to_dict(orient="records"))

        lat_keywords = ["lat", "latitude", "gps_lat", "positioning_lat", "y"]
        lon_keywords = [
            "lon",
            "lng",
            "long",
            "longitude",
            "gps_lon",
            "gps_lng",
            "positioning_lon",
            "x",
        ]

        lat_candidates = [
            c
            for c in df.columns
            if any(
                k in c.lower().replace(" ", "").replace("_", "")
                for k in lat_keywords
            )
        ]
        lon_candidates = [
            c
            for c in df.columns
            if any(
                k in c.lower().replace(" ", "").replace("_", "")
                for k in lon_keywords
            )
        ]

        lat_col = lat_candidates[0] if lat_candidates else None
        lon_col = lon_candidates[0] if lon_candidates else None

        if not lat_col or not lon_col:
            return {
                "error": "Could not detect latitude/longitude automatically",
                "columns": df.columns.tolist(),
                "sample_rows": df.head(3).to_dict(orient="records"),
            }

        print(f"📍 Using lat={lat_col}, lon={lon_col}")

        df = df.dropna(subset=[lat_col, lon_col])
        print(f"✅ After dropping NaN coords: {df.shape}")

        exclude = {lat_col, lon_col, "time", "imei", "imsi", "device_name"}
        kpi_candidates = [
            col
            for col in df.columns
            if col not in exclude and pd.api.types.is_numeric_dtype(df[col])
        ]
        print(f"📊 KPI candidates: {kpi_candidates}")

        if not kpi_candidates:
            return {
                "error": "No numeric KPI columns detected",
                "columns": df.columns.tolist(),
            }

        features = []
        for _, row in df.iterrows():
            try:
                lon, lat = float(row[lon_col]), float(row[lat_col])
                props = {
                    col: row[col]
                    for col in kpi_candidates
                    if pd.notna(row[col])
                }
                features.append(
                    {
                        "type": "Feature",
                        "geometry": {
                            "type": "Point",
                            "coordinates": [lon, lat],
                        },
                        "properties": props,
                    }
                )
            except Exception as row_err:
                print("⚠️ Row skipped:", row_err)
                continue

        geojson = {"type": "FeatureCollection", "features": features}
        print(f"✅ Generated {len(features)} features")

        drive_test_store["df"] = df
        drive_test_store["columns"] = kpi_candidates

        return {"geojson": geojson, "available_kpis": kpi_candidates}

    except Exception as e:
        import traceback

        print("❌ CRASH in upload-drive-test:", e)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Server crash: {str(e)}")


@app.get("/drive-test/column-range")
def get_drive_test_column_range(column: str):
    df = drive_test_store["df"]

    if df is None or column not in df.columns:
        raise HTTPException(
            status_code=404,
            detail=f"Column {column} not found in drive test data.",
        )

    col_series = df[column].dropna()

    if col_series.empty:
        return {"min": None, "max": None, "error": "Empty column"}

    if pd.api.types.is_numeric_dtype(col_series):
        return {
            "type": "numeric",
            "min": float(col_series.min()),
            "max": float(col_series.max()),
        }

    if pd.api.types.is_datetime64_any_dtype(col_series):
        return {
            "type": "datetime",
            "min": str(col_series.min()),
            "max": str(col_series.max()),
        }

    if pd.api.types.is_string_dtype(col_series) or col_series.dtype == "object":
        unique_vals = col_series.unique().tolist()
        return {
            "type": "categorical",
            "unique_values": unique_vals[:50],
            "count": len(unique_vals),
        }

    return {"error": f"Unsupported column type: {col_series.dtype}"}


# ============================================================
# Grid generation + grid from table
# ============================================================

@app.post("/generate-grid")
async def generate_grid(
    file: UploadFile = File(...),
    kpi: str = Query(..., description="Column to aggregate (e.g., SINR)"),
    grid_size: float = Query(
        0.01, description="Grid size in degrees (approx ~1km at equator)"
    ),
):
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".geojson") as tmp:
            tmp.write(await file.read())
            tmp_path = tmp.name

        gdf = gpd.read_file(tmp_path)

        if gdf.empty or "geometry" not in gdf.columns:
            return {"error": "Uploaded file is empty or missing geometry column."}
        if kpi not in gdf.columns:
            return {"error": f"KPI column '{kpi}' not found in uploaded data."}

        minx, miny, maxx, maxy = gdf.total_bounds
        grid_cells = []
        x = minx
        while x < maxx:
            y = miny
            while y < maxy:
                grid_cells.append(box(x, y, x + grid_size, y + grid_size))
                y += grid_size
            x += grid_size

        grid = gpd.GeoDataFrame({"geometry": grid_cells}, crs=gdf.crs)
        joined = gpd.sjoin(gdf, grid, predicate="within")
        result = joined.groupby("index_right")[kpi].mean().reset_index()
        grid["kpi_avg"] = result.set_index("index_right")[kpi]
        grid["kpi_avg"] = grid["kpi_avg"].fillna(0)
        os.remove(tmp_path)
        return json.loads(grid.to_json())
    except Exception as e:
        return {"error": str(e)}


@app.get("/grid-map/from-table")
def get_grid_map_from_table(table: str):
    global grid_data
    try:
        with engine.connect() as conn:
            cols = [
                r[0]
                for r in conn.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns WHERE table_name=:t"
                    ),
                    {"t": table},
                )
            ]
            print("✅ Available columns:", cols)

            lat_col = next(
                (c for c in cols if c.lower() in ["lat", "latitude"]), None
            )
            lon_col = next(
                (c for c in cols if c.lower() in ["lon", "long", "lng", "longitude"]),
                None,
            )

            if not lat_col or not lon_col:
                raise HTTPException(
                    status_code=400,
                    detail=f"No lat/lon columns found in {table}",
                )

            query = text(
                f'SELECT * FROM "{table}" WHERE "{lat_col}" IS NOT NULL AND "{lon_col}" IS NOT NULL'
            )
            res = conn.execute(query)
            res = conn.execute(query)
            rows = [dict(r) for r in res.mappings()]

        grid_data = pd.DataFrame(rows)
        print(f"✅ Loaded {len(rows)} rows from {table}")

        features = []
        for row in rows:
            try:
                lat, lon = float(row[lat_col]), float(row[lon_col])
                props = {k: v for k, v in row.items() if k not in [lat_col, lon_col]}
                features.append(
                    {
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [lon, lat]},
                        "properties": props,
                    }
                )
            except Exception as e:
                print("⚠️ Skipped row:", e)

        return {
            "geojson": {"type": "FeatureCollection", "features": features},
            "available_kpis": [c for c in cols if c not in [lat_col, lon_col]],
        }
    except Exception as e:
        print("❌ ERROR in /grid-map/from-table:", e)
        raise


import uuid
import zipfile

UPLOAD_POLYGON_DIR = "./uploaded_polygons"
os.makedirs(UPLOAD_POLYGON_DIR, exist_ok=True)


@app.post("/polygon/upload-zip")
async def upload_polygon_zip(file: UploadFile = File(...)):
    """
    Uploads a ZIP file containing polygon shapefiles.
    Extracts it into a unique folder and returns available .shp files.
    """
    try:
        print("📥 [UPLOAD] /polygon/upload-zip endpoint HIT")
        print(f"📁 Received file: {file.filename}")

        zip_id = str(uuid.uuid4())
        extract_path = os.path.join(UPLOAD_POLYGON_DIR, zip_id)
        os.makedirs(extract_path, exist_ok=True)

        # Extract ZIP
        contents = await file.read()
        print(f"📦 ZIP size: {len(contents)} bytes")

        with zipfile.ZipFile(io.BytesIO(contents), 'r') as zip_ref:
            zip_ref.extractall(extract_path)
            print(f"📤 Extracted ZIP to: {extract_path}")
            print("📄 Extracted files:", zip_ref.namelist())

        # Find .shp files
        shp_files = [f for f in os.listdir(extract_path) if f.endswith(".shp")]
        print(f"🗂 Found {len(shp_files)} .shp files:", shp_files)

        if not shp_files:
            print("❌ No .shp files found!")
            raise HTTPException(status_code=400, detail="No .shp files found inside ZIP")

        print("✅ Upload successful — returning zip_id + files")
        return {
            "zip_id": zip_id,
            "files": shp_files
        }

    except Exception as e:
        print("💥 ERROR in upload_polygon_zip:", e)
        raise HTTPException(status_code=500, detail=f"Failed to process ZIP: {str(e)}")


@app.get("/polygon/geojson")
async def get_polygon_geojson(zip_id: str, file: str):
    """
    Loads a specific shapefile from uploaded ZIP folder and returns GeoJSON.
    """
    try:
        print("📥 [GET] /polygon/geojson endpoint HIT")
        print(f"🔎 zip_id={zip_id} | file={file}")

        folder = os.path.join(UPLOAD_POLYGON_DIR, zip_id)
        shp_path = os.path.join(folder, file)

        print(f"📍 Looking for: {shp_path}")

        if not os.path.exists(shp_path):
            print("❌ Shapefile NOT FOUND!")
            raise HTTPException(status_code=404, detail="Shapefile not found")

        gdf = gpd.read_file(shp_path)
        print(f"🗺 Loaded shapefile — {len(gdf)} shapes")

        # Convert CRS to WGS84 (Mapbox requirement)
        if gdf.crs and gdf.crs.to_string() != "EPSG:4326":
            print(f"🌐 Reprojecting CRS {gdf.crs} → EPSG:4326")
            gdf = gdf.to_crs(4326)

        print("✅ Returning GeoJSON")
        return json.loads(gdf.to_json())

    except Exception as e:
        print("💥 ERROR in get_polygon_geojson:", e)
        raise HTTPException(status_code=500, detail=f"Failed to load shapefile: {str(e)}")



# ============================================================
# /bands/{table}
# ============================================================

@app.get("/bands/{table}")
def get_bands(table: str):
    """
    Fetch band + cellname pairs for a project or raw table.

    ✅ Auto-resolves actual source_table from configuration
    ✅ Auto-detects correct DB (via DB_ENGINES)
    ✅ Detects band and cellname columns dynamically
    ✅ Gracefully handles missing tables/columns
    ✅ Works with 2G/3G/4G/5G projects
    """
    try:
        with config_engine.connect() as conn:
            cfg = conn.execute(
                text(
                    """
                    SELECT source_table, source_column
                    FROM geolytics_projectconfiguration
                    WHERE lower(trim(project_name)) = lower(:p)
                    LIMIT 1
                    """
                ),
                {"p": table},
            ).fetchone()

        if cfg:
            source_table = cfg[0]
            logger.info(
                f"🔍 Resolved project '{table}' → source_table='{source_table}'"
            )
        else:
            source_table = table
            logger.info(
                f"⚠️ No config row for '{table}' → using raw table name"
            )

        db_for_table = find_db_for_table_cached(source_table)
        if not db_for_table:
            raise HTTPException(
                status_code=404,
                detail=f"Table '{source_table}' not found in any DB",
            )

        eng = get_engine_for_db(db_for_table)

        with eng.connect() as conn:
            res = conn.execute(
                text(
                    """
                    SELECT table_schema, table_name
                    FROM information_schema.tables
                    WHERE lower(trim(table_name)) = lower(trim(:t))
                    LIMIT 1
                    """
                ),
                {"t": source_table.strip().split(".")[-1]},
            ).fetchone()

        if not res:
            raise HTTPException(
                status_code=404,
                detail=f"Table '{source_table}' not found in {db_for_table}",
            )

        qualified_table = f'"{res[0]}"."{res[1]}"'

        with eng.connect() as conn:
            all_cols = [
                r[0]
                for r in conn.execute(
                    text(
                        """
                        SELECT column_name
                        FROM information_schema.columns
                        WHERE table_schema=:s AND table_name=:t
                        """
                    ),
                    {"s": res[0], "t": res[1]},
                )
            ]

        band_keywords = [
             "band", "spectrum", "carrier", "layer","LAYER","BAND","SPECTRUM"
        ]
        band_col = next(
            (c for c in all_cols if any(k in c.lower() for k in band_keywords)),
            None,
            )


        cell_col = next(
            (
                c
                for c in all_cols
                if any(
                    k in c.lower()
                    for k in [
                        "cellname",
                        "cell name",
                        "cell_id",
                        "cell id",
                        "element3",
                        "enbcell",
                        "d2el",
                    ]
                )
            ),
            None,
        )

        if not band_col or not cell_col:
            logger.warning(
                f"⚠️ Missing band or cell column in {source_table} → band_col={band_col}, cell_col={cell_col}"
            )
            return []

        sql = text(
            f'''
            SELECT DISTINCT "{band_col}" AS band, "{cell_col}" AS cellname
            FROM {qualified_table}
            WHERE "{band_col}" IS NOT NULL AND "{cell_col}" IS NOT NULL
            LIMIT 2000
            '''
        )

        with eng.connect() as conn:
            rows = conn.execute(sql).fetchall()

        result = [
            {"band": str(r[0]), "cellname": str(r[1])}
            for r in rows
            if r[0] and r[1]
        ]
        logger.info(
            f"✅ Bands fetched: {len(result)} records from {source_table}"
        )

        return result

    except Exception as e:
        logger.exception("❌ /bands failed:")
        raise HTTPException(
            status_code=500, detail=f"Failed to fetch bands: {str(e)}"
        )
