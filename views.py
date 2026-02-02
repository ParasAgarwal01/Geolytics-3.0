# views.py
import os
import json
import logging
import tempfile
import io
import time
import re
from threading import Timer, Lock
from threading import Thread

from django.conf import settings
from django.http import StreamingHttpResponse
from django.db import connections
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, parsers
from rest_framework.permissions import AllowAny

import pandas as pd
import simplekml
import geopandas as gpd
from shapely.geometry import box

from sqlalchemy import create_engine, text

# === Logging ===
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")

# === Template dir ===
TEMPLATE_DIR = os.path.join(settings.BASE_DIR, "templates")
os.makedirs(TEMPLATE_DIR, exist_ok=True)

# === In-memory stores / globals ===
drive_test_store = {"df": None, "columns": []}
grid_data = None

# Progress tracker (shared with /progress)
progress_status = {"progress": 0, "stage": "Idle"}
_progress_status_lock = Lock()

def set_progress(p: int, stage: str | None = None):
    """
    Safe helper to update progress_status exactly like FastAPI main.py
    """
    with _progress_status_lock:
        try:
            progress_status["progress"] = int(max(-1, min(100, p)))
        except Exception:
            progress_status["progress"] = 0
        if stage is not None:
            progress_status["stage"] = stage

_last_reset_trigger = 0

def reset_progress_later(delay: float = 5.0):
    """
    Django-safe async progress reset.
    Uses a background Thread (NOT Timer),
    which works correctly under WSGI/pm2/gunicorn.
    """

    global _last_reset_trigger
    _last_reset_trigger = time.time()

    def _reset_worker(trigger_time):
        time.sleep(delay)
        if trigger_time != _last_reset_trigger:
            return  # A newer request started
        with _progress_status_lock:
            progress_status["progress"] = 0
            progress_status["stage"] = "Idle"

    Thread(target=_reset_worker, args=(_last_reset_trigger,), daemon=True).start()


# === Environment / DB config ===
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:12345@10.133.132.90:5432/TPGA01"
)
CONFIG_DB_URL = os.getenv(
    "CONFIG_DB_URL",
    "postgresql://postgres:postgres@10.129.7.247:5431/GLOBE"
)

# Base engines (not heavily used, most logic uses DB_ENGINES)
engine = create_engine(DATABASE_URL)
config_engine = create_engine(CONFIG_DB_URL)

# Dynamic engines container (populated by load_all_db_engines)
DB_ENGINES: dict[str, any] = {}
TABLE_DB_CACHE: dict[str, str | None] = {}
TABLE_COLUMNS_CACHE: dict[tuple[str, str], list[str]] = {}

_refresh_lock = False


def qualify_table(table_name: str, default_schema: str = "public"):
    """
    Helper to schema-qualify a table name if needed.
    """
    return table_name if "." in table_name else f'{default_schema}."{table_name}"'


def load_all_db_engines():
    """
    Dynamically loads SQLAlchemy engines for all databases
    from multiple PostgreSQL hosts (10.133.132.90, 10.129.5.29, 10.129.7.247, 10.164.165.206).
    Mirrors main.py behaviour.
    """
    global DB_ENGINES
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
            "host": "10.129.7.247",
            "user": "postgres",
            "password": "postgres",
            "port": 5431,
        },
        {
            "host": "10.164.165.206",
            "user": "postgres",
            "password": "12345",
            "port": 5432,
        },
        
    ]

    new_engines: dict[str, any] = {}
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
                    new_engines[db_name] = create_engine(
                        url,
                        pool_size=5,
                        max_overflow=10,
                        pool_timeout=30,
                        pool_recycle=1800,
                        pool_pre_ping=True,
                    )
                    loaded_count += 1
                except Exception as e:
                    logger.warning(f" Skipping DB {db_name} on {host}: {e}")

            logger.info(f" Loaded {len(dbs)} databases from {host}:{port}")
        except Exception as e:
            logger.error(f" Failed to connect to {host}:{port} ? {e}")

    DB_ENGINES = new_engines
    logger.info(f" Total databases loaded: {loaded_count}")
    return DB_ENGINES


def refresh_db_engines():
    """
    Refresh engines once a day, protected by _refresh_lock.
    """
    global _refresh_lock
    if _refresh_lock:
        return
    _refresh_lock = True
    try:
        logger.info(" Refreshing DB engines...")
        load_all_db_engines()
    finally:
        _refresh_lock = False
    


try:
    load_all_db_engines()
    refresh_db_engines()
    TABLE_DB_CACHE.clear()
except Exception:
    logger.exception(" Startup DB engine loading failed.")


def get_engine_for_db(db_name: str):
    """
    Return an SQLAlchemy engine for the requested db_name.
    """
    if db_name not in DB_ENGINES:
        raise ValueError(f"Unknown or inaccessible database: {db_name}")
    return DB_ENGINES[db_name]

def read_multi_dates_from_request(request):
    """
    Reads multi-select dates passed as:
    ?dates=2024-01-01,2024-01-02
    """
    
    dates_param = request.query_params.get("dates")
    if not dates_param:
        return []

    return [
        d.strip()
        for d in dates_param.split(",")
        if d.strip()
    ]


def find_db_for_table_cached(tbl_name: str):
    """
    Global helper:
    - Normalize table name
    - Check TABLE_DB_CACHE first
    - If not cached, scan DB_ENGINES with to_regclass
    - Cache result (including None)
    Mirrors main.py.
    """
    if not tbl_name:
        return None

    norm_name = tbl_name.strip().replace('"', "")
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
    Mirrors main.py.
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
def read_date_filters_from_request(request):
    """
    Read from_date / to_date from GET or POST.
    Shared by QueryDataView, ColumnRangeView, DistinctValuesView.
    """
    from_date = (
        request.query_params.get("from_date")
        or (request.data.get("from_date") if hasattr(request, "data") else None)
    )
    to_date = (
        request.query_params.get("to_date")
        or (request.data.get("to_date") if hasattr(request, "data") else None)
    )
    return from_date, to_date


