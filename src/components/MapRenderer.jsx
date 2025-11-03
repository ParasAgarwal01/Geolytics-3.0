// MapRenderer.jsx — Unified "ultimate" version (cleaned, merged, defensive)
// Drop-in replacement for your broken/partially-merged MapRenderer files.

import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import * as turf from "@turf/turf";
import "mapbox-gl/dist/mapbox-gl.css";
import "../Styles.css";

window.mapRef = { current: null };


mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || "";

// Defaults
const DEFAULT_CENTER = [78.9629, 20.5937];
const DEFAULT_ZOOM = 5;
// Generation colors
const GENERATION_COLORS = {
  "2G": "#3B82F6", // blue
  "3G": "#F59E0B", // amber
  "4G": "#10B981", // green
  "5G": "#8B5CF6", // violet
};


/* ---------------- Utilities (keep old helpers for future use) ---------------- */
const safeGet = (obj, keys) => {
  for (const k of keys) if (obj && k in obj) return obj[k];
  return null;
};

const parseNumber = (v, fallback = NaN) => {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(String(v).trim());
  return Number.isNaN(n) ? fallback : n;
};

const normalizeBandName = (b) => (b ? String(b).trim().toUpperCase() : "DEFAULT");

const getColorForBand = (band, bandColorMap = {}) => {
  if (!band) return "#cccccc";

  // Default telecom color palette
  const defaults = {
    "700": "#22d3ee", // cyan
    "800": "#3b82f6", // blue
    "900": "#10b981", // green
    "1800": "#1d4ed8", // dark blue
    "2100": "#eab308", // yellow
    "2300": "#f97316", // orange
    "2600": "#ef4444", // red
    DEFAULT: "#6366f1", // indigo
  };

  const key = String(band).replace(/\D/g, "") || band;
  return bandColorMap[band] || bandColorMap[key] || defaults[key] || defaults.DEFAULT;
};


