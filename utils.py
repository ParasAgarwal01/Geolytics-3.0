from sqlalchemy import text

def get_geojson_with_join(
    engine,
    physical_table,
    target_table,
    physical_columns,
    physical_extra_cols,
    target_columns,
    join_on
):
    # Build SELECT clause
    select_cols = []

    for role, col in physical_columns.items():
        select_cols.append(f'p."{col}" AS "{role}"')

    for col in physical_extra_cols:
        if col not in physical_columns.values():
            select_cols.append(f'p."{col}"')

    for col in target_columns:
        select_cols.append(f't."{col}" AS "target_{col}"')

    select_clause = ", ".join(select_cols)

    # JOIN clause
    join_clause = f'LEFT JOIN "{target_table}" t ON p."{join_on["physical"]}" = t."{join_on["target"]}"'

    # WHERE clause
    where_clause = f'WHERE p."{physical_columns["lat"]}" IS NOT NULL AND p."{physical_columns["lon"]}" IS NOT NULL'

    # Final SQL
    sql = f"""
    SELECT {select_clause}
    FROM "{physical_table}" p
    {join_clause}
    {where_clause}
    """

    # Execute query
    with engine.connect() as conn:
        result = conn.execute(text(sql)).mappings().all()

    # Convert to GeoJSON
    features = []
    for row in result:
        row = dict(row)
        try:
            lon = float(row.pop("lon"))
            lat = float(row.pop("lat"))
            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": row
            })
        except (KeyError, ValueError, TypeError):
            continue

    return {
        "type": "FeatureCollection",
        "features": features
    }