def validate_date_column(engine, schema, table, date_col):
    """
    Ensure mapping.date column exists in target table.
    Prevents silent SQL failures.
    """
    if not date_col:
        return False

    with engine.connect() as conn:
        exists = conn.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema=:s
                  AND table_name=:t
                  AND lower(column_name)=lower(:c)
                """
            ),
            {"s": schema, "t": table, "c": date_col},
        ).fetchone()

    return bool(exists)
# === Simple in-memory cache ===
# cache_key -> {"dates": [...], "ts": epoch_time}
AVAILABLE_DATES_CACHE: dict[tuple[str, str], dict] = {}
AVAILABLE_DATES_TTL = 60  # seconds (you can set 30 / 60 / 120)

AVAILABLE_DATES_LOCK = Lock()


class AvailableDatesView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        project = request.query_params.get("project")
        table_type = request.query_params.get("table_type")

        if not project or not table_type:
            return Response(
                {"detail": "project and table_type are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        cache_key = (
            project.strip().lower(),
            table_type.strip().lower(),
            
        )
        

        # ---------- CACHE ----------
        now = time.time()

        with AVAILABLE_DATES_LOCK:
            cached = AVAILABLE_DATES_CACHE.get(cache_key)
            if cached:
                age = now - cached["ts"]
                if age < AVAILABLE_DATES_TTL:
                    return Response(
                        {
                            "project": project,
                            "table_type": table_type,
                            "available_dates": cached["dates"],
                            "cached": True,
                            "cache_age_sec": int(age),
                        }
                    )
                else:
                    # cache expired
                    AVAILABLE_DATES_CACHE.pop(cache_key, None)
        

        try:
            # ---------- Read config ----------
            with config_engine.connect() as conn:
                logger.error(
                    f"[AvailableDates][DEBUG] DB="
                    f"{conn.execute(text('SELECT inet_server_addr(), current_database()')).fetchone()}"
                )
                cfg = conn.execute(
                    text(
                        """
                        SELECT source_table, target_table, target_db, "date column"
                        FROM geolytics_projectconfiguration
                        WHERE lower(trim(project_name)) = lower(:p)
                          AND lower(trim(table_type)) = lower(:t)
                          AND "date column" IS NOT NULL
                        LIMIT 1
                        """
                    ),
                    {"p": project.strip(), "t": table_type.strip()},
                ).fetchone()

            if not cfg:
                logger.info(
                    f"[AvailableDates] project={project}, table_type={table_type}, "
                    
                )

                return Response(
                    {
                        "project": project,
                        "table_type": table_type,
                        "date_column": None,
                        "available_dates": [],
                    }
                )

            source_table, target_table, target_db, date_col = cfg
            date_col = date_col.strip()
            logger.info(
                f"[AvailableDates] Mapping resolved | "
                f"source_table={source_table}, target_table={target_table}, "
                f"target_db={target_db}, date_col={date_col}"
            )
            

            # ---------- Decide which table to read ----------
            table = target_table or source_table

            if not target_db:
                raise Exception(
                    f"[AvailableDates] target_db MUST be set in config for {project}/{table_type}"
                )
            

            engine = get_engine_for_db(target_db)

            qualified_table, schema, tbl = resolve_table_any(
                engine, table, target_db
            )
            logger.info(
                f"[AvailableDates] Resolved table | DB={target_db}, "
                f"qualified_table={qualified_table}, schema={schema}, table={tbl}"
            )
            

            # ---------- Validate date column ----------
            if not validate_date_column(engine, schema, tbl, date_col):
                logger.warning(
                    f"Date column '{date_col}' not found in {qualified_table}"
                )
                return Response(
                    {
                        "project": project,
                        "table_type": table_type,
                        "date_column": date_col,
                        "available_dates": [],
                        "latest_date": None,
                    }
                )
                

            # ---------- Fetch distinct dates ----------
            with engine.connect() as conn:
                rows = conn.execute(
                    text(
                        f'''
                        SELECT DISTINCT "{date_col}"::date
                        FROM {qualified_table}
                        WHERE "{date_col}" IS NOT NULL
                        ORDER BY "{date_col}" DESC
                        '''
                    )
                ).fetchall()
                logger.info(
                    f"[AvailableDates] SQL executed | raw_rows={len(rows)}"
                )
                

            dates = [
                r[0].strftime("%Y-%m-%d")
                for r in rows
                if r[0] is not None
            ]
            if dates:
                logger.info(
                    f"[AvailableDates] Dates fetched | count={len(dates)}, "
                    f"latest={dates[0]}, oldest={dates[-1]}"
                )
            else:
                logger.warning(
                    f"[AvailableDates] No dates found in table {qualified_table}"
                )
            

            # ---------- CACHE ----------
            with AVAILABLE_DATES_LOCK:
                AVAILABLE_DATES_CACHE[cache_key] = {
                    "dates": dates,
                    "ts": time.time()
                }
                

            return Response(
                {
                    "project": project,
                    "table_type": table_type,
                    "date_column": date_col,
                    "available_dates": dates,
                    "latest_date": dates[0] if dates else None,
                }
            )
            

        except Exception as e:
            logger.exception("/available-dates failed")
            return Response(
                {"detail": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


# === Helpers ===
def extract_band(val):
    """
    Extracts normalized band identifiers for 2G/3G/4G/5G.
    Handles:
      - N78, N41 (5G)
      - L800, L1800, L2100 (4G)
      - U900, W2100 (3G)
      - G900, G1800 (2G)
      - BAND 8, Band 1 ? B8
    """
    if not val:
        return None

    s = str(val).upper().replace(" ", "")

    if re.search(r"\bN\d{2,4}\b", s):
        return re.search(r"\bN\d{2,4}\b", s).group(0)
    if re.search(r"\bL\d{2,4}\b", s):
        return re.search(r"\bL\d{2,4}\b", s).group(0)
    if re.search(r"\b[UW]\d{3,4}\b", s):
        return re.search(r"\b[UW]\d{3,4}\b", s).group(0)
    if re.search(r"\bG\d{3,4}\b", s):
        return re.search(r"\bG\d{3,4}\b", s).group(0)
    m = re.search(r"BAND\s?(\d+)", s)
    if m:
        return f"B{m.group(1)}"
    return None


def is_valid_name(s: str) -> bool:
    return s.replace("_", "").isalnum()

def infer_db_from_project(project: str) -> str | None:
    """
    Infer DB name from project_name.
    Example: BHAZ01_3G ? BHAZ01, VF3UK1_4G ? VF3UK1
    """
    if not project:
        return None
    base = project.split("_")[0].strip()
    return base or None


def resolve_table_any(engine, raw_name: str, db_label: str):
    """
    Resolve a table/view name in a DB.
    Looks in information_schema.tables AND information_schema.views.
    Returns: qualified_name, schema, table
    (1:1 with main.py)
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
        # main.py raises HTTPException, but in Django we just throw a normal Exception
        raise Exception(f"Table/View {raw_name} not found in {db_label}")
    return f'"{row[0]}"."{row[1]}"', row[0], row[1]


