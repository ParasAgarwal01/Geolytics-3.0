progress_status = {"progress": 0, "stage": "Idle"}
from fastapi import FastAPI, HTTPException, Query, UploadFile, File, Form, Request
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
from threading import Timer
import numpy as np


# === FastAPI app ===
app = FastAPI(root_path="/geo-api")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

drive_test_store = {"df": None}

_refresh_lock = False
def refresh_db_engines():
    global _refresh_lock
    if _refresh_lock: return
    _refresh_lock = True
    try:
        print(" Refreshing DB engines...")
        load_all_db_engines()
    finally:
        _refresh_lock = False
    Timer(86400, refresh_db_engines).start()





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
    if re.search(r"\bN\d{2,4}\b", s):
        return re.search(r"\bN\d{2,4}\b", s).group(0)

    # 4G LTE pattern: L800, L1800, L2100, etc.
    if re.search(r"\bL\d{2,4}\b", s):
        return re.search(r"\bL\d{2,4}\b", s).group(0)

    # 3G UMTS/WCDMA pattern: U900, U2100, W2100, etc.
    if re.search(r"\b[UW]\d{3,4}\b", s):
        return re.search(r"\b[UW]\d{3,4}\b", s).group(0)

    # 2G GSM pattern: G900, G1800, etc.
    if re.search(r"\bG\d{3,4}\b", s):
        return re.search(r"\bG\d{3,4}\b", s).group(0)

    # Fallback: “Band 8”, “BAND8” → “B8”
    m = re.search(r"BAND\s?(\d+)", s)
    if m:
        return f"B{m.group(1)}"

    return None



grid_data = None

# === Setup logging ===
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")

# === Load .env ===
load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:12345@10.133.132.90:5432/TPGA01")
TEMPLATE_DIR = "./templates"
os.makedirs(TEMPLATE_DIR, exist_ok=True)




engine = create_engine(DATABASE_URL)

# Engine 1: Project configuration DB
CONFIG_DB_URL = "postgresql://postgres:postgres@10.129.7.247:5431/GLOBE"
config_engine = create_engine(CONFIG_DB_URL)

# Engine 2: Main data DB (existing)
DATA_DB_URL = os.getenv("DATABASE_URL", "postgresql://postgres:12345@10.133.132.90:5432/postgres")
data_engine = create_engine(DATA_DB_URL)

DB_ENGINES = {}

DB_ENGINES = {}