const escapeHtml = (str) =>
  String(str === null || str === undefined ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const createPopupHtml = (props = {}) => {
  const rows = Object.keys(props || {}).map((k) => {
    const v = props[k];
    const keyPretty = String(k)
      .replace(/_/g, " ")
      .replace(/\b\w/g, (l) => l.toUpperCase());
    return `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;"><strong>${escapeHtml(
      keyPretty
    )}</strong></td><td style="padding:4px 8px;border-bottom:1px solid #eee;">${escapeHtml(
      String(v)
    )}</td></tr>`;
  });
  return `<div style="max-width:320px;font-size:12px;"><table style="border-collapse:collapse;width:100%;">${rows.join(
    ""
  )}</table></div>`;
};

function createSectorPolygonFeature(center, radiusKm, azimuth = 0, beamWidth = 65, step = 5) {
  const coords = [center];
  const start = azimuth - beamWidth / 2;
  const end = azimuth + beamWidth / 2;
  for (let angle = start; angle <= end + 0.0001; angle += step) {
    const dest = turf.destination(center, radiusKm, angle, { units: "kilometers" });
    coords.push(dest.geometry.coordinates);
  }
  coords.push(center);
  return turf.polygon([coords]);
}

function rangesObjectToArray(rangesObj) {
  if (!rangesObj) return [];
  const arr = Object.entries(rangesObj).map(([color, [min, max]]) => ({
    color,
    from: Number(min),
    to: Number(max),
  }));
  arr.sort((a, b) => a.from - b.from);
  return arr;
}

/* ---------------- Enrichment helpers ---------------- */
const enrichGeoJSON = (rawGeoJSON, cityLookup = {}, kpiList = []) => {
  if (!rawGeoJSON?.features?.length) return rawGeoJSON;
  return {
    ...rawGeoJSON,
    features: rawGeoJSON.features.map((f) => {
      const cell = f.properties?.Cell_name || f.properties?.cellname;
      const enrichedProps = {
        ...f.properties,
        city: cityLookup?.[cell] || f.properties?.city || "unknown",
      };
      kpiList.forEach((kpi) => {
        const rawValue = enrichedProps[kpi];
        enrichedProps[`__${kpi}`] =
          rawValue == null || rawValue === "" || isNaN(Number(rawValue)) ? NaN : Number(rawValue);
      });
      return { ...f, properties: enrichedProps };
    }),
  };
};

/* ---------------- Component ---------------- */
const MapRenderer = (props) => {
  console.log("🔧 MapRenderer(props) initialising", props);
  const {
    
    geojsonData,
    driveTestGeoJSON,
    highlightedFeature: externalHighlight,
    gridGeoJSON,
    colorColumn,
    gridMapGeoJSON,
    colorBands = [],
    onSiteClick,
    selectedDriveKPI,
    colorRanges = {},
    layerRange,
    gridData,
    driveLayerRange,
    layerColumn,
    selectedGridKPI,
    radiusScale = 1,
    selectedUniqueBands = [],
    filters,
    selectedColumnValues = [],
    cityLookup = {},
    tableType,
    sourceColumns = [],
    targetColumns = [],
    
  } = props || {};

  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const [mapStyle, setMapStyle] = useState("mapbox://styles/mapbox/outdoors-v12");
  const [hasZoomedToSectors, setHasZoomedToSectors] = useState(false);
  const [internalHighlight, setInternalHighlight] = useState(null);

  // UI state
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchHistory, setSearchHistory] = useState([]);
  const [showLegend, setShowLegend] = useState(false);
  const [legendType, setLegendType] = useState("kpi");
  const [selectedKPI, setSelectedKPI] = useState(null);
  const [threshold, setThreshold] = useState(17);

  // ruler
  const rulerGeoJSON = useRef({ type: "FeatureCollection", features: [] });
  const rulerLinestring = useRef({ type: "Feature", geometry: { type: "LineString", coordinates: [] } });
  const rulerActiveRef = useRef(false);
  const distanceRef = useRef(null);

    // ℹ️ site info sidebar
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [selectedSiteId, setSelectedSiteId] = useState(null);
  const [infoSource, setInfoSource] = useState({});
  const [infoTarget, setInfoTarget] = useState({});



  // pretty labels
  const labelize = (k) =>
    String(k)
      .replace(/\r?\n/g, " ")
      .replace(/_/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (m) => m.toUpperCase());

  // pick fields by a given allowlist; if allowlist is empty, return all props
const pickByList = (propsObj, list) => {
  if (!propsObj || typeof propsObj !== "object") return {};
  if (!Array.isArray(list) || list.length === 0) return { ...propsObj };

  // normalize both key sets (case + spaces)
  const normalize = (s) => String(s).replace(/\s+/g, "").trim().toLowerCase();
  const wantedNorms = list.map(normalize);
  const out = {};

  Object.entries(propsObj).forEach(([k, v]) => {
    const kNorm = normalize(k);
    if (wantedNorms.includes(kNorm)) {
      out[k] = v;
    }
  });
  return out;
};


  // merge properties from all features of a site (prefer non-empty)
const mergeProps = (feats) => {
  const out = {};
  feats.forEach((f) => {
    const p = f?.properties || {};
    Object.entries(p).forEach(([k, v]) => {
      const normKey = String(k).trim();
      if (out[normKey] == null || out[normKey] === "" || out[normKey] === "[NULL]") {
        out[normKey] = v;
      }
    });
  });
  return out;
};


  // build and show panel content for a site
  // 🔥 Final dynamic showSiteInfo — copies popup logic & fixes "stuck at L800"
const showSiteInfo = (siteId, rawPoints, clickedBand = null, clickedCell = null) => {
  if (!rawPoints?.features?.length) return;

  const normalize = (v) => String(v || "").trim().toUpperCase();

  // 🧠 Find the *exact* feature that matches site + band + cell (not merged)
  let matchedFeature = rawPoints.features.find((f) => {
    const p = f.properties || {};
    const id =
      p.site_id || p.Site_ID || p["SITE ID"] || p.siteid || p.SITE || p.site;
    const band = p.band || p.BAND || "";
    const cell =
      p.cellname || p.Cell_name || p.CELLNAME || p.Cell_Name || "";

    return (
      normalize(id) === normalize(siteId) &&
      (!clickedBand || normalize(band) === normalize(clickedBand)) &&
      (!clickedCell || normalize(cell) === normalize(clickedCell))
    );
  });

  // fallback: if not exact cell found, fall back to band or site-level feature
  if (!matchedFeature) {
    matchedFeature = rawPoints.features.find((f) => {
      const p = f.properties || {};
      const id =
        p.site_id || p.Site_ID || p["SITE ID"] || p.siteid || p.SITE || p.site;
      const band = p.band || p.BAND || "";
      return (
        normalize(id) === normalize(siteId) &&
        (!clickedBand || normalize(band) === normalize(clickedBand))
      );
    });
  }

  if (!matchedFeature) {
    console.warn("⚠️ No matching feature found for", { siteId, clickedBand, clickedCell });
    return;
  }

  const props = matchedFeature.properties || {};

  // ✅ Build clean dynamic source section
  const infoSrc = {
    Cellname:
      props.cellname || props.Cell_name || props.CELLNAME || clickedCell || "N/A",
    Lat: props.Lat || props.lat || props.latitude || "",
    Long: props.Long || props.long || props.longitude || "",
    Azimuth:
      props.azimuth ||
      props.Azimuth ||
      props.AZIMUTH ||
      props["Azimuth_degrees"] ||
      "",
    Site_Id:
      props.site_id ||
      props.Site_ID ||
      props["SITE ID"] ||
      props.site ||
      siteId,
    Band: props.band || props.BAND || props.Band || clickedBand || "N/A",
    City: props.city || props.City || props.CITY || props.Region || "N/A",
    Target_Key:
      props.Target_Key ||
      props.Target_key ||
      props.target_key ||
      props.Target ||
      "",
  };

  // ✅ Dynamically create KPI section (like popup)
  const excludeKeys = new Set(
    Object.keys(infoSrc).map((k) => k.toLowerCase())
  );
  const infoTgt = {};
  for (const [k, v] of Object.entries(props)) {
    const nk = k.toLowerCase();
    if (!excludeKeys.has(nk) && v != null && v !== "" && v !== "[NULaL]") {
      infoTgt[k] = v;
    }
  }

  // ✅ Update sidebar instantly
  setInfoSource(infoSrc);
  setInfoTarget(infoTgt);

  // ✅ Force sidebar to update even for same site clicked again
  setSelectedSiteId(`${siteId}_${Date.now()}`);

  // ✅ Auto-open panel if it’s not open
  setShowInfoPanel(true);

  console.log("📡 Site Info Updated:", {
    siteId,
    clickedBand,
    clickedCell,
    cell: infoSrc.Cellname,
    band: infoSrc.Band,
  });
};
// 🔁 Generation Overview trigger
const { selectedDB, selectedProject, availableProjects } = props;


// Cleanup & render logic
useEffect(() => {
  const map = mapInstance.current;
  if (!map) return;

  // When specific project selected → remove generation overview
  if (selectedProject) {
    ["generation-overview", "generation-labels"].forEach((id) => {
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    });
    console.log("🧹 Removed generation overview (project selected)");
    return;
  }

  // When DB selected and no project selected → render overview
  if (selectedDB && availableProjects.length > 0) {
    console.log("🌐 Auto rendering generation overview for DB:", selectedDB);
    renderGenerationOverview(availableProjects, selectedDB);
  }
}, [selectedDB, selectedProject, availableProjects]);


  // local selections
  const [selectedBandCells, setSelectedBandCells] = useState([]);
  const [bandColorMap, setBandColorMap] = useState({});
  const [availableGridKPIs, setAvailableGridKPIs] = useState([]);
  const infoPanelRef = useRef({ showInfoPanel, showSiteInfo });

  // Normalize selectedColumnValues (App passes as array of {column, values})
  const normalizedColumnFilters = Array.isArray(selectedColumnValues)
    ? selectedColumnValues
    : [];
useEffect(() => {
  infoPanelRef.current = { showInfoPanel, showSiteInfo };
}, [showInfoPanel, showSiteInfo]);

  /* ---------------- Map init ---------------- */
  useEffect(() => {
    if (mapInstance.current) return;

    console.log("🗺️ Initializing Mapbox map");
    const map = new mapboxgl.Map({
      container: mapRef.current,
      style: mapStyle,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });
    mapInstance.current = map;
    window._map = map;
    map.addControl(new mapboxgl.NavigationControl());
    window.mapRef = mapRef;

    map.on("load", () => {
      console.log("🗺️ Map load event fired - creating baseline sources/layers");
      if (!map.getSource("sectors")) map.addSource("sectors", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      if (!map.getSource("band-sectors")) map.addSource("band-sectors", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      if (!map.getSource("highlighted-feature")) map.addSource("highlighted-feature", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

      if (!map.getLayer("sector-layer")) {
        map.addLayer({
          id: "sector-layer",
          type: "fill",
          source: "sectors",
          paint: {
            "fill-color": "#cccccc",
            "fill-opacity": 0.6,
            "fill-outline-color": "#000000",
          },
        });
      }

      if (!map.getLayer("band-sectors")) {
        map.addLayer({
          id: "band-sectors",
          type: "fill",
          source: "band-sectors",
          paint: { "fill-color": ["get", "color"], "fill-opacity": 0.85 },
        });
      }

      if (!map.getLayer("highlighted-feature-layer")) {
        map.addLayer({
          id: "highlighted-feature-layer",
          type: "circle",
          source: "highlighted-feature",
          paint: {
            "circle-color": "rgba(255,0,0,0.4)",
            "circle-radius": 9,
            "circle-stroke-width": 2,
            "circle-stroke-color": "red",
          },
        });
      }

      // ruler
      if (!map.getSource("ruler-geojson")) map.addSource("ruler-geojson", { type: "geojson", data: rulerGeoJSON.current });
      if (!map.getLayer("measure-points")) {
        map.addLayer({
          id: "measure-points",
          type: "circle",
          source: "ruler-geojson",
          paint: { "circle-radius": 4, "circle-color": "#000" },
          filter: ["==", "$type", "Point"],
        });
      }
      if (!map.getLayer("measure-lines")) {
        map.addLayer({
          id: "measure-lines",
          type: "line",
          source: "ruler-geojson",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#000", "line-width": 2 },
          filter: ["==", "$type", "LineString"],
        });
      }

      console.log("✅ Baseline sources & layers ready");
    });

    map.on("click", (e) => {
      if (!rulerActiveRef.current) return;
      const coords = [e.lngLat.lng, e.lngLat.lat];
      rulerGeoJSON.current.features.push({ type: "Feature", geometry: { type: "Point", coordinates: coords } });
      rulerLinestring.current.geometry.coordinates.push(coords);
      const distance = turf.length(rulerLinestring.current);
      if (distanceRef.current) distanceRef.current.innerText = `📏 ${distance.toFixed(2)} km`;
      if (map.getSource("ruler-geojson")) {
        map.getSource("ruler-geojson").setData({ type: "FeatureCollection", features: [...rulerGeoJSON.current.features, rulerLinestring.current] });
      }
    });

    map.on("mousemove", (e) => {
      if (!rulerActiveRef.current) return;
      map.getCanvas().style.cursor = "crosshair";
    });

    return () => {
      try { map.remove(); } catch (e) { console.warn("map remove error", e); }
      mapInstance.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- Sector generator ---------------- */
/* ---------------- Sector generator (fixed — no deduplication) ---------------- */
/* ---------------- Sector generator (final alias-aware KPI match) ---------------- */
const generateSectorGeoJSON = (geojson, userScale = 1, colorColumnParam = null) => {
  if (!geojson || !Array.isArray(geojson.features)) {
    console.warn("⚠️ generateSectorGeoJSON: invalid input", geojson);
    return { type: "FeatureCollection", features: [] };
  }

  const featuresOut = [];
  const kpiHits = [];
  const kpiMisses = [];

  // Normalize key safely
  const normalizeKey = (k) =>
    String(k || "")
      .trim()
      .replace(/[%_\-\s/()]+/g, "")
      .toLowerCase();

  // Build alias cache (for case-insensitive matching)
  const aliasCache = new Map();
  if (geojson.features?.length) {
    const keys = new Set();
    geojson.features.slice(0, 300).forEach((f) => {
      Object.keys(f.properties || {}).forEach((k) => keys.add(k));
    });
    keys.forEach((k) => aliasCache.set(normalizeKey(k), k));
  }

  // Parse numeric safely
  const parseSmart = (v) => {
    if (v === null || v === undefined || v === "") return NaN;
    if (typeof v === "number") return v;
    const s = String(v).replace(/,/g, "").trim();
    const n = parseFloat(s);
    return isNaN(n) ? NaN : n;
  };

  for (const [i, f] of geojson.features.entries()) {
    try {
      const props = f.properties || {};

      // Flatten geometry
      let coords = f.geometry?.coordinates;
      if (Array.isArray(coords?.[0])) {
        coords = coords[0][0] && Array.isArray(coords[0][0]) ? coords[0][0] : coords[0];
      }
      if (!Array.isArray(coords) || coords.length < 2) continue;

      // Azimuth fallback
      let az = parseSmart(
        safeGet(props, ["azimuth", "Azimuth", "AZIMUTH", "Azimuth_degrees", "Azimuth "])
      );
      if (isNaN(az)) {
        const hash = Math.abs(
          String(props.site_id || props.Site_ID || "").split("").reduce((a, c) => a + c.charCodeAt(0), 0)
        );
        az = [0, 120, 240][hash % 3];
      }

      const bandRaw =
        safeGet(props, ["band", "BAND", "Band"]) || props.BAND || props.band;
      const band = normalizeBandName(bandRaw);
      const siteId =
        safeGet(props, ["site_id", "Site_ID", "SITE ID", "siteid", "SITE"]) || "unknown";
      const cellname =
        safeGet(props, ["cellname", "Cell_name", "CELLNAME"]) ||
        props.cellname ||
        props.Cell_name ||
        null;
      const city =
        safeGet(props, ["city", "City", "REGION"]) ||
        cityLookup[cellname] ||
        "unknown";

      const radiusKm = Math.max(0.01, Number(userScale) || 1);

      // 🎯 KPI lookup
      let colorValue = null;
      let colorValueRaw = null;
      let matchedKey = null;

      if (colorColumnParam) {
        const normTarget = normalizeKey(colorColumnParam);

        // find KPI key in properties
        for (const [normKey, origKey] of aliasCache.entries()) {
          if (normKey === normTarget || normKey.includes(normTarget) || normTarget.includes(normKey)) {
            matchedKey = origKey;
            colorValueRaw = props[origKey];
            break;
          }
        }

        const parsed = parseSmart(colorValueRaw);
        if (!isNaN(parsed)) {
          colorValue = parsed;
          kpiHits.push(parsed);
        } else {
          kpiMisses.push(i);
        }

        // 🔍 Log a few values for debugging
        if (i < 3) {
          console.log(
            `🧪 [${i}] KPI lookup for`,
            colorColumnParam,
            "matchedKey:",
            matchedKey,
            "raw:",
            colorValueRaw,
            "parsed:",
            colorValue
          );
        }
      }

      // Build polygon geometry
      const poly = createSectorPolygonFeature(coords, radiusKm, az, 60, 5);

      // Default color (transparent gray)
      let color = "rgba(120,120,120,0.25)";

      // 🎨 Apply KPI-based color if valid
      if (
        colorColumnParam &&
        colorRanges &&
        colorRanges[colorColumnParam] &&
        colorValue !== null &&
        !isNaN(colorValue)
      ) {
        const arr = rangesObjectToArray(colorRanges[colorColumnParam]);
        let matched = false;
        for (const r of arr) {
          if (colorValue >= Number(r.from) && colorValue <= Number(r.to)) {
            color = r.color;
            matched = true;
            break;
          }
        }
        if (!matched) {
          color = "rgba(120,120,120,0.25)"; // outside range → neutral gray
        }
      }

      // Add feature
      featuresOut.push({
        type: "Feature",
        geometry: poly.geometry,
        properties: {
          ...props,
          cellname,
          site_id: siteId,
          band,
          city,
          azimuth: az,
          color,
          radius_km: radiusKm,
          __colorValue: colorValue,
          __colorValueRaw: colorValueRaw,
          __matchedKey: matchedKey,
        },
      });
    } catch (e) {
      console.warn("❌ generateSectorGeoJSON failed:", e);
    }
  }

  console.groupCollapsed("🎨 generateSectorGeoJSON Debug");
  console.log("KPI column:", colorColumnParam);
  console.log("Alias keys:", [...aliasCache.values()]);
  console.log("Numeric hits:", kpiHits.length);
  console.log("Misses:", kpiMisses.length);
  console.log("Example value:", kpiHits[0]);
  console.groupEnd();

  return { type: "FeatureCollection", features: featuresOut };
};



// 🔵🟠🟢🟣 Generation Overview renderer
function renderGenerationOverview(projectList = [], selectedDB = null) {
  const map = window._map;
  if (!map) return;

  console.log("🌐 renderGenerationOverview:", { selectedDB, projectList });

  // cleanup existing overview
  ["generation-overview", "generation-labels"].forEach((id) => {
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  });

  if (!Array.isArray(projectList) || projectList.length === 0) {
    console.warn("No generation projects to render.");
    return;
  }

  // group sites per generation
  const features = [];
  projectList.forEach((p) => {
    const gen = (p.name || p.project || "")
      .toUpperCase()
      .match(/(2G|3G|4G|5G)/)?.[1];
    if (!gen) return;
    const lat = parseFloat(p.lat || p.latitude);
    const lon = parseFloat(p.lon || p.longitude);
    if (!isFinite(lat) || !isFinite(lon)) return;

    // one ring per site
    const center = [lon, lat];
    const color = GENERATION_COLORS[gen] || "#999";
    const outer = turf.circle(center, 0.8, { units: "kilometers", steps: 64 });
    const inner = turf.circle(center, 0.4, { units: "kilometers", steps: 64 });
    const outerCoords = outer.geometry.coordinates[0];
    const innerCoords = inner.geometry.coordinates[0].reverse();
    const ring = turf.polygon([[...outerCoords, ...innerCoords]]);
    ring.properties = { site: p.site_id || p.name, generation: gen, color };
    features.push(ring);
  });

  const fc = { type: "FeatureCollection", features };
  map.addSource("generation-overview", { type: "geojson", data: fc });

  map.addLayer({
    id: "generation-overview",
    type: "fill",
    source: "generation-overview",
    paint: {
      "fill-color": ["get", "color"],
      "fill-opacity": 0.55,
      "fill-outline-color": "#000",
    },
  });

  map.addLayer({
    id: "generation-labels",
    type: "symbol",
    source: "generation-overview",
    layout: {
      "text-field": ["get", "generation"],
      "text-size": 11,
      "text-offset": [0, 0.7],
    },
    paint: { "text-color": "#000" },
  });

  console.log(`✅ Rendered generation overview: ${features.length} sites`);
  if (features.length > 0) {
    const bbox = turf.bbox(fc);
    map.fitBounds(bbox, { padding: 40, maxZoom: 10, essential: true });
  }

  // show generation legend
  window.setLegendType && window.setLegendType("generation");
  window.setShowLegend && window.setShowLegend(true);
}

/* ---------------- Add sector layer (final alias-aware + generation-concentric) ---------------- */
/* ---------------- Add sector layer (final alias-aware + generation/band + CM Change & RCA + debug logs) ---------------- */
const addSectorLayer = ({
  map,
  rawPoints,
  selectedBandCells = [],
  bandColorMap = {},
  selectedUniqueBands = [],
  selectedColumnFilters = [],
  layerColumn = colorColumn,
  colorRangesObj = colorRanges,
  radiusKm = radiusScale,
  tableType = "",
  showInfoPanel,
  showSiteInfo,  
  onSiteClick,         
} = {}) => {
  if (!map) {
    console.warn("addSectorLayer called but map missing");
    return;
  }

  if (!rawPoints || !rawPoints.features) {
    console.warn("addSectorLayer: rawPoints missing/empty");
    ["sectors", "band-sectors", "site-rings", "sector-dividers"].forEach((src) => {
      if (map.getSource(src))
        map.getSource(src).setData({ type: "FeatureCollection", features: [] });
    });
    return;
  }

  console.group("🎨 addSectorLayer()");
  console.log("🧠 Props →", { rawPointsCount: rawPoints.features.length, tableType });
  console.log("🧪 Example props:", rawPoints.features[0]?.properties);

  // 1️⃣ Build base sector polygons (kept for bbox/props enrichment)
  const sectorGeo = generateSectorGeoJSON(rawPoints, radiusKm, layerColumn);
  console.log("📦 Generated polygons:", sectorGeo.features.length);

  // Helper: numeric band value (for ordering)
  const bandNum = (b) => {
    const n = Number(String(b || "").replace(/\D/g, ""));
    return Number.isFinite(n) ? n : -1;
  };

  // Geometry helper: ring-slice polygon (donut wedge)
  function createRingSlice(center, innerKm, outerKm, startDeg, endDeg, stepDeg = 3) {
    const outer = [];
    for (let a = startDeg; a <= endDeg + 1e-6; a += stepDeg) {
      const pt = turf.destination(center, outerKm, a, { units: "kilometers" }).geometry.coordinates;
      outer.push(pt);
    }
    const inner = [];
    for (let a = endDeg; a >= startDeg - 1e-6; a -= stepDeg) {
      const pt = turf.destination(center, innerKm, a, { units: "kilometers" }).geometry.coordinates;
      inner.push(pt);
    }
    const ring = [...outer, ...inner, outer[0]];
    return turf.polygon([ring]);
  }

  // 2️⃣ Build **band-ring, 3-slice** geometry per site (aligned 0°,120°,240°)
  const bandRingFeatures = [];
  let dividerLineFeatures = []; // thin black lines between stacked duplicates

  // group by site
  const bySite = {};
  for (const f of sectorGeo.features) {
    const p = f.properties || {};
    const site = String(p.site_id || p.Site_ID || p.site || "").trim();
    if (!bySite[site]) bySite[site] = [];
    bySite[site].push(f);
  }

  Object.entries(bySite).forEach(([site, feats]) => {
    if (!feats.length) return;

    // Site center = mean of centroids (stable for close points)
    const cents = feats.map((f) => turf.centroid(f).geometry.coordinates);
    const cx = cents.reduce((s, c) => s + c[0], 0) / cents.length;
    const cy = cents.reduce((s, c) => s + c[1], 0) / cents.length;
    const center = [cx, cy];

    // Bands present at site
    const bandsAtSite = Array.from(
      new Set(
        feats.map((f) => String(f.properties.band || "").toUpperCase().trim()).filter(Boolean)
      )
    );

    // Order: lowest band (e.g., 700/800/900) outermost → highest innermost
    const orderedBands = bandsAtSite.sort((a, b) => bandNum(a) - bandNum(b));

    // Outer radius for the outermost ring = radiusKm
    // Visible gap between rings: GAP = 10% of ring thickness
    const RING_THICKNESS = Math.max(0.02, radiusKm * 0.28);
    const GAP_RATIO = 0.10;
    const GAP = RING_THICKNESS * GAP_RATIO;

    // Three fixed slices per band (with 60° wedge and 60° empty gap)
    const SLICE_SPANS = [
      { start: 0, end: 60 },
      { start: 120, end: 180 },
      { start: 240, end: 300 },
    ];

    // Allocate site cells → band → slice (round-robin)
    const byBand = {};
    orderedBands.forEach((b) => (byBand[b] = [[], [], []])); // three bins per band

    feats.forEach((f) => {
      const b = String(f.properties.band || "").toUpperCase().trim();
      if (!byBand[b]) return;
      // round-robin into the 3 slices
      const idx = byBand[b].flat().length % 3;
      byBand[b][idx].push(f);
    });

    // Build rings from outer → inner
    let currentOuter = radiusKm;
    orderedBands.forEach((bandLabel) => {
      const outerR = currentOuter;
      const innerR = Math.max(0.005, outerR - RING_THICKNESS * (1 - GAP_RATIO)); // leave a gap to the next ring
      const color = getColorForBand(bandLabel, bandColorMap);

      SLICE_SPANS.forEach((span, sliceIdx) => {
        const sliceCells = byBand[bandLabel][sliceIdx] || [];
        if (sliceCells.length === 0) return;

        // If duplicates in the same slice → split the ring thickness equally into N sub-layers
        const n = Math.max(1, sliceCells.length);
        const subT = (outerR - innerR) / n;

        for (let j = 0; j < n; j++) {
          const subInner = innerR + j * subT;
          const subOuter = innerR + (j + 1) * subT;

          // make the wedge polygon
          const polyslice = createRingSlice(center, subInner, subOuter, span.start, span.end, 3);

          // collect details for popup
          const detailCells = [sliceCells[j]?.properties || {}];
          const cellList = detailCells
            .map((p) => p.Cell_name || p.cellname || p.sector || p.Antenna_Name || p.EUtranCell || "cell")
            .join(", ");

          bandRingFeatures.push({
            type: "Feature",
            geometry: polyslice.geometry,
            properties: {
              ...(sliceCells[j]?.properties || {}),
              site_id: site,
              band: bandLabel,
              color,
              ring_outer_km: Number(outerR.toFixed(5)),
              ring_inner_km: Number(innerR.toFixed(5)),
              slice_index: sliceIdx,
              slice_start_deg: span.start,
              slice_end_deg: span.end,
              slice_cells_count: 1,
              slice_cells: cellList,
            },
          });

          // divider line between sub-layers (except after the last one)
          if (j < n - 1) {
            const boundary = [];
            for (let a = span.start; a <= span.end + 1e-6; a += 3) {
              const pt = turf
                .destination(center, subInner + (j + 1) * subT, a, { units: "kilometers" })
                .geometry.coordinates;
              boundary.push(pt);
            }
            dividerLineFeatures.push({
              type: "Feature",
              geometry: { type: "LineString", coordinates: boundary },
              properties: { site_id: site, band: bandLabel },
            });
          }
        }
      });

      // next ring (move inward, leaving a visible gap)
      currentOuter = innerR - GAP;
    });
  });

  console.log(`✅ Built ${bandRingFeatures.length} ring-slice features with ${dividerLineFeatures.length} dividers`);

  // 👇 choose what to render (your existing fallbacks kept)
  let workFeatures =
    bandRingFeatures.length > 0
      ? bandRingFeatures
      : sectorGeo.features; // fallback to plain polygons if something goes wrong

  // 3️⃣ Band filter (unchanged)
  if (Array.isArray(selectedUniqueBands) && selectedUniqueBands.length > 0) {
    const bandSet = new Set(selectedUniqueBands.map((b) => String(b).toUpperCase().trim()));
    workFeatures = workFeatures.filter((f) =>
      bandSet.has(String(f.properties.band || "").toUpperCase().trim())
    );

    // 🔄 DYNAMIC RESCALE AFTER FILTER — keep only selected bands but expand them to fill full radius
    // Rebuild ring geometry per site using ONLY the visible bands in `workFeatures`
    if (bandRingFeatures.length > 0 && workFeatures.length > 0) {
      const SLICE_SPANS = [
        { start: 0, end: 60 },
        { start: 120, end: 180 },
        { start: 240, end: 300 },
      ];
      const GAP_RATIO = 0.10;

      // Group filtered features by site → band → slice
      const bySiteFiltered = {};
      workFeatures.forEach((f) => {
        const p = f.properties || {};
        const site = String(p.site_id || p.Site_ID || p.site || "").trim();
        const band = String(p.band || "").toUpperCase().trim();
        const slice = Number(p.slice_index ?? 0);
        if (!bySiteFiltered[site]) bySiteFiltered[site] = {};
        if (!bySiteFiltered[site][band]) bySiteFiltered[site][band] = [[], [], []];
        bySiteFiltered[site][band][slice].push(f);
      });

      const rebuilt = [];
      let rebuiltDividers = [];

      Object.entries(bySiteFiltered).forEach(([site, bandSlices]) => {
        // site center from current wedges (average of centroids)
        const allSiteFeats = Object.values(bandSlices).flatMap((arr) => arr.flat());
        const cents = allSiteFeats.map((f) => turf.centroid(f).geometry.coordinates);
        const cx = cents.reduce((s, c) => s + c[0], 0) / cents.length;
        const cy = cents.reduce((s, c) => s + c[1], 0) / cents.length;
        const center = [cx, cy];

        // order visible bands low→high frequency
        const orderedVisibleBands = Object.keys(bandSlices).sort((a, b) => bandNum(a) - bandNum(b));

        // even ring thickness across visible bands
        const ringCount = orderedVisibleBands.length;
        if (ringCount === 0) return;

        const effectiveThickness = radiusKm / ringCount;
        const gap = effectiveThickness * GAP_RATIO;

        let currentOuter = radiusKm;
        orderedVisibleBands.forEach((bandLabel) => {
          const outerR = currentOuter;
          const innerR = Math.max(0.005, outerR - (effectiveThickness - gap));
          const color = getColorForBand(bandLabel, bandColorMap);

          SLICE_SPANS.forEach((span, sliceIdx) => {
            const sliceFeats = bandSlices[bandLabel][sliceIdx] || [];
            if (sliceFeats.length === 0) return;

            const n = Math.max(1, sliceFeats.length);
            const subT = (outerR - innerR) / n;

            for (let j = 0; j < n; j++) {
              const subInner = innerR + j * subT;
              const subOuter = innerR + (j + 1) * subT;

              const wedge = createRingSlice(center, subInner, subOuter, span.start, span.end, 3);
              const props = sliceFeats[j].properties || {};
              rebuilt.push({
                type: "Feature",
                geometry: wedge.geometry,
                properties: {
                  ...props,
                  site_id: site,
                  band: bandLabel,
                  color,
                  ring_outer_km: Number(outerR.toFixed(5)),
                  ring_inner_km: Number(innerR.toFixed(5)),
                  slice_index: sliceIdx,
                  slice_start_deg: span.start,
                  slice_end_deg: span.end,
                  slice_cells_count: 1,
                },
              });

              if (j < n - 1) {
                const boundary = [];
                for (let a = span.start; a <= span.end + 1e-6; a += 3) {
                  const pt = turf
                    .destination(center, subInner + (j + 1) * subT, a, { units: "kilometers" })
                    .geometry.coordinates;
                  boundary.push(pt);
                }
                rebuiltDividers.push({
                  type: "Feature",
                  geometry: { type: "LineString", coordinates: boundary },
                  properties: { site_id: site, band: bandLabel },
                });
              }
            }
          });

          currentOuter = innerR - gap;
        });
      });

      if (rebuilt.length > 0) {
        workFeatures = rebuilt;
        dividerLineFeatures = rebuiltDividers; // update divider set to match rescaled rings
        console.log(`🔁 Rescaled after filter → ${workFeatures.length} wedges, ${dividerLineFeatures.length} dividers`);
      }
    }
  }

  // 4️⃣ Region/city filters (unchanged)
  if (Array.isArray(selectedColumnFilters) && selectedColumnFilters.length > 0) {
    const aliasMap = {
      region: ["city", "City", "CITY", "Region", "REGION", "region_name"],
      city: ["city", "City", "CITY", "Region", "REGION", "region_name"],
    };

    workFeatures = workFeatures.filter((f) => {
      const props = f.properties || {};
      return selectedColumnFilters.every(({ column, values }) => {
        if (!column || !Array.isArray(values) || values.length === 0) return true;
        const colNorm = column.toLowerCase().trim();
        const aliases = aliasMap[colNorm] || [column];
        const valNorms = values.map((v) => String(v).trim().toLowerCase());
        let matchKey = Object.keys(props).find((k) =>
          aliases.some((alias) => k.toLowerCase().includes(alias.toLowerCase()))
        );
        if (!matchKey)
          matchKey = Object.keys(props).find(
            (k) => k.toLowerCase().trim() === colNorm
          );
        if (!matchKey) return true;
        const propVal = String(props[matchKey] || "").trim().toLowerCase();
        return valNorms.some((val) => propVal === val || propVal.includes(val));
      });
    });
  }

  // 5️⃣ Push to map sources
  const sectorGeoJSON = { type: "FeatureCollection", features: workFeatures };
  if (map.getSource("sectors")) map.getSource("sectors").setData(sectorGeoJSON);
  else map.addSource("sectors", { type: "geojson", data: sectorGeoJSON });

  // divider source
  const dividerJSON = { type: "FeatureCollection", features: dividerLineFeatures };
  if (map.getSource("sector-dividers")) map.getSource("sector-dividers").setData(dividerJSON);
  else map.addSource("sector-dividers", { type: "geojson", data: dividerJSON });

  // 6️⃣ Color logic
  const ISSUE_COLORS = [
    "#22c55e", "#eab308", "#3b82f6", "#ef4444", "#f97316", "#8b5cf6",
    "#14b8a6", "#a855f7", "#ec4899", "#f59e0b", "#6366f1", "#84cc16",
    "#10b981", "#0ea5e9", "#9333ea", "#fb923c", "#c026d3", "#64748b",
    "#1d4ed8", "#f87171"
  ];
  const issueColorMap = {};
  const getColorForIssue = (issue) => {
    if (!issue || issue === "[NULL]") return "#9ca3af";
    if (!issueColorMap[issue]) {
      const idx = Object.keys(issueColorMap).length % ISSUE_COLORS.length;
      issueColorMap[issue] = ISSUE_COLORS[idx];
    }
    return issueColorMap[issue];
  };

  let fillColorExpr = ["get", "color"];

  /* ---------------- CM CHANGE MODE (TOTAL_SCORE auto-buckets) ---------------- */
  let popupHTML = ""; 
  if ((tableType || "").toLowerCase().includes("cm change")) {
     const score =
    props.TOTAL_SCORE ??
    props.total_score ??
    props["Total_Score"] ??
    props.avg_total_score ??
    props.AVG_TOTAL_SCORE ??
    props["Avg_Total_Score"] ??
    "N/A";
    const color = props.total_score_color || props.color || "#9ca3af";
     popupHTML =
    `<div style="display:flex;align-items:center;margin-bottom:6px;">
      <div style="width:14px;height:14px;border-radius:2px;background:${escapeHtml(color)};
                  margin-right:6px;flex-shrink:0;"></div>
      <strong>Total Score: ${escapeHtml(String(score))}</strong>
     </div>` + popupHTML;
     
    // Normalize variants for TOTAL_SCORE
    const totalKeyCandidates = ["TOTAL_SCORE", "total_score", "Total_Score", "Total Score","avg_total_score","Avg_Total_Score","AVG_TOTAL_SCORE",];
    const normalize = (s) => String(s).replace(/\s+/g, "").toLowerCase();

    const getTotalFromProps = (p = {}) => {
      for (const k of Object.keys(p)) {
        if (totalKeyCandidates.some((tk) => normalize(tk) === normalize(k))) {
          const val = Number(String(p[k]).toString().replace(/,/g, "").trim());
          return Number.isFinite(val) ? val : null;
        }
      }
      return null;
    };

    // Collect numeric scores
    const scores = workFeatures
      .map((f) => getTotalFromProps(f.properties))
      .filter((v) => v !== null);

    if (scores.length === 0) {
      console.warn("CM Change: No numeric TOTAL_SCORE found. Falling back to grey.");
      fillColorExpr = "#9ca3af";
    } else {
      const minScore = Math.min(...scores);
      const maxScore = Math.max(...scores);
      console.log(`📊 CM Change TOTAL_SCORE range: ${minScore} → ${maxScore}`);

      // Build 5 equal buckets
      const buckets = 5;
      const step = (maxScore - minScore) / (buckets || 1);
      const cmPalette = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#16a34a"]; // red → green

      const colorBands = [];
      for (let i = 0; i < buckets; i++) {
        const from = minScore + i * step;
        const to = i === buckets - 1 ? maxScore : from + step;
        colorBands.push({ from, to, color: cmPalette[i] });
      }

      // Attach normalized score + color to properties (also override "color" used by default)
      workFeatures = workFeatures.map((f) => {
        const total = getTotalFromProps(f.properties);
        let color = "#9ca3af";
        if (total !== null) {
          const band = colorBands.find((r) => total >= r.from && total <= r.to);
          color = band ? band.color : "#9ca3af";
        }
        return {
          ...f,
          properties: {
            ...f.properties,
            total_score_norm: total,
            total_score_color: color,
            color,
          },
        };
      });
      // ✅ Force-update source with normalized scores BEFORE setting fill expression
       const cmGeoJSON = { type: "FeatureCollection", features: workFeatures };
       if (map.getSource("sectors")) map.getSource("sectors").setData(cmGeoJSON);
       else map.addSource("sectors", { type: "geojson", data: cmGeoJSON });


      // Build Mapbox expression based on total_score_norm
      fillColorExpr = ["case"];
      colorBands.forEach(({ from, to, color }) => {
        fillColorExpr.push(
          ["all",
            [">=", ["to-number", ["get", "total_score_norm"]], from],
            ["<=", ["to-number", ["get", "total_score_norm"]], to]
          ],
          color
        );
      });
      fillColorExpr.push("#9ca3af");

      // Update source with colored features
      
      if (map.getSource("sectors")) map.getSource("sectors").setData(cmGeoJSON);
      else map.addSource("sectors", { type: "geojson", data: cmGeoJSON });

      // Expose for legend
      window.cmColorBands = colorBands.map(({ from, to, color }) => ({
        from,
        to,
        color,
      }));
      console.log("✅ CM Change color bands:", window.cmColorBands);
    }

  /* ---------------- RCA MODE ---------------- */
  } else if ((tableType || "").toLowerCase().includes("rca")) {
    console.log("🎨 RCA mode activated");

    const issueKeys = [
      "Issue/Analysis Bucket new",
      "issue/analysis bucket new",
      "issue_bucket",
      "Issue_Bucket"
    ];

    // helper to extract issue bucket safely
    const getIssue = (p) =>
      issueKeys.reduce((v, k) => (v != null ? v : p?.[k]), null) ?? "[NULL]";

    const uniqueIssues = [...new Set(workFeatures.map((f) => getIssue(f.properties)))];

    // 🧩 Create color map dynamically for RCA issues
    const palette = [
      "#ef4444","#22c55e","#3b82f6","#f59e0b","#8b5cf6","#14b8a6","#ec4899",
      "#84cc16","#06b6d4","#f97316","#0ea5e9","#a855f7","#e11d48","#65a30d",
      "#7c3aed","#0d9488","#ca8a04","#2563eb","#fb923c","#6366f1"
    ];

    const rcaColorMapLocal = {};
    uniqueIssues.forEach((issue, idx) => {
      rcaColorMapLocal[issue] = palette[idx % palette.length];
    });

    // 🧠 Attach color to each feature
    workFeatures = workFeatures.map((f) => ({
      ...f,
      properties: {
        ...f.properties,
        issue_bucket_color: rcaColorMapLocal[getIssue(f.properties)] || "#9ca3af",
      },
    }));

    // 🎨 Construct final fill expression for Mapbox
    fillColorExpr = [
      "match",
      ["coalesce",
        ["get", "Issue/Analysis Bucket new"],
        ["get", "issue/analysis bucket new"],
        ["get", "issue_bucket"],
        ["get", "Issue_Bucket"]
      ],
    ];

    uniqueIssues.forEach((issue) => {
      fillColorExpr.push(issue, rcaColorMapLocal[issue]);
    });
    fillColorExpr.push("#9ca3af");

    // 🧩 Update GeoJSON source after RCA recoloring
    const rcaGeoJSON = { type: "FeatureCollection", features: workFeatures };
    if (map.getSource("sectors")) {
      map.getSource("sectors").setData(rcaGeoJSON);
    } else {
      map.addSource("sectors", { type: "geojson", data: rcaGeoJSON });
    }

    console.log("✅ RCA color map:", rcaColorMapLocal);
    console.log("🎨 RCA unique issues:", uniqueIssues);
    // 🧩 Expose RCA color map globally for legend rendering
    window.rcaColorMap = rcaColorMapLocal;
    window.rcaUniqueIssues = uniqueIssues;

  /* ---------------- KPI MODE (auto numeric diverging red→blue→green) ---------------- */
} else if (layerColumn) {
  console.log("🎨 KPI mode active for column:", layerColumn);

  // Collect all numeric values for this KPI
  const values = workFeatures
    .map((f) => parseFloat(f.properties?.[layerColumn]))
    .filter((v) => !isNaN(v));

  if (values.length === 0) {
    console.warn("⚠️ No numeric values found for KPI:", layerColumn);
    fillColorExpr = "#cccccc";
  } else {
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const midVal = 0; // center at zero

    console.log(`📊 KPI numeric range → min=${minVal}, mid=0, max=${maxVal}`);

    // Build smooth diverging color expression
    fillColorExpr = [
      "interpolate",
      ["linear"],
      ["to-number", ["get", layerColumn]],
      minVal, "#b91c1c",   // dark red (worst)
      minVal / 2, "#f87171", // lighter red
      midVal, "#93c5fd",     // near 0 = light blue
      maxVal / 2, "#22c55e", // greenish
      maxVal, "#14532d"      // dark green (best)
    ];

    // Apply this to all features for debugging
    workFeatures = workFeatures.map((f) => {
      const val = parseFloat(f.properties?.[layerColumn]);
      return {
        ...f,
        properties: { ...f.properties, __numericKPI: val },
      };
    });

    const kpiGeoJSON = { type: "FeatureCollection", features: workFeatures };
    if (map.getSource("sectors")) map.getSource("sectors").setData(kpiGeoJSON);
    else map.addSource("sectors", { type: "geojson", data: kpiGeoJSON });
  }
}

  // 7️⃣ Add/update layers
  if (!map.getLayer("sector-layer")) {
    map.addLayer({
      id: "sector-layer",
      type: "fill",
      source: "sectors",
      paint: {
        "fill-color": fillColorExpr,
        "fill-opacity": 0.6,
        "fill-outline-color": "#000000",
      },
    });
  } else {
    try {
      map.setPaintProperty("sector-layer", "fill-color", fillColorExpr);
    } catch (e) {
      console.warn("Recreating sector-layer:", e);
      if (map.getLayer("sector-layer")) map.removeLayer("sector-layer");
      map.addLayer({
        id: "sector-layer",
        type: "fill",
        source: "sectors",
        paint: {
          "fill-color": fillColorExpr,
          "fill-opacity": 0.6,
          "fill-outline-color": "#000000",
        },
      });
    }
  }

  // Divider line layer (thin black)
  if (!map.getLayer("sector-dividers")) {
    map.addLayer({
      id: "sector-dividers",
      type: "line",
      source: "sector-dividers",
      paint: {
        "line-color": "#000000",
        "line-width": 0.8,
        "line-opacity": 0.9,
      },
    });
  }

  // 8️⃣ Site click → either popup or info sidebar
  map.off("click", "sector-layer");
  map.on("click", "sector-layer", (e) => {
    if (!e.features || !e.features.length) return;
    const feat = e.features[0];
    const props = feat.properties || {};
    const siteId = props.site_id || props.Site_ID || props.siteid || props.site;

    // if info panel is open, update it instead of showing popup
    const { showInfoPanel: panelOpen, showSiteInfo: showFn } = infoPanelRef.current || {};

    if (panelOpen && typeof showFn === "function") {
      const clickedBand = props.band || props.BAND || null;
      const clickedCell =
        props.Cell_name || props.cellname || props.CELLNAME || null;
      showFn(siteId, rawPoints, clickedBand, clickedCell);

    } else {
      // existing popup flow
      let popupHTML = createPopupHtml({
        ...props,
        Slice_Cells: props.slice_cells || "",
        Slice_Cells_Count: props.slice_cells_count || 0,
      });

      // RCA: prepend issue
      if ((tableType || "").toLowerCase().includes("rca")) {
        const issue =
          props["Issue/Analysis Bucket new"] ??
          props["issue/analysis bucket new"] ??
          props["issue_bucket"] ??
          props["Issue_Bucket"];
        if (issue) {
          popupHTML =
            `<div style="font-weight:600;margin-bottom:4px;">Issue: ${escapeHtml(issue)}</div>` +
            popupHTML;
        }
      }

      // CM Change: prepend total score with color chip
      if ((tableType || "").toLowerCase().includes("cm change")) {
        const score = props.TOTAL_SCORE ?? props.total_score ?? props["Total_Score"] ?? "N/A";
        const color = props.total_score_color || props.color || "#9ca3af";
        popupHTML =
          `<div style="display:flex;align-items:center;margin-bottom:6px;">
            <div style="width:14px;height:14px;border-radius:2px;background:${escapeHtml(color)};
                        margin-right:6px;flex-shrink:0;"></div>
            <strong>Total Score: ${escapeHtml(String(score))}</strong>
           </div>` + popupHTML;
      }
        // ✅ Expose to legend
  // window.cmColorBands = colorBands.map(({ from, to, color }) => ({ from, to, color }));
  // console.log("✅ CM Change color bands:", window.cmColorBands);

  // ✅ Trigger legend update
  if (typeof window.setLegendType === "function") window.setLegendType("cmchange");
  if (typeof window.setShowLegend === "function") window.setShowLegend(true);


      if (window.currentPopup) window.currentPopup.remove();
      window.currentPopup = new mapboxgl.Popup({ offset: 12 })
        .setLngLat(e.lngLat)
        .setHTML(popupHTML)
        .addTo(map);
    }

    // keep your external callback too
    if (typeof onSiteClick === "function") {
      const siteFeatures = (rawPoints?.features || []).filter((f) => {
        const p = f.properties || {};
        return (
          String(p.site_id || p.Site_ID || p.siteid || p.site || "").toLowerCase() ===
          String(siteId || "").toLowerCase()
        );
      });
      onSiteClick(siteId, siteFeatures);
    }
  });

  console.log("🏁 addSectorLayer finished", {
    tableType,
    finalFeatures: workFeatures.length,
  });
  console.groupEnd();
};







  /* ---------------- Drive Test layer (fixed version) ---------------- */
const addDriveTestLayer = () => {
  const map = mapInstance.current;
  if (
    !map ||
    !driveTestGeoJSON ||
    !driveTestGeoJSON.features ||
    driveTestGeoJSON.features.length === 0
  ) {
    console.log(
      "addDriveTestLayer: no drive test geojson -> clearing drive-test source if present"
    );
    if (map && map.getSource && map.getSource("drive-test")) {
      try {
        map.getSource("drive-test").setData({
          type: "FeatureCollection",
          features: [],
        });
      } catch (e) {}
    }
    return;
  }

  console.log(
    "addDriveTestLayer: adding drive test data",
    driveTestGeoJSON.features.length
  );

  // Add or update GeoJSON source
  if (map.getSource("drive-test"))
    map.getSource("drive-test").setData(driveTestGeoJSON);
  else map.addSource("drive-test", { type: "geojson", data: driveTestGeoJSON });

  // Remove old layer if exists
  if (map.getLayer("driveTest-points")) map.removeLayer("driveTest-points");

  // ✅ Build color expression safely
  let colorExpression = ["case"];
  if (selectedDriveKPI && colorRanges && colorRanges[selectedDriveKPI]) {
    Object.entries(colorRanges[selectedDriveKPI]).forEach(
      ([color, [min, max]]) => {
        colorExpression.push(
          ["all",
            [">=", ["to-number", ["get", selectedDriveKPI]], min],
            ["<=", ["to-number", ["get", selectedDriveKPI]], max]
          ],
          color
        );
      }
    );

    // ✅ Add fallback color (last argument)
    colorExpression.push("#cccccc");
  } else {
    colorExpression = "gray"; // default fallback if no KPI selected
  }

  // 🗺️ Add drive test layer
  map.addLayer({
    id: "driveTest-points",
    type: "circle",
    source: "drive-test",
    paint: {
      "circle-radius": 4,
      "circle-color": colorExpression,
    },
  });

  // 🧭 Hover popup
  const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false });
  map.off("mousemove", "driveTest-points");
  map.off("mouseleave", "driveTest-points");

  map.on("mousemove", "driveTest-points", (e) => {
    if (!e.features?.length) return;
    const feat = e.features[0];
    const value = feat.properties[selectedDriveKPI];
    if (value == null) return;

    let rangeLabel = "Uncategorized",
      bandColor = "#999999";

    if (colorRanges[selectedDriveKPI]) {
      for (const [color, [min, max]] of Object.entries(
        colorRanges[selectedDriveKPI]
      )) {
        if (value >= min && value <= max) {
          rangeLabel = `${min} → ${max}`;
          bandColor = color;
          break;
        }
      }
    }

    popup
      .setLngLat(e.lngLat)
      .setHTML(
        `<div style="font-size:12px">
           <strong>${selectedDriveKPI}</strong>: ${value}<br/>
           <span style="color:${bandColor}">Range: ${rangeLabel}</span>
         </div>`
      )
      .addTo(map);
  });

  map.on("mouseleave", "driveTest-points", () => popup.remove());
};


  /* ---------------- Grid map layer ---------------- */
  const addGridMapLayer = (kpi, ranges) => {
    const map = mapInstance.current;
    if (!map) return;
    if (!gridMapGeoJSON || !gridMapGeoJSON.features || gridMapGeoJSON.features.length === 0) {
      console.warn("addGridMapLayer: gridMapGeoJSON missing or empty");
      return;
    }
    if (!kpi || !ranges || Object.keys(ranges).length === 0) {
      console.warn("addGridMapLayer: missing kpi or ranges");
      return;
    }

    console.log("addGridMapLayer()", { kpi, ranges });
    const pointGeoJSON = {
      type: "FeatureCollection",
      features: gridMapGeoJSON.features.map((f) => {
        const raw = f.properties[kpi];
        const value = raw === null || raw === undefined || raw === "" || isNaN(Number(raw)) ? NaN : Number(raw);
        return { type: "Feature", geometry: f.geometry, properties: { ...f.properties, __numericValue: value } };
      }),
    };

    ["gridMap-points", "gridMap-heatmap"].forEach((layerId) => {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
    });
    if (map.getSource("grid-map")) map.removeSource("grid-map");

    map.addSource("grid-map", { type: "geojson", data: pointGeoJSON });

    try {
      const bounds = turf.bbox(pointGeoJSON);
      map.fitBounds(bounds, { padding: 50, maxZoom: 12 });
    } catch (e) { console.warn("fitBounds grid", e); }

    const circleColorExpr = ["interpolate", ["linear"], ["to-number", ["get", "__numericValue"]]];
    Object.entries(ranges).forEach(([color, [min, max]]) => {
      circleColorExpr.push(min, color);
      circleColorExpr.push(max, color);
    });

    map.addLayer({
      id: "gridMap-points",
      type: "circle",
      source: "grid-map",
      paint: {
        "circle-radius": 4,
        "circle-color": circleColorExpr,
      },
    });

    map.addLayer({
      id: "gridMap-heatmap",
      type: "heatmap",
      source: "grid-map",
      paint: {
        "heatmap-weight": ["interpolate", ["linear"], ["to-number", ["get", "__numericValue"]], Object.values(ranges)[0][0], 0, Object.values(ranges)[Object.values(ranges).length - 1][1], 1],
        "heatmap-intensity": 1,
        "heatmap-radius": 15,
        "heatmap-opacity": 0.8,
      },
    });

    const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false });
    map.off("mousemove", "gridMap-points");
    map.off("mouseleave", "gridMap-points");
    map.on("mousemove", "gridMap-points", (e) => {
      if (!e.features?.length) return;
      const feature = e.features[0];
      const value = feature.properties[kpi];
      if (value == null) return;
      popup.setLngLat(e.lngLat).setHTML(`<div style="font-size:12px"><strong>${kpi}</strong>: ${value}</div>`).addTo(map);
    });
    map.on("mouseleave", "gridMap-points", () => popup.remove());
  };

  /* ---------------- Effects: respond to props ---------------- */
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    if (!geojsonData || !Array.isArray(geojsonData.features) || geojsonData.features.length === 0) {
      if (map.getSource && map.getSource("sectors")) map.getSource("sectors").setData({ type: "FeatureCollection", features: [] });
      return;
    }

    try {
      addSectorLayer({
        map,
        rawPoints: geojsonData,
        selectedBandCells,
        bandColorMap,
        selectedUniqueBands,
        selectedColumnFilters: normalizedColumnFilters,
        layerColumn: layerColumn || colorColumn,
        colorRangesObj: colorRanges,
        radiusKm: radiusScale,
        tableType,
        showSiteInfo,
        onSiteClick,

      });
    } catch (e) {
      console.error("Error in addSectorLayer call", e);
    }

    try {
      const sectorGeo = generateSectorGeoJSON(geojsonData, radiusScale, layerColumn || colorColumn);
      const valid = sectorGeo.features.filter((f) => f.properties && f.properties.color);
      if (valid.length > 0 && !hasZoomedToSectors && map) {
        const bbox = turf.bbox({ type: "FeatureCollection", features: valid });
        map.fitBounds(bbox, { padding: 40, maxZoom: 15, essential: true });
        setHasZoomedToSectors(true);
        console.log("Auto-fit bounds to sectors");
      }
    } catch (e) {
      console.warn("Auto-zoom error", e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geojsonData, colorColumn, JSON.stringify(colorRanges), radiusScale, JSON.stringify(selectedUniqueBands), JSON.stringify(selectedColumnValues)]);

  useEffect(() => {
    if (!mapInstance.current) return;
    if (!driveTestGeoJSON) {
      try { if (mapInstance.current.getSource("drive-test")) mapInstance.current.getSource("drive-test").setData({ type: "FeatureCollection", features: [] }); } catch (e) {}
      return;
    }
    addDriveTestLayer();
  }, [driveTestGeoJSON, selectedDriveKPI, JSON.stringify(colorRanges)]);

    useEffect(() => {
    if (!showInfoPanel || !selectedSiteId) return;
    try {
      showSiteInfo(selectedSiteId, geojsonData);
    } catch (e) {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInfoPanel, selectedSiteId, geojsonData]);


  useEffect(() => {
    if (!mapInstance.current) return;
    if (!gridMapGeoJSON) return;
    if (!selectedGridKPI) return;
    const ranges = colorRanges?.[selectedGridKPI];
    if (!ranges) return;
    addGridMapLayer(selectedGridKPI, ranges);
  }, [gridMapGeoJSON, selectedGridKPI, JSON.stringify(colorRanges)]);

  useEffect(() => {
    const map = mapInstance.current;
    const hf = externalHighlight || internalHighlight;
    if (!map) return;
    if (!hf) {
      if (map.getSource("highlighted-feature")) map.getSource("highlighted-feature").setData({ type: "FeatureCollection", features: [] });
      return;
    }
    const coll = hf.type === "FeatureCollection" ? hf : { type: "FeatureCollection", features: [hf] };
    if (map.getSource("highlighted-feature")) map.getSource("highlighted-feature").setData(coll);
    else map.addSource("highlighted-feature", { type: "geojson", data: coll });
    try {
      const coords = coll.features[0]?.geometry?.coordinates;
      if (coords && coords.length >= 2) map.flyTo({ center: coords, zoom: 15, essential: true });
    } catch (e) {}
  }, [externalHighlight, internalHighlight]);

  // Global applyBandFilter hook for debugging / external calls
  useEffect(() => {
    window.applyBandFilter = (bands) => {
      try {
        const map = mapInstance.current;
        if (!map || !geojsonData) return;
        addSectorLayer({
          map,
          rawPoints: geojsonData,
          selectedBandCells,
          bandColorMap,
          selectedUniqueBands: bands || selectedUniqueBands,
          selectedColumnFilters: normalizedColumnFilters,
          layerColumn: layerColumn || colorColumn,
          colorRangesObj: colorRanges,
          radiusKm: radiusScale,
          tableType,  
        });
      } catch (e) {
        console.error("applyBandFilter error", e);
      }
    };
    return () => { try { delete window.applyBandFilter; } catch (e) {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geojsonData, selectedUniqueBands, JSON.stringify(selectedColumnValues), JSON.stringify(colorRanges)]);

  useEffect(() => {
    if (!mapInstance.current) return;
    const map = mapInstance.current;
    map.once("style.load", () => {
      console.log("style.load - re-applying layers");
      if (geojsonData) {
        addSectorLayer({ map, rawPoints: geojsonData, layerColumn: layerColumn || colorColumn, colorRangesObj: colorRanges, radiusKm: radiusScale, tableType });
      }
      if (driveTestGeoJSON) addDriveTestLayer();
      if (gridMapGeoJSON && selectedGridKPI) {
        const ranges = colorRanges?.[selectedGridKPI];
        if (ranges) addGridMapLayer(selectedGridKPI, ranges);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapStyle]);

  /* ---------------- UI helpers ---------------- */
  const toggleStyle = () => {
    const newStyle = mapStyle.includes("satellite") ? "mapbox://styles/mapbox/outdoors-v12" : "mapbox://styles/mapbox/satellite-streets-v12";
    setMapStyle(newStyle);
    if (mapInstance.current) {
      const center = mapInstance.current.getCenter();
      const zoom = mapInstance.current.getZoom();
      mapInstance.current.setStyle(newStyle);
      mapInstance.current.once("style.load", () => {
        mapInstance.current.setCenter(center);
        mapInstance.current.setZoom(zoom);
      });
    }
  };

  const toggleLightStyle = () => {
    const newStyle = mapStyle === "mapbox://styles/mapbox/light-v10" ? "mapbox://styles/mapbox/outdoors-v12" : "mapbox://styles/mapbox/light-v10";
    setMapStyle(newStyle);
    if (mapInstance.current) {
      const center = mapInstance.current.getCenter();
      const zoom = mapInstance.current.getZoom();
      mapInstance.current.setStyle(newStyle);
      mapInstance.current.once("style.load", () => {
        mapInstance.current.setCenter(center);
        mapInstance.current.setZoom(zoom);
      });
    }
  };

  const handleSearch = (e) => {
    e && e.preventDefault && e.preventDefault();
    if (!geojsonData || !geojsonData.features) return;
    const term = searchTerm.trim().toLowerCase();
    if (!term) {
      setSearchResults([]);
      setInternalHighlight(null);
      setSearchHistory([]);
      return;
    }
    const results = geojsonData.features.filter((f) => {
      const props = f.properties || {};
      return (
        (props.Site_ID && String(props.Site_ID).toLowerCase().includes(term)) ||
        (props.Cell_name && String(props.Cell_name).toLowerCase().includes(term)) ||
        Object.values(props).some((v) => v && v.toString && v.toString().toLowerCase().includes(term))
      );
    });
    setSearchResults(results);
    if (results.length > 0) {
      setInternalHighlight(results[0]);
      setSearchHistory((prev) => [...prev, results[0]]);
    } else {
      setInternalHighlight(null);
    }
  };

  const handleUndoSearch = () => {
    setSearchHistory((prev) => {
      if (prev.length === 0) return prev;
      const newHistory = prev.slice(0, -1);
      const previousFeature = newHistory.length > 0 ? newHistory[newHistory.length - 1] : null;
      setInternalHighlight(previousFeature);
      return newHistory;
    });
  };

  

  /* ---------------- Render legend UI ---------------- */
  const KPI_OPTIONS = [
    { value: "SINR", label: "SINR" },
    { value: "RSRP", label: "RSRP" },
    { value: "Complaints", label: "Complaints" },
  ];

  const BAND_OPTIONS = [
    { value: "1800", label: "1800 MHz" },
    { value: "900", label: "900 MHz" },
    { value: "2100", label: "2100 MHz" },
    { value: "2300", label: "2300 MHz" },
  ];

  const renderLegend = () => {
    if (gridGeoJSON && gridGeoJSON.features?.length > 0) {
      return (
        <>
          <div className="legend-title">Grid KPI (SINR)</div>
          <div className="legend-item">
            <span className="legend-color" style={{ backgroundColor: "#fee08b" }}></span>
            SINR ≥ {threshold} (Yellow, Threshold)
          </div>
          <div className="legend-item">
            <span className="legend-color" style={{ backgroundColor: "#d73027" }}></span>
            SINR &lt; {threshold} (Red, Problematic)
          </div>
          <div className="legend-item">
            <span className="legend-color" style={{ backgroundColor: "#1a9850" }}></span>
            SINR &gt; 30 (Green, Good)
          </div>
        </>
      );
    }

    switch (legendType) {

      case "generation":
  return (
    <>
      <div className="legend-title">Generation Colors</div>
      <div className="legend-item">
        <span className="legend-color" style={{ backgroundColor: "#3B82F6" }}></span>2G (Blue)
      </div>
      <div className="legend-item">
        <span className="legend-color" style={{ backgroundColor: "#10B981" }}></span>3G (Green)
      </div>
      <div className="legend-item">
        <span className="legend-color" style={{ backgroundColor: "#f82606ff" }}></span>4G (Red)
      </div>
      <div className="legend-item">
        <span className="legend-color" style={{ backgroundColor: "#14c8f1ff" }}></span>5G (Cyan)
      </div>
    </>
  );

      case "kpi":
        return (
          <>
            <div className="legend-title">{`Selected KPI`} Color Ranges</div>
            <div className="legend-item">
              <span className="legend-color" style={{ backgroundColor: "#1a9850" }}></span>
              High Value
            </div>
            <div className="legend-item">
              <span className="legend-color" style={{ backgroundColor: "#fee08b" }}></span>
              Moderate Value
            </div>
            <div className="legend-item">
              <span className="legend-color" style={{ backgroundColor: "#d73027" }}></span>
              Low Value
            </div>
          </>
        );
      case "band":
        return (
          <>
            <div className="legend-title">Band Colors</div>
            {BAND_OPTIONS.map(({ value, label }) => (
              <div className="legend-item" key={value}>
                <span className="legend-color" style={{ backgroundColor: getColorForBand(value) }}></span>
                {label}
              </div>
            ))}
          </>
        );
      case "sector":
        if (!colorColumn) return <div className="legend-title">⚠️ No column selected</div>;
        if (!colorRanges[colorColumn]) return <div className="legend-title">⚠️ No color bands defined for {colorColumn}</div>;
        return (
          <>
            <div className="legend-title">Sector Colors: {colorColumn}</div>
            {Object.entries(colorRanges[colorColumn]).map(([color, [min, max]]) => (
              <div className="legend-item" key={color} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="legend-color" style={{ backgroundColor: color, width: 16, height: 16, border: "1px solid #ccc", borderRadius: 4 }} />
                <span>{min} – {max}</span>
              </div>
            ))}
          </>
        );
        case "rca":
  const rcaMap = window.rcaColorMap || {};
  const rcaIssues = Object.keys(rcaMap);
  if (rcaIssues.length === 0) {
    return <div className="legend-title">⚠️ RCA data not loaded yet</div>;
  }
  return (
    <>
      <div className="legend-title">RCA Analysis (Issue Buckets)</div>
      {rcaIssues.map((issue) => (
        <div key={issue} className="legend-item" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            className="legend-color"
            style={{
              backgroundColor: rcaMap[issue],
              width: 16,
              height: 16,
              border: "1px solid #ccc",
              borderRadius: 4,
            }}
          />
          <span style={{ fontSize: 12 }}>{issue}</span>
        </div>
      ))}
    </>
  );
  case "cmchange":
  const cmBands = window.cmColorBands || [];
  if (!cmBands.length) return <div className="legend-title">⚠️ CM Change data not loaded</div>;
  return (
    <>
      <div className="legend-title">CM Change — Total Score</div>
      {cmBands.map(({ color, from, to }, idx) => (
        <div key={idx} className="legend-item" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ backgroundColor: color, width: 16, height: 16, borderRadius: 4, border: "1px solid #ccc" }} />
          <span style={{ fontSize: 12 }}>{from.toFixed(1)} – {to.toFixed(1)}</span>
        </div>
      ))}
    </>
  );

      
      case "driveTest":
        if (!selectedDriveKPI) return <div className="legend-title">⚠️ No Drive Test KPI selected</div>;
        if (!colorRanges[selectedDriveKPI]) return <div className="legend-title">⚠️ No color ranges defined for {selectedDriveKPI}</div>;
        return (
          <>
            <div className="legend-title">Drive Test KPI: <strong>{selectedDriveKPI}</strong></div>
            {Object.entries(colorRanges[selectedDriveKPI]).map(([color, [min, max]]) => (
              <div className="legend-item" key={color} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span className="legend-color" style={{ backgroundColor: color, width: 16, height: 16, border: "1px solid #ccc", borderRadius: 4 }} />
                <span>{min} – {max}</span>
              </div>
            ))}
            
          </>
        );
      default:
        return null;
    }
  };


  // 🔁 Global auto-refresh hook — called whenever colorRanges or layerColumn change
useEffect(() => {
  // Expose global refresh method
  window.refreshLayerMap = () => {
    const map = mapInstance.current;
    if (!map || !geojsonData) return;

    console.log("🎨 Refreshing map polygons with updated color ranges...");

    addSectorLayer({
      map,
      rawPoints: geojsonData,
      selectedBandCells,
      bandColorMap,
      selectedUniqueBands,
      selectedColumnFilters: normalizedColumnFilters,
      layerColumn: layerColumn || colorColumn,
      colorRangesObj: colorRanges,
      radiusKm: radiusScale,
    });
  };

  // Auto-trigger whenever colorRanges or layerColumn changes
  if (layerColumn && colorRanges) {
    console.log("🌀 Auto refresh triggered (colorRanges/layerColumn changed)");
    window.refreshLayerMap();
  }

  return () => {
    try {
      delete window.refreshLayerMap;
    } catch (e) {}
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [layerColumn, JSON.stringify(colorRanges)]);

  /* ---------------- Render ---------------- */
  return (
    <>
      {/* Search toggle */}
      <div style={{ position: "fixed", top: 37, right: 200, zIndex: 10001, display: "flex", gap: "6px" }}>
        <button className="icon-btn" title="Toggle Search Panel" onClick={() => setShowSearchPanel((v) => !v)} style={{ boxShadow: "0 2px 6px rgba(0,0,0,0.12)", background: showSearchPanel ? "#e6f5ec" : "#fff", fontSize: 15, transition: "background 0.2s" }}>🔍</button>
      </div>

      {/* Search Bar UI */}
      {showSearchPanel && (
        <form style={{ color: "#000", position: "absolute", top: 18, left: 360, zIndex: 10, background: "#fff", padding: "4px 8px", borderRadius: "8px", boxShadow: "0 1px 5px rgba(0,0,0,0.08)", display: "flex", alignItems: "center", gap: "8px", border: "1px solid #e5e7eb", minHeight: 40 }} onSubmit={handleSearch}>
          <input type="text" placeholder="Search Site/Cell/KPI" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ color: "#000", minWidth: 220, border: "1px solid #ccc", borderRadius: 4, padding: "6px 8px", fontSize: 13, background: "#f9fafb" }} />
          <button type="submit" className="btn-outline" style={{ padding: "6px 12px", borderRadius: 4, fontWeight: 500 }}>Search</button>
          <button type="button" className="btn-outline" onClick={handleUndoSearch} disabled={searchHistory.length === 0} style={{ padding: "6px 10px", borderRadius: 4 }}>{`Undo`}</button>
          {searchResults.length > 1 && (
            <select onChange={(e) => { const idx = Number(e.target.value); setInternalHighlight(searchResults[idx]); }} style={{ marginLeft: 8, padding: "6px 8px", borderRadius: 4, minWidth: 140 }}>
              {searchResults.map((f, idx) => <option key={idx} value={idx}>{f.properties.Site_ID || f.properties.Cell_name || `Sector ${idx + 1}`}</option>)}
            </select>
          )}
        </form>
      )}

      <div ref={mapRef} className="map-container" style={{ position: "absolute", inset: 0 }} />

      {/* Toolbar */}
      {/* ℹ️ Right Sidebar */}
      {showInfoPanel && (
        <div
          style={{
            color: "#000",
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            width: "420px",
            background: "#ffffff",
            borderLeft: "1px solid #e5e7eb",
            boxShadow: "0 0 24px rgba(0,0,0,0.08)",
            zIndex: 13000,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* header */}
          <div
            style={{
              padding: "10px 12px",
              borderBottom: "1px solid #e5e7eb",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "#f8fafc",
            }}
          >
            <div style={{ fontWeight: 700 }}>
              Site Info {selectedSiteId ? `— ${selectedSiteId}` : ""}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn-outline"
                onClick={() => {
                  // hint text if nothing selected
                  if (!selectedSiteId && geojsonData?.features?.length) {
                    const first = geojsonData.features[0]?.properties;
                    const sid =
                      first?.site_id ||
                      first?.Site_ID ||
                      first?.["SITE ID"] ||
                      first?.siteid ||
                      first?.SITE ||
                      first?.site;
                    if (sid) showSiteInfo(sid, geojsonData);
                  }
                }}
                title="Load some site"
                style={{ padding: "4px 8px" }}
              >
                Refresh
              </button>
              <button
                className="btn-outline"
                onClick={() => setShowInfoPanel(false)}
                title="Close"
                style={{ padding: "4px 8px" }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* content */}
          <div style={{ overflow: "auto", padding: 12 }}>
            {/* Source table */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>📊 Source</div>
              {Object.keys(infoSource || {}).length === 0 ? (
                <div style={{ color: "#6b7280" }}>Click a site to view details…</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <tbody>
                    {Object.entries(infoSource).map(([k, v]) => (
                      <tr key={`src-${k}`}>
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid #f3f4f6", fontWeight: 600, width: "45%" }}>
                          {labelize(k)}
                        </td>
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid #f3f4f6", wordBreak: "break-word" }}>
                          {String(v ?? "")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Target table */}
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>📈 Target</div>
              {Object.keys(infoTarget || {}).length === 0 ? (
                <div style={{ color: "#6b7280" }}>No target fields present in this feature.</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <tbody>
                    {Object.entries(infoTarget).map(([k, v]) => (
                      <tr key={`tgt-${k}`}>
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid #f3f4f6", fontWeight: 600, width: "45%" }}>
                          {labelize(k)}
                        </td>
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid #f3f4f6", wordBreak: "break-word" }}>
                          {String(v ?? "")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

<div
  style={{
    position: "absolute",
    top: 120,
    right: 12,
    zIndex: 1200,
    display: "flex",
    flexDirection: "column", // 👈 stack buttons vertically
    gap: 8, // spacing between buttons
  }}
>
  <button onClick={toggleStyle} className="icon-btn" title="Toggle satellite">🛰️</button>
  <button onClick={toggleLightStyle} className="icon-btn" title="Toggle light">💡</button>
  <button
    className="icon-btn"
    title="Zoom to dataset"
    onClick={() => {
      try {
        if (!mapInstance.current || !geojsonData) return;
        const sectors = generateSectorGeoJSON(
          geojsonData,
          radiusScale,
          layerColumn || colorColumn
        );
        const bbox = turf.bbox(sectors);
        mapInstance.current.fitBounds(bbox, {
          padding: 40,
          maxZoom: 14,
          essential: true,
        });
      } catch (e) {
        console.warn("Zoom to data failed", e);
      }
    }}
  >
    🔎
  </button>
  <button
    onClick={() => {
      rulerActiveRef.current = !rulerActiveRef.current;
      if (!rulerActiveRef.current) {
        rulerGeoJSON.current = { type: "FeatureCollection", features: [] };
        rulerLinestring.current = {
          type: "Feature",
          geometry: { type: "LineString", coordinates: [] },
        };
        if (mapInstance.current && mapInstance.current.getSource("ruler-geojson"))
          mapInstance.current.getSource("ruler-geojson").setData(rulerGeoJSON.current);
        if (distanceRef.current) distanceRef.current.innerText = "";
      }
    }}
    className="icon-btn"
    title="Toggle Ruler"
  >
    🧭
  </button>
    <button onClick={() => setShowLegend((v) => !v)} className="icon-btn" title="Toggle Legend">
    📊
  </button>

  {/* NEW: Info sidebar toggle */}
  <button
    onClick={() => setShowInfoPanel((v) => !v)}
    className="icon-btn"
    title="Toggle Site Info"
    style={{ fontWeight: 600 }}
  >
    ℹ️
  </button>

</div>


      {/* Distance box */}
      <div ref={distanceRef} id="distance-box" style={{ position: "absolute", bottom: 40, right: 10, zIndex: 1200, background: "rgba(136, 233, 173, 0.47)", padding: "6px 8px", borderRadius: 6, color: "#333" }} />

      {/* Legend popup */}
      {showLegend && (
        <div className="map-legend-popup" style={{ position: "absolute", bottom: 10, right: 2, zIndex: 12000, background: "#ffffff", padding: 12, borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.12)" }}>
          <select
  value={legendType}
  onChange={(e) => setLegendType(e.target.value)}
  className="input"
  style={{ marginBottom: 10, width: "100%" }}
>
  <option value="generation">Generation Colors</option>
  <option value="kpi">KPI Heatmap</option>
  <option value="band">Band Colors</option>
  <option value="sector">Sector Colors</option>
  <option value="driveTest">Drive Test KPI</option>
  <option value="rca">RCA Analysis</option>
  <option value="cmchange">CM Change Analysis</option>

</select>

          <div style={{ maxHeight: 280, overflow: "auto" }}>{renderLegend()}</div>
        </div>
      )}
    </>
  );
};

export default MapRenderer;