def make_threshold_mask(series: pd.Series, expr: str | None) -> pd.Series:
    """
    Supported:
      - None or ''        ? everything True
      - <>NULL            ? non-null values
      - >x, <x, >=x, <=x  ? numeric
      - =VALUE            ? string match
      - VALUE             ? string match
    (1:1 from main.py)
    """
    if series is None:
        return pd.Series([True] * len(series))

    if not expr or str(expr).strip() == "":
        return pd.Series([True] * len(series), index=series.index)

    expr = str(expr).strip()

    # <>NULL
    if expr.upper() in ("<>NULL", "!=NULL", "NOT NULL"):
        return series.notna() & (series.astype(str).str.strip() != "")

    # numeric comparisons
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
        except:
            return pd.Series([True] * len(series), index=series.index)

    # explicit string: =Something
    if expr.startswith("="):
        val = expr[1:].strip().lower()
        return series.astype(str).str.strip().str.lower() == val

    # implicit string: Something
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

    Returns (features, bands, color_meta)
    (1:1 from main.py)
    """
    import numpy as np

    features = []
    all_bands = set()

    if not color_column or color_column not in df.columns:
        # No special color column ? just basic features, no color
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
                if norm_band and norm_band[0] not in ("N", "L", "U", "W", "G", "B"): 
                    norm_band = None   
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

    # Decide type
    numeric_series = pd.to_numeric(series, errors="coerce")
    numeric_ratio = numeric_series.notna().sum() / max(len(series), 1)
    is_numeric = numeric_ratio >= 0.8
    

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

    if is_numeric:
        vals = numeric_series[mask & numeric_series.notna()]
        if vals.empty:
            vals = numeric_series[numeric_series.notna()]
        if vals.empty:
            # Nothing to color, fall back to grey
            value_to_color = {}
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
                    "label": f"{a:.2f} - {b:.2f}",
                    "from": a,
                    "to": b,
                    "color": palette[i % len(palette)],
                }
                for i, (a, b) in enumerate(labels)
            ]

            value_to_color = {idx: bucket_color(v) for idx, v in numeric_series.items()}
    else:
        # Categorical coloring
        vals = series[mask & series.notna()].astype(str)
        uniques = sorted(vals.unique())
        color_map = {v: palette[i % len(palette)] for i, v in enumerate(uniques)}

        color_meta["unique_values"] = uniques
        color_meta["legend"] = [
            {"value": v, "color": color_map[v]} for v in uniques
        ]

        value_to_color = {}
        for idx, v in series.items():
            if not mask.loc[idx] or pd.isna(v):
                value_to_color[idx] = "#CCCCCC"
            else:
                value_to_color[idx] = color_map.get(str(v), "#CCCCCC")

    # Build features
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

# === API Views ===

class DatabasesView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        try:
            return Response(list(DB_ENGINES.keys()))
        except Exception as e:
            return Response({"detail": str(e)}, status=500)


class DriveTestProgressView(APIView):
    """
    Optional: if you want /drive-test/progress separate
    It reads the same global progress_status.
    """
    permission_classes = [AllowAny]

    def get(self, request):
        with _progress_status_lock:
            return Response(progress_status.copy())


class ProgressView(APIView):
    """
    /progress ? same as FastAPI main.py progress endpoint
    Frontend polls this for query progress.
    """
    permission_classes = [AllowAny]

    def get(self, request):
        with _progress_status_lock:
            return Response(progress_status.copy())

class ProjectsView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        try:
            with config_engine.connect() as conn:
                res = conn.execute(
                    text("SELECT DISTINCT project_name FROM geolytics_projectconfiguration")
                )
                projects = [r[0] for r in res]
            return Response(projects)
        except Exception as e:
            logger.exception(" /projects failed")
            return Response({"detail": str(e)}, status=500)


class ProjectTypesView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, project):
        try:
            with config_engine.connect() as conn:
                res = conn.execute(
                    text("SELECT DISTINCT table_type FROM geolytics_projectconfiguration WHERE project_name=:p"),
                    {"p": project}
                )
                types = [r[0] for r in res]
            return Response(types)
        except Exception as e:
            logger.exception(" /projects/{project}/types failed")
            return Response({"detail": str(e)}, status=500)


class ProjectConfigView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, project):
        table_type = request.query_params.get("table_type")
        if not table_type:
            return Response({"detail": "table_type required"}, status=400)
        try:
            table_type_clean = table_type.strip().replace("\u2019", "'").lower()

            with config_engine.connect() as conn:
                cols_result = conn.execute(text("""
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_name = 'geolytics_projectconfiguration'
                    ORDER BY ordinal_position
                """))
                all_columns = [r[0] for r in cols_result]

                query = text(f"""
                    SELECT {', '.join(f'"{c}"' for c in all_columns)}
                    FROM geolytics_projectconfiguration
                    WHERE lower(trim(project_name)) = :p
                      AND lower(trim(table_type)) = :t
                """)
                res = conn.execute(
                    query, {"p": project.lower().strip(), "t": table_type_clean}
                )
                rows = [dict(r) for r in res.mappings()]

                if not rows:
                    return Response(
                        {"detail": "No configuration found for this project/type"},
                        status=404,
                    )

                return Response(
                    {
                        "project": project,
                        "table_type": table_type,
                        "columns": all_columns,
                        "rows": rows,
                    }
                )
        except Exception as e:
            logger.exception(" /projects/{project}/config failed")
            return Response({"detail": str(e)}, status=500)


class TablesView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        # This uses Django DB 'tpga01' as in your original code
        with connections["tpga01"].cursor() as cursor:
            cursor.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            """
            )
            tables = [row[0] for row in cursor.fetchall()]
        return Response(tables)