def load_all_db_engines():
    """
    Dynamically loads SQLAlchemy engines for all databases 
    from multiple PostgreSQL hosts (10.133.132.90 and 10.129.5.29).
    Works safely and merges results into DB_ENGINES.
    """
    from sqlalchemy import create_engine, text

    db_hosts = [
        {
            "host": "10.133.132.90",
            "user": "postgres",
            "password": "12345",
            "port": 5432
        },
        {
            "host": "10.129.5.29",
            "user": "postgres",
            "password": "postgres",
            "port": 5430
        }
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
                    r[0] for r in conn.execute(
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
                        pool_pre_ping=True
                    )
                    loaded_count += 1
                except Exception as e:
                    print(f" Skipping DB {db_name} on {host}: {e}")

            print(f" Loaded {len(dbs)} databases from {host}:{port} → {dbs}")

        except Exception as e:
            print(f" Failed to connect to {host}:{port} → {e}")

    print(f" Total databases loaded: {loaded_count}")
    return DB_ENGINES


# Run once at startup
load_all_db_engines()
refresh_db_engines()

@app.get("/databases")
def list_databases():
    """
    Returns the list of dynamically loaded databases.
    These are the real DB names loaded from load_all_db_engines().
    """
    try:
        return list(DB_ENGINES.keys())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def get_engine_for_db(db_name: str):
    """
    Returns a SQLAlchemy engine for the given database name.
    Uses the dynamically loaded engines from DB_ENGINES.
    """
    if db_name not in DB_ENGINES:
        raise HTTPException(status_code=400, detail=f"Unknown or inaccessible database: {db_name}")
    return DB_ENGINES[db_name]

# === Global cache for drive test ===
drive_test_store = {
    "df": None,   # will hold the uploaded dataframe
    "columns": [] # numeric KPI columns
}



@app.get("/projects")
def get_projects():
    with config_engine.connect() as conn:
        res = conn.execute(text("SELECT DISTINCT project_name FROM geolytics_projectconfiguration"))
        return [r[0] for r in res]

@app.get("/projects/{project}/types")
def get_project_table_types(project: str):
    with config_engine.connect() as conn:
        res = conn.execute(
            text("SELECT DISTINCT table_type FROM geolytics_projectconfiguration WHERE project_name=:p"),
            {"p": project}
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
        # Get the actual column names dynamically so new columns are also included
        cols_result = conn.execute(text("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'geolytics_projectconfiguration'
            ORDER BY ordinal_position
        """))
        all_columns = [r[0] for r in cols_result]

        # Build dynamic select query
        query = text(f"""
            SELECT {', '.join(f'"{c}"' for c in all_columns)}
            FROM geolytics_projectconfiguration
            WHERE lower(trim(project_name)) = :p
              AND lower(trim(table_type)) = :t
        """)

        res = conn.execute(query, {"p": project.lower().strip(), "t": table_type_clean})
        rows = [dict(r) for r in res.mappings()]

        if not rows:
            raise HTTPException(status_code=404, detail="No configuration found for this project/type")

        return {
            "project": project,
            "table_type": table_type,
            "columns": all_columns,
            "rows": rows
        }


# === Routes ===
@app.get("/tables")
def get_tables():
    with engine.connect() as conn:
        res = conn.execute(text("""
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        """))
        return [row[0] for row in res]

@app.get("/columns/{project_name}")
def get_table_columns(project_name: str):
    """
     Returns column names for a given project or raw table.
     If project_name (e.g., BHAZ01_3G) → resolves to real source_table from config
     Auto-detects correct DB via DB_ENGINES
     Handles schema-qualified tables
     Returns list of columns
    """
    from sqlalchemy import text
    import re

    print(f" /columns called for: {project_name}")

    clean_name = re.sub(r"\s+$", "", project_name.strip().replace('"', ""))
    print(f" Normalized: {clean_name}")

    # --- Step 1️ Try resolve project → source_table from config ---
    with config_engine.connect() as conn:
        cfg = conn.execute(
            text("""
                SELECT source_table
                FROM geolytics_projectconfiguration
                WHERE lower(trim(project_name)) = lower(:p)
                LIMIT 1
            """),
            {"p": clean_name.lower()},
        ).fetchone()

    if cfg:
        source_table = cfg[0]
        print(f" Mapped project '{clean_name}' → source_table='{source_table}'")
    else:
        source_table = clean_name
        print(f" No config mapping, using raw name '{source_table}'")

    # --- Step 2️ Find correct database for the table ---
    def find_db_for_table(tbl_name: str):
        for db_name, eng in DB_ENGINES.items():
            try:
                with eng.connect() as conn:
                    exists = conn.execute(
                        text(f"SELECT to_regclass('public.\"{tbl_name}\"')")
                    ).scalar()
                    if exists:
                        print(f" Found table '{tbl_name}' in DB '{db_name}'")
                        return db_name
            except Exception:
                continue
        return None

    db_for_table = find_db_for_table(source_table)
    if not db_for_table:
        print(f" Table '{source_table}' not found in any DB")
        raise HTTPException(status_code=404, detail=f"Table '{source_table}' not found")

    eng = get_engine_for_db(db_for_table)

    # --- Step 3️ Fetch column names ---
    with eng.connect() as conn:
        cols = [
            r[0]
            for r in conn.execute(
                text("""
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_name = :t OR lower(table_name)=lower(:t)
                """),
                {"t": source_table},
            )
        ]

    print(f" Found {len(cols)} columns in '{source_table}' (DB={db_for_table})")
    return cols


    
from fastapi import HTTPException
from sqlalchemy import text
# === Helper ===
def qualify_table(table_name: str, default_schema="public"):
    # If table already has schema (e.g. myschema.table) return as is
    if "." in table_name:
        return table_name
    return f'{default_schema}."{table_name}"'

from fastapi import Query, HTTPException
from sqlalchemy import text
import pandas as pd

@app.get("/distinct-values/{table}")
async def get_distinct_values(
    table: str,
    col: str = Query(..., description="Column name to get distinct values for")
):
    """
     Fetch distinct non-null values for a column in any table or project.
    Handles complex column names (spaces, slashes, special chars) safely.
    Auto-detects DB via DB_ENGINES and maps projects to source_table via config.
    """
    if not table or not col:
        raise HTTPException(status_code=400, detail="Table and column are required")

    try:
        logger.info(f" /distinct-values called → table={table}, col={col}")

        # --- Helper: find DB for table ---
        def find_db_for_table(tbl_name: str):
            for db_name, eng in DB_ENGINES.items():
                try:
                    with eng.connect() as conn:
                        exists = conn.execute(
                            text(f"SELECT to_regclass('public.\"{tbl_name}\"')")
                        ).scalar()
                        if exists:
                            logger.info(f" Found table '{tbl_name}' in DB '{db_name}'")
                            return db_name
                except Exception:
                    continue
            return None

        # --- Step  Try direct DB match ---
        db_for_table = find_db_for_table(table)

        # --- Step  Try fallback via config (project → source_table) ---
        if not db_for_table:
            with config_engine.connect() as cfg_conn:
                alt = cfg_conn.execute(text("""
                    SELECT source_table
                    FROM geolytics_projectconfiguration
                    WHERE :tbl LIKE '%' || project_name || '%'
                    LIMIT 1
                """), {"tbl": table}).fetchone()

            if alt and alt[0]:
                old_table = table
                table = alt[0]
                db_for_table = find_db_for_table(table)
                logger.info(f" Mapped project '{old_table}' → source_table='{table}'")

        if not db_for_table:
            raise HTTPException(status_code=404, detail=f"Table '{table}' not found in any database")

        eng = get_engine_for_db(db_for_table)
        qualified_table = qualify_table(table)

        # --- Step  Fetch all columns and find the correct column name (case-insensitive) ---
        with eng.connect() as conn:
            cols_query = text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name=:t OR lower(table_name)=lower(:t)
            """)
            all_cols = [r[0] for r in conn.execute(cols_query, {"t": table.split('.')[-1].replace('"', '')})]
            logger.info(f" Columns in {table}: {len(all_cols)}")

            match_col = next((c for c in all_cols if c.lower().strip() == col.lower().strip()), None)
            if not match_col:
                raise HTTPException(status_code=404, detail=f"Column '{col}' not found in '{table}'")

            # --- Step 4️ Fetch distinct values safely ---
            safe_query = text(f'''
                SELECT DISTINCT "{match_col}" 
                FROM {qualified_table} 
                WHERE "{match_col}" IS NOT NULL AND TRIM("{match_col}") <> '' 
                LIMIT 300
            ''')

            result = conn.execute(safe_query)
            values = [str(r[0]).strip() for r in result if r[0] is not None]

        logger.info(f" Found {len(values)} distinct values for '{match_col}' in '{table}'")
        return sorted(values, key=lambda x: x.lower())

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        logger.error(f" Exception in /distinct-values: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch distinct values: {str(e)}")




# === Global Progress Tracker ===
progress_status = {"progress": 0, "stage": "Idle"}

@app.get("/progress")
def get_progress():
    """Frontend polls this endpoint to get live progress updates."""
    return progress_status

@app.get("/query")
def query_sites(project: str, table_type: str):
    """
    Builds dataset for GeoJSON visualization.

     Works in three modes:
        A) Source-only (no target)
        B) Normal Join (KPI / CM Change)
        C) RCA (categorical issue analysis)
     Auto-detects key geometry columns (Lat/Long/Azimuth/Band)
     Joins safely with dtype normalization
     Prevents SQL syntax errors from empty column lists
     Returns clean GeoJSON with band & RCA info
    """

    import time, json, re
    import numpy as np
    import pandas as pd
    from fastapi.responses import JSONResponse
    from sqlalchemy import text

    global progress_status
    start_time = time.time()
    progress_status.update({"progress": 0, "stage": "Initializing..."})
    logger.info(" /query endpoint called")
    logger.info(f" Input → project={project}, table_type={table_type}")

    try:
        # --- Normalize table_type ---
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

        # --- Step 1: Config fetch ---
        progress_status.update({"progress": 10, "stage": "Fetching configuration..."})
        with config_engine.connect() as conn:
            cfg = None
            for cand in candidates:
                query = text("""
                    SELECT source_table, source_column, target_db, target_table, target_column
                    FROM geolytics_projectconfiguration
                    WHERE lower(trim(project_name)) = :p
                      AND lower(trim(table_type)) = :t
                """)
                cfg = conn.execute(query, {"p": project.lower().strip(), "t": cand}).mappings().first()
                if cfg:
                    cfg = dict(cfg)
                    break

        if not cfg:
            raise HTTPException(status_code=404, detail=f"No config found for {project}/{table_type}")

        # --- Dual DB resolution ---
        source_table = (cfg.get("source_table") or "").strip()
        source_col = (cfg.get("source_column") or "").strip()
        target_table = (cfg.get("target_table") or "").strip()
        target_col = (cfg.get("target_column") or "").strip()
        default_dbs = ["BHAZ01", "VFUK01"]

        def detect_db_for_table(tbl):
            for db in default_dbs:
                if db in DB_ENGINES:
                    try:
                        with DB_ENGINES[db].connect() as conn:
                            if conn.execute(text("SELECT to_regclass(:tbl)"),
                                            {"tbl": f'public.\"{tbl}\"'}).scalar():
                                return db
                    except Exception:
                        continue
            return default_dbs[0]

        source_db = (cfg.get("source_db") or "").strip() or detect_db_for_table(source_table)
        target_db = (cfg.get("target_db") or "").strip() or detect_db_for_table(target_table)

        logger.info(f" Source={source_table} (DB={source_db}) → Target={target_table or '—'} (DB={target_db or '—'})")
        source_engine = get_engine_for_db(source_db)

        # --- Resolve schema safely ---
        def resolve_table(engine, raw_name, db_label):
            base = raw_name.strip().replace('"', '').split('.')[-1]
            with engine.connect() as conn:
                row = conn.execute(text("""
                    SELECT table_schema, table_name
                    FROM information_schema.tables
                    WHERE lower(trim(table_name)) = lower(trim(:t))
                    LIMIT 1
                """), {"t": base}).fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail=f"Table {raw_name} not found in {db_label}")
                return f'"{row[0]}"."{row[1]}"', row[0], row[1]

        progress_status.update({"progress": 20, "stage": "Resolving source schema..."})
        qualified_source, s_schema, s_table = resolve_table(source_engine, source_table, source_db)

        # --- Detect key columns ---
        with source_engine.connect() as conn:
            src_cols = [r[0] for r in conn.execute(text("""
                SELECT column_name FROM information_schema.columns
                WHERE table_schema=:s AND table_name=:t
            """), {"s": s_schema, "t": s_table})]

        def pick_cellname_col(all_cols, configured):
            if configured and configured in all_cols:
                return configured
            for c in all_cols:
                if re.search(r"cellname|cell_name|cell id|cellid|element|enbcell|d2el", c, re.IGNORECASE):
                    return c
            for c in all_cols:
                if "site" in c.lower():
                    return c
            return all_cols[0] if all_cols else configured

        source_col = pick_cellname_col(src_cols, source_col)

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
        band_col = find_col(["band", "spectrum", "carrier", "freq"])
        city_col = find_col(["city", "region", "town", "hq"])

        logger.info(f" Detected lat={lat_col}, lon={lon_col}, site={site_col}, band={band_col}, city={city_col}")
        if not lat_col or not lon_col:
            raise HTTPException(status_code=400, detail=f"Could not detect Lat/Lon columns in {source_table}")

        # --- SQL for source geometry ---
        def build_source_sql():
            az_expr = f'"{az_col}" AS "Azimuth"' if az_col else 'NULL::text AS "Azimuth"'
            site_expr = f'"{site_col}" AS "site_id"' if site_col else 'NULL::text AS "site_id"'
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
                LIMIT 10000
            """

        # === CASE A: Source-only ===
        if not target_table or not target_col:
            progress_status.update({"progress": 40, "stage": "Fetching source data..."})
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
                    features.append({
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [lon, lat]},
                        "properties": props
                    })
                except Exception:
                    continue
            safe_rows = json.loads(df.to_json(orient="records", default_handler=str))
            progress_status.update({"progress": 100, "stage": "Complete ✅"})
            logger.info(f" GeoJSON ready (Source-only) | Features={len(features)} | Bands={sorted(all_bands)}")
            return JSONResponse(
                content={
                    "type": "FeatureCollection",
                    "features": features,
                    "bands": sorted(all_bands),
                    "source_columns": src_cols,
                    "target_columns": [],
                    "rca_column": None,
                    "available_kpis": [],
                    "columns": list(df.columns),
                    "rows": safe_rows
                },
                headers={"Access-Control-Allow-Origin": "*"}
            )

        # === CASE B: RCA Mode ===
        if "rca" in table_type.lower():
            progress_status.update({"progress": 40, "stage": "Fetching RCA data..."})
            target_engine = get_engine_for_db(target_db)
            qualified_target, t_schema, t_table = resolve_table(target_engine, target_table, target_db)

            src_df = pd.read_sql(text(build_source_sql()), source_engine.connect())
            src_df.columns = [c.strip().lower() for c in src_df.columns]

            # normalize join key name regardless of case
            source_col_norm = source_col.strip().lower()
            if source_col_norm not in src_df.columns:
                match = next((c for c in src_df.columns if source_col_norm in c or c in source_col_norm), None)
                if not match:
                    raise Exception(f"Source column '{source_col}' not found in {list(src_df.columns)}")
                source_col_norm = match

            with target_engine.begin() as conn:
                tgt_cols = conn.execute(text("""
                    SELECT column_name, data_type
                    FROM information_schema.columns
                    WHERE table_schema=:s AND table_name=:t
                """), {"s": t_schema, "t": t_table}).fetchall()

            tgt_colnames = [c for c, _ in tgt_cols]
            rca_priority = [
                "Issue/Analysis Bucket new", "issue/analysis bucket new",
                "Issue_Bucket", "issue_bucket", "Analysis_Counters"
            ]
            _lower_map = {c.lower(): c for c in tgt_colnames}
            rca_col = next((_lower_map[n.lower()] for n in rca_priority if n.lower() in _lower_map), None)
            if not rca_col:
                rca_col = next((c for c in tgt_colnames if "issue" in c.lower() or "analysis" in c.lower()), None)
            if not rca_col:
                raise Exception(" No RCA column (Issue/Analysis Bucket new) found in target table")

            join_key = target_col or next(
                (c for c in tgt_colnames if "element" in c.lower() or "cell" in c.lower()), tgt_colnames[0]
            )

            logger.info(f" RCA join key → {join_key}")
            logger.info(f" RCA column used → {rca_col}")

            rca_sql = f'''
                SELECT "{join_key}" AS target_key, "{rca_col}"
                FROM {qualified_target}
                WHERE "{join_key}" IS NOT NULL
                LIMIT 10000
            '''
            tgt_df = pd.read_sql(text(rca_sql), target_engine.connect())
            tgt_df["target_key"] = tgt_df["target_key"].astype(str)
            src_df[source_col_norm] = src_df[source_col_norm].astype(str)
            merged = pd.merge(src_df, tgt_df, left_on=source_col_norm, right_on="target_key", how="left")

            features, all_bands = [], set()
            for _, r in merged.iterrows():
                try:
                    lon, lat = float(r["long"]), float(r["lat"])
                    if not np.isfinite(lon) or not np.isfinite(lat):
                        continue
                    props = {k: (None if pd.isna(v) else v) for k, v in r.items()}
                    norm_band = extract_band(props.get("band") or props.get(source_col_norm))
                    if norm_band:
                        props["band"] = norm_band
                        all_bands.add(norm_band)
                    features.append({
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [lon, lat]},
                        "properties": props
                    })
                except Exception:
                    continue

            # === RCA Auto Color + Legend ===
            unique_issues = sorted(set(merged[rca_col].dropna().astype(str)))
            palette = [
                "#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231",
                "#911eb4", "#46f0f0", "#f032e6", "#bcf60c", "#fabebe",
                "#008080", "#e6beff", "#9a6324", "#fffac8", "#800000",
                "#aaffc3", "#808000", "#ffd8b1", "#000075", "#808080"
            ]
            color_map = {v: palette[i % len(palette)] for i, v in enumerate(unique_issues)}
            merged["rca_color"] = merged[rca_col].map(color_map)

            for f in features:
                issue_value = f["properties"].get(rca_col)
                f["properties"]["color"] = color_map.get(str(issue_value), "#999999")

            legend_items = [{"issue": issue, "color": color_map[issue]} for issue in unique_issues]

            safe_rows = json.loads(merged.to_json(orient="records", default_handler=str))
            progress_status.update({"progress": 100, "stage": "Complete "})
            logger.info(f" GeoJSON ready (RCA, Auto-Colored) | Features={len(features)} | Issues={len(unique_issues)}")

            return JSONResponse(
                content={
                    "type": "FeatureCollection",
                    "features": features,
                    "bands": sorted(all_bands),
                    "source_columns": list(src_df.columns),
                    "target_columns": [rca_col],
                    "rca_column": rca_col,
                    "available_kpis": [],
                    "columns": merged.columns.tolist(),
                    "rows": safe_rows,
                    "rca_colors": color_map,
                    "rca_legend": legend_items
                },
                headers={"Access-Control-Allow-Origin": "*"}
            )

        # === CASE C: Normal KPI / CM Change Join ===
        target_engine = get_engine_for_db(target_db)
        qualified_target, t_schema, t_table = resolve_table(target_engine, target_table, target_db)
        src_df = pd.read_sql(text(build_source_sql()), source_engine.connect())
        with target_engine.begin() as conn:
            tgt_cols = conn.execute(text("""
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema=:s AND table_name=:t
            """), {"s": t_schema, "t": t_table}).fetchall()

        numeric_keywords = ["int", "double", "real", "numeric", "float", "decimal"]
        target_columns = [c for (c, _) in tgt_cols if c != target_col]
        kpi_cols = [c for (c, dt) in tgt_cols if any(n in dt.lower() for n in numeric_keywords)]
        cols_part = ", ".join(f'"{c}"' for c in kpi_cols) if kpi_cols else ""
        comma = "," if cols_part else ""
        kpi_sql = f'''
            SELECT "{target_col}" AS target_key{comma} {cols_part}
            FROM {qualified_target}
            LIMIT 5000
        '''
        tgt_df = pd.read_sql(text(kpi_sql), target_engine.connect())
        src_df["cellname"] = src_df["cellname"].astype(str)
        tgt_df["target_key"] = tgt_df["target_key"].astype(str)
        merged = pd.merge(src_df, tgt_df, left_on="cellname", right_on="target_key", how="left")
        merged = merged.replace([np.inf, -np.inf], np.nan).where(pd.notnull(merged), None)

        features, all_bands = [], set()
        for _, r in merged.iterrows():
            try:
                lon, lat = float(r["Long"]), float(r["Lat"])
                if not np.isfinite(lon) or not np.isfinite(lat):
                    continue
                props = {k: (None if pd.isna(v) else v) for k, v in r.items()}
                norm_band = extract_band(props.get("band") or props.get("cellname"))
                if norm_band:
                    props["band"] = norm_band
                    all_bands.add(norm_band)
                features.append({
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    "properties": props
                })
            except Exception:
                continue

        safe_rows = json.loads(merged.to_json(orient="records", default_handler=str))
        progress_status.update({"progress": 100, "stage": "Complete ✅"})
        logger.info(f" GeoJSON ready (KPI/CM) | Features={len(features)} | Bands={sorted(all_bands)}")

        return JSONResponse(
            content={
                "type": "FeatureCollection",
                "features": features,
                "bands": sorted(all_bands),
                "source_columns": src_cols,
                "target_columns": target_columns,
                "rca_column": None,
                "available_kpis": kpi_cols,
                "columns": merged.columns.tolist(),
                "rows": safe_rows
            },
            headers={"Access-Control-Allow-Origin": "*"}
        )

    except Exception as e:
        progress_status.update({"progress": -1, "stage": "Error", "error": str(e)})
        logger.error(f" Error occurred: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})




@app.get("/drive-test/columns")
def get_drive_test_columns():
    df = drive_test_store["df"]

    if df is None:
        raise HTTPException(status_code=404, detail="No drive test data uploaded")

    available_kpis = drive_test_store.get("columns", [])

    # Fallback if not populated yet
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

    # --- Detect lat/lon ---
    lat_col, lon_col = None, None
    if "Lat" in df.columns and "Long" in df.columns:
        lat_col, lon_col = "Lat", "Long"
    else:
        lat_keywords = ["lat", "latitude", "y", "gps_lat", "positioning_lat"]
        lon_keywords = ["lon", "lng", "long", "longitude", "x", "gps_lon", "gps_lng"]
        lat_col = next((c for c in df.columns if any(k in c.lower().replace(" ", "").replace("_", "") for k in lat_keywords)), None)
        lon_col = next((c for c in df.columns if any(k in c.lower().replace(" ", "").replace("_", "") for k in lon_keywords)), None)

    if not lat_col or not lon_col:
        return {
            "error": "Could not detect latitude/longitude columns",
            "columns": df.columns.tolist(),
            "sample_rows": df.head(3).to_dict(orient="records"),
        }

    print(f" Using lat_col={lat_col}, lon_col={lon_col}")

    # --- Clean invalid values ---
    df = df.dropna(subset=[lat_col, lon_col])
    df = df.replace([float("inf"), float("-inf")], None)

    # --- Build GeoJSON ---
    features = []
    for _, row in df.iterrows():
        try:
            lon, lat = float(row[lon_col]), float(row[lat_col])
            if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                continue

            props = {k: (None if pd.isna(v) or v in [float("inf"), float("-inf")] else v) for k, v in row.to_dict().items()}

            # Include city if exists
            if "city" in props:
                props["city"] = props.get("city")
            elif "City" in props:
                props["city"] = props.get("City")
            else:
                props["city"] = "Unknown"

            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": props,
            })
        except Exception as e:
            print(" Skipped row:", e)
            continue

    geojson = {"type": "FeatureCollection", "features": features}

    # --- Pick KPIs: numeric columns only (exclude lat/lon) ---
    exclude_cols = {lat_col, lon_col}
    numeric_cols = df.drop(columns=list(exclude_cols), errors="ignore").select_dtypes(include=["number"]).columns.tolist()

    return {
        "geojson": geojson,
        "available_kpis": numeric_cols
    }




@app.post("/save-template")
def save_template(template: dict):
    name = template.get("name")
    config = template.get("config")
    if not name or not config:
        raise HTTPException(status_code=400, detail="Template must have a name and config.")
    if not isinstance(config.get("target_joins", []), list):
        raise HTTPException(status_code=400, detail="Expected 'target_joins' to be a list.")
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

@app.get("/column-range")
def get_column_range(table: str, column: str):
    """
    FINAL robust /column-range endpoint
    ✅ Automatically maps project_name → target_table via geolytics_projectconfiguration
    ✅ Fuzzy, case-insensitive matching (underscores/spaces/hyphens ignored)
    ✅ Handles both Source (Azimuth/Band) and Target (KPI) tables
    ✅ Detects correct DB automatically
    ✅ Returns numeric min/max safely
    ✅ Logs every step for debugging
    """
    import pandas as pd
    import numpy as np
    import re
    from sqlalchemy import text

    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print(f"📡 /column-range called → table={table}, column={column}")

    try:
        # === Helpers ===
        def normalize_colname(name: str) -> str:
            """Normalize for fuzzy comparison (remove _, spaces, %, (), etc.)"""
            if not name:
                return ""
            return re.sub(r'[^a-z0-9]+', '', str(name).lower().strip())

        def fuzzy_match_column(cols, target):
            """Return the closest matching DB column name."""
            norm_target = normalize_colname(target)

            # Exact normalized match
            for c in cols:
                if normalize_colname(c) == norm_target:
                    return c

            # Partial match
            for c in cols:
                nc = normalize_colname(c)
                if norm_target in nc or nc in norm_target:
                    return c

            # Numeric fallback (e.g. 151_USER_... vs 151 User ...)
            tnums = re.findall(r'\d+', target)
            for c in cols:
                cnums = re.findall(r'\d+', c)
                if cnums and tnums and cnums[0] == tnums[0]:
                    return c
            return None

        def find_db_for_table(tbl_name: str):
            """Find which DB contains this table."""
            for db_name, eng in DB_ENGINES.items():
                try:
                    with eng.connect() as conn:
                        exists = conn.execute(
                            text(f"SELECT to_regclass('public.\"{tbl_name}\"')")
                        ).scalar()
                        if exists:
                            print(f"✅ Table '{tbl_name}' found in DB '{db_name}'")
                            return db_name
                except Exception:
                    continue
            print(f"⚠️ Table '{tbl_name}' not found in any DB")
            return None

        # Normalize input
        raw_table = table.strip().replace('"', '')
        normalized_column = normalize_colname(column)

        # === Step 0: Auto-map project_name → target_table (for "4G-Nokia_Eric-Master Sheet" cases)
        with config_engine.connect() as conn:
            mapping = conn.execute(
                text("""
                    SELECT target_table, target_db
                    FROM geolytics_projectconfiguration
                    WHERE lower(trim(project_name)) = lower(:t)
                    LIMIT 1
                """),
                {"t": raw_table.lower()},
            ).fetchone()

        if mapping:
            mapped_table, mapped_db = mapping
            print(f"🔄 Auto-mapped project '{raw_table}' → target_table '{mapped_table}' (DB={mapped_db})")
            raw_table = mapped_table
        else:
            print(f"⚠️ No mapping found for project_name '{raw_table}'")

        # === Step 1: Try configuration-based link (for completeness)
        with config_engine.connect() as conn:
            cfg = conn.execute(
                text("""
                    SELECT source_table, target_table, target_db
                    FROM geolytics_projectconfiguration
                    WHERE lower(trim(project_name)) = lower(:t)
                    LIMIT 1
                """),
                {"t": raw_table.lower()},
            ).fetchone()

        source_table = target_table = target_db = None
        if cfg:
            source_table, target_table, target_db = cfg
            print(f"🧩 Config match → project={raw_table}")
            print(f"   ├─ source_table: {source_table}")
            print(f"   ├─ target_table: {target_table}")
            print(f"   └─ target_db: {target_db}")
        else:
            print(f"⚠️ No config match for project_name='{raw_table}'")

        # === Step 2: Directly search the mapped/target table
        db_for_table = find_db_for_table(raw_table)
        if not db_for_table:
            print(f"❌ Could not locate DB for '{raw_table}'")
            return {"min": None, "max": None, "error": f"Table '{raw_table}' not found"}

        with DB_ENGINES[db_for_table].connect() as conn:
            cols = [r[0] for r in conn.execute(
                text("""
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_name=:t OR lower(table_name)=lower(:t)
                """),
                {"t": raw_table.split('.')[-1].replace('"', '')},
            )]

            print(f"📑 Found {len(cols)} columns in table '{raw_table}': {cols[:10]}...")
            match_col = fuzzy_match_column(cols, column)
            if not match_col:
                print(f"❌ No fuzzy match for '{column}' in '{raw_table}'")
                return {"min": None, "max": None, "error": f"Column '{column}' not found or non-numeric"}

            print(f"✅ Matched column → '{match_col}' (fuzzy match for '{column}')")

            # === Step 3: Get numeric range ===
            result = conn.execute(
                text(f'SELECT MIN("{match_col}"), MAX("{match_col}") '
                     f'FROM public."{raw_table}" WHERE "{match_col}" IS NOT NULL')
            ).fetchone()

            if result and result[0] is not None and result[1] is not None:
                print(f"🎯 Range from '{raw_table}' → min={result[0]}, max={result[1]}")
                return {"min": float(result[0]), "max": float(result[1])}
            else:
                print(f"⚠️ Column '{match_col}' found but no numeric data")
                return {"min": None, "max": None, "error": f"Column '{match_col}' not numeric or empty"}

    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"❌ Exception in /column-range: {e}")
        return {"min": None, "max": None, "error": str(e)}




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
        return StreamingResponse(iter([stream.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=export.csv"})
    elif format == "kml":
        kml = simplekml.Kml()
        for feature in data:
            coords = feature.get("geometry", {}).get("coordinates")
            props = feature.get("properties", {})
            if coords and len(coords) == 2:
                kml.newpoint(name=str(props.get("Site_ID", "")), coords=[(coords[0], coords[1])])
        kml_bytes = kml.kml()
        return StreamingResponse(io.BytesIO(kml_bytes.encode('utf-8')), media_type="application/vnd.google-earth.kml+xml", headers={"Content-Disposition": "attachment; filename=export.kml"})
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
            raise HTTPException(status_code=400, detail="❌ Unsupported file format")

        if df is None or df.empty:
            raise HTTPException(status_code=400, detail="❌ Uploaded file is empty or unreadable")

        print("✅ DataFrame loaded:", df.shape)
        print("📑 Columns:", df.columns.tolist())
        print("🔍 First 5 rows:\n", df.head().to_dict(orient="records"))

        # --- Smarter lat/lon detection ---
        lat_keywords = ["lat", "latitude", "gps_lat", "positioning_lat", "y"]
        lon_keywords = ["lon", "lng", "long", "longitude", "gps_lon", "gps_lng", "positioning_lon", "x"]

        lat_candidates = [c for c in df.columns if any(k in c.lower().replace(" ", "").replace("_", "") for k in lat_keywords)]
        lon_candidates = [c for c in df.columns if any(k in c.lower().replace(" ", "").replace("_", "") for k in lon_keywords)]

        lat_col = lat_candidates[0] if lat_candidates else None
        lon_col = lon_candidates[0] if lon_candidates else None

        if not lat_col or not lon_col:
            # Instead of crashing, return available columns for manual mapping
            return {
                "error": "Could not detect latitude/longitude automatically",
                "columns": df.columns.tolist(),
                "sample_rows": df.head(3).to_dict(orient="records")
            }

        print(f"📍 Using lat={lat_col}, lon={lon_col}")

        # --- Drop missing coords ---
        df = df.dropna(subset=[lat_col, lon_col])
        print(f"✅ After dropping NaN coords: {df.shape}")

        # --- Numeric KPI columns ---
        exclude = {lat_col, lon_col, "time", "imei", "imsi", "device_name"}
        kpi_candidates = [
            col for col in df.columns
            if col not in exclude and pd.api.types.is_numeric_dtype(df[col])
        ]
        print(f"📊 KPI candidates: {kpi_candidates}")

        if not kpi_candidates:
            return {
                "error": "No numeric KPI columns detected",
                "columns": df.columns.tolist()
            }

        # --- Convert to GeoJSON ---
        features = []
        for _, row in df.iterrows():
            try:
                lon, lat = float(row[lon_col]), float(row[lat_col])
                props = {col: row[col] for col in kpi_candidates if pd.notna(row[col])}
                features.append({
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    "properties": props
                })
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
        raise HTTPException(status_code=404, detail=f"Column {column} not found in drive test data.")

    col_series = df[column].dropna()

    if col_series.empty:
        return {"min": None, "max": None, "error": "Empty column"}

    # ✅ If numeric → return min/max
    if pd.api.types.is_numeric_dtype(col_series):
        return {
            "type": "numeric",
            "min": float(col_series.min()),
            "max": float(col_series.max())
        }

    # ✅ If datetime → return earliest/latest
    if pd.api.types.is_datetime64_any_dtype(col_series):
        return {
            "type": "datetime",
            "min": str(col_series.min()),
            "max": str(col_series.max())
        }

    # ✅ If categorical/string → return unique values (limited)
    if pd.api.types.is_string_dtype(col_series) or col_series.dtype == "object":
        unique_vals = col_series.unique().tolist()
        return {
            "type": "categorical",
            "unique_values": unique_vals[:50],  # limit to avoid huge response
            "count": len(unique_vals)
        }

    # fallback
    return {"error": f"Unsupported column type: {col_series.dtype}"}

@app.post("/generate-grid")
async def generate_grid(
    file: UploadFile = File(...),
    kpi: str = Query(..., description="Column to aggregate (e.g., SINR)"),
    grid_size: float = Query(0.01, description="Grid size in degrees (approx ~1km at equator)")
):
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".geojson") as tmp:
            tmp.write(await file.read())
            tmp_path = tmp.name
        gdf = gpd.read_file(tmp_path)
        if gdf.empty or 'geometry' not in gdf.columns:
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
        grid = gpd.GeoDataFrame({'geometry': grid_cells}, crs=gdf.crs)
        joined = gpd.sjoin(gdf, grid, predicate='within')
        result = joined.groupby('index_right')[kpi].mean().reset_index()
        grid['kpi_avg'] = result.set_index('index_right')[kpi]
        grid['kpi_avg'] = grid['kpi_avg'].fillna(0)
        os.remove(tmp_path)
        return json.loads(grid.to_json())
    except Exception as e:
        return {"error": str(e)}
    


@app.get("/grid-map/from-table")
def get_grid_map_from_table(table: str):
    global grid_data
    try:
        with engine.connect() as conn:
            cols = [r[0] for r in conn.execute(
                text("SELECT column_name FROM information_schema.columns WHERE table_name=:t"),
                {"t": table}
            )]
            print("✅ Available columns:", cols)

            lat_col = next((c for c in cols if c.lower() in ["lat", "latitude"]), None)
            lon_col = next((c for c in cols if c.lower() in ["lon", "long", "lng", "longitude"]), None)

            if not lat_col or not lon_col:
                raise HTTPException(status_code=400, detail=f"No lat/lon columns found in {table}")

            query = text(f'SELECT * FROM "{table}" WHERE "{lat_col}" IS NOT NULL AND "{lon_col}" IS NOT NULL')
            res = conn.execute(query)
            res = conn.execute(query)
            rows = [dict(r) for r in res.mappings()]


        import pandas as pd
        grid_data = pd.DataFrame(rows)
        print(f"✅ Loaded {len(rows)} rows from {table}")

        features = []
        for row in rows:
            try:
                lat, lon = float(row[lat_col]), float(row[lon_col])
                props = {k: v for k, v in row.items() if k not in [lat_col, lon_col]}
                features.append({
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    "properties": props
                })
            except Exception as e:
                print("⚠️ Skipped row:", e)

        return {
            "geojson": {"type": "FeatureCollection", "features": features},
            "available_kpis": [c for c in cols if c not in [lat_col, lon_col]]
        }
    except Exception as e:
        print("❌ ERROR in /grid-map/from-table:", e)
        raise


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
    from sqlalchemy import text

    try:
        # --- Step 1: Try to resolve project → real source_table from configuration ---
        with config_engine.connect() as conn:
            cfg = conn.execute(text("""
                SELECT source_table, source_column
                FROM geolytics_projectconfiguration
                WHERE lower(trim(project_name)) = lower(:p)
                LIMIT 1
            """), {"p": table}).fetchone()

        if cfg:
            source_table = cfg[0]
            logger.info(f"🔍 Resolved project '{table}' → source_table='{source_table}'")
        else:
            # Fallback: assume 'table' is already the actual table name
            source_table = table
            logger.info(f"⚠️ No config row for '{table}' → using raw table name")

        # --- Step 2: Find the correct database for this table ---
        def find_db_for_table(tbl_name: str):
            for db_name, eng in DB_ENGINES.items():
                try:
                    with eng.connect() as conn:
                        exists = conn.execute(
                            text(f"SELECT to_regclass('public.\"{tbl_name}\"')")
                        ).scalar()
                        if exists:
                            logger.info(f"✅ Found table '{tbl_name}' in DB '{db_name}'")
                            return db_name
                except Exception:
                    continue
            return None

        db_for_table = find_db_for_table(source_table)
        if not db_for_table:
            raise HTTPException(status_code=404, detail=f"Table '{source_table}' not found in any DB")

        eng = get_engine_for_db(db_for_table)

        # --- Step 3: Resolve schema-qualified table name ---
        with eng.connect() as conn:
            res = conn.execute(text("""
                SELECT table_schema, table_name
                FROM information_schema.tables
                WHERE lower(trim(table_name)) = lower(trim(:t))
                LIMIT 1
            """), {"t": source_table.strip().split('.')[-1]}).fetchone()

        if not res:
            raise HTTPException(status_code=404, detail=f"Table '{source_table}' not found in {db_for_table}")

        qualified_table = f'"{res[0]}"."{res[1]}"'

        # --- Step 4: Detect all columns ---
        with eng.connect() as conn:
            all_cols = [
                r[0] for r in conn.execute(
                    text("SELECT column_name FROM information_schema.columns WHERE table_schema=:s AND table_name=:t"),
                    {"s": res[0], "t": res[1]}
                )
            ]

        # --- Step 5: Detect band & cellname columns dynamically ---
        band_col = next(
            (c for c in all_cols if any(k in c.lower() for k in ["band", "spectrum", "carrier", "freq"])),
            None
        )
        cell_col = next(
            (c for c in all_cols if any(k in c.lower() for k in ["cellname", "cell name", "cell_id", "cell id", "element3", "enbcell", "d2el"])),
            None
        )

        if not band_col or not cell_col:
            logger.warning(f"⚠️ Missing band or cell column in {source_table} → band_col={band_col}, cell_col={cell_col}")
            return []  # gracefully return empty list

        # --- Step 6: Fetch distinct pairs ---
        sql = text(f'''
            SELECT DISTINCT "{band_col}" AS band, "{cell_col}" AS cellname
            FROM {qualified_table}
            WHERE "{band_col}" IS NOT NULL AND "{cell_col}" IS NOT NULL
            LIMIT 1000
        ''')

        with eng.connect() as conn:
            rows = conn.execute(sql).fetchall()

        result = [{"band": str(r[0]), "cellname": str(r[1])} for r in rows if r[0] and r[1]]
        logger.info(f"✅ Bands fetched: {len(result)} records from {source_table}")

        return result

    except Exception as e:
        logger.exception("❌ /bands failed:")
        raise HTTPException(status_code=500, detail=f"Failed to fetch bands: {str(e)}")