class ColumnsView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, project_name=None, table=None):
        """
        Returns column names for a given project OR raw table.

        Supports BOTH routes:
        - columns/<str:table>
        - geo-api/columns/<str:project_name>

        This avoids crashes when geolytics.urls is included multiple times
        under different base paths.
        """

        # Resolve name from whichever URL matched first
        name = project_name or table
        if not name:
            return Response(
                {"detail": "Missing table or project name"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        logger.info(f" /columns called for: {name}")

        clean_name = re.sub(r"\s+$", "", name.strip().replace('"', ""))
        logger.info(f" Normalized: {clean_name}")

        # Step 1: project_name ? source_table (if config exists)
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

        if cfg and cfg[0]:
            source_table = cfg[0]
            logger.info(
                f" Mapped project '{clean_name}' ? source_table='{source_table}'"
            )
        else:
            source_table = clean_name
            logger.warning(
                f" No config mapping, using raw name '{source_table}'"
            )

        # Step 2: find DB via cached helper
        db_for_table = find_db_for_table_cached(source_table)
        if not db_for_table:
            logger.error(f" Table '{source_table}' not found in any DB")
            return Response(
                {"detail": f"Table '{source_table}' not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Step 3: fetch columns (cached)
        cols = get_columns_for_table_cached(db_for_table, source_table)

        logger.info(
            f" Found {len(cols)} columns in '{source_table}' (DB={db_for_table})"
        )

        return Response(cols)
def infer_series_type(values: list[str]):
    """
    Decide if column is numeric or categorical
    based on numeric ratio.
    """
    if not values:
        return "empty"

    s = pd.Series(values).dropna().astype(str)

    numeric = pd.to_numeric(s, errors="coerce")
    ratio = numeric.notna().sum() / max(len(s), 1)

    return "numeric" if ratio >= 0.8 else "categorical"


class ColumnRangeView(APIView):
    permission_classes = [AllowAny]
    

    def get(self, request):
        """
        /column-range endpoint - mirrors FastAPI logic:
        - Auto-map project_name ? target_table
        - Auto-detect DB via find_db_for_table_cached
        - Fuzzy match column names
        - Safe numeric parsing
        - Optional date filter via mapping table
        """
        table = request.query_params.get("table")
        column = request.query_params.get("column")

        if not table or not column:
            return Response({"detail": "Missing table or column"}, status=400)

        logger.info(f"/column-range called for table={table}, column={column}")

        try:
            # --------------------------------------------------
            # Step 0: project_name ? target_table mapping
            # --------------------------------------------------
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
                    {"t": table.lower()},
                ).fetchone()

            if mapping and mapping[0]:
                mapped_table, mapped_db = mapping
                logger.info(
                    f"Auto-mapped project '{table}' ? target_table '{mapped_table}' (DB={mapped_db})"
                )
                table = mapped_table

            # --------------------------------------------------
            # Helpers
            # --------------------------------------------------
            def normalize_colname(name: str) -> str:
                return re.sub(r"[^a-z0-9]+", "", str(name).lower().strip())

            def fuzzy_match_column(cols, target):
                norm_target = normalize_colname(target)

                # Exact normalized match
                for c in cols:
                    if normalize_colname(c) == norm_target:
                        return c

                # Substring match
                for c in cols:
                    if norm_target in normalize_colname(c) or normalize_colname(c) in norm_target:
                        return c

                # Numeric partial match (e.g. KPI_10 vs KPI10)
                tnums = re.findall(r"\d+", target)
                for c in cols:
                    cnums = re.findall(r"\d+", c)
                    if cnums and tnums and cnums[0] == tnums[0]:
                        return c

                return None

            def safe_float(val):
                if val is None:
                    return None
                try:
                    return float(val)
                except (ValueError, TypeError):
                    try:
                        if isinstance(val, str) and val.strip().lower().startswith("0x"):
                            return float(int(val.strip(), 16))
                        nums = re.findall(r"[-+]?\d*\.\d+|\d+", str(val))
                        return float(nums[0]) if nums else None
                    except Exception:
                        return None

            # --------------------------------------------------
            # Step 1: Resolve DB
            # --------------------------------------------------
            db_for_table = find_db_for_table_cached(table)
            if not db_for_table:
                return Response(
                    {
                        "min": None,
                        "max": None,
                        "error": f"Table '{table}' not found",
                    },
                    status=404,
                )

            eng = get_engine_for_db(db_for_table)

            # --------------------------------------------------
            # Step 2: Get columns (cached)
            # --------------------------------------------------
            cols = get_columns_for_table_cached(db_for_table, table)
            if not cols:
                return Response(
                    {
                        "min": None,
                        "max": None,
                        "error": f"No columns found in table '{table}'",
                    },
                    status=404,
                )

            # --------------------------------------------------
            # Step 3: Fuzzy match column
            # --------------------------------------------------
            match_col = fuzzy_match_column(cols, column)
            if not match_col:
                return Response(
                    {
                        "min": None,
                        "max": None,
                        "error": f"Column '{column}' not found",
                        "available_columns": cols,
                    },
                    status=404,
                )

            logger.info(f"Matched column ? '{match_col}'")

            # --------------------------------------------------
            # Step 4: Compute min / max with optional date filter
            # --------------------------------------------------
            from_date, to_date = read_date_filters_from_request(request)
            selected_dates = read_multi_dates_from_request(request)

            logger.info(
                f" Date filter ? from={from_date}, to={to_date}, dates={selected_dates}"
            )
            

            # Resolve date column from mapping table
            date_col = None
            with config_engine.connect() as cfg_conn:
                row = cfg_conn.execute(
                    text(
                        """
                        SELECT "date column"
                        FROM geolytics_projectconfiguration
                        WHERE lower(trim(project_name)) = lower(:p)
                        LIMIT 1
                        """
                    ),
                    {"p": table.lower()},
                ).fetchone()
                if row and row[0]:
                    date_col = row[0].strip()

            # Resolve actual table ONCE (IMPORTANT)
            qualified_table, schema, tbl = resolve_table_any(
                eng, table, db_for_table
            )

            where_clauses = [f'"{match_col}" IS NOT NULL']
            params = {}

            # Apply date filter ONLY if column exists
            if date_col and validate_date_column(eng, schema, tbl, date_col):

                if selected_dates:
                    where_clauses.append(f'"{date_col}"::date IN :dates')
                    params["dates"] = tuple(selected_dates)
            
                elif from_date and to_date:
                    where_clauses.append(
                        f'"{date_col}" BETWEEN :from_date AND :to_date'
                    )
                    params["from_date"] = from_date
                    params["to_date"] = to_date
            
                elif from_date:
                    where_clauses.append(f'"{date_col}" >= :from_date')
                    params["from_date"] = from_date
            
                elif to_date:
                    where_clauses.append(f'"{date_col}" <= :to_date')
                    params["to_date"] = to_date
            
            sql = text(
                f'''
                SELECT "{match_col}"
                FROM {qualified_table}
                WHERE {' AND '.join(where_clauses)}
                LIMIT 5000
                '''
            )
            
            with eng.connect() as conn:
                rows = conn.execute(sql, params).fetchall()
            
            values = [r[0] for r in rows if r[0] is not None]
            
            col_type = infer_series_type(values)
            
            if col_type == "numeric":
                nums = pd.to_numeric(pd.Series(values), errors="coerce").dropna()
                if nums.empty:
                    return Response({"type": "numeric", "min": None, "max": None})
            
                return Response({
                    "type": "numeric",
                    "values": None,
                    "min": float(nums.min()),
                    "max": float(nums.max()),
                })
            
            # categorical
            uniques = sorted(set(map(str, values)))
            return Response({
                "type": "categorical",
                "values": uniques[:50],
                "count": len(uniques),
                "min": None,
                "max": None,
            })
            

            #     return Response(
            #         {
            #             "min": None,
            #             "max": None,
            #             "error": f"Column '{match_col}' contains non-numeric data",
            #         },
            #         status=400,
            #     )

            # return Response(
            #     {
            #         "min": None,
            #         "max": None,
            #         "error": f"No numeric data found in '{match_col}'",
            #     }
            # )

        except Exception as e:
            logger.exception("/column-range failed")
            return Response(
                {"min": None, "max": None, "error": str(e)}, status=500
            )



class SaveTemplateView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        template = request.data
        name = template.get("name")
        config = template.get("config")
        if not name or not config:
            return Response(
                {"detail": "Template must have a name and config."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not isinstance(config.get("target_joins", []), list):
            return Response(
                {"detail": "Expected 'target_joins' to be a list."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        path = os.path.join(TEMPLATE_DIR, f"{name}.json")
        with open(path, "w") as f:
            json.dump(template, f, indent=2)
        return Response({"message": "Template saved"}, status=status.HTTP_200_OK)


class ListTemplatesView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        templates = [
            f[:-5]
            for f in os.listdir(TEMPLATE_DIR)
            if f.endswith(".json")
        ]
        return Response(templates)


class GetTemplateView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, name):
        path = os.path.join(TEMPLATE_DIR, f"{name}.json")
        if not os.path.exists(path):
            return Response(
                {"detail": "Template not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        with open(path, "r") as f:
            data = json.load(f)
        return Response(data)


class ExportDataView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        body = request.data
        format_ = body.get("format")
        data = body.get("data", {}).get("features", [])
        if not data:
            return Response(
                {"detail": "No data provided."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        df = pd.json_normalize(data)

        if format_ == "csv":
            stream = io.StringIO()
            df.to_csv(stream, index=False)
            stream.seek(0)
            response = StreamingHttpResponse(
                iter([stream.getvalue()]), content_type="text/csv"
            )
            response["Content-Disposition"] = "attachment; filename=export.csv"
            return response

        elif format_ == "kml":
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
            response = StreamingHttpResponse(
                io.BytesIO(kml_bytes.encode("utf-8")),
                content_type="application/vnd.google-earth.kml+xml",
            )
            response["Content-Disposition"] = "attachment; filename=export.kml"
            return response

        return Response(
            {"detail": "Invalid format requested."},
            status=status.HTTP_400_BAD_REQUEST,
        )


class UploadDriveTestView(APIView):
    permission_classes = [AllowAny]
    parser_classes = [parsers.MultiPartParser]

    def post(self, request):
        file_obj = request.FILES.get("file")
        if not file_obj:
            return Response(
                {"detail": " No file uploaded"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            if file_obj.name.lower().endswith(".csv"):
                df = pd.read_csv(
                    file_obj, encoding="utf-8-sig", sep=None, engine="python"
                )
            elif file_obj.name.lower().endswith((".xls", ".xlsx")):
                df = pd.read_excel(file_obj, engine="openpyxl")
            else:
                return Response(
                    {"detail": "Unsupported file format"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if df.empty:
                return Response(
                    {"detail": "Uploaded file is empty or unreadable"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            df.columns = [col.strip() for col in df.columns]

            lat_keywords = ["lat", "latitude", "gpslat", "positioninglat", "y"]
            lon_keywords = [
                "lon",
                "lng",
                "long",
                "longitude",
                "gpslon",
                "gpslng",
                "positioninglon",
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
                return Response(
                    {
                        "error": "Could not detect latitude/longitude automatically",
                        "columns": df.columns.tolist(),
                        "sample_rows": df.head(3).to_dict("records"),
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            df = df.dropna(subset=[lat_col, lon_col])

            exclude = {lat_col, lon_col, "time", "imei", "imsi", "device_name"}
            kpi_candidates = [
                col
                for col in df.columns
                if col not in exclude and pd.api.types.is_numeric_dtype(df[col])
            ]

            if not kpi_candidates:
                return Response(
                    {
                        "error": "No numeric KPI columns detected",
                        "columns": df.columns.tolist(),
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            drive_test_store["df"] = df
            drive_test_store["columns"] = kpi_candidates

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
                except Exception:
                    continue

            geojson = {"type": "FeatureCollection", "features": features}

            return Response(
                {"geojson": geojson, "available_kpis": kpi_candidates}
            )
        except Exception as e:
            logger.exception(" upload-drive-test crash")
            return Response(
                {"detail": f"Server crash: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class DriveTestColumnsView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        df = drive_test_store["df"]
        if df is None:
            return Response(
                {"detail": "No drive test data uploaded"},
                status=status.HTTP_404_NOT_FOUND,
            )

        cols = drive_test_store.get("columns", [])
        if not cols:
            cols = [
                c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])
            ]
        return Response({"columns": cols})


class DriveTestColumnRangeView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        col = request.query_params.get("column")
        df = drive_test_store["df"]

        if df is None or col not in df.columns:
            return Response(
                {"detail": f"Column {col} not found in drive test data."},
                status=status.HTTP_404_NOT_FOUND,
            )

        series = df[col].dropna()
        if series.empty:
            return Response({"min": None, "max": None, "error": "Empty column"})

        if pd.api.types.is_numeric_dtype(series):
            return Response(
                {
                    "type": "numeric",
                    "min": float(series.min()),
                    "max": float(series.max()),
                }
            )
        if pd.api.types.is_datetime64_any_dtype(series):
            return Response(
                {
                    "type": "datetime",
                    "min": str(series.min()),
                    "max": str(series.max()),
                }
            )
        if pd.api.types.is_string_dtype(series):
            unique_vals = series.unique().tolist()
            return Response(
                {
                    "type": "categorical",
                    "unique_values": unique_vals[:50],
                    "count": len(unique_vals),
                }
            )

        return Response({"error": f"Unsupported dtype: {series.dtype}"})


class GenerateGridView(APIView):
    permission_classes = [AllowAny]
    parser_classes = [parsers.MultiPartParser]

    def post(self, request):
        file_obj = request.FILES.get("file")
        kpi = request.query_params.get("kpi")
        grid_size = float(request.query_params.get("grid_size", 0.01))

        if not file_obj or not kpi:
            return Response(
                {"error": "File and kpi required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            with tempfile.NamedTemporaryFile(
                delete=False, suffix=".geojson"
            ) as tmp:
                for chunk in file_obj.chunks():
                    tmp.write(chunk)
                tmp_path = tmp.name

            gdf = gpd.read_file(tmp_path)
            if gdf.empty or "geometry" not in gdf.columns:
                return Response(
                    {"error": "Uploaded file empty or missing geometry"},
                    status=400,
                )
            if kpi not in gdf.columns:
                return Response(
                    {"error": f"KPI {kpi} not found"}, status=400
                )

            minx, miny, maxx, maxy = gdf.total_bounds
            grid_cells, x = [], minx
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
            return Response(json.loads(grid.to_json()))
        except Exception as e:
            logger.exception(" generate-grid failed")
            return Response({"error": str(e)}, status=500)


class QueryDataView(APIView):
    """
    /query endpoint - 1:1 clone of FastAPI main.py query_sites
    (same behaviour + same JSON shape, including color_config)
    """

    permission_classes = [AllowAny]

    def get(self, request):
        project = request.query_params.get("project")
        table_type = request.query_params.get("table_type")

        if not project:
            return Response(
                {"detail": "Missing 'project' parameter."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not table_type:
            return Response(
                {"detail": "Missing 'table_type' parameter."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        logger.info(f"[GET] QueryDataView project={project}, table_type={table_type}")
        return self._handle_query(request, project, table_type)


    def post(self, request):
        project = request.data.get("project")
        table_type = request.data.get("table_type")

        if not project:
            return Response(
                {"detail": "Missing 'project' in payload."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not table_type:
            return Response(
                {"detail": "Missing 'table_type' in payload."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        logger.info(f"[POST] QueryDataView project={project}, table_type={table_type}")
        return self._handle_query(request, project, table_type)

    def _handle_query(self, request, project, table_type):
        import numpy as np
        global progress_status
        
        

        set_progress(0, "Initializing...")
        logger.info(" /query endpoint called (Django)")
        logger.info(f" Input ? project={project}, table_type={table_type}")
        # ====== Read date filters from request (GET or POST) ======
        from_date, to_date = read_date_filters_from_request(request)
        selected_dates = read_multi_dates_from_request(request)

        logger.info(
            f" Date filter ? from={from_date}, to={to_date}, dates={selected_dates}"
        )
        
        
        


        try:
            # ====== table_type normalization (1:1 with main.py) ======
            table_type_clean = (
                table_type.strip()
                .replace("@", "'")
                .replace("`", "'")
                .replace("%27", "'")
                .lower()
            )
            # ====== GENERATION VIEW DETECTION (CRITICAL FIX) ======
            is_generation_view = (
                project.lower().endswith(("_2g", "_3g", "_4g", "_5g"))
            )
            
            candidates = [table_type_clean]
            if "kpi's" in table_type_clean:
                candidates.append("kpis")
            if "kpis" in table_type_clean:
                candidates.append("kpi's")

            # ====== Step 1: fetch configuration (same fields as main.py) ======
            set_progress(10, "Fetching configuration...")
            with config_engine.connect() as conn:
                cfg = None
                for cand in candidates:
                    query = text(
                        """
                        SELECT
                            source_table,
                            
                            source_column,
                            target_db,
                            target_table,
                            target_column,
                            "date column",
                            "colour column",

                            band,
                            column1,
                            column2,
                            column3,
                            column4,
                            column5,
                            column6,
                            column7,
                            column8,
                            column9,
                            column10,
                            column11,
                            thersold1,
                            thersold2,
                            thersold3,
                            thersold4,
                            thersold5,
                            thersold6,
                            thersold7,
                            thersold8,
                            thersold9,
                            thersold10,
                            thersold11
                        FROM geolytics_projectconfiguration
                        WHERE lower(trim(project_name)) = :p
                          AND lower(trim(table_type)) = :t
                        """
                    )
                    cfg = (
                        conn.execute(
                            query, {"p": project.lower().strip(), "t": cand}
                        )
                        .mappings()
                        .first()
                    )
                    if cfg:
                        cfg = dict(cfg)
                        break

            if not cfg:
                if is_generation_view:
                    logger.info(
                        f"GENERATION VIEW WITHOUT CONFIG | project={project} | forcing source-only"
                    )
            
                    # Step 1: Try to resolve source_table from ANY config row of this project
                    with config_engine.connect() as conn:
                        row = conn.execute(
                            text("""
                                SELECT source_table
                                FROM geolytics_projectconfiguration
                                WHERE lower(trim(project_name)) = lower(:p)
                                  AND source_table IS NOT NULL
                                LIMIT 1
                            """),
                            {"p": project.strip()}
                        ).fetchone()
            
                    if not row or not row[0]:
                        raise Exception(
                            f"No source_table mapping found for generation project {project}"
                        )
            
                    source_table = row[0].strip()
                    inferred_db = infer_db_from_project(project)
            
                    if not inferred_db:
                        raise Exception("Could not infer DB for generation view")
            
                    # Minimal fake cfg (but with REAL source_table)
                    cfg = {
                        "source_table": source_table,
                        "source_column": None,
                        "target_table": None,
                        "target_column": None,
                        "target_db": None,
                        "date column": None,
                        "band": None,
                    }
            
                else:
                    # ===== NON-GENERATION: STRICT CONFIG REQUIRED =====
                    logger.warning(f"No config found for {project}/{table_type}")
                    set_progress(100, "No data for this configuration")
                    reset_progress_later()
                    return Response(
                        {
                            "status": "missing_config",
                            "message": f"No configuration found for {project} ({table_type})",
                            "features": [],
                            "bands": [],
                        }
                    )
            

            # ====== Read core config ======
            source_table = (cfg.get("source_table") or "").strip()
            source_col = (cfg.get("source_column") or "").strip()
            target_table = (cfg.get("target_table") or "").strip()
            target_col = (cfg.get("target_column") or "").strip()
            date_col = (cfg.get("date column") or "").strip()

            if date_col in ["", "NONE", "none", "Null"]:
                date_col = None
            
            

            # ====== DB resolution – NO HARDCODED LIST (1:1 with main.py) ======
            source_db = (cfg.get("source_db") or "").strip()
            target_db = (cfg.get("target_db") or "").strip()

            inferred_db = infer_db_from_project(project)


            if not source_db:
                # 1) try inferred from project_name
                if inferred_db and inferred_db in DB_ENGINES:
                    source_db = inferred_db
                else:
                    # 2) try scanning all engines for source_table
                    source_db = find_db_for_table_cached(source_table)

            if target_table and not target_db:
                target_db = find_db_for_table_cached(target_table)

            if not source_db:
                raise Exception(
                    f"Could not resolve DB for source_table '{source_table}'"
                )
            if target_table and not target_db:
                raise Exception(
                    f"Could not resolve DB for target_table '{target_table}'"
                )

            logger.info(
                f" Source={source_table} (DB={source_db}) ? "
                f"Target={target_table or '-'} (DB={target_db or '-'})"
            )
            source_engine = get_engine_for_db(source_db)

            # ====== Step 2: resolve source schema & columns ======
            set_progress(20, "Resolving source schema...")
            try:
                qualified_source, s_schema, s_table = resolve_table_any(
                    source_engine, source_table, source_db
                )
            except Exception as e:
                logger.error(str(e))
                set_progress(100, "Source table missing")
                reset_progress_later()
                return Response(
                    {
                        "status": "missing_source_table",
                        "project": project,
                        "table_type": table_type,
                        "source_table": source_table,
                        "source_db": source_db,
                        "features": [],
                        "bands": [],
                        "message": "Source table not found in database"
                    },
                    status=404,
                )
            

            with source_engine.connect() as conn:
                src_cols = [
                    r[0]
                    for r in conn.execute(
                        text(
                            """
                            SELECT column_name
                            FROM information_schema.columns
                            WHERE table_schema=:s AND table_name=:t
                            """
                        ),
                        {"s": s_schema, "t": s_table},
                    )
                ]

            def pick_cellname_col(all_cols, configured):
                if configured and configured in all_cols:
                    return configured
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

            source_col = pick_cellname_col(src_cols, source_col)

            def find_col(cands):
                for name in src_cols:
                    ln = name.lower()
                    for c in cands:
                        if c in ln:
                            return name
                return None

            az_col = find_col(["azimuth"])
            # 
            lat_col = next(
                (c for c in src_cols if c.lower().strip() in ["latitude", "lat_dec", "lat", "lattitude"]),
                None
            )
            
            lon_col = next(
                (c for c in src_cols if c.lower().strip() in ["longitude", "lon_dec", "lon", "long", "longtitude"]),
                None
            )
            
            # fallback to old fuzzy logic if still not found
            if not lat_col:
                lat_col = find_col(["lat", "latitude", "lattitude"])
            if not lon_col:
                lon_col = find_col(["lon", "long", "longitude", "longtitude"])
            
            site_col = find_col(["sitename", "site_id", "siteid", "site"])

            # band from config (band column name)
            band_col = cfg.get("band")
            if band_col not in src_cols:
                band_col = None

            city_col = find_col(["city", "region", "town", "hq", "layer"])

            logger.info(
                f" Detected lat={lat_col}, lon={lon_col}, site={site_col}, "
                f"band={band_col}, city={city_col}"
            )
            if not lat_col or not lon_col:
                raise Exception(
                    f"Could not detect Lat/Lon columns in {source_table}"
                )

            def build_source_sql():
                az_expr = (
                    f'"{az_col}" AS "Azimuth"' if az_col else 'NULL::text AS "Azimuth"'
                )
                site_expr = (
                    f'"{site_col}" AS "site_id"' if site_col else 'NULL::text AS "site_id"'
                )
                band_expr = (
                    f'"{band_col}" AS "band"' if band_col else 'NULL::text AS "band"'
                )
                city_expr = (
                    f'"{city_col}" AS "city"' if city_col else 'NULL::text AS "city"'
                )
            
                where_clauses = [
                    f'"{lat_col}" IS NOT NULL',
                    f'"{lon_col}" IS NOT NULL'
                ]
            
                # ?? APPLY DATE FILTER TO SOURCE TABLE
                if date_col and validate_date_column(source_engine, s_schema, s_table, date_col):
                    if selected_dates:
                        where_clauses.append(f'"{date_col}"::date IN :dates')
                    elif from_date and to_date:
                        where_clauses.append(f'"{date_col}" BETWEEN :from_date AND :to_date')
                    elif from_date:
                        where_clauses.append(f'"{date_col}" >= :from_date')
                    elif to_date:
                        where_clauses.append(f'"{date_col}" <= :to_date')
            
                base_sql = f"""
                    SELECT
                        "{source_col}" AS "cellname",
                        "{lat_col}" AS "Lat",
                        "{lon_col}" AS "Long",
                        {az_expr},
                        {site_expr},
                        {band_expr},
                        {city_expr}
                    FROM {qualified_source}
                    WHERE {' AND '.join(where_clauses)}
                """
            
                # GEN OVERVIEW = NO LIMIT
                GEN_TYPES = ["kpi", "kpis", "kpi's", "generation", "overview"]
                if (
                    project.lower().endswith(("_2g", "_3g", "_4g", "_5g"))
                    and table_type_clean in GEN_TYPES
                ):
                    return base_sql
            
                return base_sql + " LIMIT 40000"
            
            
            # ===== GEN OVERVIEW FORCE SOURCE-ONLY =====
            # If project ends with _2G/_3G/_4G/_5G  this is generation overview
            GEN_TYPES = ["kpi", "kpis", "kpi's", "generation", "overview"]

            if (
                project.lower().endswith(("_2g", "_3g", "_4g", "_5g"))
                and table_type_clean in GEN_TYPES
            ):
            

                logger.info("GEN OVERVIEW DETECTED - forcing SOURCE-ONLY branch")
            
                set_progress(40, "Fetching source data...")
            
                params = {}
                if selected_dates:
                    params["dates"] = tuple(selected_dates)
                if from_date:
                    params["from_date"] = from_date
                if to_date:
                    params["to_date"] = to_date
                
                df = pd.read_sql(
                    text(build_source_sql()),
                    source_engine.connect(),
                    params=params
                )
                
                logger.info(f"GEN OVERVIEW rows: {len(df)}")
            
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
                                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                                "properties": props,
                            }
                        )
                    except:
                        continue
            
                safe_rows = json.loads(df.to_json(orient="records", default_handler=str))
                set_progress(100, "Complete ?")
                logger.info(
                    f"GEN OVERVIEW COMPLETE | Features={len(features)} | Bands={sorted(all_bands)}"
                )
                reset_progress_later()

            
                return Response({
                    "type": "FeatureCollection",
                    "features": features,
                    "bands": sorted(all_bands),
                    "source_columns": src_cols,
                    "target_columns": [],
                    "columns": list(df.columns),
                    "rows": safe_rows,
                    "available_kpis": [],
                    "rca_column": None
                })
            

            # ====== CASE A: Source-only (exactly like main.py) ======
            if not target_table or not target_col:
                set_progress(40, "Fetching source data...")
                params = {}
                if selected_dates:
                    params["dates"] = tuple(selected_dates)
                if from_date:
                    params["from_date"] = from_date
                if to_date:
                    params["to_date"] = to_date
                
                df = pd.read_sql(
                    text(build_source_sql()),
                    source_engine.connect(),
                    params=params
                )
                
                logger.info(f" Source rows: {len(df)}")

                features, all_bands = [], set()
                for _, r in df.iterrows():
                    try:
                        lon, lat = float(r["Long"]), float(r["Lat"])
                        if not np.isfinite(lon) or not np.isfinite(lat):
                            continue
                        props = {
                            k: (None if pd.isna(v) else v) for k, v in r.items()
                        }
                        norm_band = extract_band(
                            props.get("band") or props.get("cellname")
                        )
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
                set_progress(100, "Complete ?")
                logger.info(
                    f" GeoJSON ready (Source-only) | "
                    f"Features={len(features)} | Bands={sorted(all_bands)}"
                )

                # EXACT same keys as FastAPI source-only branch
                reset_progress_later()

                return Response(
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
                    }
                )

            # ====== CASE B: GENERIC JOIN (KPI / CM / RCA / Alarm / Traffic / anything) ======
            # Dynamic color column: first non-empty among color_column, column1..column11
            color_column = None
            for c_name in [
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
                val = cfg.get(c_name)
                if val not in [None, "", "NONE", "none", "Null"]:
                    color_column = str(val).strip()
                    break

            # Dynamic threshold expression: first non-empty thersold*
            threshold_expr = None
            for t_name in [
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
                val = cfg.get(t_name)
                if val not in [None, "", "NONE", "none", "Null"]:
                    threshold_expr = str(val).strip()
                    break

            set_progress(40, "Fetching joined data...")

            target_engine = get_engine_for_db(target_db)
            qualified_target, t_schema, t_table = resolve_table_any(
                target_engine, target_table, target_db
            )

            # Load source data
            params = {}
            if selected_dates:
                params["dates"] = tuple(selected_dates)
            if from_date:
                params["from_date"] = from_date
            if to_date:
                params["to_date"] = to_date
            
            src_df = pd.read_sql(
                text(build_source_sql()),
                source_engine.connect(),
                params=params
            )
            
            # src_df = pd.read_sql(text(build_source_sql()), source_engine.connect())

            # Discover target columns, join key etc.
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
                raise Exception(
                    f"Config missing target_column for {project}/{table_type}"
                )
            join_key = target_col

            logger.info(f" Generic join key ? {join_key}")
            logger.info(f" Color column from config ? {color_column or 'NONE'}")
            logger.info(f" Threshold expression ? {threshold_expr or 'NONE'}")

            # Pull full target table (ALL columns available in frontend)
            where_clauses = [f'"{join_key}" IS NOT NULL']
            params = {}
            
            # ---- Date filter (SAFE) ----
            if date_col and not validate_date_column(
                target_engine, t_schema, t_table, date_col
            ):
                logger.warning(
                    f"Date column '{date_col}' not found in {qualified_target}, ignoring date filter"
                )
                date_col = None

            # ---- Apply date filter (MULTI-DATE FIRST) ----
            if date_col and validate_date_column(
                target_engine, t_schema, t_table, date_col
            ):
            
                if selected_dates:
                    where_clauses.append(
                        f'"{date_col}"::date IN :dates'
                    )
                    params["dates"] = tuple(selected_dates)
            
                elif from_date and to_date:
                    where_clauses.append(
                        f'"{date_col}" BETWEEN :from_date AND :to_date'
                    )
                    params["from_date"] = from_date
                    params["to_date"] = to_date
            
                elif from_date:
                    where_clauses.append(f'"{date_col}" >= :from_date')
                    params["from_date"] = from_date
            
                elif to_date:
                    where_clauses.append(f'"{date_col}" <= :to_date')
                    params["to_date"] = to_date
            
                
            
            
            
            tgt_sql = text(
                f'''
                SELECT *, "{join_key}" AS target_key
                FROM {qualified_target}
                WHERE {' AND '.join(where_clauses)}
                LIMIT 40000
                '''
            )
            
            tgt_df = pd.read_sql(
                tgt_sql,
                target_engine.connect(),
                params=params
            )
            
            

            # Normalize join columns to string
            src_df["cellname"] = src_df["cellname"].astype(str)
            tgt_df["target_key"] = tgt_df["target_key"].astype(str)

            merged = pd.merge(
                src_df,
                tgt_df,
                left_on="cellname",
                right_on="target_key",
                how="left",
            )

            merged = merged.replace([np.inf, -np.inf], np.nan).where(
                pd.notnull(merged), None
            )

            # Apply generic coloring based on config (same as main.py)
            features, all_bands, color_meta = apply_color_config(
                merged, color_column=color_column, threshold_expr=threshold_expr
            )

            safe_rows = json.loads(
                merged.to_json(orient="records", default_handler=str)
            )
            set_progress(100, "Complete ?")
            logger.info(
                f" GeoJSON ready (GENERIC JOIN) | "
                f"Features={len(features)} | Bands={all_bands}"
            )

            target_columns = [c for c in tgt_colnames if c != join_key]

            # EXACT JSON shape as FastAPI generic join
            return Response(
                {
                    "type": "FeatureCollection",
                    "features": features,
                    "bands": all_bands,
                    "source_columns": src_cols,
                    "target_columns": target_columns,
                    "color_config": color_meta,
                    "columns": merged.columns.tolist(),
                    "rows": safe_rows,
                }
            )

        except Exception as e:
            # 1:1 error behaviour: set progress to Error and return {"error": "..."} with 500
            with _progress_status_lock:
                progress_status["progress"] = -1
                progress_status["stage"] = "Error"
                progress_status["error"] = str(e)
            reset_progress_later(5.0)
            logger.error(f" Error occurred: {e}")
            return Response(
                {"error": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class UploadGridMapView(APIView):
    permission_classes = [AllowAny]
    parser_classes = [parsers.MultiPartParser]

    def post(self, request):
        file_obj = request.FILES.get("file")
        if not file_obj:
            return Response({"detail": "File required"}, status=400)

        df = pd.read_csv(file_obj, encoding="utf-8-sig")
        if df.empty:
            return Response({"detail": "Uploaded file empty"}, status=400)

        # Detect lat/lon
        if "Lat" in df.columns and "Long" in df.columns:
            lat_col, lon_col = "Lat", "Long"
        else:
            lat_keywords = ["lat", "latitude", "gps_lat", "y", "positioning_lat"]
            lon_keywords = [
                "lon",
                "lng",
                "long",
                "longitude",
                "x",
                "gps_lon",
                "gps_lng",
            ]
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
            return Response(
                {
                    "error": "Could not detect latitude/longitude columns",
                    "columns": df.columns.tolist(),
                    "sample_rows": df.head(3).to_dict("records"),
                },
                status=400,
            )

        df = df.dropna(subset=[lat_col, lon_col])
        df = df.replace([float("inf"), float("-inf")], None)

        global grid_data
        grid_data = df.copy()

        features = []
        for _, row in df.iterrows():
            try:
                lon, lat = float(row[lon_col]), float(row[lat_col])
                if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                    continue

                props = {
                    k: (None if pd.isna(v) else v)
                    for k, v in row.to_dict().items()
                }
                if "city" not in props:
                    props["city"] = None

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

        exclude_cols = {lat_col, lon_col}
        numeric_cols = (
            df.drop(columns=list(exclude_cols), errors="ignore")
            .select_dtypes(include=["number"])
            .columns.tolist()
        )

        return Response(
            {
                "geojson": {"type": "FeatureCollection", "features": features},
                "available_kpis": numeric_cols,
            }
        )


class GridMapColumnRangeView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        global grid_data
        column = request.query_params.get("column")
        table = request.query_params.get("table")

        if table:
            with connections["tpga01"].cursor() as cursor:
                cursor.execute(
                    "SELECT column_name FROM information_schema.columns WHERE table_name = %s",
                    [table],
                )
                cols = [row[0] for row in cursor.fetchall()]
                if column not in cols:
                    return Response(
                        {
                            "min": None,
                            "max": None,
                            "error": f"Column {column} not in {table}",
                        }
                    )

                cursor.execute(
                    f'SELECT MIN("{column}"), MAX("{column}") FROM "{table}" WHERE "{column}" IS NOT NULL'
                )
                result = cursor.fetchone()
                return Response(
                    {
                        "min": float(result[0]) if result[0] is not None else None,
                        "max": float(result[1]) if result[1] is not None else None,
                    }
                )

        if grid_data is None or column not in grid_data.columns:
            return Response({"min": None, "max": None})

        return Response(
            {
                "min": float(grid_data[column].min()),
                "max": float(grid_data[column].max()),
            }
        )


class GridMapFromTableView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        table = request.query_params.get("table")
        if not table:
            return Response({"error": "Table name required"}, status=400)

        with connections["tpga01"].cursor() as cursor:
            cursor.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_name = %s",
                [table],
            )
            cols = [row[0] for row in cursor.fetchall()]

            lat_col = next(
                (c for c in cols if c.lower() in ["lat", "latitude"]), None
            )
            lon_col = next(
                (c for c in cols if c.lower() in ["lon", "long", "lng", "longitude"]),
                None,
            )

            if not lat_col or not lon_col:
                return Response(
                    {"error": f"No lat/lon columns found in {table}"},
                    status=400,
                )

            cursor.execute(
                f'SELECT * FROM "{table}" WHERE "{lat_col}" IS NOT NULL AND "{lon_col}" IS NOT NULL'
            )
            rows = [
                dict(zip([col[0] for col in cursor.description], r))
                for r in cursor.fetchall()
            ]

        global grid_data
        grid_data = pd.DataFrame(rows)

        features = []
        for row in rows:
            try:
                lat, lon = float(row[lat_col]), float(row[lon_col])
                props = {
                    k: v for k, v in row.items() if k not in [lat_col, lon_col]
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
            except Exception:
                continue

        return Response(
            {
                "geojson": {"type": "FeatureCollection", "features": features},
                "available_kpis": [c for c in cols if c not in [lat_col, lon_col]],
            }
        )


class BandsView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, table):
        try:
            # Step 1: Resolve project ? source_table
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
                    f" Resolved project '{table}' ? source_table='{source_table}'"
                )
            else:
                source_table = table
                logger.info(f" No config row for '{table}', using raw name")

            db_for_table = find_db_for_table_cached(source_table)
            if not db_for_table:
                return Response([], status=200)
            eng = get_engine_for_db(db_for_table)

            with eng.connect() as conn:
                all_cols = [
                    r[0]
                    for r in conn.execute(
                        text(
                            """
                            SELECT column_name
                            FROM information_schema.columns
                            WHERE table_name=:t
                        """
                        ),
                        {"t": source_table.split(".")[-1].replace('"', "")},
                    )
                ]

            band_col = next(
                (
                    c
                    for c in all_cols
                    if any(
                        k in c.lower()
                        for k in ["band", "spectrum", "carrier", "freq"]
                    )
                ),
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
                            "cell id",
                            "cellid",
                            "element3",
                            "enbcell",
                        ]
                    )
                ),
                None,
            )

            if not band_col or not cell_col:
                logger.warning(
                    f" Missing band/cell columns in {source_table}"
                )
                return Response([], status=200)
            qualified_table, _, _ = resolve_table_any(
                eng, source_table, db_for_table
            )

            sql = text(
                f'''
                SELECT DISTINCT "{band_col}" AS band, "{cell_col}" AS cellname
                FROM {qualified_table}
                WHERE "{band_col}" IS NOT NULL AND "{cell_col}" IS NOT NULL
                LIMIT 10000
                '''
            )
            with eng.connect() as conn:
                rows = conn.execute(sql).fetchall()

            result = [
                {"band": str(r[0]), "cellname": str(r[1])}
                for r in rows
                if r[0] and r[1]
            ]
            logger.info(f" Bands fetched: {len(result)} from {source_table}")
            return Response(result)

        except Exception as e:
            logger.exception("BandsView failed")
            return Response({"detail": str(e)}, status=500)


class DistinctValuesView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, table):
        col = request.query_params.get("col")
        if not table or not col:
            return Response(
                {"detail": "Table and column are required"}, status=400
            )

        try:
            col = col.strip()
            resolved_table = table.strip()

            # Try resolving actual table via config
            with config_engine.connect() as conn:
                result = conn.execute(
                    text(
                        """
                        SELECT source_table, target_table
                        FROM geolytics_projectconfiguration
                        WHERE lower(trim(project_name)) = lower(trim(:p))
                        LIMIT 1
                    """
                    ),
                    {"p": table},
                )
                row = result.fetchone()
                source_table, target_table = row if row else (None, None)
                
                # decide table based on column ownership
                resolved_table = source_table or target_table
                db_for_source = find_db_for_table_cached(source_table)
                db_for_target = find_db_for_table_cached(target_table) if target_table else None
                
                if db_for_target:
                    tgt_cols = get_columns_for_table_cached(db_for_target, target_table)
                    if col in tgt_cols:
                        resolved_table = target_table
                


            db_for_table = find_db_for_table_cached(resolved_table)
            if not db_for_table:
                return Response(
                    {
                        "detail": f"Table '{resolved_table}' not found in any DB."
                    },
                    status=404,
                )

            eng = get_engine_for_db(db_for_table)

            with eng.connect() as conn:
                cols = [
                    r[0]
                    for r in conn.execute(
                        text(
                            """
                            SELECT column_name
                            FROM information_schema.columns
                            WHERE table_name = :t
                            """
                        ),
                        {
                            "t": resolved_table.split(".")[-1].replace(
                                '"', ""
                            )
                        },
                    )
                ]

                match = next(
                    (c for c in cols if c.lower() == col.lower()), None
                )
                if not match:
                    return Response(
                        {
                            "detail": f"Column '{col}' not found in {resolved_table}",
                            "available_columns": cols,
                        },
                        status=404,
                    )

                from_date, to_date = read_date_filters_from_request(request)
                selected_dates = read_multi_dates_from_request(request)

                
                

                # Resolve date column from config
                date_col = None
                with config_engine.connect() as cfg_conn:
                    cfg = cfg_conn.execute(
                        text(
                            """
                            SELECT "date column"
                            FROM geolytics_projectconfiguration
                            WHERE lower(trim(project_name)) = lower(trim(:p))
                            LIMIT 1
                            """
                        ),
                        {"p": table},
                    ).fetchone()
                
                if cfg and cfg[0]:
                    date_col = cfg[0].strip()
            
                
                where_clauses = [f'"{match}" IS NOT NULL']
                params = {}
                
                qualified_table, schema, tbl = resolve_table_any(
                    eng, resolved_table, db_for_table
                )
                
                if date_col and validate_date_column(eng, schema, tbl, date_col):
                
                    if selected_dates:
                        where_clauses.append(f'"{date_col}"::date IN :dates')
                        params["dates"] = tuple(selected_dates)
                
                    elif from_date and to_date:
                        where_clauses.append(
                            f'"{date_col}" BETWEEN :from_date AND :to_date'
                        )
                        params["from_date"] = from_date
                        params["to_date"] = to_date
                
                    elif from_date:
                        where_clauses.append(f'"{date_col}" >= :from_date')
                        params["from_date"] = from_date
                
                    elif to_date:
                        where_clauses.append(f'"{date_col}" <= :to_date')
                        params["to_date"] = to_date
                
                
                safe_sql = text(
                    f'''
                    SELECT DISTINCT "{match}"
                    FROM {qualified_table}
                    WHERE {' AND '.join(where_clauses)}
                    LIMIT 200
                    '''
                )
                
                result = conn.execute(safe_sql, params)
                values = [r[0] for r in result if r[0] is not None]
                
                

            return Response(
                sorted(values, key=lambda x: str(x).lower())
            )

        except Exception as e:
            logger.exception("DistinctValuesView failed")
            return Response(
                {"detail": f"Failed to fetch values: {str(e)}"}, status=500
            )


@method_decorator(csrf_exempt, name="dispatch")
class GeoAPIRouterView(APIView):
    """
    /geo-api router - mirrors FastAPI's /query when called by frontend.
    """

    permission_classes = [AllowAny]

    def get(self, request, *args, **kwargs):
        q = QueryDataView()
        return q.get(request)

    def post(self, request, *args, **kwargs):
        q = QueryDataView()
        return q.post(request)
