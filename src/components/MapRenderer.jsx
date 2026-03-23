// MapRenderer.jsx — merged: new legend + old UI (search, toolbar, ruler, info panel) 

import React, { useEffect, useRef, useState } from "react";
import toast from 'react-hot-toast';
import mapboxgl from "mapbox-gl";
import * as turf from "@turf/turf";
import "mapbox-gl/dist/mapbox-gl.css";
import "../Styles.css";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import CircleMode from "mapbox-gl-draw-circle-mode";
import FreehandMode from "mapbox-gl-draw-freehand-mode";
import Papa from "papaparse";
import { Pentagon, Pencil, Trash2, Save } from "lucide-react";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
// import { getEnabledFeatures } from "../Utils/cookieUtils";
import {getToken, checkCookieExpiration,isUserLoggedIn } from "./CookiesUtils";
import { redirectToLogin } from "./Logout";
import KPIGridUploader from "./KPIGridUploader";
// import { createTABarsLayer } from "./TABarsLayer";


mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || "";

// Defaults
const DEFAULT_CENTER = [78.9629, 20.5937];
const DEFAULT_ZOOM = 10;

// Default generation colors
const GENERATION_COLORS = {
  "2G": "#3B82F6",
  "3G": "#10B981",
  "4G": "#F97316",
  "5G": "#E11D48",
};





// ===== TA DATASET =====
const taDataset = {

  // "LZM00438": {
  'LZM33042':{
    "4G": {
      TAI0: 40,
      TAI1: 200,
      TAI2: 1200,
      TAI3: 2000,
      TAI4: 80,
      TAI5: 16,
      TAI6: 24,
      TAI7: 32,
      TAI8: 12,
      TAI9: 4,
      TAI10: 0,
      TAI11: 0
    }
  },

  // "LZM00433": {
  "LZM33043":{
    "4G": {
      TAI0: 30,
      TAI1: 150,
      TAI2: 900,
      TAI3: 1700,
      TAI4: 70,
      TAI5: 14,
      TAI6: 20,
      TAI7: 28,
      TAI8: 10,
      TAI9: 3,
      TAI10: 0,
      TAI11: 0
    }
  },

  // "LZM00439": {
"LZM33041":{
    "4G": {
      TAI0: 25,
      TAI1: 120,
      TAI2: 750,
      TAI3: 1300,
      TAI4: 52,
      TAI5: 12,
      TAI6: 18,
      TAI7: 26,
      TAI8: 10,
      TAI9: 3,
      TAI10: 0,
      TAI11: 0
    }
  },


  "LZM13998":{
    "4G": {
      TAI0: 25,
      TAI1: 120,
      TAI2: 750,
      TAI3: 1300,
      TAI4: 52,
      TAI5: 12,
      TAI6: 18,
      TAI7: 26,
      TAI8: 10,
      TAI9: 3,
      TAI10: 0,
      TAI11: 0
    }
  },


  "LZM13992":{
    "4G": {
      TAI0: 25,
      TAI1: 120,
      TAI2: 750,
      TAI3: 1300,
      TAI4: 52,
      TAI5: 12,
      TAI6: 18,
      TAI7: 26,
      TAI8: 10,
      TAI9: 3,
      TAI10: 0,
      TAI11: 0
    }
  },

  "LZM004343": {
    "4G": {
      TAI0: 50,
      TAI1: 260,
      TAI2: 1400,
      TAI3: 2100,
      TAI4: 90,
      TAI5: 20,
      TAI6: 28,
      TAI7: 36,
      TAI8: 14,
      TAI9: 5,
      TAI10: 0,
      TAI11: 0
    }
  }

};





function buildStackedBarPolygons(center, azimuth, segments = [], options = {}) {
  const barThickness = options.thickness || 15;
  const valueFactor = options.valueFactor || 1500;
  const startOffset = options.offset || 0;
  
  if (!segments.length) return [];
  const [baseLng, baseLat] = center;

  // Align Compass (0=N) to Math (0=E)
  const rad = ((90 - azimuth) * Math.PI) / 180;
  const dirX = Math.cos(rad);
  const dirY = Math.sin(rad);

  // Perpendicular vector for width
  const perpX = Math.cos(rad + Math.PI / 2);
  const perpY = Math.sin(rad + Math.PI / 2);

  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos((baseLat * Math.PI) / 180);
  const halfWidth = barThickness / 2;

  let currentDist = 0;
  const polygons = [];

  segments.forEach((value, idx) => {
    if (value <= 0) return;

    const d0 = startOffset + (currentDist * valueFactor);
    const d1 = startOffset + ((currentDist + value) * valueFactor);

    // Center-line points
    const x0 = baseLng + (d0 * dirX) / metersPerDegLng;
    const y0 = baseLat + (d0 * dirY) / metersPerDegLat;
    const x1 = baseLng + (d1 * dirX) / metersPerDegLng;
    const y1 = baseLat + (d1 * dirY) / metersPerDegLat;

    // Corner offsets
    const dx = (halfWidth * perpX) / metersPerDegLng;
    const dy = (halfWidth * perpY) / metersPerDegLat;

    polygons.push({
      taIndex: idx,
      polygon: [
        [x0 - dx, y0 - dy], // Bottom Left
        [x1 - dx, y1 - dy], // Top Left
        [x1 + dx, y1 + dy], // Top Right
        [x0 + dx, y0 + dy], // Bottom Right
        [x0 - dx, y0 - dy]  // Close Loop
      ]
    });

    currentDist += value;
  });

  return polygons;
}


// 🔄 Convert Point geometries to Sector polygons
function convertPointsToSectors(geojsonData, radiusKm = 1.5, beamwidthDeg = 60) {
  if (!geojsonData || !geojsonData.features) return geojsonData;

  const features = geojsonData.features.map((feature) => {
    // If already a polygon, skip
    if (feature.geometry.type === "Polygon") {
      return feature;
    }

    // If Point, convert to sector polygon
    if (feature.geometry.type === "Point") {
      const [lng, lat] = feature.geometry.coordinates;
      const bearing = getAzimuth(feature.properties, 0);
      
      const points = [];
      const center = [lng, lat];
      points.push(center);

      const steps = 40;
      for (let i = 0; i <= steps; i++) {
        const angle = bearing - beamwidthDeg / 2 + (beamwidthDeg / steps) * i;
        const rad = (angle * Math.PI) / 180;
        
        // Convert km to degrees (approximate)
        const degPerKm = 1 / 111;
        const dx = radiusKm * degPerKm * Math.cos(rad);
        const dy = radiusKm * degPerKm * Math.sin(rad);
        
        points.push([lng + dx, lat + dy]);
      }
      points.push(center);

      return {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [points]
        },
        properties: feature.properties
      };
    }

    return feature;
  });

  return {
    ...geojsonData,
    features
  };
}

// 4️⃣ TA LEGEND
function TALegend() {

  const colors = [
    "#4CAF50","#FF9800","#F44336","#2196F3",
    "#9C27B0","#FF5722","#00BCD4","#CDDC39",
    "#673AB7","#3F51B5","#E91E63","#FFC107"
  ];

  return (
    <div
      style={{
        position: "absolute",
        right: "60px",
        top: "120px",
        background: "#fff",
        padding: "10px",
        borderRadius: "6px",
        boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
        fontSize: "12px",
        zIndex: 9999
      }}
    >
      <b>TA Legend</b>

      {colors.map((c, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center" }}>
          <span
            style={{
              width: 12,
              height: 12,
              background: c,
              marginRight: 6,
              display: "inline-block"
            }}
          />
          TA{i}
        </div>
      ))}
    </div>
  );
}





/* ---------------- Utility helpers ---------------- */

const escapeHtml = (str) =>
  String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const normalize = (v) =>
  String(v ?? "")
    .trim()
    .toUpperCase();

// ================= GLOBAL TECH NORMALIZER =================
const normalizeTech = (raw) => {
  if (raw === null || raw === undefined) return null;

  const t = String(raw).trim().toUpperCase();

  if (!t || t === "NAN" || t === "NULL") return null;

  if (t.includes("2G")) return "2G";
  if (t.includes("3G")) return "3G";
  if (t.includes("4G")) return "4G";
  if (t.includes("5G")) return "5G";

  return null;
};

// ================= TECH COLOR ENGINE =================
const TECH_COLORS = {
  "2G": "#4CAF50",
  "3G": "#2196F3",
  "4G": "#FF9800",
  "5G": "#E91E63",
};

// ================= PULSE REFRESH HELPER =================
const refreshPulseFromFeatures = (features, map) => {
  if (!Array.isArray(features) || features.length === 0) {
    console.warn("⚠️ No features for pulse");
    return;
  }
  const pulseFeatures = [];
  features.forEach((f) => {
    const color =
      f.properties?.color ||
      f.properties?.Color ||
      null;
    if (!color) {
      // console.log("🚫 Pulse skipped — no color", f.properties);
      return;
    }
    const tech = normalizeTech(
      f.properties?.tech ||
      f.properties?.Tech ||
      f.properties?.generation
    );
    const pulseColor = TECH_COLORS[tech] || color;
    const coords = turf.centroid(f).geometry.coordinates;
    pulseFeatures.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: coords },
      properties: { pulseColor, tech },
    });
  });
  console.log("🔥 Pulse features:", pulseFeatures.length);
  if (map.getSource("pulse-points")) {
    map.getSource("pulse-points").setData({
      type: "FeatureCollection",
      features: pulseFeatures,
    });
  }
};


// ================= KPI FAILURE COLOR ENGINE =================
const FAILURE_COLOR_PALETTE = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
];

const buildFailureColorMap = (features) => {
  const map = {};
  let idx = 0;

  features.forEach((f) => {
    const raw =
      f.properties?.FAILED_KPIS ||
      f.properties?.failed_kpis ||
      "UNKNOWN";

    const key = String(raw).trim();

    if (!map[key]) {
      map[key] = FAILURE_COLOR_PALETTE[idx % FAILURE_COLOR_PALETTE.length];
      idx++;
    }
  });

  console.log("🎨 Failure color map:", map);
  return map;
};

// ================= GLOBAL PULSE LAYER =================
const addPulseLayer = (map) => {
  if (map.getSource("pulse-points")) return;

  map.addSource("pulse-points", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addLayer({
    id: "pulse-glow",
    type: "circle",
    source: "pulse-points",
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        5, 3,
        8, 5,
        12, 8,
        16, 14,
      ],
      "circle-color": ["get", "pulseColor"],
      "circle-opacity": [
        "interpolate",
        ["linear"],
        ["zoom"],
        5, 0.6,
        10, 0.9,
        16, 1,
      ],
      // 🔥 GPU pulse glow
      "circle-blur": [
        "interpolate",
        ["linear"],
        ["zoom"],
        5, 0.4,
        10, 0.7,
        16, 1.2,
      ],
      // 🔥 smooth breathing animation
      "circle-stroke-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        5, 0,
        16, 2,
      ],
      "circle-stroke-color": ["get", "pulseColor"],
    },
  });

  // pulsate opacity
  let phase = 0;
  const interval = setInterval(() => {
    if (!map.getLayer("pulse-glow")) return;
    phase = (phase + 1) % 100;
    const op = 0.4 + 0.4 * Math.sin((phase / 100) * 2 * Math.PI);
    map.setPaintProperty("pulse-glow", "circle-opacity", op);
  }, 80);
  map.__pulseInterval = interval;
  console.log("🔥 Pulse layer added");
};


// NOTE: getKpiLegendItems moved inside MapRenderer component where kpiFailureGeoJSON state exists.

// 🧠 Attach global date filters
const appendDateParams = (url) => {
  try {
    console.log("🧪 appendDateParams called");

    const dates = window.__geoDateFilter?.dates;
    const fromDate = window.__geoDateFilter?.from_date;
    const toDate = window.__geoDateFilter?.to_date;

    const u = new URL(url, window.location.origin);

    if (dates) {
      u.searchParams.set("dates", dates);
    } else {
      if (fromDate) u.searchParams.set("from_date", fromDate);
      if (toDate) u.searchParams.set("to_date", toDate);
    }

    console.log("🧪 Final KPI URL:", u.toString());
    return u.toString();
  } catch (e) {
    console.warn("appendDateParams failed:", e);
    return url;
  }
};


const getFirstProp = (props, keys) => {
  for (const k of keys) {
    if (
      k in props &&
      props[k] != null &&
      props[k] !== "" &&
      props[k] !== "[NULL]"
    ) {
      return props[k];
    }
  }
  return null;
};

const getSiteId = (props) =>
  getFirstProp(props, [
    "site_id",
    "Site_ID",
    "SITE ID",
    "SITEID",
    "SITE",
    "site",
  ]);

const getBand = (props) => getFirstProp(props, ["band", "BAND", "Band"]);

const getCellName = (props) => {
  const result = getFirstProp(props, [
    "cellname",
    "Cellname",
    "Cell_name",
    "CELLNAME",
    "CELL_NAME",
    "Cell_Name",
  ]);
  // console.log("getCellName debug:", { props: Object.keys(props), result });
  return result;
};

const getAzimuth = (props, fallback) => {
  const raw = getFirstProp(props, [
    "azimuth",
    "Azimuth",
    "AZIMUTH",
    "Azimuth_degrees",
  ]);
  const n = raw == null ? NaN : Number(String(raw).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : fallback;
};

const normalizeGeneration = (val) => {
  const s = normalize(val);
  if (!s) return "";

  // ⭐ LTE bands
  if (
    s.includes("L") ||
    s.includes("LTE") ||
    s.includes("800") ||
    s.includes("1800") ||
    s.includes("2100")
  )
    return "4G";

  if (s.includes("5G") || s.includes("NR")) return "5G";
  if (s.includes("3G") || s.includes("UMTS") || s.includes("WCDMA"))
    return "3G";
  if (s.includes("2G") || s.includes("GSM")) return "2G";

  return "";
};

const bandNumber = (band) => {
  const m = String(band || "").match(/\d+/g);
  if (!m) return -1;
  const n = Number(m.join(""));
  return Number.isFinite(n) ? n : -1;
};

const createRingSlice = (
  center,
  innerKm,
  outerKm,
  startDeg,
  endDeg,
  stepDeg = 3
) => {
  const outer = [];
  for (let a = startDeg; a <= endDeg + 1e-6; a += stepDeg) {
    outer.push(
      turf.destination(center, outerKm, a, { units: "kilometers" }).geometry
        .coordinates
    );
  }
  const inner = [];
  for (let a = endDeg; a >= startDeg - 1e-6; a -= stepDeg) {
    inner.push(
      turf.destination(center, innerKm, a, { units: "kilometers" }).geometry
        .coordinates
    );
  }
  const ring = [...outer, ...inner, outer[0]];
  return turf.polygon([ring]);
};

const createPopupHtml = (props = {}, extra = {}) => {
  const merged = { ...props, ...extra };
  const rows = Object.keys(merged).map((k) => {
    const v = merged[k];
    return `
      <tr>
        <td style="padding:4px 8px;border-bottom:1px solid #eee;"><strong>${escapeHtml(
          k
        )}</strong></td>
        <td style="padding:4px 8px;border-bottom:1px solid #eee;">${escapeHtml(
          v
        )}</td>
      </tr>`;
  });
  return `<div style="max-width:320px;font-size:12px;">
    <table style="border-collapse:collapse;width:100%;">${rows.join("")}</table>
  </div>`;
};

// deterministic band color generator
const hashToHue = (str) => {
  let h = 0;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) % 360;
  }
  return h;
};

const hslToHex = (h, s, l) => {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) =>
    Math.round(
      255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))))
    )
      .toString(16)
      .padStart(2, "0");
  return `#${f(0)}${f(8)}${f(4)}`;
};

const isInsidePolygon = (sitePoint, polygon) => {
  return turf.booleanPointInPolygon(sitePoint, polygon);
};

const labelize = (key) => {
  if (!key) return "";
  return String(key)
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

const createSectorPolygonFeature = (
  center,
  radiusKm,
  azimuthDeg,
  widthDeg,
  step = 4
) => {
  const start = azimuthDeg - widthDeg / 2;
  const end = azimuthDeg + widthDeg / 2;

  const outer = [];
  for (let a = start; a <= end; a += step) {
    outer.push(
      turf.destination(center, radiusKm, a, { units: "kilometers" }).geometry
        .coordinates
    );
  }

  const inner = [center];

  return turf.feature(turf.polygon([[...outer, ...inner, outer[0]]]).geometry);
};

// ================= KPI → SECTOR WEDGE BUILDER =================
const buildKpiWedge = (feature) => {
  try {
    const coords = feature?.geometry?.coordinates;
    if (!coords || coords.length < 2) return null;

    const [lon, lat] = coords;

    // fallback azimuth (since KPI table has no azimuth)
    const azimuth =
      Number(feature.properties?.azimuth) ||
      Number(feature.properties?.AZIMUTH) ||
      0;

    const radiusKm = 0.4; // same visual scale as sectors
    const beamWidth = 60;

    const wedge = turf.sector(
      [lon, lat],
      radiusKm,
      azimuth - beamWidth / 2,
      azimuth + beamWidth / 2,
      { units: "kilometers" }
    );

    if (!wedge?.geometry?.coordinates?.length) {
      console.warn("🧨 geometry validator — empty wedge");
    }

    return {
      type: "Feature",
      geometry: wedge.geometry,
      properties: {
        ...feature.properties,
        fillColor:
          feature.properties?.color ||
          feature.properties?.fillColor ||
          "#ff0000",
        __isKpiWedge: true,
      },
    };
  } catch (e) {
    console.warn("🧨 KPI wedge build failed", e);
    return null;
  }
};


  const generateColors = (values) => {
    const colors = {};
    const step = 360 / values.length;
    values.forEach((val, i) => {
      colors[val] = `hsl(${Math.round(i * step)},70%,50%)`;
    });
    return colors;
  };
  
  // const buildMatchExpression = (geojson) => {
  //   const zones = [...new Set(geojson.features.map(f => f.properties.B4_Polygon))];
  //   const colors = generateColors(zones);
  //   const expression = ['match', ['get', 'B4_Polygon']];
  //   zones.forEach(zone => {
  //     expression.push(zone, colors[zone]);
  //   });
  //   expression.push('#cccccc');
  //   return expression;
  // };

  
  const buildMatchExpression = (geojson) => {
  const expression = ['match', ['get', 'zone_id']];

  geojson.features.forEach((feature) => {
    const zoneId = String(feature.properties.zone_id);

    expression.push(zoneId, '#00ff99'); // hardcoded color for now
  });

  expression.push('#cccccc'); // fallback color
  console.log('🎨 fill-color expression:', expression);

  return expression;
};








/* ---------------- Component ---------------- */

const MapRenderer = ({
  mapStyle,
  radiusScale = 0.2,

  geojsonData,
  driveTestGeoJSON,
  
  
  setSelectedGridKPI,
  highlightedFeature,

  colorColumn, // selectedLayerColumn in App
  colorRanges = {}, // KPI color ranges
  selectedUniqueBands = [],
  selectedColumnValues = [], // [{column, values}]

  selectedDriveKPI,
  selectedGridKPI,

  tableType, // "KPI's", "RCA", "CM Change", etc.

  onSiteClick,

  // unused props but kept for compatibility
  driveLayerRange,
  layerRange,
  gridData,
  targetConfigs,
  targetColorRanges,
  setGridData,
  

  selectedDB,
  selectedProject,
  availableProjects,
}) => {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);

  const [internalStyle, setInternalStyle] = useState(
    mapStyle || "mapbox://styles/mapbox/outdoors-v12"
  );
  const lastZoomedDB = useRef(null);
  // 🆕 CACHED DATA FOR STYLE SWITCHING
  const sectorsRef = useRef({ type: "FeatureCollection", features: [] });
  const driveTestRef = useRef({ type: "FeatureCollection", features: [] });
  const gridRef = useRef({ type: "FeatureCollection", features: [] });
  const highlightRef = useRef({ type: "FeatureCollection", features: [] });
  const [expandBandMode, setExpandBandMode] = useState(false);
  const [alarmLegend, setAlarmLegend] = useState([]);
  const [trafficLegend, setTrafficLegend] = useState([]);
  const [datePanelCollapsed, setDatePanelCollapsed] = useState(false);
  const lastClickedOriginalFeatureRef = useRef(null);

const [showPolygonList, setShowPolygonList] = useState(false);  // upload expansion

// 🎨 Polygon UI toggle
const [showPolygonPanel, setShowPolygonPanel] = useState(false);
const [selectedCells, setSelectedCells] = useState([]);


  // 🔥 TRACK WHEN geojsonData ARRIVES
  useEffect(() => {
    if (geojsonData?.features?.length) {
      console.log("📊 MapRenderer: geojsonData RECEIVED with", geojsonData.features.length, "features");
      console.log("📊 First feature geometry type:", geojsonData.features[0]?.geometry?.type);
    } else {
      console.warn("⚠️ MapRenderer: geojsonData is empty or missing");
    }
  }, [geojsonData?.features?.length]);

  const [showLegend, setShowLegend] = useState(true);
  
  // 🔥 LOG WHEN TABLETYPE CHANGES
  // useEffect(() => {
  //   if (tableType) {
  //     console.log("✅ MapRenderer: tableType CHANGED to:", tableType);
  //   } else {
  //     console.log("⚠️ MapRenderer: tableType is EMPTY");
  //   }
  // }, [tableType]);
  const [gridKPIColumns, setGridKPIColumns] = useState([]);
  const [gridMapGeoJSON, setGridMapGeoJSON] = useState(null)
  // ===== DRIVE / GRID MODAL STATES =====
const [showDrivePanel, setShowDrivePanel] = useState(false);
const [showGridPanel, setShowGridPanel] = useState(false);

// --- Local Drive / Grid UI state (mirrors Sidebar functionality) ---
const [driveTestFile, setDriveTestFile] = useState(null);
const [driveTestColumns, setDriveTestColumns] = useState([]);
const [fetchingKPI, setFetchingKPI] = useState(false);
const [kpiProgress, setKpiProgress] = useState(0);
const [addingDriveColor, setAddingDriveColor] = useState(false);
const [newDriveColorHex, setNewDriveColorHex] = useState("#0000ff");
const [newDriveMin, setNewDriveMin] = useState(0);
const [newDriveMax, setNewDriveMax] = useState(0);

const [fetchingGridKPI, setFetchingGridKPI] = useState(false);
const [gridKpiProgress, setGridKpiProgress] = useState(0);
const [addingGridColor, setAddingGridColor] = useState(false);
const [newGridColorHex, setNewGridColorHex] = useState("#0000ff");
const [newGridMin, setNewGridMin] = useState(0);
const [newGridMax, setNewGridMax] = useState(0);
// 🔥 KPI FAILURE MODE
const [kpiFailureMode, setKpiFailureMode] = useState(false);
const [selectedTechs, setSelectedTechs] = useState([]);
const [kpiFailureGeoJSON, setKpiFailureGeoJSON] = useState(null);
const [kpiFailureLegend, setKpiFailureLegend] = useState({});
// cache for KPI fetch results (temporary storage while switching modes)
const kpiFailureCacheRef = useRef(null);




// dynamic legend items derived from current KPI data
const getKpiLegendItems = () => {
  if (!kpiFailureGeoJSON?.features) return [];
  const set = new Set();
  kpiFailureGeoJSON.features.forEach((f) => {
    const bucket =
      f.properties?.["Issue/Analysis Bucket new"] ||
      f.properties?.FAILED_KPIS;
    if (bucket) set.add(bucket);
  });
  return Array.from(set);
};

// determine fill color for KPI wedge based on failure value using dynamic legend
const getKpiFailureColor = (val) => {
  const key = val == null ? "<null>" : String(val).trim();
  const map = kpiFailureLegend || {};
  const color = map[key] || "#ff0000"; // fallback red
  //console.log("🎨 getKpiFailureColor", key, "->", color);
  return color;
};

// Local copy of color ranges so UI edits are reactive here
const [localColorRanges, setLocalColorRanges] = useState(colorRanges || {});

// Sync prop -> local copy
useEffect(() => {
  console.log("📣 MapRenderer: colorRanges prop changed:", colorRanges, "colorColumn:", colorColumn);
  setLocalColorRanges(colorRanges || {});
  // Give a tick for React state to settle then refresh the layers
  setTimeout(() => {
    console.log("📣 MapRenderer: calling refreshLayerMap after colorRanges sync");
    setTimeout(() => window.refreshLayerMap?.(), 0);
  }, 0);
}, [JSON.stringify(colorRanges), colorColumn]);

// Dropdown UI state (local to MapRenderer)
const [showDropdowns, setShowDropdowns] = useState({});
const [searchTexts, setSearchTexts] = useState({});
const dropdownRefs = useRef({});

// Close dropdowns on outside click (mirror Sidebar behavior)
useEffect(() => {
  const handler = (e) => {
    Object.entries(dropdownRefs.current || {}).forEach(([key, el]) => {
      if (showDropdowns[key] && el && !el.contains(e.target)) {
        setShowDropdowns((prev) => ({ ...prev, [key]: false }));
      }
    });
  };

  document.addEventListener("click", handler);
  return () => document.removeEventListener("click", handler);
}, [showDropdowns]);


  const [legendMode, setLegendMode] = useState("sector"); // sector | driveTest | grid | generation | rca | cmchange | band
  // ⭐ Detect ALARM / TRAFFIC and switch legend mode
  // ⭐ Alarm / Traffic label remapping (display only)
  const remapAlarmValue = (val) => {
    if (!val) return val;
    const s = String(val).trim();
    if (s.toLowerCase() === "local fm" || s.toLowerCase() === "gdc fm")
      return "Operational Issue";
    return s;
  };

  const remapTrafficValue = (val) => {
    if (!val) return val;
    const s = String(val).trim();
    const lower = s.toLowerCase().replace(/\s+/g, " ");

    // handle singular, plural, and slight variations
    if (
      lower === "low call fail" ||
      lower === "low call fails" ||
      lower === "Low Call Failure" ||
      lower === "Low Call Fails" ||
      lower.includes("low call fail")
    ) {
      return "Traffic Variation";
    }

    return s;
  };


  
  const applyFillColors = () => {
      const map = mapInstance.current;
      if (!map) return;

      const fillLayer = map.getStyle().layers.find(l => l.id.includes('fill'));
      if (!fillLayer) return;
      // 🚨 KPI FAILURE OVERRIDE (style-refresh) — skip color application
if (kpiFailureMode && kpiFailureCacheRef.current?.features?.length) {
  console.log("🟥 KPI style-refresh override — skipping fill color change");
  return; // stop normal generation
}

      map.setPaintProperty(fillLayer.id, 'fill-color', ['get', 'fillColor']);
      map.setPaintProperty(fillLayer.id, 'fill-opacity', 0.4); 
    };


  useEffect(() => {
    checkCookieExpiration();
  }, []);

  // ⭐ Force legend dropdown to switch when table changes
  useEffect(() => {
    const type = (tableType || "").toLowerCase();

    if (type.includes("alarm")) {
      setLegendMode("alarm");
    } else if (type.includes("traffic")) {
      setLegendMode("traffic");
    } else if (type.includes("cm change")) {
      setLegendMode("cmchange");
    } else if (type.includes("rca")) {
      setLegendMode("rca");
    } else {
      setLegendMode("sector"); // default for KPI / others
    }
  }, [tableType]);
useEffect(() => {
  if (!showPolygonPanel) {
    setShowPolygonList(false);
  }
}, [showPolygonPanel]);

// Close map info popup and reset selection when project/DB/tech changes
useEffect(() => {
  if (popupRef.current) {
    try {
      popupRef.current.remove();
    } catch (e) {
      console.warn('Error removing popup on project/tech change', e);
    }
    popupRef.current = null;
  }
  setShowInfoPanel(false);
  setSelectedSiteIdState("");
  lastClickedOriginalFeatureRef.current = null;
}, [selectedProject, selectedDB, tableType]);

  useEffect(() => {
    const typeLower = (tableType || "").toLowerCase();
    if (!typeLower.includes("alarm")) {
      setAlarmLegend([]);
      return;
    }

    // ⭐ Use backend strict legend
    if (geojsonData?.color_config?.legend) {
      setAlarmLegend(geojsonData.color_config.legend);
      return;
    }

    // fallback (rare)
    setAlarmLegend([]);
  }, [tableType, geojsonData]);

  useEffect(() => {
    const typeLower = (tableType || "").toLowerCase();

    if (!typeLower.includes("traffic")) {
      setTrafficLegend([]);
      return;
    }

    if (!geojsonData) {
      setTrafficLegend([]);
      return;
    }

    // ⭐ If backend legend exists — DEDUPE after remapping
    if (geojsonData?.color_config?.legend) {
      const rawLegend = geojsonData.color_config.legend;

      // collapse duplicates by remapped value
      const deduped = [];
      const seen = new Set();

      rawLegend.forEach((item) => {
        const remapped = remapTrafficValue(item.value);
        if (!seen.has(remapped)) {
          seen.add(remapped);
          deduped.push({ ...item, value: remapped });
        }
      });

      setTrafficLegend(deduped);
      return;
    }

    setTrafficLegend([]);
  }, [tableType, geojsonData]);
  // 🔥 detect techs from generation data
useEffect(() => {
  if (!geojsonData?.features?.length) return;

  const techSet = new Set();

  geojsonData.features.forEach((f) => {
    const raw =
      f.properties?.generation ||
      f.properties?.GENERATION ||
      f.properties?.Tech;
    const norm = normalizeTech(raw);
    if (norm) techSet.add(norm);
  });

  const techs = Array.from(techSet);

  // auto-select latest (prefer 5G → 4G → 3G → 2G)
  const priority = ["5G", "4G", "3G", "2G"];
  const sorted = priority.filter((p) => techs.includes(p));

  setSelectedTechs(sorted.length ? [sorted[0]] : techs);
}, [geojsonData]);

  // Legend / color state
  const [rcaLegend, setRcaLegend] = useState([]); // [{issue, color}]
  const [cmLegend, setCmLegend] = useState([]); // [{from,to,color}]
  const [uniqueBands, setUniqueBands] = useState([]);
  const [bandColorMap, setBandColorMap] = useState({});
  const [generationColorMap, setGenerationColorMap] = useState(GENERATION_COLORS);

  // KPI color overrides
  const [sectorKpiColors, setSectorKpiColors] = useState({}); // key: `${kpi}__${baseColor}`
  const [driveKpiColors, setDriveKpiColors] = useState({}); // key: `${kpi}__${baseColor}`

  // Grid gradient colors
  const [gridGradientColors, setGridGradientColors] = useState({
    low: "#d1fae5",
    mid: "#22c55e",
    high: "#064e3b",
  });

  // Safe refresh helpers to immediately update map layers based on localColorRanges
  useEffect(() => {
    // Drive test layer refresh
    window.refreshDriveTestLayer = (kpiArg) => {
      const map = mapInstance.current;
      if (!map) return;
      const kpi = kpiArg || selectedDriveKPI;
      let colorExpr = "#666";
      const ranges = (localColorRanges && localColorRanges[kpi]) || {};
      if (kpi && ranges && Object.keys(ranges).length) {
        colorExpr = ["case"];
        for (const [baseColor, [min, max]] of Object.entries(ranges)) {
          colorExpr.push(
            [
              "all",
              [">=", ["to-number", ["get", kpi]], Number(min)],
              ["<=", ["to-number", ["get", kpi]], Number(max)],
            ],
            baseColor
          );
        }
        colorExpr.push("#cccccc");
      }
      try {
        if (map.getLayer("driveTest-points")) {
          map.setPaintProperty("driveTest-points", "circle-color", colorExpr);
        }
      } catch (e) {
        console.warn("refreshDriveTestLayer failed", e);
      }
    };

    // Grid layer refresh
    window.refreshGridLayer = () => {
      const map = mapInstance.current;
      if (!map) return;
      const kpi = selectedGridKPI;
      const ranges = (localColorRanges && localColorRanges[kpi]) || {};

      // circle-color (discrete) or gradient fallback
      if (kpi && ranges && Object.keys(ranges).length) {
        const colorExpr = ["case"];
        for (const [baseColor, [min, max]] of Object.entries(ranges)) {
          colorExpr.push(
            [
              "all",
              [">=", ["to-number", ["get", "__value"]], Number(min)],
              ["<=", ["to-number", ["get", "__value"]], Number(max)],
            ],
            baseColor
          );
        }
        colorExpr.push(gridGradientColors.mid || "#22c55e");
        try {
          if (map.getLayer("gridMap-points")) {
            map.setPaintProperty("gridMap-points", "circle-color", colorExpr);
          }
          if (map.getLayer("gridMap-heatmap")) {
            map.setPaintProperty("gridMap-heatmap", "heatmap-weight", [
              "interpolate",
              ["linear"],
              ["to-number", ["get", "__value"]],
              0,
              0,
              1,
              1,
            ]);
          }
        } catch (e) {
          console.warn("refreshGridLayer failed", e);
        }
      } else {
        // fallback: compute gradient on min/max from source
        try {
          if (!map.getSource("grid-map")) return;
          const data = map.getSource("grid-map")._data || gridRef.current;
          const values = (data?.features || [])
            .map((f) => f.properties?.__value)
            .filter((v) => Number.isFinite(v));
          if (!values.length) return;
          const minVal = Math.min(...values);
          const maxVal = Math.max(...values);
          const colorExpr = [
            "interpolate",
            ["linear"],
            ["to-number", ["get", "__value"]],
            minVal,
            gridGradientColors.low,
            (minVal + maxVal) / 2,
            gridGradientColors.mid,
            maxVal,
            gridGradientColors.high,
          ];
          if (map.getLayer("gridMap-points")) map.setPaintProperty("gridMap-points", "circle-color", colorExpr);
          if (map.getLayer("gridMap-heatmap")) map.setPaintProperty("gridMap-heatmap", "heatmap-weight", ["interpolate", ["linear"], ["to-number", ["get", "__value"]], minVal, 0, maxVal, 1]);
        } catch (e) {
          console.warn("refreshGridLayer fallback failed", e);
        }
      }
    };

    // Universal refresh helper — recompute per-feature fillColor for polygon/point sources
    window.refreshLayerMap = (updatedGeojson = null) => {
      const map = mapInstance.current;
      if (!map) {
        console.log("refreshLayerMap: no map instance");
        return;
      }

      console.log("refreshLayerMap: called", {
        updatedGeojsonExists: !!updatedGeojson,
        colorColumn,
        localColorRangesKeys: Object.keys(localColorRanges || {}),
      });

      const computeForGeo = (geo, column) => {
        if (!geo || !Array.isArray(geo.features)) {
          console.log("computeForGeo: no features or invalid geo for column", column);
          return geo;
        }

        const ranges = (localColorRanges && localColorRanges[column]) || {};
        const entries = Object.entries(ranges || {});
        let assignedCount = 0;

        const features = geo.features.map((f, idx) => {
          try {
            const props = { ...(f.properties || {}) };
            const raw = props[column];

            let assignedColor = null;

            // Numeric bands (entries where value is an array [min,max])
            const numericEntries = entries.filter(([, v]) => Array.isArray(v));
            if (numericEntries.length) {
              const val = raw == null || raw === "" ? NaN : Number(String(raw).replace(/,/g, "").trim());
              if (!Number.isNaN(val)) {
                for (const [k, v] of numericEntries) {
                  const [min, max] = v || [];
                  if (Number(val) >= Number(min) && Number(val) <= Number(max)) {
                    // For numeric bands, key 'k' may be a color (hex) or a name (green)
                    assignedColor = k;
                    break;
                  }
                }
              }
            }

            // Categorical bands (entries where value is a color string)
            if (!assignedColor) {
              const categoricalEntries = entries.filter(([, v]) => typeof v === "string");
              if (categoricalEntries.length) {
                const rawStr = raw == null ? "" : String(raw).trim();
                for (const [k, v] of categoricalEntries) {
                  // match property value to category key; assigned color is the value (hex)
                  if (String(k).trim() === rawStr) {
                    assignedColor = v;
                    break;
                  }
                }
              }
            }

            if (assignedColor) assignedCount++;
            props.fillColor = assignedColor || props.fillColor || "#cccccc";
            return { ...f, properties: props };
          } catch (e) {
            console.warn("computeForGeo: feature compute error", e);
            return f;
          }
        });

        console.log(`computeForGeo: column=${column} total=${geo.features.length} assigned=${assignedCount} entries=${entries.length}`);
        return { ...geo, features };
      };

      try {
        // If a specific geojson was provided (Sidebar sometimes passes updatedGeoJson)
        if (updatedGeojson) {
          const first = updatedGeojson.features?.[0];
          const col = colorColumn;
          if (first && first.geometry && first.geometry.type && first.geometry.type.includes("Polygon")) {
            sectorsRef.current = computeForGeo(updatedGeojson, col);
            if (map.getSource("sectors")) map.getSource("sectors").setData(sectorsRef.current);
          } else {
            // try both point sources
            driveTestRef.current = computeForGeo(updatedGeojson, col);
            gridRef.current = computeForGeo(updatedGeojson, col);
            if (map.getSource("drive-test")) map.getSource("drive-test").setData(driveTestRef.current);
            if (map.getSource("grid-map")) map.getSource("grid-map").setData(gridRef.current);
          }
        } else {
          // Apply current localColorRanges -> all sources
          const col = colorColumn;
          sectorsRef.current = computeForGeo(sectorsRef.current, col);
          driveTestRef.current = computeForGeo(driveTestRef.current, col);
          gridRef.current = computeForGeo(gridRef.current, col);

          if (map.getSource("sectors")) map.getSource("sectors").setData(sectorsRef.current);
          if (map.getSource("drive-test")) map.getSource("drive-test").setData(driveTestRef.current);
          if (map.getSource("grid-map")) map.getSource("grid-map").setData(gridRef.current);
        }

        // Ensure layer paint expressions use the updated properties
        applyFillColors();

        const sectorsCount = sectorsRef.current?.features?.length || 0;
        const driveCount = driveTestRef.current?.features?.length || 0;
        const gridCount = gridRef.current?.features?.length || 0;
        console.log("refreshLayerMap: updated counts", { sectorsCount, driveCount, gridCount });
      } catch (e) {
        console.warn("refreshLayerMap failed", e);
      }
    };
  }, [JSON.stringify(localColorRanges), selectedDriveKPI, selectedGridKPI, JSON.stringify(gridGradientColors)]);

  // 🔍 Search panel state
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchHistory, setSearchHistory] = useState([]); // stack of previous highlights
  const [searchResults, setSearchResults] = useState([]);
  const [internalHighlight, setInternalHighlight] = useState(null);
  const [targetTables, setTargetTables] = useState([]);
  const [kpiSource, setKpiSource] = useState({ type: null, table: null });


  // 🧭 Ruler state
  const rulerActiveRef = useRef(false);
  const rulerGeoJSON = useRef({ type: "FeatureCollection", features: [] });
  const rulerLinestring = useRef({
    type: "Feature",
    geometry: { type: "LineString", coordinates: [] },
    properties: {},
  });
  const distanceRef = useRef(null);

  // ℹ️ Info panel state
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [selectedSiteIdState, setSelectedSiteIdState] = useState("");
  const [infoSource, setInfoSource] = useState({});
  const [infoTarget, setInfoTarget] = useState({});

  //  POLYGON DRAWING & SITE DETECTION SECTION

  const drawRef = useRef(null);                           // MapboxDraw instance
  const popupRef = useRef(null);                          // Mapbox Popup instance
  const currentMatchedSitesRef = useRef([]);              // Sites matched in polygon
  const currentActiveZoneIdRef = useRef(null);            // Current zone ID
  const isDrawingRef = useRef(false);                     // Is user currently drawing
  
// Pending draw mode
  const [polygonCount, setPolygonCount] = useState(0);    // Counter for zone IDs
  const [listpolygon,setListpolygon] = useState([])
  const [userselectedPolygon, setUserSelectedPolygon] = useState(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const [uploadedZipId, setUploadedZipId] = useState(null);
  const [polygonFiles, setPolygonFiles] = useState([]);
  const [showShpPopup, setShowShpPopup] = useState(false);
  const [selectedShpFile, setSelectedShpFile] = useState(null);
  const [projectZones, setProjectZones] = useState([]);
   const [selectedPolygon, setSelectedPolygon] = useState(null);



  const fileInputRef = useRef(null);

  const fetchKpiFailureData = async () => {
  try {
    console.log("🚀 Fetching KPI Failure per tech...");

    // 🔥 RESOLVE PROJECT SAFELY
    const resolvedProject =
      selectedDB || 
      selectedDatabase ||
      selectedProject ||
      geojsonData?.project ||
      infoSource?.project ||
      infoSource?.PROJECT;

    console.log("🧪 Resolved project:", resolvedProject);

    if (!resolvedProject) {
      console.error("❌ KPI fetch blocked — project missing");
      return;
    }

    // build query parameters including tech filters
    const params = new URLSearchParams();
    params.set("project", resolvedProject);
    selectedTechs.forEach((t) => params.append("tech", t));

    let url = `${getApiBaseUrl()}/kpi-failure-tech?${params.toString()}`;
    url = appendDateParams(url);

    console.log("🌐 Final KPI URL:", url);

    const res = await fetch(url);
    console.log("📡 KPI response status:", res.status);

    const data = await res.json();

    const features = data?.features || [];
    console.log("📦 KPI RAW FEATURES:", features.length);
    // count tech distribution for debugging
    const techCounts = {};
    features.forEach(f => {
      const t = normalizeTech(f) || "UNKNOWN";
      techCounts[t] = (techCounts[t] || 0) + 1;
    });
    console.log("📊 KPI tech distribution:", techCounts);

    console.log("✅ KPI failure response features:", features.length);


    setKpiFailureGeoJSON(data);
    // 🔥 STORE CACHE
    kpiFailureCacheRef.current = {
      type: "FeatureCollection",
      features,
    };
    console.log(
      "💾 KPI cache stored:",
      features.length
    );

    // ================= BUILD FAILURE COLORS =================
    const failureColorMap = buildFailureColorMap(features);
    setKpiFailureLegend(failureColorMap);

    // 📊 tech distribution debug
    console.log(
      "📊 KPI tech distribution:",
      features.reduce((acc, f) => {
        const t = String(
          f.properties?.tech ??
          f.properties?.Tech ??
          f.properties?.generation ??
          "NAN"
        ).toUpperCase();

        acc[t] = (acc[t] || 0) + 1;
        return acc;
      }, {})
    );

    // additional view of counts only
    console.log(
      "📊 KPI tech distribution:",
      Object.values(
        features.reduce((acc, f) => {
          const t = String(
            f.properties?.tech ??
            f.properties?.Tech ??
            f.properties?.generation ??
            "NAN"
          ).toUpperCase();
          acc[t] = (acc[t] || 0) + 1;
          return acc;
        }, {})
      )
    );

    // 🔄 force layer refresh
    setTimeout(() => {
      window.refreshLayerMap?.();
      console.log("🔄 Forced layer refresh after KPI load");
    }, 0);
  } catch (err) {
    console.error("❌ KPI failure fetch failed:", err);
  }
};
// 🔥 when KPI mode toggles
useEffect(() => {
  console.log("🎛️ KPI toggle changed:", kpiFailureMode);

  if (kpiFailureMode) {
    console.log("🚀 KPI mode ON — fetching…");
    fetchKpiFailureData();
    setLegendMode("generation");
  } else {
    console.log("🟢 KPI mode OFF — back to generation");
  }
}, [kpiFailureMode]);

// refetch when tech selection changes while KPI mode is active
useEffect(() => {
  if (kpiFailureMode) {
    console.log("🔁 Tech selection changed, refetching KPI failure data");
    fetchKpiFailureData();
  }
}, [selectedTechs]);

  const username = checkCookieExpiration().userData?.first_name || "User";
  // console.log(checkCookieExpiration(),'cookies')
  const userRole = checkCookieExpiration().userData?.role || 'User';

  // Initialize drawing tools effect
  useEffect(() => {
    if (!mapInstance.current) {
      console.log("⏳ Waiting for mapInstance...");
      return;
    }

    const map = mapInstance.current;
    console.log("🗺️ Map instance available, checking if Draw is needed...");


    // Check if Draw is already initialized
    if (drawRef.current) {
      console.log("✅ Draw already initialized");
      return;
    }

    // Wait for map to be fully loaded
    const initDraw = () => {
      if (drawRef.current) {
        console.log("✅ Draw already exists, skipping init");
        return;
      }
      initializeDrawingTools(map);
    };

    if (map.isStyleLoaded()) {
      console.log("🎯 Map style already loaded, initializing Draw...");
      initDraw();
    } else {
      console.log("⏳ Waiting for map style to load...");
      map.once("load", initDraw);
      map.once("style.load", initDraw);
    }

    return () => {
      // Cleanup on unmount
      if (drawRef.current && map.getSource("draw-source")) {
        // Draw instance already handles its cleanup
      }
    };
  }, [mapInstance]);


useEffect(() => {
  console.log("Auth check useEffect running");
  const value = isUserLoggedIn();
  console.log("isUserLoggedIn:", value);
  setIsLoggedIn(value);
}, []);


  const token = checkCookieExpiration().userData.token
    if (!token) {
      toast.error("Session expired. Please login again.");
      return;
    }


const getRandomColor = () => {
  const letters = "0123456789ABCDEF";
  let color = "#";
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
};


  function getApiBaseUrl() {
  return (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
}


  const handlePolygonZipUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch(`${getApiBaseUrl()}/geo-api/polygon/upload-zip`, {
      method: "POST",
      body: formData,
    });
    
    const data = await res.json();
    console.log(data,'data')
    setUploadedZipId(data.zip_id);
    setPolygonFiles(data.files);

    setSelectedShpFile(null);
    setShowShpPopup(true);

    e.target.value = ""

  };


  const onChooseClick = () => {
  if (!uploadedZipId) {
    toast.error("Please upload zip first");
    return;
  }
  setShowShpPopup(true);
};


  const fetchProjectZones = async (fileName) => {
  setSelectedShpFile(fileName);

  const res = await fetch(
    `${getApiBaseUrl()}/geo-api/polygon/geojson?zip_id=${uploadedZipId}&file=${encodeURIComponent(
      fileName
    )}`
  );

  const data = await res.json();
  console.log(data,'df')

    const zones = data.features.map((f) => ({
      id: f.properties.id,           // Use properties.id as unique id
      zone_id: f.properties.id,      // Or use f.id if you want
      zone_name: f.properties.B4_Polygon,
      geometry: f.geometry
    }));

    setProjectZones(zones);
    setShowShpPopup(false);
    setShowPolygonList(true);

 
  setShowShpPopup(false);
};


  const onButtonClick = () => {
    fileInputRef.current.click();
  };



// useEffect(() => {
//   const map = mapInstance.current;
//   if (!map) return;
//   if (!map.getLayer("sector-layer")) return;

//   try {
//     console.log("📣 sector repaint triggered", { colorColumn, legendMode, tableType, colorRangesKeys: Object.keys(colorRanges || {}) });
//     map.setPaintProperty("sector-layer", "fill-color", [
//       "coalesce",
//       ["get", "fillColor"],
//       ["get", "color"],
//       "#9ca3af",
//     ]);
//     // Recompute per-feature fillColor and push changes to source
//     console.log("📣 sector repaint: calling refreshLayerMap");
//     setTimeout(() => window.refreshLayerMap?.(), 0);
//   } catch (e) {
//     console.warn("sector repaint failed", e);
//   }
// }, [
//   JSON.stringify(colorRanges),
//   JSON.stringify(sectorKpiColors),
//   tableType,
//   legendMode,
//   colorColumn
// ]);


useEffect(() => {

  const map = mapInstance.current;
  if (!map) return;

  if (!map.getLayer("sector-layer")) return;

  try {

    console.log("  Repaint useEffect triggered", {tableType, colorColumn, colorRanges: Object.keys(colorRanges || {})});

    console.log(" 📣 sector repaint triggered", {
      colorColumn,
      tableType
    });

    map.setPaintProperty("sector-layer", "fill-color", [
      "coalesce",
      ["get", "fillColor"],
      ["get", "color"],
      "#9ca3af"
    ]);

    // 🔥 TA bars are now handled in a separate dedicated useEffect above
    
  } catch (e) {

    console.warn("sector repaint failed", e);

  }

}, [
  JSON.stringify(colorRanges),
  tableType,
  colorColumn
]);


// ⭐ DEDICATED TA BARS EFFECT (separate from colorRanges dependencies)
useEffect(() => {
  const map = mapInstance.current;
  
  // 1️⃣ Cleanup: Remove layers if map or tableType is incorrect
  if (!map || tableType !== "TA") {
    if (map?.getLayer("ta-bars")) map.removeLayer("ta-bars");
    if (map?.getSource("ta-bars")) map.removeSource("ta-bars");
    return;
  }

  const allTABars = [];

  if (sectorsRef.current?.features?.length > 0) {
    // 2️⃣ Group features by Site ID
    const bySite = {};
    sectorsRef.current.features.forEach((f) => {
      const siteId = f.properties?.site_id || f.properties?.siteId;
      if (!siteId) return;
      if (!bySite[siteId]) bySite[siteId] = [];
      bySite[siteId].push(f);
    });

    Object.entries(bySite).forEach(([siteId, feats]) => {
      
      // ⭐ LOGIC TO FIND THE "BLACK DOT" (Shared Vertex)
      // We look for the coordinate used by the most sectors (the tip)
      const coordCounts = {};
      let antennaBasePoint = null;
      let maxOccurrence = -1;

      feats.forEach(f => {
        // Flatten geometry to get all [lng, lat] pairs
        const coords = f.geometry.coordinates.flat(Infinity);
        for (let i = 0; i < coords.length; i += 2) {
          const lng = coords[i];
          const lat = coords[i+1];
          const key = `${lng.toFixed(7)},${lat.toFixed(7)}`;
          
          coordCounts[key] = (coordCounts[key] || 0) + 1;
          
          if (coordCounts[key] > maxOccurrence) {
            maxOccurrence = coordCounts[key];
            antennaBasePoint = [lng, lat];
          }
        }
      });

      // Fallback if no shared point is found
      if (!antennaBasePoint) return;

      feats.forEach((feature) => {
        const cellName = String(feature.properties?.cellname || "").trim();
        if (!selectedCells.includes(cellName)) return;

        const tech = (feature.properties?.band || "").startsWith("N") ? "5G" : "4G";
        const taData = taDataset[cellName]?.[tech];
        if (!taData) return;

        // 3️⃣ Normalize TA data
        const rawSegments = Array.from({ length: 12 }, (_, i) => taData[`TAI${i}`] ?? 0);
        const total = rawSegments.reduce((s, v) => s + v, 0);
        const segments = total > 0 ? rawSegments.map(v => v / total) : rawSegments;

        const azimuth = parseFloat(feature.properties.azimuth || feature.properties.Azimuth || 0);

        // 4️⃣ BUILD BARS FROM antennaBasePoint (The Black Dot)
        const barPolys = buildStackedBarPolygons(antennaBasePoint, azimuth, segments, {
          offset: 3,   
          thickness: 4, 
          valueFactor: 80  
        });

        // 5️⃣ Create Features
        barPolys.forEach((poly, idx) => {
          if (!poly.polygon || poly.polygon.length === 0) return;
          allTABars.push({
            type: "Feature",
            geometry: { type: "Polygon", coordinates: [poly.polygon] },
            properties: {
              taIndex: idx,
              site: cellName,
              azimuth,
              value: (segments[idx] * 100).toFixed(1) + "%",
              raw: rawSegments[idx]
            }
          });
        });
      });
    });
  }

  // 6️⃣ Push to Mapbox Source
  const geojson = { type: "FeatureCollection", features: allTABars };

  if (!map.getSource("ta-bars")) {
    map.addSource("ta-bars", { type: "geojson", data: geojson });
    map.addLayer({
      id: "ta-bars",
      type: "fill",
      source: "ta-bars",
      paint: {
        "fill-color": [
          "match", ["get", "taIndex"],
          0, "#4CAF50", 1, "#8BC34A", 2, "#CDDC39", 3, "#FFC107",
          4, "#FF9800", 5, "#FF5722", 6, "#F44336", 7, "#E91E63",
          8, "#9C27B0", 9, "#673AB7", 10, "#3F51B5", 11, "#2196F3",
          "#999"
        ],
        "fill-opacity": 0.9,
        "fill-outline-color": "#ffffff"
      }
    });

    // Cursors
    map.on("mouseenter", "ta-bars", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "ta-bars", () => (map.getCanvas().style.cursor = ""));
  } else {
    map.getSource("ta-bars").setData(geojson);
  }
}, [tableType, selectedCells, sectorsRef.current, taDataset]);



useEffect(() => {
  async function initPolygonCounter() {
    const res = await fetch(
      `${import.meta.env.VITE_API_URL}/geo-api/polygon/user_polygon_list`,

      {
        headers: {
          Authorization: `Token ${token}`,
        },
      }
    );

    if (!res.ok) {
      console.error("Failed to fetch polygons");
      return;
    }

  const data = await res.json();   
    setListpolygon(data.results)
    const polygons = data.results || [];

   

    let maxIndex = -1;

    polygons.forEach((p) => {
      const parts = p.zone_id.split("_");
      const num = parseInt(parts[1], 10);
      if (!isNaN(num) && num > maxIndex) {
        maxIndex = num;
      }
    });

    setPolygonCount(maxIndex + 1);
  }

  if (isLoggedIn) {
    initPolygonCounter();
  }
}, [isLoggedIn, token]);


const initializeDrawingTools = (map) => {
  if (drawRef.current) {
    console.log("Draw already initialized, skipping");
    return;
  }

  console.log("Starting Draw initialization...");

  try {
    // Initialize Mapbox Draw with custom styles
    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {
        polygon: false,
        trash: false,
      },
      modes: {
        ...MapboxDraw.modes,
        draw_circle: CircleMode,
        draw_freehand: FreehandMode,
      },
      styles: [
        // Inactive polygon fill
        {
          id: "gl-draw-polygon-fill-inactive",
          type: "fill",
          filter: ["all", ["==", "$type", "Polygon"], ["!=", "mode", "static"]],
          paint: {
            "fill-color": ["coalesce", ["get", "fillColor"], "#3b82f6"],
            "fill-opacity": 0.4,
          },
        },
        // Active polygon fill
        {
          id: "gl-draw-polygon-fill-active",
          type: "fill",
          filter: ["all", ["==", "$type", "Polygon"], ["!=", "mode", "static"]],
          paint: {
            "fill-color": ["coalesce", ["get", "fillColor"], "#2563eb"],
            "fill-opacity": 0.6,
          },
        },
        // Polygon outline
        {
          id: "gl-draw-polygon-stroke",
          type: "line",
          filter: ["all", ["==", "$type", "Polygon"], ["!=", "mode", "static"]],
          paint: {
            "line-color": "#000000",
            "line-width": 2,
          },
        },
        // Draw-time vertices halo
        {
          id: "gl-draw-polygon-and-line-vertex-halo-active",
          type: "circle",
          filter: ["all", ["==", "$type", "Point"], ["!=", "meta", "midpoint"]],
          paint: {
            "circle-radius": 6,
            "circle-color": ["coalesce", ["get", "fillColor"], "#3b92f6"],
            "circle-opacity": 0.8,
          },
        },
        // Draw-time vertices actual points
        {
          id: "gl-draw-polygon-and-line-vertex-active",
          type: "circle",
          filter: ["all", ["==", "$type", "Point"], ["!=", "meta", "midpoint"]],
          paint: {
            "circle-radius": 4,
            "circle-color": ["coalesce", ["get", "fillColor"], "#3b82f6"],
            "circle-opacity": 1,
          },
        },
      ],
    });

    // Add Draw to the map
    map.addControl(draw);
    drawRef.current = draw;
    console.log(" Draw control added and drawRef set");

    // Event listener: polygon creation
    map.on("draw.create", (e) => {
      const feature = e.features[0];
      if (!feature) return;

      // Assign random fill color
      const color = getRandomColor();
      draw.setFeatureProperty(feature.id, "fillColor", color);

      // Assign zone ID
      setPolygonCount((prev) => {
        const zoneId = `west_${prev}_${username}`;
        draw.setFeatureProperty(feature.id, "zone_id", zoneId);
        currentActiveZoneIdRef.current = zoneId;
        return prev + 1;
      });
    });

 
    setupDrawingListeners(map, draw);

    // Load existing polygons with unique colors
    loadExistingPolygons();

    console.log("✅ Draw initialization complete");

  } catch (error) {
    console.error("Error initializing Draw:", error);
    drawRef.current = null;
  }
};


  


 

  const setupDrawingListeners = (map, draw) => {
    console.log("🎯 Setting up drawing listeners...");

    // Mode change listener
    map.on("draw.modechange", (e) => {
      const mode = draw.getMode();
      console.log("📍 Drawing mode changed to:", mode);
      isDrawingRef.current = mode && (mode.includes("draw_polygon") || mode.includes("draw_freehand") || mode.includes("draw_circle"));
      
      // Set cursor when mode changes
      if (isDrawingRef.current) {
        const canvas = map.getCanvas();
        if (canvas) {
          canvas.style.cursor = "crosshair";
          console.log("✅ Cursor set to crosshair on mode change");
        }
      }
    });





    



    // Draw create listener - set zone ID on new polygon
    map.on("draw.create", (e) => {
      const feature = e.features[0];
      if (!feature) return;

      const color = getRandomColor();
      draw.setFeatureProperty(feature.id, "fillColor", color);

    
      setPolygonCount((prev) => {
        const zoneId = `west_${prev}_${username}`;
        draw.setFeatureProperty(feature.id, "zone_id", zoneId);
        currentActiveZoneIdRef.current = zoneId;
        return prev + 1;
      });

      
    });


      map.on("load", () => {
  // inactive polygons
  map.addLayer({
    id: "draw-fill-inactive",
    type: "fill",
    source: "mapbox-gl-draw-cold",
    filter: ["==", ["get", "$type"], "Polygon"],
    paint: {
      "fill-color": ["coalesce", ["get", "fillColor"], "#3b82f6"],
      "fill-opacity": 0.4
    }
  });

  // active polygon
  map.addLayer({
    id: "draw-fill-active",
    type: "fill",
    source: "mapbox-gl-draw-hot",
    filter: ["==", ["get", "$type"], "Polygon"],
    paint: {
      "fill-color": ["coalesce", ["get", "fillColor"], "#2563eb"],
      "fill-opacity": 0.6
    }
  });
});



      



    map.on("draw.update", handleDrawingComplete);

    // Global click handler for CSV and Submit buttons
    const handleGlobalClick = (e) => {
      if (e.target.id === "export-csv-btn") {
        handleExportCSV();
      }
      if (e.target.id === "submit-db-btn") {
        handleSubmitToBackend();
      }
    };

    // Map click listener for site detection and polygon clicks
    map.on("click", handleMapClick);

    // Setup cursor handling for polygon hover
    setupCursorHandling(map, draw);

    // Right-click or Escape to finish drawing
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && isDrawingRef.current) {
        console.log("✋ Escape pressed, finishing drawing...");
        draw.changeMode("simple_select");
      }
    };

    // Right-click context menu - finish drawing
    const handleContextMenu = (e) => {
      if (isDrawingRef.current) {
        e.preventDefault();
        console.log("✋ Right-click, finishing drawing...");
        draw.changeMode("simple_select");
      }
    };

    document.addEventListener("click", handleGlobalClick);
    document.addEventListener("keydown", handleKeyDown);
    map.getCanvas().addEventListener("contextmenu", handleContextMenu);

    // Cleanup function
    return () => {
      document.removeEventListener("click", handleGlobalClick);
      document.removeEventListener("keydown", handleKeyDown);
      map.getCanvas().removeEventListener("contextmenu", handleContextMenu);
    };
  };


  const activateTool = (mode) => {
    

    // Country already selected, activate directly
    if (!drawRef.current) {
      setTimeout(() => {
        if (drawRef.current) {
    
          activateTool(mode);
        } else {
          if (mapInstance.current) {
            console.log("🔧 Force initializing Draw...");
            initializeDrawingTools(mapInstance.current);
            setTimeout(() => {
              activateTool(mode);
            }, 300);
          }
        }
      }, 500);
      return;
    }

    try {
      drawRef.current.changeMode(mode);
      
      // Set cursor immediately and after mode change settles
      const setCursor = () => {
        if (mapInstance.current) {
          const canvas = mapInstance.current.getCanvas();
          if (canvas) {
            canvas.style.cursor = "crosshair";
  
          }
        }
      };
      
      setCursor();
      
      setTimeout(() => {
        setCursor();
      }, 100);
    } catch (error) {
      console.error(" Error activating tool:", error);
    }
  };

  const handleDrawingComplete = () => {
    console.log("✏️ Drawing completed");
    if (!drawRef.current) return;

    const data = drawRef.current.getAll();
    if (data.features.length === 0) return;

    const lastFeature = data.features[data.features.length - 1];
    console.log("📦 Last drawn feature:", lastFeature);

    // Detect clicked sites within polygon
    detectClickedSites(lastFeature);
  };

  // *** FUNCTION 7: DETECT CLICKED SITES ***
  const detectClickedSites = (polygon) => {
    // Get site data from geojsonData
    const sites = geojsonData?.features || [];
    
    if (!sites || sites.length === 0) {
      console.warn("⚠️ No site data available");
      currentMatchedSitesRef.current = [];
      showZonePopup(polygon, []);
      return;
    }

    const matchedSites = [];
    sites.forEach((feature) => {
      try {
        if (feature && feature.geometry) {
          let coordinates = null;
          
          // Handle Point geometry
          if (feature.geometry.type === "Point" && feature.geometry.coordinates) {
            coordinates = feature.geometry.coordinates;
          }
          // Handle properties with Lat/Long
          else if (feature.properties) {
            const lat = feature.properties.Lat || feature.properties.LATITUDE || feature.properties.latitude;
            const lon = feature.properties.Long || feature.properties.LONGITUDE || feature.properties.longitude;
            if (lat != null && lon != null) {
              coordinates = [lon, lat];
            }
          }

          if (coordinates) {
            const point = turf.point(coordinates);
            if (turf.booleanPointInPolygon(point, polygon)) {
              matchedSites.push(feature);
            }
          }
        }
      } catch (err) {
        console.warn("Error checking point in polygon:", err);
      }
    });

    currentMatchedSitesRef.current = matchedSites;
    console.log(`🎯 Found ${matchedSites.length} sites in polygon`);

    // Show popup with zone info
    showZonePopup(polygon, matchedSites);
  };

  // *** FUNCTION 8: SHOW ZONE POPUP ***
  const showZonePopup = (polygon, sites) => {
    const draw = drawRef.current;
    if (!draw) return;

    // Find or create zone ID
    let zoneId = currentActiveZoneIdRef.current;
    if (!zoneId) {
      const countryPrefix = "UK"; // Default country
      zoneId = `${countryPrefix}_${polygonCount}_${username}`;
      currentActiveZoneIdRef.current = zoneId;
    }

    // Build site list HTML - handle various property names
    const siteList =
      sites.length === 0
        ? "<i style=\"color: #999;\">No sites found</i>"
        : sites
            .slice(0, 15)
            .map((s) => {
              const props = s.properties || {};
              const siteName = props.SITENAME || props.sitename || props["SITE NAME"] || props.site_name || props["SITE ID"] || props.site_id || "Unknown Site";
              return `<div style="padding: 4px 6px; border-bottom: 1px solid #eee; font-size: 11px;">
                  ${siteName}
                </div>`;
            })
            .join("");

    // Create popup content
    const popupContent = document.createElement("div");
    popupContent.innerHTML = `
      <div style="padding: 12px; font-size: 12px; color: #333; min-width: 240px; max-width: 280px;">
        <div style="margin-bottom: 8px;">
          <strong style="font-size: 13px;">Zone ID:</strong><br/>
          <span style="font-size: 11px; color: #666;">${zoneId}</span>
        </div>
        
        <div style="margin-bottom: 8px; display: flex; gap: 6px;">
          <button id="export-csv-btn" style="flex: 1; padding: 6px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: 500;">
            📊 Export CSV
          </button>
          <button id="submit-db-btn" style="flex: 1; padding: 6px; background: #10b981; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: 500;">
            💾 Save DB
          </button>
        </div>

        <div style="margin-bottom: 6px;">
          <strong>Total Sites:</strong> <span style="background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-weight: 600;">${sites.length}</span>
        </div>

        <div style="margin-bottom: 6px; background: #f9f9f9; border-radius: 4px; max-height: 140px; overflow-y: auto; border: 1px solid #e0e0e0;">
          ${siteList}
        </div>

        <div style="font-size: 10px; color: #999; text-align: center; padding-top: 6px; border-top: 1px solid #e0e0e0;">
          Right-click to close polygon
        </div>
      </div>
    `;

    // Remove old popup
    if (popupRef.current) {
      popupRef.current.remove();
    }

    // Create new popup at polygon center
    const center = turf.centroid(polygon);
    popupRef.current = new mapboxgl.Popup({ closeOnClick: true })
      .setLngLat(center.geometry.coordinates)
      .setDOMContent(popupContent)
      .addTo(mapInstance.current);

    // Attach event listeners to buttons
    setTimeout(() => {
      const csvBtn = document.getElementById("export-csv-btn");
      const submitBtn = document.getElementById("submit-db-btn");

      if (csvBtn) {
        csvBtn.addEventListener("click", handleExportCSV);
      }

      if (submitBtn) {
        submitBtn.addEventListener("click", handleSubmitToBackend);
      }
    }, 0);
  };

const handleMapClick = (e) => {
  const map = mapInstance.current;
  const draw = drawRef.current;
  if (!map || !draw) return;


  if (isDrawingRef.current) return;

  const ids = draw.getFeatureIdsAt(e.point);
  if (ids && ids.length > 0) {
    const feature = draw.get(ids[0]);
    if (feature?.geometry?.type === "Polygon") {
      map.getCanvas().style.cursor = "pointer";
      detectClickedSites(feature);
      return;
    }
  }


  const features = map.queryRenderedFeatures(e.point, {
    layers: ["user-polygons-fill", "selected-polygon-fill"],
  });

  if (!features.length) {
    map.getCanvas().style.cursor = "default";
    if (popupRef.current) popupRef.current.remove();
    return;
  }

  const polygon = features[0];
  map.getCanvas().style.cursor = "pointer";

  detectClickedSites({
    type: "Feature",
    geometry: polygon.geometry,
    properties: polygon.properties || {},
  });
};
  // *** FUNCTION 6: SETUP CURSOR HANDLING ***
  const setupCursorHandling = (map, draw) => {
    map.on("mousemove", (e) => {
      const ids = draw.getFeatureIdsAt(e.point);
      if (ids && ids.length > 0) {
        // Hovering over polygon
        map.getCanvas().style.cursor = "pointer";
      } else if (!isDrawingRef.current) {
        // Not hovering over polygon and not drawing
        map.getCanvas().style.cursor = "default";
      }
    });
  };

  // *** FUNCTION 9: HANDLE EXPORT CSV ***
  
  const handleExportCSV = () => {
    if (currentMatchedSitesRef.current.length === 0) {
      toast.error("No sites to export");
      return;
    }

    try {
      const csv = Papa.unparse(
        currentMatchedSitesRef.current.map((s) => s.properties)
      );
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([csv]));
      link.download = `${currentActiveZoneIdRef.current}.csv`;
      link.click();
      console.log("✅ CSV exported");
    } catch (error) {
      console.error("Error exporting CSV:", error);
      toast.error("Error exporting CSV");
    }
  };

  // *** FUNCTION 10: HANDLE SUBMIT TO BACKEND ***
 
  const handleSubmitToBackend = async () => {
    const token = checkCookieExpiration().userData.token
    if (!token) {
      toast.error("Session expired. Please login again.");
      redirectToLogin();
      return;
    }

    const draw = drawRef.current;
    if (!draw) {
      toast.error("Drawing tools not ready");
      return;
    }

    const zoneId = currentActiveZoneIdRef.current;
    const sites = currentMatchedSitesRef.current;

  

    if (!zoneId) {
      toast.error("No zone ID set");
    }

    const allFeatures = draw.getAll().features;
    const currentPolygon = allFeatures.find((f) => f.properties?.zone_id === zoneId);


    if (!currentPolygon) {
      toast.error("Could not find the polygon geometry to save.");
      return;
    }

    const payload = {
      zoneId,
      country: "UK",
      site_data: {
        feature: currentPolygon,
        matched_sites: sites.map((s) => s.properties),
      },
      timestamp: new Date().toISOString(),
    };

    console.log(payload, "payload");


  const savePromise = fetch(
      `${import.meta.env.VITE_API_URL}/geo-api/polygon/save_polygon`,

      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify(payload),
      }
    );

    toast.promise(savePromise, {
      loading: 'Saving polygon...',
      success: (res) => {
        if (!res.ok) throw new Error('Server error');
        return 'Polygon saved successfully! ✅';
      },
      error: (err) => `Error: ${err.message || 'Network error'} ❌`,
    });
};


const drawAndZoomSelectedPolygon = (polygon) => {
  const map = mapInstance.current;
  if (!map) return;

  let feature = null;

  // Case 1: Saved GeoJSON
  if (polygon.site_data?.feature) {
    feature = {
      ...polygon.site_data.feature,
      id: polygon.id,
      properties: {
        ...polygon.site_data.feature.properties,
        zone_id: polygon.zone_id,
        country: polygon.country,
      },
    };
  }
  // Case 2: Coordinate array
  else if (Array.isArray(polygon.site_data)) {
    const points = polygon.site_data.map((p) => [
      p.LONGITUDE,
      p.LATITUDE,
    ]);

    if (
      points[0][0] !== points[points.length - 1][0] ||
      points[0][1] !== points[points.length - 1][1]
    ) {
      points.push(points[0]);
    }

    feature = turf.polygon([points], {
      zone_id: polygon.zone_id,
      id: polygon.id,
    });
    feature.id = polygon.id;
  }

  if (!feature) return;

  // 🔴 Remove old
  if (map.getLayer("selected-polygon-fill")) {
    map.removeLayer("selected-polygon-fill");
    map.removeLayer("selected-polygon-outline");
    map.removeSource("selected-polygon");
  }

  // 🟢 Add source
  map.addSource("selected-polygon", {
    type: "geojson",
    data: feature,
  });

  map.addLayer({
    id: "selected-polygon-fill",
    type: "fill",
    source: "selected-polygon",
    paint: {
      "fill-color": "#22c55e",
      "fill-opacity": 0.5,
    },
  });

  map.addLayer({
    id: "selected-polygon-outline",
    type: "line",
    source: "selected-polygon",
    paint: {
      "line-color": "#72a316",
      "line-width": 2,
    },
  });

  // 🟢 Zoom
  const coords =
    feature.geometry.type === "MultiPolygon"
      ? feature.geometry.coordinates.flat(2)
      : feature.geometry.coordinates[0];

  const bounds = coords.reduce(
    (b, c) => b.extend(c),
    new mapboxgl.LngLatBounds(coords[0], coords[0])
  );

  map.fitBounds(bounds, {
    padding: 60,
    duration: 1000,
  });

  // ✅ Auto open popup AFTER zoom
  map.once("moveend", () => {
    detectClickedSites(feature);
  });
};









const handleApply = () => {
  if (!userselectedPolygon) return;

  isDrawingRef.current = false;

  drawAndZoomSelectedPolygon(userselectedPolygon);
  setShowPolygonList(false);
};







  // *** FUNCTION 11: LOAD EXISTING POLYGONS ***
  const loadExistingPolygons = async () => {
  const token = checkCookieExpiration().userData.token;
  if (!token) {
    alert("Session expired. Please login again.");
    return;
  }

  try {
    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/geo-api/polygon/user_polygon_list`,
      {
        headers: { Authorization: `Token ${token}` },
      }
    );

    const data = await response.json();
    console.log(data, "polygons data");

    if (data.success && data.results) {
      const map = mapInstance.current;
      if (!map) return;

      // 🔴 Remove previous polygon layers and source
      if (map.getLayer("user-polygons-fill")) {
        map.removeLayer("user-polygons-fill");
      }
      if (map.getLayer("user-polygons-outline")) {
        map.removeLayer("user-polygons-outline");
      }
      if (map.getSource("user-polygons")) {
        map.removeSource("user-polygons");
      }

      // Generate features with unique color for each
      const features = data.results
        .map((item, idx) => {
          // Generate a unique color using HSL or any method
          const color = `hsl(${(idx * 50) % 360}, 70%, 50%)`; // different hue for each

          // Case 1: GeoJSON feature exists
          if (item.site_data?.feature) {
            return {
              ...item.site_data.feature,
              id: item.id,
              properties: {
                ...item.site_data.feature.properties,
                zone_id: item.zone_id,
                country: item.country,
                color, // add dynamic color here
              },
            };
          }

          // Case 2: Array of coordinates
          if (Array.isArray(item.site_data) && item.site_data.length > 2) {
            const points = item.site_data.map((s) => [s.LONGITUDE, s.LATITUDE]);
            if (
              points[0][0] !== points[points.length - 1][0] ||
              points[0][1] !== points[points.length - 1][1]
            ) {
              points.push(points[0]); // close polygon
            }

            const polygon = turf.polygon([points], {
              zone_id: item.zone_id,
              id: item.id,
              color, // add dynamic color here
            });
            polygon.id = item.id;
            return polygon;
          }

          return null;
        })
        .filter((f) => f !== null);

      if (features.length === 0) {
        console.warn("No valid polygons found");
        return;
      }

      // 🟢 Add GeoJSON source
      map.addSource("user-polygons", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features,
        },
      });

      // Fill layer with data-driven color
      map.addLayer({
        id: "user-polygons-fill",
        type: "fill",
        source: "user-polygons",
        paint: {
          "fill-color": ["get", "color"], // use the feature's 'color' property
          "fill-opacity": 0.5,
        },
      });

      // Outline layer
      map.addLayer({
        id: "user-polygons-outline",
        type: "line",
        source: "user-polygons",
        paint: {
          "line-color": "#000000",
          "line-width": 1.5,
        },
      });

      console.log("✅ Polygons loaded successfully with unique colors");
    } else {
      console.warn("No polygons found");
    }
  } catch (err) {
    console.error("Error loading polygons:", err);
    alert("Error loading polygons");
  }
};


  const rebuildMapSourcesAndLayers = () => {
    console.log("🟠 rebuildMapSourcesAndLayers() called");

    const map = mapInstance.current;
    if (!map) return;

    // --- Re-add all sources if missing ---
    const ensureSource = (id) => {
      if (!map.getSource(id)) {
        map.addSource(id, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
    };

    ensureSource("sectors");
    ensureSource("drive-test");
    ensureSource("grid-map");
    ensureSource("highlighted-feature");
    ensureSource("ruler-geojson");

    // --- Re-add all layers if missing ---
    const ensureLayer = (id, layerDef) => {
      if (!map.getLayer(id)) {
        map.addLayer(layerDef);
      }
    };

    ensureLayer("sector-layer", {
      id: "sector-layer",
      type: "fill",
      source: "sectors",
      paint: {
        "fill-color": [
          "coalesce",
          ["get", "fillColor"],
          ["get", "color"],
          "#9ca3af",
        ],
        "fill-opacity": 0.7,
        "fill-outline-color": "#111",
      },
    });

    ensureLayer("driveTest-points", {
      id: "driveTest-points",
      type: "circle",
      source: "drive-test",
      paint: {
        "circle-radius": 4,
        "circle-color": "#666",
      },
    });

    ensureLayer("gridMap-points", {
      id: "gridMap-points",
      type: "circle",
      source: "grid-map",
      paint: {
        "circle-radius": 4,
        "circle-color": "#888",
      },
    });

    ensureLayer("gridMap-heatmap", {
      id: "gridMap-heatmap",
      type: "heatmap",
      source: "grid-map",
      paint: {
        "heatmap-weight": 0.6,
        "heatmap-radius": 15,
        "heatmap-opacity": 0.6,
      },
    });

    ensureLayer("highlighted-feature-layer", {
      id: "highlighted-feature-layer",
      type: "circle",
      source: "highlighted-feature",
      paint: {
        "circle-radius": 10,
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": "#ff0000",
        "circle-stroke-width": 2,
      },
    });

    ensureLayer("ruler-line", {
      id: "ruler-line",
      type: "line",
      source: "ruler-geojson",
      paint: {
        "line-color": "#111111",
        "line-width": 2,
      },
      filter: ["==", ["geometry-type"], "LineString"],
    });

    ensureLayer("ruler-points", {
      id: "ruler-points",
      type: "circle",
      source: "ruler-geojson",
      paint: {
        "circle-radius": 4,
        "circle-color": "#111111",
      },
      filter: ["==", ["geometry-type"], "Point"],
    });

    // 🆕 RESTORE LATEST DATA INTO SOURCES
    try {
      if (map.getSource("sectors") && sectorsRef.current) {
        map.getSource("sectors").setData(sectorsRef.current);
      }
      if (map.getSource("drive-test") && driveTestRef.current) {
        map.getSource("drive-test").setData(driveTestRef.current);
      }
      if (map.getSource("grid-map") && gridRef.current) {
        map.getSource("grid-map").setData(gridRef.current);
      }
      if (map.getSource("highlighted-feature") && highlightRef.current) {
        map.getSource("highlighted-feature").setData(highlightRef.current);
      }
      if (map.getSource("ruler-geojson")) {
        map.getSource("ruler-geojson").setData(rulerGeoJSON.current);
      }
    } catch (e) {
      console.warn("rebuildMapSourcesAndLayers setData error:", e);
    }
  };
const findOriginalFeature = (clickedProps, geojsonData) => {
  if (!geojsonData?.features?.length) return null;

  const siteId = normalize(getSiteId(clickedProps));
  const cell = normalize(getCellName(clickedProps));
  const band = normalize(getBand(clickedProps));
  const date =
    clickedProps.Date ||
    clickedProps.date ||
    clickedProps.D1DATE ||
    clickedProps.Delta_Date;

  return geojsonData.features.find((f) => {
    const p = f.properties || {};
    return (
      normalize(getSiteId(p)) === siteId &&
      (!cell || normalize(getCellName(p)) === cell) &&
      (!band || normalize(getBand(p)) === band) &&
      (!date || String(p.Date || p.date || "").includes(String(date)))
    );
  });
};
const findRepresentativeCell = (props, geojsonData) => {
  if (!geojsonData?.features?.length) return null;

  const siteId = normalize(getSiteId(props));
  const band = normalize(getBand(props));
  const date =
    props.Date ||
    props.date ||
    props.D1DATE ||
    props.Delta_Date;

  if (!siteId) return null;

  // 1️⃣ Same site + same band + same date
  let f = geojsonData.features.find((feat) => {
    const p = feat.properties || {};
    return (
      normalize(getSiteId(p)) === siteId &&
      normalize(getBand(p)) === band &&
      getCellName(p) &&
      date &&
      String(p.Date || p.date || "").includes(String(date))
    );
  });
  if (f) return f;

  // 2️⃣ Same site + same band (IGNORE DATE) ⭐ KEY FIX
  f = geojsonData.features.find((feat) => {
    const p = feat.properties || {};
    return (
      normalize(getSiteId(p)) === siteId &&
      normalize(getBand(p)) === band &&
      getCellName(p)
    );
  });
  if (f) return f;

  // 3️⃣ Same site + any cell (IGNORE band + date)
  return (
    geojsonData.features.find((feat) => {
      const p = feat.properties || {};
      return (
        normalize(getSiteId(p)) === siteId &&
        getCellName(p)
      );
    }) || null
  );
};


  /* ---------------- Map init ---------------- */
  useEffect(() => {
    if (mapInstance.current) return;

    const map = new mapboxgl.Map({
      container: mapRef.current,
      style: internalStyle,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });


    mapInstance.current = map;
    map.addControl(new mapboxgl.NavigationControl());

    map.on("load", () => {
      // baseline sources
      if (!map.getSource("sectors")) {
        map.addSource("sectors", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      if (!map.getSource("drive-test")) {
        map.addSource("drive-test", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      if (!map.getSource("grid-map")) {
        map.addSource("grid-map", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      if (!map.getSource("highlighted-feature")) {
        map.addSource("highlighted-feature", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      // glow points for KPI failure mode
      if (!map.getSource("kpi-glow-points")) {
        map.addSource("kpi-glow-points", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      // add NOC-style pulse layer
      addPulseLayer(map);

      // Ruler source
      if (!map.getSource("ruler-geojson")) {
        map.addSource("ruler-geojson", {
          type: "geojson",
          data: rulerGeoJSON.current,
        });
      }

      // sector layer
      if (!map.getLayer("sector-layer")) {
        map.addLayer({
          id: "sector-layer",
          type: "fill",
          source: "sectors",
          paint: {
            "fill-color": [
              "coalesce",
              ["get", "fillColor"],
              ["get", "color"],
              "#9ca3af",
            ],
            "fill-opacity": 0.7,
            "fill-outline-color": "#111",
          },
        });
      }

      // glowing dot layer for KPI sites
      if (!map.getLayer("kpi-glow-layer")) {
        map.addLayer({
          id: "kpi-glow-layer",
          type: "circle",
          source: "kpi-glow-points",
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              5, 3,
              12, 8,
            ],
            "circle-color": "#ff0000",
            "circle-opacity": 0.8,
            "circle-blur": 0.6,
          },
        });
      }

      // drive test layer
      if (!map.getLayer("driveTest-points")) {
        map.addLayer({
          id: "driveTest-points",
          type: "circle",
          source: "drive-test",
          paint: {
            "circle-radius": 4,
            "circle-color": "#666",
          },
        });
      }

      // grid map layers
      if (!map.getLayer("gridMap-points")) {
        map.addLayer({
          id: "gridMap-points",
          type: "circle",
          source: "grid-map",
          paint: {
            "circle-radius": 4,
            "circle-color": "#888",
          },
        });
      }
      if (!map.getLayer("gridMap-heatmap")) {
        map.addLayer({
          id: "gridMap-heatmap",
          type: "heatmap",
          source: "grid-map",
          paint: {
            "heatmap-weight": 0.6,
            "heatmap-radius": 15,
            "heatmap-opacity": 0.6,
          },
        });
      }
      // ⭐ ADD THIS: Global polygon loader for uploaded ZIP shapefile
      window.loadPolygonLayer = function (geojson) {
      console.log("🌍 Loading custom polygon layer...", geojson);

      const map = mapInstance.current;
      if (!map) {
        console.error("❌ Map instance is not ready.");
        return;
      }

      // Remove old layers and sources if they exist
      if (map.getLayer("custom-polygon-fill")) {
        map.removeLayer("custom-polygon-fill");
      }
      if (map.getLayer("custom-polygon-outline")) {
        map.removeLayer("custom-polygon-outline");
      }
      if (map.getSource("custom-polygon-source")) {
        map.removeSource("custom-polygon-source");
      }

      // Add a new GeoJSON source
      map.addSource("custom-polygon-source", {
        type: "geojson",
        data: geojson,
      });

      // Verify GeoJSON source
      const source = map.getSource("custom-polygon-source");
      if (source) {
        console.log("✅ GeoJSON source loaded:", source._data);
      } else {
        console.error("❌ GeoJSON source not found.");
        return;
      }

      // Inspect GeoJSON features
      geojson.features.forEach((feature) => {
        console.log("Feature Geometry:", feature.geometry);
        console.log("Feature Properties:", feature.properties);
      });

      const fillColorExpression = buildMatchExpression(geojson);

      // Add the fill layer with static color
      try {
        map.addLayer({
          id: "custom-polygon-fill",
          type: "fill",
          source: "custom-polygon-source",
          paint: {
            "fill-color": fillColorExpression,
            "fill-opacity": 0.8, 
          },
        });
        console.log("✅ Fill layer added successfully.");
      } catch (error) {
        console.error(" Error adding fill layer:", error);
      }

      // Add the outline layer
      try {
        map.addLayer({
          id: "custom-polygon-outline",
          type: "line",
          source: "custom-polygon-source",
          paint: {
            "line-color": "#ff40ff",
            "line-width": 2,
          },
        });
        console.log("✅ Outline layer added successfully.");
      } catch (error) {
        console.error(" Error adding outline layer:", error);
      }

    

      // Auto zoom to fit the polygon bounds
      try {
        const bbox = turf.bbox(geojson); // Calculate bounding box using Turf.js
        map.fitBounds(bbox, { padding: 40 });
      } catch (error) {
        console.warn("⚠️ Could not fit polygon bounding box:", error);
      }
    };

      // highlighted feature
      if (!map.getLayer("highlighted-feature-layer")) {
        map.addLayer({
          id: "highlighted-feature-layer",
          type: "circle",
          source: "highlighted-feature",
          paint: {
            "circle-radius": 10,
            "circle-color": "rgba(0,0,0,0)",
            "circle-stroke-color": "#ff0000",
            "circle-stroke-width": 2,
          },
        });
      }

      // Ruler layers
      if (!map.getLayer("ruler-line")) {
        map.addLayer({
          id: "ruler-line",
          type: "line",
          source: "ruler-geojson",
          paint: {
            "line-color": "#111111",
            "line-width": 2,
          },
          filter: ["==", ["geometry-type"], "LineString"],
        });
      }
      if (!map.getLayer("ruler-points")) {
        map.addLayer({
          id: "ruler-points",
          type: "circle",
          source: "ruler-geojson",
          paint: {
            "circle-radius": 4,
            "circle-color": "#111111",
          },
          filter: ["==", ["geometry-type"], "Point"],
        });
      }

      // click handler for sector layer
      map.on("click", "sector-layer", (e) => {
        if (!e.features?.length) return;
        const feat = e.features[0];
        const props = feat.properties || {};
        const siteId = getSiteId(props) || "Unknown";

        // const cell = getCellName(props);
        const cell = String(getCellName(props) || "")
        .split("_")[0]
        .split("-")[0]
        .trim();

        setSelectedCells(prev => {
          if (prev.includes(cell)) return prev;
          return [...prev, cell];
        });

        // popup
        const popupHtml = createPopupHtml(props, {
          Site_ID: siteId,
          Cell_Name: getCellName(props) || "N/A",
          Band: getBand(props) || "N/A",
          KPI: (() => {
            const raw = colorColumn ? props[colorColumn] ?? "N/A" : "N/A";
            if (tableType.toLowerCase().includes("alarm"))
              return remapAlarmValue(raw);
            if (tableType.toLowerCase().includes("traffic"))
              return remapTrafficValue(raw);
            return raw;
          })(),
        });

        new mapboxgl.Popup({ offset: 10 })
          .setLngLat(e.lngLat)
          .setHTML(popupHtml)
          .addTo(map);

        // Info panel
        // ⭐ Always refresh site info even if same site clicked
        // FINAL FIX — ALWAYS refresh the site info panel
        // Info panel — show EXACT clicked cell
        const normalizedSite = normalize(siteId);
        // 🔥 Resolve ORIGINAL feature (full data)
const originalFeature =
  findOriginalFeature(feat.properties || {}, geojsonData) || feat;

// Info panel now uses FULL source/target data
lastClickedOriginalFeatureRef.current = originalFeature;
showSiteInfoFromFeature(originalFeature);
setSelectedSiteIdState(normalize(siteId));
setShowInfoPanel(true);
// 👈 now CELL-based, not merged SITE
        setSelectedSiteIdState(normalizedSite);
        setShowInfoPanel(true);

        // notify parent for band dropdown etc.
        if (typeof onSiteClick === "function" && geojsonData?.features) {
          const siteFeatures = geojsonData.features.filter((f) => {
            const p = f.properties || {};
            return normalize(getSiteId(p)) === normalize(siteId);
          });
          onSiteClick(siteId, siteFeatures);
        }
      });

      // Ruler click handler
      map.on("click", (e) => {
        if (!rulerActiveRef.current) return;
        const coords = [e.lngLat.lng, e.lngLat.lat];

        const features = rulerGeoJSON.current.features;
        features.push({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: coords,
          },
          properties: {},
        });

        rulerLinestring.current.geometry.coordinates.push(coords);
        features[0] = rulerLinestring.current;

        const distanceKm = turf.length(rulerLinestring.current, {
          units: "kilometers",
        });
        if (distanceRef.current) {
          distanceRef.current.innerText = `${distanceKm.toFixed(2)} km`;
        }

        if (map.getSource("ruler-geojson")) {
          map.getSource("ruler-geojson").setData(rulerGeoJSON.current);
        }
      });
    });

    return () => {
      try {
        if (map.__pulseInterval) {
          clearInterval(map.__pulseInterval);
          console.log("🌀 cleared pulse animation interval");
        }
        map.remove();
      } catch (e) {
        // ignore
      }
      mapInstance.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- Derive unique bands & band colors ---------------- */
  useEffect(() => {
    if (!geojsonData?.features?.length) {
      setUniqueBands([]);
      setBandColorMap({});
      return;
    }

    const bands = Array.from(
      new Set(
        geojsonData.features
          .map((f) => getBand(f.properties || {}))
          .filter(Boolean)
          .map((b) => String(b).toUpperCase().trim())
      )
    ).sort((a, b) => bandNumber(a) - bandNumber(b));

    const nextMap = {};
    bands.forEach((b) => {
      if (bandColorMap[b]) {
        nextMap[b] = bandColorMap[b];
      } else {
        const h = hashToHue(b);
        nextMap[b] = hslToHex(h, 75, 55);
      }
    });

    setUniqueBands(bands);
    setBandColorMap(nextMap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geojsonData]);

  /* ---------------- Sector layer: build concentric band fans ---------------- */
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    console.log("🎬 SECTOR BUILDING EFFECT TRIGGERED:", {
      geojsonDataFeatures: geojsonData?.features?.length || 0,
      tableType,
      radiusScale,
      colorColumn,
      hasMap: !!map,
    });

    const empty = { type: "FeatureCollection", features: [] };

    if (!geojsonData?.features?.length) {
      console.warn("⚠️ No geojsonData - setting empty sectors");
      if (map.getSource("sectors")) map.getSource("sectors").setData(empty);
      return;
    }
    
    console.log("📦 Converting", geojsonData.features.length, "points to sectors...");
    // 🔄 Auto-convert Point geometries to Sector polygons
    const convertedGeojson = convertPointsToSectors(geojsonData, 1.5, 60);
    console.log("✅ Converted to", convertedGeojson.features.length, "sectors");

    let features = convertedGeojson.features;
    const tableTypeLower = (tableType || "").toLowerCase();

    // 👇 Detect CM Change mode + whether color_column is "remarks"
    const cmColorColumn = geojsonData?.color_config?.color_column || "";
    const isCmRemarks =
      tableTypeLower.includes("cm change") &&
      cmColorColumn.trim().toLowerCase() === "remarks";

    // ================= KPI FAILURE OVERRIDE =================
if (kpiFailureMode && kpiFailureGeoJSON?.features?.length) {
  console.log("🟥 KPI MODE ACTIVE — overriding sectors");
  const allFeatures = kpiFailureGeoJSON.features;
  console.log("📊 Total KPI features:", allFeatures.length);
  console.log("🎯 Selected techs:", selectedTechs);

  // 🔧 STEP 1 — FILTER with updated normalizeTech
  const filteredFeatures = allFeatures.filter((f) => {
    const tech = normalizeTech(
      f.properties?.tech ||
      f.properties?.Tech ||
      f.properties?.generation
    );

    const pass =
      selectedTechs.length === 0 ||
      (tech && selectedTechs.includes(tech));

    return pass;
  });

  console.log("✅ Filtered KPI features:", filteredFeatures.length);

  // 🔧 STEP 2 — GROUP BY SITE
  const bySite = {};
  filteredFeatures.forEach((f) => {
    const site =
      f.properties?.site_name ??
      f.properties?.SITE_NAME ??
      f.properties?.site_id;
    if (!site) return;
    if (!bySite[site]) bySite[site] = [];
    bySite[site].push(f);
  });

  console.log("🧭 Unique KPI sites:", Object.keys(bySite).length);

  // 🔧 STEP 3 — BUILD CONCENTRIC FANS PER SITE
  const TECH_RING_ORDER = ["2G", "3G", "4G", "5G"];
    const FIXED_FANS = [
      [0, 60],
      [120, 180],
      [240, 300],
    ];

    const wedges = [];
    const glowPoints = [];

    Object.entries(bySite).forEach(([site, feats]) => {
      console.log("🧭 Building site fans:", site);
      if (!feats.length) return;
      const lon = Number(feats[0].geometry?.coordinates?.[0]);
      const lat = Number(feats[0].geometry?.coordinates?.[1]);
      if (!isFinite(lon) || !isFinite(lat)) return;

      glowPoints.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties: {},
      });

      const siteTechs = Array.from(
        new Set(
          feats
            .map((f) =>
              normalizeTech(
                f.properties?.tech ||
                f.properties?.Tech ||
                f.properties?.generation
              )
            )
            .filter(Boolean)
        )
      );
    console.log("📡 Techs at site:", siteTechs);

    siteTechs.sort(
      (a, b) => TECH_RING_ORDER.indexOf(a) - TECH_RING_ORDER.indexOf(b)
    );

    siteTechs.forEach((tech, idx) => {
      const inner = idx * radiusScale;
      const outer = inner + radiusScale;

      FIXED_FANS.forEach(([start, end]) => {
        try {
          const poly = createRingSlice([lon, lat], inner, outer, start, end);

          const featForTech = feats.find((f) => {
            const tval = normalizeTech(
              f.properties?.tech ||
              f.properties?.Tech ||
              f.properties?.generation
            );
            return tval === tech;
          });
          const props = featForTech?.properties || {};

          const color = getKpiFailureColor(props.FAILED_KPIS);

          poly.properties = {
            ...props,
            fillColor: color,
            kpi_mode: true,
            site_id: site,
            tech,
          };

          wedges.push(poly);
        } catch (err) {
          console.warn("🧨 wedge reconstruction failed:", err);
        }
      });
    });
  });

  console.log("🧨 KPI wedge count:", wedges.length);
  console.log("🧨 Glow points count:", glowPoints.length);
  console.log("🧨 Sites processed:", Object.keys(bySite).length);

  // 🔧 STEP 4 — GEOMETRY VALIDATOR
  const validWedges = wedges.filter((w) => {
    const coords = w?.geometry?.coordinates;
    const ok =
      w?.geometry?.type === "Polygon" &&
      Array.isArray(coords) &&
      coords.length > 0;
    if (!ok) {
      console.warn("🧨 geometry validator rejected:", w);
    }
    return ok;
  });

  console.log("🧨 geometry validator passed:", validWedges.length);

  // 🔧 STEP 5 — PUSH FINAL COLLECTIONS
  const fc = { type: "FeatureCollection", features: validWedges };
  sectorsRef.current = fc;
  console.log("🔧 sectorsRef size:", fc.features.length);
  if (map.getSource("sectors")) {
    map.getSource("sectors").setData(fc);
    console.log("🗺️ KPI wedges pushed to map");

    // update pulse using original filtered KPI features
    const pulseFeatures = filteredFeatures.map((f) => ({
      type: "Feature",
      geometry: f.geometry,
      properties: {},
    }));
    if (map.getSource("pulse-points")) {
      map.getSource("pulse-points").setData({
        type: "FeatureCollection",
        features: pulseFeatures,
      });
    }
  }

  if (map.getSource("kpi-glow-points")) {
    map.getSource("kpi-glow-points").setData({
      type: "FeatureCollection",
      features: glowPoints,
    });
  }

  return; // ⛔ DO NOT REMOVE
}

    // 0) Precompute CM buckets (global) if needed (ONLY when NOT remarks mode)
    let cmBands = cmLegend && cmLegend.length ? cmLegend : null;
    // ⭐ ALWAYS sync from Sidebar colorRanges if available
if (colorColumn && colorRanges[colorColumn]) {
  cmBands = Object.entries(colorRanges[colorColumn]).map(
    ([color, [from, to]]) => ({
      from: Number(from),
      to: Number(to),
      color
    })
  );
}

    if (tableTypeLower.includes("cm change") && !cmBands && !isCmRemarks) {
      const scores = [];
      features.forEach((f) => {
        const p = f.properties || {};
        const candidate =
          p.TOTAL_SCORE ??
          p.total_score ??
          p["Total_Score"] ??
          p["Avg_Total_Score"] ??
          p["avg_total_score"];
        if (candidate != null && candidate !== "" && candidate !== "[NULL]") {
          const val = Number(String(candidate).replace(/,/g, "").trim());
          if (Number.isFinite(val)) scores.push(val);
        }
      });
      if (scores.length) {
        const min = Math.min(...scores);
        const max = Math.max(...scores);
        const buckets = 5;
        const step = (max - min) / (buckets || 1);
        const palette = ["#b91c1c", "#f97316", "#eab308", "#22c55e", "#15803d"];
        const localBands = [];
        for (let i = 0; i < buckets; i++) {
          const from = min + i * step;
          const to = i === buckets - 1 ? max : from + step;
          localBands.push({ from, to, color: palette[i] });
        }
        cmBands = localBands;
      }
    }

    // 1) group by site
    const sites = {};
    features.forEach((f) => {
      const props = f.properties || {};
      const siteId = getSiteId(props) || "UNKNOWN";
      if (!sites[siteId]) sites[siteId] = [];
      sites[siteId].push(f);
    });

    const sectorFeatures = [];

        // 🌈 GENERATION FAN MODE (FIXED CONCENTRIC GENERATION RINGS)
const hasGeneration = features.some((f) => f.properties?.generation);
console.log("🧪 hasGeneration =", hasGeneration, {
  expandBandMode,
  legendMode,
  totalFeatures: features.length,
});

if (hasGeneration && !expandBandMode) {
  console.log("🚀 ENTERED FIXED GENERATION FAN MODE");

  const SLICE_SPANS = [
    { start: 0, end: 60 },
    { start: 120, end: 180 },
    { start: 240, end: 300 },
  ];

  // 🔒 FIXED generation order (inner → outer)
  const GEN_ORDER = ["5G", "4G", "3G", "2G"];

  // 🔒 FIXED relative radii (scaled by radiusScale)
  const GEN_RADII = {
    "5G": { inner: 0.0, outer: 1.0 },
    "4G": { inner: 1.0, outer: 2.5 },
    "3G": { inner: 2.5, outer: 4.5 },
    "2G": { inner: 4.5, outer: 7.0 },
  };

  // --- Group features by site ---
  const bySite = {};
  features.forEach((f) => {
    const p = f.properties || {};
    const site = String(getSiteId(p) || "").trim();
    const gen = String(p.generation || "").toUpperCase();
    if (!site || !gen) return;
    if (!bySite[site]) bySite[site] = [];
    bySite[site].push(f);
  });

  Object.entries(bySite).forEach(([site, feats]) => {
    

    // 📍 Site centroid
    const cents = feats.map((f) => turf.centroid(f).geometry.coordinates);
    const cx = cents.reduce((s, c) => s + c[0], 0) / cents.length;
    const cy = cents.reduce((s, c) => s + c[1], 0) / cents.length;
    const center = [cx, cy];

    // Group by generation
    const byGen = {};
    feats.forEach((f) => {
      const g = String(f.properties?.generation || "").toUpperCase();
      if (!byGen[g]) byGen[g] = [];
      byGen[g].push(f);
    });

    // 🎯 Draw generations deterministically (inner → outer)
    GEN_ORDER.forEach((gen) => {
      const genFeats = byGen[gen];
      if (!genFeats || !genFeats.length) return;

      const R = GEN_RADII[gen];
      const innerR = R.inner * radiusScale;
      const outerR = R.outer * radiusScale;

      const color =
        generationColorMap[gen] || GENERATION_COLORS[gen] || "#777";

      

      SLICE_SPANS.forEach((span) => {
        const wedge = createRingSlice(
          center,
          innerR,
          outerR,
          span.start,
          span.end
        );

        const ref = genFeats[0].properties || {};
        const ct = turf.centroid(genFeats[0]).geometry.coordinates;

        sectorFeatures.push({
          type: "Feature",
          geometry: wedge.geometry,
          properties: {
            ...ref,
            site_id: site,
            generation: gen,
            color,
            fillColor: color,
            lat: ref.lat || ref.Lat || ct[1],
            lon: ref.lon || ref.Long || ct[0],
          },
        });
      });
    });
  });

  // 🚀 Push to map
  const fc = { type: "FeatureCollection", features: sectorFeatures };
  sectorsRef.current = fc;
  if (map.getSource("sectors")) {
    map.getSource("sectors").setData(fc);
  }

  setLegendMode("generation");
  setShowLegend(true);

  // 🔍 Auto zoom on DB change
  if (selectedDB && lastZoomedDB.current !== selectedDB) {
    lastZoomedDB.current = selectedDB;
    setTimeout(() => {
      try {
        const bbox = turf.bbox(fc);
        map.fitBounds(bbox, { padding: 60, maxZoom: 15, essential: true });
      } catch (e) {}
    }, 300);
  }

  return; // ⛔ skip normal band rendering
}

    // ⭐ FINAL — Balanced FIXED-RADIUS GEN + BAND MODE (perfect concentric)
    if (expandBandMode) {
      console.log("🎯 FIXED-GEN-RADIUS mode enabled (Balanced)");

      const map = mapInstance.current;
      if (!map || !geojsonData?.features?.length) return;

      const finalFeatures = [];

      // Fixed radii for ALL sites
      const GEN_ORDER = ["5G", "4G", "3G", "2G"]; // inner → outer
      const GEN_RADII = {
        "5G": { inner: 0.0, outer: 1.0 },
        "4G": { inner: 1.0, outer: 2.5 },
        "3G": { inner: 2.5, outer: 4.5 },
        "2G": { inner: 4.5, outer: 7.0 },
      };

      const SECTOR_WIDTH = 60; // uniform wedge
      const STEP = 3;
      const BAND_GAP = 0.04; // thin divider

      // --- Group by site ---
      const bySite = {};
      geojsonData.features.forEach((f) => {
        const site = normalize(getSiteId(f.properties || {}));
        if (!site) return;
        if (!bySite[site]) bySite[site] = [];
        bySite[site].push(f);
      });

      Object.entries(bySite).forEach(([siteId, feats]) => {
        if (!feats.length) return;

        // Site centroid
        const cents = feats.map((f) => turf.centroid(f).geometry.coordinates);
        const cx = cents.reduce((s, c) => s + c[0], 0) / cents.length;
        const cy = cents.reduce((s, c) => s + c[1], 0) / cents.length;
        const center = [cx, cy];

        // Build canonical sector centers so angles ALWAYS align
        const rawAz = feats
          .map((f) => getAzimuth(f.properties || {}, NaN))
          .filter((a) => Number.isFinite(a));

        let sectorCenters = [];
        if (rawAz.length) {
          const norm = rawAz.map((a) => ((a % 360) + 360) % 360);
          const mod120 = norm.map((a) => a % 120);
          const mean = mod120.reduce((s, v) => s + v, 0) / mod120.length;

          for (let i = 0; i < 3; i++) sectorCenters.push(mean + 120 * i);
        } else {
          sectorCenters = [0, 120, 240];
        }

        // Group by GEN
        const byGen = {};
        feats.forEach((f) => {
          const g = normalize(f.properties?.generation);
          if (!g) return;
          if (!byGen[g]) byGen[g] = [];
          byGen[g].push(f);
        });

        // Draw GEN rings from inside → outside
        GEN_ORDER.forEach((G) => {
          const cellsInGen = byGen[G];
          if (!cellsInGen || !cellsInGen.length) return;

          const R = GEN_RADII[G];
          const rInner = R.inner * radiusScale;
          const rOuter = R.outer * radiusScale;
          const thick = rOuter - rInner;

          const genColor =
            generationColorMap[G] || GENERATION_COLORS[G] || "#999";

          // Unique bands inside this generation
          const bands = Array.from(
            new Set(
              cellsInGen
                .map((f) => normalize(getBand(f.properties)))
                .filter(Boolean)
            )
          ).sort((a, b) => bandNumber(b) - bandNumber(a)); // high→low

          const bandCount = bands.length || 1;
          const bandThick = thick / bandCount;

          bands.forEach((bandName, idx) => {
            const bInner = rInner + idx * bandThick;
            const bOuter = rInner + (idx + 1) * bandThick;

            const gap = bandThick * BAND_GAP;
            const ringIn = bInner + gap * 0.5;
            const ringOut = bOuter - gap * 0.5;

            const bandCells = cellsInGen.filter(
              (f) => normalize(getBand(f.properties)) === normalize(bandName)
            );

            bandCells.forEach((cell) => {
              const props = cell.properties || {};

              let realAz = getAzimuth(props, 0);
              realAz = ((realAz % 360) + 360) % 360;

              // snap to nearest sector wedge
              let snapped = sectorCenters[0];
              let bestDiff = 999;
              sectorCenters.forEach((c) => {
                let d = Math.abs(realAz - c) % 360;
                d = d > 180 ? 360 - d : d;
                if (d < bestDiff) {
                  bestDiff = d;
                  snapped = c;
                }
              });

              const poly = createRingSlice(
                center,
                ringIn,
                ringOut,
                snapped - SECTOR_WIDTH / 2,
                snapped + SECTOR_WIDTH / 2,
                STEP
              );

              finalFeatures.push({
                type: "Feature",
                geometry: poly.geometry,
                properties: {
                  ...props,
                  site_id: siteId,
                  generation: G,
                  band: bandName,
                  fillColor: genColor, // ⭐ same GEN color
                  smooth_band: true,
                  ring_inner_km: ringIn,
                  ring_outer_km: ringOut,
                },
              });
            });
          });
        });
      });

      // send result to map
      const out = { type: "FeatureCollection", features: finalFeatures };
      sectorsRef.current = out;
      if (map.getSource("sectors")) map.getSource("sectors").setData(out);

      return; // stop normal mode
    }

    const rcaColorMap = {};
    // seed RCA color map with existing legend edits
    rcaLegend.forEach(({ issue, color }) => {
      if (issue) rcaColorMap[issue] = color;
    });

    Object.entries(sites).forEach(([siteId, feats]) => {
      // compute site center from centroids
      const cents = feats.map((f) => turf.centroid(f).geometry.coordinates);
      const cx = cents.reduce((s, c) => s + c[0], 0) / cents.length;
      const cy = cents.reduce((s, c) => s + c[1], 0) / cents.length;
      const center = [cx, cy];

      // ALL bands originally present at this site
      const allBandsAtSite = Array.from(
        new Set(
          feats
            .map((f) => getBand(f.properties || {}))
            .filter(Boolean)
            .map((b) => String(b).toUpperCase().trim())
        )
      ).sort((a, b) => bandNumber(a) - bandNumber(b));

      // Apply band filter at geometry level
      const bands =
        selectedUniqueBands && selectedUniqueBands.length
          ? allBandsAtSite.filter((b) =>
              selectedUniqueBands
                .map((x) => normalize(x))
                .includes(normalize(b))
            )
          : allBandsAtSite;

      if (!bands.length) {
        // fallback: single ring with no band
        feats.forEach((f, idx) => {
          const props = f.properties || {};
          const az = getAzimuth(props, (idx % 3) * 120);
          const poly = createRingSlice(
            center,
            0,
            radiusScale,
            az - 30,
            az + 30
          );
          let fillColor = "#9ca3af";

          if (
            props.generation &&
            !tableTypeLower.includes("rca") &&
            !tableTypeLower.includes("cm change") &&
            !tableTypeLower.includes("alarm") &&
            !tableTypeLower.includes("traffic")
          ) {
            const gen = String(props.generation).toUpperCase();
            fillColor =
              props.color ||
              generationColorMap[gen] ||
              GENERATION_COLORS[gen] ||
              fillColor;
          }

          sectorFeatures.push({
            type: "Feature",
            geometry: poly.geometry,
            properties: {
              ...props,
              site_id: siteId,
              band: "N/A",
              fillColor,
            },
          });
        });
        return;
      }

      const N = bands.length;
      const thickness = radiusScale / N;

      // now build ring-slice polygons
      bands.forEach((bandLabel, idx) => {
        const outerR = radiusScale - idx * thickness;
        const innerR = Math.max(0, outerR - thickness);

        const bandFeats = feats.filter(
          (f) => normalize(getBand(f.properties || {})) === normalize(bandLabel)
        );

        if (!bandFeats.length) return;

        const baseBandColor = bandColorMap[bandLabel] || "#9ca3af";

        bandFeats.forEach((fLocal, cellIdx) => {
          const props = fLocal.properties || {};
          let az = getAzimuth(props, (cellIdx % 3) * 120);
          if (!Number.isFinite(az)) az = (cellIdx % 3) * 120;

          const poly = createRingSlice(
            center,
            innerR,
            outerR,
            az - 30,
            az + 30
          );

          // ---- Color logic per cell ----
          let fillColor = baseBandColor;
          if (
            tableTypeLower.includes("alarm") ||
            tableTypeLower.includes("traffic")
          ) {
            fillColor = "#cccccc"; // temporary neutral before override
          }

          // 1) Generation mode (if feature has generation)
          if (
            props.generation &&
            !tableTypeLower.includes("rca") &&
            !tableTypeLower.includes("cm change") &&
            !tableTypeLower.includes("alarm") &&
            !tableTypeLower.includes("traffic")
          ) {
            const gen = String(props.generation).toUpperCase();
            fillColor =
              props.color ||
              generationColorMap[gen] ||
              GENERATION_COLORS[gen] ||
              fillColor;
          }

          // 2) RCA mode → color by issue bucket
          if (tableTypeLower.includes("rca")) {
            const rawIssue =
              getFirstProp(props, [
                "Issue/Analysis Bucket new",
                "issue/analysis bucket new",
                "Issue_Bucket",
                "Issue Bucket",
                "Issue",
              ]) || "[NULL]";

            const issue = String(rawIssue).trim() || "[NULL]";
            if (!rcaColorMap[issue]) {
              const palette = [
                "#f8fbfc",
                "#22c55e",
                "#3b82f6",
                "#f59e0b",
                "#8b5cf6",
                "#14b8a6",
                "#ec4899",
                "#84cc16",
                "#06b6d4",
                "#f97316",
                "#0ea5e9",
                "#a855f7",
              ];
              const idxColor = Object.keys(rcaColorMap).length % palette.length;
              rcaColorMap[issue] = palette[idxColor];
            }
            fillColor = rcaColorMap[issue];
          }

          // 3) CM Change → REMARKS categories OR TOTAL_SCORE buckets
          if (tableTypeLower.includes("cm change")) {
            if (isCmRemarks) {
              // 🎯 remarks-based coloring
              const rawRemark =
                props.remarks ??
                props.REMARKS ??
                props.Remarks ??
                props["Remarks"] ??
                props["remark"] ??
                props["REMARK"];

              const remark = String(rawRemark || "")
                .trim()
                .toLowerCase();
              if (!remark) {
                fillColor = "#cccccc";
              }

              const c = cmLegend || {};

              if (!remark) {
                fillColor = c.noRemarks || "#cccccc";
              } else if (remark.startsWith("improv")) {
                fillColor = c.improved || "#22c55e";
              } else if (remark.startsWith("neutral")) {
                fillColor = c.neutral || "#eab308";
              } else if (remark.startsWith("degrad")) {
                fillColor = c.degraded || "#ef4444";
              } else {
                fillColor = c.noRemarks || "#cccccc"; // unknown category
              }
            } else if (cmBands && cmBands.length) {
              // numeric TOTAL_SCORE mode
              const candidate =
                props.TOTAL_SCORE ??
                props.total_score ??
                props["Total_Score"] ??
                props["Avg_Total_Score"] ??
                props["avg_total_score"];
              const val =
                candidate == null
                  ? NaN
                  : Number(String(candidate).replace(/,/g, "").trim());
              if (Number.isFinite(val)) {
                const band = cmBands.find(
                  ({ from, to }) => val >= from && val <= to
                );
                if (band) fillColor = band.color;
              }
            }
          }

          // 4) Generic KPI mode (uses colorRanges[colorColumn]) — only if NOT RCA / CM / Alarm / Traffic
          if (
            colorColumn &&
            colorRanges[colorColumn] &&
            !tableTypeLower.includes("rca") &&
            !tableTypeLower.includes("cm change") &&
            !tableTypeLower.includes("alarm") &&
            !tableTypeLower.includes("traffic")
          ) {
            const kpiValRaw = props[colorColumn];
            const v =
              kpiValRaw == null || kpiValRaw === "" || kpiValRaw === "[NULL]"
                ? NaN
                : Number(String(kpiValRaw).replace(/,/g, "").trim());
            if (Number.isFinite(v)) {
              for (const [baseColor, [min, max]] of Object.entries(
                colorRanges[colorColumn]
              )) {
                if (v >= Number(min) && v <= Number(max)) {
                  const overrideKey = `${colorColumn}__${baseColor}`;
                  const finalColor = sectorKpiColors[overrideKey] || baseColor;
                  fillColor = finalColor;
                  break;
                }
              }
            }
          }

          /* ---------------------------------------------------------
           ⭐  FINAL OVERRIDE — ALARM COLORS
        ----------------------------------------------------------*/
          if (tableTypeLower.includes("alarm") && alarmLegend?.length > 0) {
            const col = geojsonData?.color_config?.color_column || "KPI";

            const propsNorm = {};
            Object.entries(props).forEach(([k, v]) => {
              propsNorm[k.trim().toLowerCase()] = v;
            });

            const targetCol = col.trim().toLowerCase();
            let val = propsNorm[targetCol];

            if (val == null) {
              const fallbackKeys = [
                col,
                col.toUpperCase(),
                col.toLowerCase(),
                "KPI",
                "kpi",
              ];
              for (const k of fallbackKeys) {
                const keyNorm = k.trim().toLowerCase();
                if (propsNorm[keyNorm] != null && propsNorm[keyNorm] !== "") {
                  val = propsNorm[keyNorm];
                  break;
                }
              }
            }

            if (val != null) {
              const match = alarmLegend.find(
                (i) =>
                  remapAlarmValue(i.value) ===
                  remapAlarmValue(String(val).trim())
              );

              if (match) fillColor = match.color;
            }
          }

          /* ---------------------------------------------------------
           ⭐  FINAL OVERRIDE — TRAFFIC COLORS
        ----------------------------------------------------------*/
          if (tableTypeLower.includes("traffic") && trafficLegend?.length > 0) {
            const col = geojsonData?.color_config?.color_column || "KPI";

            const propsNorm = {};
            Object.entries(props).forEach(([k, v]) => {
              propsNorm[k.trim().toLowerCase()] = v;
            });

            const targetCol = col.trim().toLowerCase();
            let val = propsNorm[targetCol];

            if (val == null) {
              const fallbackKeys = [
                col,
                col.trim(),
                col.toUpperCase(),
                col.toLowerCase(),
                "KPI",
                "kpi",
                "KPI_NEW",
                "KPI NEW",
                "KPI VALUE",
              ];

              for (const k of fallbackKeys) {
                const keyNorm = k.trim().toLowerCase();
                if (propsNorm[keyNorm] != null && propsNorm[keyNorm] !== "") {
                  val = propsNorm[keyNorm];
                  break;
                }
              }
            }

            if (val != null) {
              const match = trafficLegend.find(
                (i) =>
                  remapTrafficValue(i.value) ===
                  remapTrafficValue(String(val).trim())
              );

              if (match) fillColor = match.color;
            }
          }

          sectorFeatures.push({
            type: "Feature",
            geometry: poly.geometry,
            properties: {
              ...props,
              site_id: siteId,
              band: bandLabel,
              fillColor,
            },
          });
        });
      });
    });

    // apply band filter if any
    let filteredFeatures = sectorFeatures;
    // ⭐ Important fix — apply band FILTER correctly
    if (selectedUniqueBands?.length) {
      filteredFeatures = filteredFeatures.filter((f) =>
        selectedUniqueBands
          .map((x) => normalize(x))
          .includes(normalize(getBand(f.properties || {})))
      );
    }

    // apply column filters (region, city, etc.)
    if (Array.isArray(selectedColumnValues) && selectedColumnValues.length) {
      filteredFeatures = filteredFeatures.filter((f) => {
        const props = f.properties || {};
        return selectedColumnValues.every(({ column, values }) => {
          if (!column || !Array.isArray(values) || !values.length) return true;
          const target = String(column).toLowerCase().trim();
          const propKey = Object.keys(props).find(
            (k) => String(k).toLowerCase().trim() === target
          );
          if (!propKey) return true;
          const val = String(props[propKey]).toLowerCase().trim();
          return values
            .map((v) => String(v).toLowerCase().trim())
            .includes(val);
        });
      });
    }

    // update RCA / CM legends from maps/bands
    const newRcaLegend = Object.entries(rcaColorMap).map(([issue, color]) => ({
      issue,
      color,
    }));
    const rcaChanged =
      JSON.stringify(newRcaLegend) !== JSON.stringify(rcaLegend);
    if (newRcaLegend.length && rcaChanged) {
      setRcaLegend(newRcaLegend);
    }

    if (!isCmRemarks && cmBands && cmBands.length) {
      // only keep numeric cmLegend when not using remarks mode
      const cmChanged = JSON.stringify(cmBands) !== JSON.stringify(cmLegend);
      if (cmChanged) setCmLegend(cmBands);
    } else if (!tableTypeLower.includes("cm change") && cmLegend.length) {
      setCmLegend([]);
    }

    console.log("🔵 Sector Generator RUN:", {
      totalGeojson: geojsonData?.features?.length,
      generatedPolygons: filteredFeatures.length,
    });

    const out = { type: "FeatureCollection", features: filteredFeatures };
    sectorsRef.current = out;
    console.log("🔵 sectorsRef updated:", sectorsRef.current);
    if (map.getSource("sectors")) {
      console.log("🔵 Applying sector polygons to map source");
      map.getSource("sectors").setData(out);

      // update global pulse points from sectors
      // update pulse for all modes
      refreshPulseFromFeatures(sectorsRef.current.features, map);
    } else {
      console.warn("🔴 sectors source missing!");
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    geojsonData,
    radiusScale,
    colorColumn,
    JSON.stringify(colorRanges),
    JSON.stringify(selectedUniqueBands),
    JSON.stringify(selectedColumnValues),
    tableType,
    legendMode,
    JSON.stringify(bandColorMap),
    JSON.stringify(generationColorMap),
    JSON.stringify(sectorKpiColors),
    JSON.stringify(rcaLegend),
    JSON.stringify(cmLegend),
    JSON.stringify(alarmLegend),
    JSON.stringify(trafficLegend),
    expandBandMode,
    colorColumn,
    kpiFailureMode,
    JSON.stringify(kpiFailureGeoJSON),
    JSON.stringify(selectedTechs),
  ]);

  /* ---------------- Drive test layer ---------------- */
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    const empty = { type: "FeatureCollection", features: [] };
    if (!driveTestGeoJSON?.features?.length) {
      driveTestRef.current = empty; // 🆕 cache
      if (map.getSource("drive-test"))
        map.getSource("drive-test").setData(empty);
      return;
    }
    driveTestRef.current = driveTestGeoJSON;
    if (map.getSource("drive-test")) {
      map.getSource("drive-test").setData(driveTestGeoJSON);
    }

    // color expression using colorRanges[selectedDriveKPI] + overrides
    let colorExpr = "#666";
    if (selectedDriveKPI && colorRanges[selectedDriveKPI]) {
      colorExpr = ["case"];
      for (const [baseColor, [min, max]] of Object.entries(
        colorRanges[selectedDriveKPI]
      )) {
        const key = `${selectedDriveKPI}__${baseColor}`;
        const finalColor = driveKpiColors[key] || baseColor;
        colorExpr.push(
          [
            "all",
            [">=", ["to-number", ["get", selectedDriveKPI]], Number(min)],
            ["<=", ["to-number", ["get", selectedDriveKPI]], Number(max)],
          ],
          finalColor
        );
      }
      colorExpr.push("#cccccc");
    }

    if (map.getLayer("driveTest-points")) {
      map.setPaintProperty("driveTest-points", "circle-color", colorExpr);
    }

    // popup on hover
    const popup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
    });

    const mouseMove = (e) => {
      if (!e.features?.length || !selectedDriveKPI) return;
      const feat = e.features[0];
      const v = feat.properties?.[selectedDriveKPI];
      if (v == null) return;
      popup
        .setLngLat(e.lngLat)
        .setHTML(
          `<div style="font-size:12px;">
            <strong>${escapeHtml(selectedDriveKPI)}</strong>: ${escapeHtml(v)}
          </div>`
        )
        .addTo(map);
    };

    const mouseLeave = () => popup.remove();

    map.on("mousemove", "driveTest-points", mouseMove);
    map.on("mouseleave", "driveTest-points", mouseLeave);

    return () => {
      try {
        map.off("mousemove", "driveTest-points", mouseMove);
        map.off("mouseleave", "driveTest-points", mouseLeave);
      } catch (e) {}
    };
  }, [
    driveTestGeoJSON,
    selectedDriveKPI,
    JSON.stringify(colorRanges),
    JSON.stringify(driveKpiColors),
  ]);

  /* ---------------- Grid map layer ---------------- */
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    if (!gridMapGeoJSON?.features?.length || !selectedGridKPI) return;

    const pointGeoJSON = {
      type: "FeatureCollection",
      features: gridMapGeoJSON.features.map((f) => {
        const raw = f.properties?.[selectedGridKPI];
        const v =
          raw == null || raw === "" || isNaN(Number(raw)) ? NaN : Number(raw);
        return {
          type: "Feature",
          geometry: f.geometry,
          properties: { ...f.properties, __value: v },
        };
      }),
    };
    gridRef.current = pointGeoJSON;
    if (map.getSource("grid-map")) {
      map.getSource("grid-map").setData(pointGeoJSON);
    }

    const ranges = colorRanges[selectedGridKPI];
    if (!ranges) {
      // still apply gradient from min/max of __value using our gradient colors
      const values = pointGeoJSON.features
        .map((f) => f.properties.__value)
        .filter((v) => Number.isFinite(v));
      if (!values.length) return;
      const minVal = Math.min(...values);
      const maxVal = Math.max(...values);

      const colorExpr = [
        "interpolate",
        ["linear"],
        ["to-number", ["get", "__value"]],
        minVal,
        gridGradientColors.low,
        (minVal + maxVal) / 2,
        gridGradientColors.mid,
        maxVal,
        gridGradientColors.high,
      ];

      if (map.getLayer("gridMap-points")) {
        map.setPaintProperty("gridMap-points", "circle-color", colorExpr);
      }
      if (map.getLayer("gridMap-heatmap")) {
        map.setPaintProperty("gridMap-heatmap", "heatmap-weight", [
          "interpolate",
          ["linear"],
          ["to-number", ["get", "__value"]],
          minVal,
          0,
          maxVal,
          1,
        ]);
      }
      return;
    }

    // we have discrete ranges, but still build a smooth gradient anchored at low/mid/high
    const values = Object.values(ranges);
    const flat = [];
    values.forEach(([min, max]) => flat.push(min, max));
    const minVal = Math.min(...flat);
    const maxVal = Math.max(...flat);

    const colorExpr = [
      "interpolate",
      ["linear"],
      ["to-number", ["get", "__value"]],
      minVal,
      gridGradientColors.low,
      (minVal + maxVal) / 2,
      gridGradientColors.mid,
      maxVal,
      gridGradientColors.high,
    ];

    if (map.getLayer("gridMap-points")) {
      map.setPaintProperty("gridMap-points", "circle-color", colorExpr);
    }
    if (map.getLayer("gridMap-heatmap")) {
      map.setPaintProperty("gridMap-heatmap", "heatmap-weight", [
        "interpolate",
        ["linear"],
        ["to-number", ["get", "__value"]],
        minVal,
        0,
        maxVal,
        1,
      ]);
    }
  }, [
    gridMapGeoJSON,
    selectedGridKPI,
    JSON.stringify(colorRanges),
    JSON.stringify(gridGradientColors),
  ]);

  /* ---------------- Highlighted feature (prop + internal search) ---------------- */
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    const empty = { type: "FeatureCollection", features: [] };

    let coll = null;
    if (internalHighlight) {
      coll = {
        type: "FeatureCollection",
        features: [internalHighlight],
      };
    } else if (highlightedFeature) {
      coll =
        highlightedFeature.type === "FeatureCollection"
          ? highlightedFeature
          : { type: "FeatureCollection", features: [highlightedFeature] };
    } else {
      coll = empty;
    }
    highlightRef.current = coll;
    if (map.getSource("highlighted-feature")) {
      map.getSource("highlighted-feature").setData(coll);
    }

    try {
      const coords = coll.features[0]?.geometry?.coordinates;
      if (coords && coords.length >= 2) {
        map.flyTo({ center: coords, zoom: 15, essential: true });
      }
    } catch (e) {}
  }, [highlightedFeature, internalHighlight]);

  /* ---------------- Toolbar helpers ---------------- */
   const handleDriveTestFileChange = async (e) => {
    const file = e.target.files[0];
    setDriveTestFile(file);
    if (!file) return;

    setFetchingKPI(true);
    setKpiProgress(0);

    const interval = setInterval(() => {
      setKpiProgress((prev) => (prev < 95 ? prev + 5 : prev));
    }, 100);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/upload-drive-test`,
        {
          method: "POST",
          body: formData,
        }
      );
      if (!response.ok) throw new Error(`Error: ${response.status}`);
      const result = await response.json();

      // ✅ Extract and store all columns
      if (result.available_kpis?.length)
        setDriveTestColumns(result.available_kpis);

      // ✅ Filter KPIs to only signal metrics
      setAvailableDriveKPIs(
        (result.available_kpis || []).filter(
          (k) =>
            k.toUpperCase().includes("RSRP") ||
            k.toUpperCase().includes("RSRQ") ||
            k.toUpperCase().includes("SINR") ||
            k.toUpperCase().includes("EARFCN")
        )
      );

      // ✅ Pick default KPI and fetch its range immediately
      if (result.available_kpis?.length > 0) {
        const defaultKPI = result.available_kpis[0];
        setSelectedDriveKPI(defaultKPI);

        try {
          const res = await fetch(
            `${
              import.meta.env.VITE_API_URL
            }/drive-test/column-range?column=${encodeURIComponent(defaultKPI)}`
          );
          const range = await res.json();
          if (range.min != null && range.max != null)
            setDriveLayerRange({ min: range.min, max: range.max });
        } catch (err) {
          console.error("❌ Failed to fetch drive test column range", err);
        }
      }

      // Notify parent
      if (onDriveTestUpload)
        onDriveTestUpload(file, result.available_kpis?.[0] || selectedDriveKPI);
    } catch (err) {
      console.error("Upload failed:", err.message);
    } finally {
      clearInterval(interval);
      setKpiProgress(100);
      setTimeout(() => {
        setFetchingKPI(false);
        setKpiProgress(0);
      }, 300);
    }
  };

  // === KPI Change Handler ===
  const handleDriveKPIChange = async (e) => {
    const kpi = e.target.value;
    setSelectedDriveKPI(kpi);
    if (!kpi) return;

    setFetchingKPI(true);
    setKpiProgress(0);

    const interval = setInterval(() => {
      setKpiProgress((prev) => (prev < 95 ? prev + 5 : prev));
    }, 100);

    try {
      const res = await fetch(
        appendDateParams(
          `${getApiBaseUrl()}/drive-test/column-range?column=${encodeURIComponent(
            kpi
          )}`
        )
      );

      const range = await res.json();
      if (range.min != null && range.max != null)
        setDriveLayerRange({ min: range.min, max: range.max });
    } catch (err) {
      console.error("❌ Failed to fetch drive test column range", err);
    } finally {
      clearInterval(interval);
      setKpiProgress(100);
      setTimeout(() => {
        setFetchingKPI(false);
        setKpiProgress(0);
      }, 300);
    }

    // Notify parent
    if (driveTestFile && onDriveTestUpload)
      onDriveTestUpload(driveTestFile, kpi);
  };
const handleGridMapFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // start loader
    setFetchingGridKPI(true);
    setGridKpiProgress(0);

    // animate progress
    const interval = setInterval(() => {
      setGridKpiProgress((prev) => (prev < 90 ? prev + 5 : prev));
    }, 120);

    const formData = new FormData();
    formData.append("file", file);

    try {
      // 🔼 Upload to backend
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/upload-grid-map`,
        {
          method: "POST",
          body: formData,
        }
      );

      if (!res.ok) {
        throw new Error(`Grid map upload failed: ${res.statusText}`);
      }

      const data = await res.json();

      // ✅ Populate KPI dropdown
      if (Array.isArray(data.available_kpis)) {
        setGridKPIColumns(data.available_kpis);

        // 🔑 mark KPI source as file
        setKpiSource({ type: "file", table: null });
      } else {
        setGridKPIColumns([]);
        setKpiSource({ type: null, table: null });
      }

      // ✅ Push GeoJSON to parent (App or MapRenderer)
      if (data.geojson) {
        onGridData?.(data.geojson);
      }
    } catch (err) {
      console.error("❌ Grid map upload failed:", err);
      toast.error(
        "Grid map upload failed. Please check the file format or backend logs."
      );
    } finally {
      clearInterval(interval);
      setGridKpiProgress(100);
      setTimeout(() => {
        setFetchingGridKPI(false);
        setGridKpiProgress(0);
      }, 500);
    }
  };

  const [localSelectedGridKPI, setLocalSelectedGridKPI] = React.useState(
    selectedGridKPI ?? null
  );
  const [addingColor, setAddingColor] = useState(false);
  const [newColorName, setNewColorName] = useState("");
  const bandSortOrder = (band) => {
    const numericPart = parseInt(band.replace(/[^\d]/g, "")); // L21 -> 21
    return isNaN(numericPart) ? 0 : numericPart;
  };

  useEffect(() => {
    if (kpiSource.type === "file") return;

    const chosen =
      Array.isArray(targetTables) && targetTables.length
        ? targetTables[targetTables.length - 1] // most recent selection
        : null;

    if (!chosen) {
      setGridKPIColumns([]);
      setKpiSource({ type: null, table: null });
      setGridMapGeoJSON(null);
      return;
    }

    // ✅ One API call for both columns + geojson
    fetch(
      appendDateParams(
        `${getApiBaseUrl()}/grid-map/from-table?table=${encodeURIComponent(
          chosen
        )}`
      )
    )
      .then((r) => r.json())
      .then((data) => {
        // Columns for KPI dropdown
        if (Array.isArray(data.available_kpis)) {
          setGridKPIColumns(data.available_kpis);
        } else {
          setGridKPIColumns([]);
        }

        // GeoJSON for heatmap
        if (data?.geojson?.features?.length) {
          setGridMapGeoJSON(data.geojson);
          onGridData?.(data.geojson); // push to parent/map if needed
        } else {
          setGridMapGeoJSON(null);
        }

        setKpiSource({ type: "target", table: chosen });
      })
      .catch((err) => {
        console.error("❌ Failed fetching grid map from target table:", err);
        setGridKPIColumns([]);
        setGridMapGeoJSON(null);
        setKpiSource({ type: "target", table: chosen });
      });
  }, [targetTables, kpiSource.type]);

  React.useEffect(() => {
    if (localSelectedGridKPI && localSelectedGridKPI !== selectedGridKPI) {
      setSelectedGridKPI(localSelectedGridKPI);
    }
  }, [localSelectedGridKPI, selectedGridKPI, setSelectedGridKPI]);
  // Dropdown rendering helper
  const renderDropdown = (key, options, multiple, value, setValue) => {
    const searchText = searchTexts[key] || "";

    // ✅ Ensure options is always an array — prevent `.filter` crash
    let safeOptions = [];
    if (Array.isArray(options)) {
      safeOptions = options;
    } else if (typeof options === "object" && options !== null) {
      // Handle case like { columns: [...] } or object with keys
      if (Array.isArray(options.columns)) {
        safeOptions = options.columns;
      } else {
        console.warn(
          `⚠️ renderDropdown[${key}] received object instead of array:`,
          options
        );
        safeOptions = Object.values(options)
          .flat()
          .filter((v) => typeof v === "string");
      }
    } else if (typeof options === "string") {
      safeOptions = [options];
    } else if (options == null) {
      safeOptions = [];
    } else {
      console.warn(
        `⚠️ renderDropdown[${key}] received invalid options type:`,
        typeof options,
        options
      );
    }

    const filteredOptions = safeOptions.filter((opt) =>
      String(opt).toLowerCase().includes(searchText.toLowerCase())
    );

    return (
      <div
        className="dropdown-wrapper"
        ref={(el) => (dropdownRefs.current[key] = el)}
      >
      <input
            className="input"
            readOnly
            value={
              multiple
                ? Array.isArray(value) && value.length
                  ? value.join(", ")
                  : ""
                : value ?? ""
            }
            placeholder={`Select ${key}`}
            onClick={() =>
              setShowDropdowns((prev) => ({ ...prev, [key]: !prev[key] }))
            }
          />


        {showDropdowns[key] && (
          <div className="dropdown-list">
            {/* 🔍 Search bar */}
            <input
              type="text"
              className="input search-input"
              placeholder="Search..."
              value={searchTexts[key] ?? ""}
              onChange={(e) =>
                setSearchTexts((prev) => ({ ...prev, [key]: e.target.value }))
              }
              autoFocus
            />

            {/* ✅ Render list safely */}
            {filteredOptions.map((option) => (
              <div
                key={`${key}-${option}`}
                className={`dropdown-item ${
                  multiple && Array.isArray(value) && value.includes(option)
                    ? "selected"
                    : ""
                }`}
                onClick={() => {
                  if (multiple) {
                    const safeValue = Array.isArray(value) ? value : [];
                    const newValue = safeValue.includes(option)
                      ? safeValue.filter((item) => item !== option)
                      : [...safeValue, option];
                    setValue(newValue);
                  } else {
                    setValue(option);
                    setShowDropdowns((prev) => ({ ...prev, [key]: false }));
                  }
                }}
              >
                {option}
              </div>
            ))}

            {/* 🧾 No matches fallback */}
            {filteredOptions.length === 0 && (
              <div className="dropdown-item disabled">No matches</div>
            )}
          </div>
        )}
        
      </div>
    );
  };

  {
    /* === KPI Grid Uploader === */
  }
  <div className="sidebar-section">
    <h3>Grid Heatmap</h3>
    <KPIGridUploader onGridData={setGridData} />
  </div>;

function getColorLabel(hex) {
  return colorNameMap[hex.toLowerCase()] || hex;
}
  const applyStyle = (nextStyle) => {
    const map = mapInstance.current;
    if (!map) return;
    const camera = {
      center: map.getCenter(),
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    };
    setInternalStyle(nextStyle);
    map.setStyle(nextStyle, { diff: false });
    map.once("style.load", () => {
      map.jumpTo(camera);
    });
  };
  const rebuildAllLayers = () => {
    // Nothing needed here
    // Because your sector, drive test, grid, highlight layers
    // are ALL driven automatically by useEffects.
    // We simply re-trigger a React render by updating a dummy state if needed.
    // But in your case, style.load → useEffects run again automatically.
  };

  const toggleStyle = () => {
    const newStyle = internalStyle.includes("satellite")
      ? "mapbox://styles/mapbox/outdoors-v12"
      : "mapbox://styles/mapbox/satellite-streets-v12";

    const map = mapInstance.current;
    if (!map) return;

    const camera = {
      center: map.getCenter(),
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    };

    setInternalStyle(newStyle);
    map.setStyle(newStyle, { diff: false });

    map.once("style.load", () => {
      map.jumpTo(camera);

      // ⭐ Restore cached polygons — DO NOT regenerate
      rebuildMapSourcesAndLayers();
    });
  };

  const toggleLightStyle = () => {
    const newStyle =
      internalStyle === "mapbox://styles/mapbox/light-v10"
        ? "mapbox://styles/mapbox/outdoors-v12"
        : "mapbox://styles/mapbox/light-v10";

    const map = mapInstance.current;
    if (!map) return;

    const camera = {
      center: map.getCenter(),
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    };

    setInternalStyle(newStyle);
    map.setStyle(newStyle, { diff: false });

    map.once("style.load", () => {
      map.jumpTo(camera);

      // ⭐ Restore cached polygons — NO regeneration
      rebuildMapSourcesAndLayers();
    });
  };

  const zoomToData = () => {
    const map = mapInstance.current;
    if (!map) return;
    if (!geojsonData?.features?.length) return;

    try {
      const feats = geojsonData.features;
      const coll = { type: "FeatureCollection", features: feats };
      const bbox = turf.bbox(coll);
      map.fitBounds(bbox, { padding: 40, maxZoom: 18, essential: true });
    } catch (e) {
      // ignore
    }
  };
  /* ---------------- KPI Trend Link helper ---------------- */
  const getBaseProject = (proj) => {
    if (!proj) return "";
    // BHAU01_4G → BHAU01
    const m = String(proj).match(/^([A-Z0-9]+)_/);
    return m ? m[1] : proj;
  };

const buildKpiTrendUrl = () => {
  if (!infoSource || Object.keys(infoSource).length === 0) return null;

  const siteId = getSiteId(infoSource);

  const project =
    getBaseProject(selectedProject) ||
    getBaseProject(infoSource.project) ||
    getBaseProject(infoSource.PROJECT) ||
    getBaseProject(infoSource.db) ||
    deriveProjectFromSiteId(siteId);

  const tech = normalizeGeneration(
    infoSource.generation ||
      infoSource.GENERATION ||
      infoSource.band ||
      infoSource.BAND
  );

  // 👇 PRIMARY cell (clicked feature)
  let cellName = getCellName(infoSource);

  console.log(infoSource,'info')

  // 🟢 NEW: fallback for site-level / band-level sectors
  if (!cellName) {
    const baseProps =
  lastClickedOriginalFeatureRef.current?.properties || infoSource;

const fallback = findRepresentativeCell(baseProps, geojsonData);

    if (fallback?.properties) {
      cellName = getCellName(fallback.properties);
      console.log("🟢 KPI Trend using representative cell:", cellName);
    }
  }

  // 🔴 Hard stop only if STILL no cell
  if (!cellName) {
    console.warn("KPI Trend disabled — no cell available", {
      siteId,
      band: infoSource.band,
    });
    return null;
  }

  if (!project || !tech) {
    console.warn("KPI Trend link missing params:", {
      project,
      tech,
      cellName,
      siteId,
      selectedProject,
    });
    return null;
  }

  console.log("🔗 KPI Trend Params", {
    project,
    tech,
    cellName,
  });
  console.log("🧪 KPI Trend resolution", {
  clickedCell: getCellName(infoSource),
  resolvedCell: cellName,
  siteId,
  band: infoSource.band,
  date: window.__geoDateFilter?.dates,
});


  return `http://10.164.167.122/KPI-Analysis?project=${encodeURIComponent(
    project
  )}&tech=${encodeURIComponent(tech)}&cell_name=${encodeURIComponent(
    cellName
  )}`;
};


  /* ---------------- Info panel helpers ---------------- */

const showSiteInfoFromFeature = (feature) => {
  if (!feature) return;

  const props = feature.properties || {};
  const src = {};
  const tgt = {};

  Object.entries(props).forEach(([k, v]) => {
    const lower = String(k).toLowerCase();
    if (lower.includes("target") || lower.startsWith("tgt_")) {
      tgt[k] = v;
    } else {
      src[k] = v;
    }
  });

  // 🟢 Inject DATE context explicitly
  const activeDates = window.__geoDateFilter?.dates;
  if (activeDates) {
    src["Active Date"] = activeDates;
  }

  // 🟢 Resolve FINAL display color (same logic as sector)
let resolvedColor =
  props.fillColor ||
  props.color ||
  "#cccccc";

// Alarm mode
if (tableType?.toLowerCase().includes("alarm") && alarmLegend?.length) {
  const col = geojsonData?.color_config?.color_column || "KPI";
  const val = props[col] ?? props[col.toLowerCase()];
  const match = alarmLegend.find(
    (i) => remapAlarmValue(i.value) === remapAlarmValue(String(val || "").trim())
  );
  if (match) resolvedColor = match.color;
}

// Traffic mode
if (tableType?.toLowerCase().includes("traffic") && trafficLegend?.length) {
  const col = geojsonData?.color_config?.color_column || "KPI";
  const val = props[col] ?? props[col.toLowerCase()];
  const match = trafficLegend.find(
    (i) => remapTrafficValue(i.value) === remapTrafficValue(String(val || "").trim())
  );
  if (match) resolvedColor = match.color;
}

// CM Change remarks
if (tableType?.toLowerCase().includes("cm change")) {
  const remark = String(props.remarks || "").toLowerCase();
  if (remark.startsWith("improv")) resolvedColor = cmLegend.improved;
  else if (remark.startsWith("neutral")) resolvedColor = cmLegend.neutral;
  else if (remark.startsWith("degrad")) resolvedColor = cmLegend.degraded;
}

// 🔥 Inject FINAL color into source info
src["Color"] = resolvedColor;
src["Fillcolor"] = resolvedColor;
// 🔧 FIX: resolve cell for colorless / site-level sectors
if (!getCellName(src)) {
  const fallbackCell = findRepresentativeCell(props, geojsonData);
  if (fallbackCell?.properties) {
    const cellProps = fallbackCell.properties;

    src["Cellname"] =
      getCellName(cellProps);

    src["generation"] =
      src["generation"] ||
      cellProps.generation;

    src["Derived Cell"] = "Yes"; // 🔍 debug-visible (optional)
  }
}


setInfoSource(src);
setInfoTarget(tgt);

};


  // 🔁 Used by the "Refresh" button: pick *one* feature of that site
  const showSiteInfoBySiteId = (siteId, data) => {
    if (!data?.features?.length) return;

    const feat = data.features.find((f) => {
      const p = f.properties || {};
      return normalize(getSiteId(p)) === normalize(siteId);
    });

    if (!feat) return;
    // 🔥 Resolve ORIGINAL feature (full data)
const originalFeature =
  findOriginalFeature(feat.properties || {}, geojsonData) || feat;

// Info panel now uses FULL source/target data
showSiteInfoFromFeature(originalFeature);
setSelectedSiteIdState(normalize(siteId));
setShowInfoPanel(true);

  };

  /* ---------------- Search handlers ---------------- */

  const handleSearch = (e) => {
    e.preventDefault();
    const term = searchTerm.trim();
    if (!term || !geojsonData?.features?.length) return;

    const upperTerm = term.toUpperCase();
    const results = geojsonData.features.filter((f) => {
      const p = f.properties || {};
      const site = String(getSiteId(p) || "").toUpperCase();
      const cell = String(getCellName(p) || "").toUpperCase();
      const kpiVal = colorColumn
        ? String(p[colorColumn] || "").toUpperCase()
        : "";
      return (
        site.includes(upperTerm) ||
        cell.includes(upperTerm) ||
        (kpiVal && kpiVal.includes(upperTerm))
      );
    });

    if (!results.length) {
      setSearchResults([]);
      setInternalHighlight(null);
      return;
    }

    // push current highlight into history
    if (internalHighlight) {
      setSearchHistory((prev) => [...prev, internalHighlight]);
    }

    setSearchResults(results);
    setInternalHighlight(results[0]);
  };
  const deriveProjectFromSiteId = (siteId) => {
    if (!siteId) return "";
    const s = String(siteId).toUpperCase();

    if (s.startsWith("ZM")) return "BHAZ01";
    if (s.startsWith("KA")) return "BHAU01";
    if (s.startsWith("TN")) return "BHAT01";
    // add mappings as needed

    return "";
  };

  const handleUndoSearch = () => {
    if (!searchHistory.length) return;
    const last = searchHistory[searchHistory.length - 1];
    setSearchHistory((prev) => prev.slice(0, prev.length - 1));
    setInternalHighlight(last || null);
  };

  /* ---------------- Legend rendering ---------------- */

  const handleBandColorChange = (band, newColor) => {
    setBandColorMap((prev) => ({
      ...prev,
      [band]: newColor,
    }));
  };

  const handleGenerationColorChange = (gen, newColor) => {
    setGenerationColorMap((prev) => ({
      ...prev,
      [gen]: newColor,
    }));
  };
  const renderDatePanel = () => {
  const raw = window.__geoDateFilter?.dates;
  if (!raw) return null;

  const dates = String(raw)
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);

  if (!dates.length) return null;

  const isCollapsed =
    datePanelCollapsed && dates.length > 1; // auto-expand if single date

  return (
    <div
      style={{
        width: "100%",
        background: "#f8fafc",
        borderBottom: "1px solid #e5e7eb",
        padding: "8px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: dates.length > 1 ? "pointer" : "default",
        }}
        onClick={() => {
          if (dates.length > 1) {
            setDatePanelCollapsed((v) => !v);
          }
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "#111827",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {/* Arrow */}
          {dates.length > 1 && (
            <span
              style={{
                fontSize: 12,
                transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                transition: "transform 0.15s ease",
                display: "inline-block",
              }}
            >
              ▾
            </span>
          )}
          📅 Active Date{dates.length > 1 ? "s" : ""}
        </div>

        {dates.length > 1 && (
          <div
            style={{
              fontSize: 10,
              color: "#6b7280",
              fontWeight: 500,
            }}
          >
            {isCollapsed ? "Show" : "Hide"}
          </div>
        )}
      </div>

      {/* Date list */}
      {!isCollapsed &&
        dates.map((d, idx) => (
          <div
            key={idx}
            style={{
              fontSize: 12,
              padding: "4px 8px",
              borderRadius: 4,
              background: idx === 0 ? "#ecfdf5" : "#ffffff",
              border: "1px solid #e5e7eb",
              color: idx === 0 ? "#047857" : "#374151",
              fontWeight: idx === 0 ? 600 : 500,
              textAlign: "center",
            }}
          >
            {d}
            {idx === 0 && dates.length > 1 && (
              <span style={{ marginLeft: 6, fontSize: 10 }}>(latest)</span>
            )}
          </div>
        ))}
    </div>
  );
};

  const renderLegendContent = () => {
    const typeLower = (tableType || "").toLowerCase();
    // detect CM Change + remarks-based coloring
    const cmColorColumn = geojsonData?.color_config?.color_column || "";
    const isCmRemarks =
      typeLower.includes("cm change") &&
      cmColorColumn.trim().toLowerCase() === "remarks";

    // 1. Generation legend (editable)
    const hasGeneration =
      geojsonData?.features?.some((f) => f.properties?.generation) || false;

    if (legendMode === "generation" && hasGeneration) {
  return (
    <>
      {/* 🧠 KPI FAILURE TOGGLE */}
      <div style={{ marginBottom: 10 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 6,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600 }}>
            KPI Failure Mode
          </span>

          <label className={`md-toggle ${kpiFailureMode ? "md-toggle-on" : ""}`}>
            <input
              type="checkbox"
              checked={kpiFailureMode}
              onChange={() => setKpiFailureMode((v) => !v)}
              className="md-toggle-input"
            />
            <div className="md-toggle-track">
              <div className="md-toggle-thumb" />
            </div>
          </label>
        </div>
      </div>

      {/* 🧩 TECH MULTI SELECT */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
          Select Tech
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {["2G", "3G", "4G", "5G"].map((tech) => {
            const active = selectedTechs.includes(tech);

            return (
              <div
                key={tech}
                onClick={() => {
                  setSelectedTechs((prev) => {
                    const next = prev.includes(tech)
                      ? prev.filter((t) => t !== tech)
                      : [...prev, tech];
                    console.log("🎛️ Tech selection changed:", next);
                    return next;
                  });
                }}
                style={{
                  padding: "4px 8px",
                  borderRadius: 6,
                  fontSize: 11,
                  cursor: "pointer",
                  border: "1px solid #d1d5db",
                  background: active ? "#059669" : "#f3f4f6",
                  color: active ? "#fff" : "#111",
                  fontWeight: 600,
                }}
              >
                {tech}
              </div>
            );
          })}
        </div>
      </div>

      {/* 🔵 NORMAL GENERATION COLORS */}
      {!kpiFailureMode && (
        <>
          <div className="legend-title">
            Generation Colors (click to edit)
          </div>

          {["2G", "3G", "4G", "5G"].map((g) => (
            <div
              key={g}
              className="legend-item"
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <input
                type="color"
                value={generationColorMap[g] || GENERATION_COLORS[g]}
                onChange={(e) =>
                  handleGenerationColorChange(g, e.target.value)
                }
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 4,
                  border: "1px solid #ccc",
                  cursor: "pointer",
                }}
              />
              <span style={{ fontSize: 13 }}>{g}</span>
            </div>
          ))}
        </>
      )}

      {/* 🔴 KPI FAILURE LEGEND (dynamic) */}
      {kpiFailureMode && kpiFailureLegend && (
        <>
          <div className="legend-title">KPI Failure Types</div>

          {Object.entries(kpiFailureLegend).map(([label, color]) => (
            <div key={label} className="legend-item">
              <span
                style={{
                  width: 14,
                  height: 14,
                  background: color,
                  display: "inline-block",
                  marginRight: 6,
                }}
              />
              {label}
            </div>
          ))}
        </>
      )}
    </>
  );
}

    // 2. Band legend (editable)
    if (legendMode === "band") {
      if (!uniqueBands.length)
        return <div className="legend-title">No bands detected</div>;
      return (
        <>
          <div className="legend-title">Band Colors (click to edit)</div>
          {uniqueBands.map((b) => (
            <div
              key={b}
              className="legend-item"
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <input
                type="color"
                value={bandColorMap[b] || "#cccccc"}
                onChange={(e) => handleBandColorChange(b, e.target.value)}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 4,
                  border: "1px solid #ccc",
                  cursor: "pointer",
                }}
              />
              <span style={{ fontSize: 13 }}>{b}</span>
            </div>
          ))}
        </>
      );
    }

    // 3. RCA legend (editable)
    if (legendMode === "rca" && typeLower.includes("rca")) {
      if (!rcaLegend.length)
        return <div className="legend-title">RCA: No data</div>;
      return (
        <>
          <div className="legend-title">RCA — Issue Buckets</div>
          {rcaLegend.map(({ issue, color }, idx) => (
            <div
              key={`${issue}-${idx}`}
              className="legend-item"
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <input
                type="color"
                value={color}
                onChange={(e) => {
                  const newColor = e.target.value;
                  setRcaLegend((prev) =>
                    prev.map((item) =>
                      item.issue === issue ? { ...item, color: newColor } : item
                    )
                  );
                }}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 4,
                  border: "1px solid #ccc",
                  cursor: "pointer",
                }}
              />
              <span style={{ fontSize: 12 }}>{issue}</span>
            </div>
          ))}
        </>
      );
    }

    // 4. CM Change legend (numeric Total Score OR Remarks categories)
    if (legendMode === "cmchange" && typeLower.includes("cm change")) {
      // Detect Remarks mode
      const cmColorColumn = geojsonData?.color_config?.color_column || "";
      const isRemarksMode = cmColorColumn.trim().toLowerCase() === "remarks";

      // 🟢 REMARKS MODE (Editable colors)
      if (isRemarksMode) {
        const remarkColors = {
          improved: cmLegend?.improved || "#22c55e",
          neutral: cmLegend?.neutral || "#eab308",
          degraded: cmLegend?.degraded || "#ef4444",
          noRemarks: cmLegend?.noRemarks || "#cccccc",
        };

        const categories = [
          { key: "improved", label: "Improved" },
          { key: "neutral", label: "Neutral" },
          { key: "degraded", label: "Degraded" },
          { key: "noRemarks", label: "No Remarks" },
        ];

        return (
          <>
            <div className="legend-title">CM Change — Remarks</div>

            {categories.map((c) => (
              <div
                key={c.key}
                className="legend-item"
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <input
                  type="color"
                  value={remarkColors[c.key]}
                  onChange={(e) => {
                    const newColor = e.target.value;
                    setCmLegend((prev) => ({
                      ...prev,
                      [c.key]: newColor,
                    }));
                  }}
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 4,
                    border: "1px solid #ccc",
                    cursor: "pointer",
                  }}
                />

                <span style={{ fontSize: 12 }}>{c.label}</span>
              </div>
            ))}
          </>
        );
      }

      // 🔢 NUMERIC TOTAL_SCORE MODE (existing behaviour)
      if (!cmLegend.length)
        return <div className="legend-title">CM: No data</div>;

      return (
        <>
          <div className="legend-title">CM Change — Total Score</div>
          {cmLegend.map((b, idx) => (
            <div
              key={idx}
              className="legend-item"
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <input
                type="color"
                value={b.color}
                onChange={(e) => {
                  const newColor = e.target.value;
                  setCmLegend((prev) =>
                    prev.map((band, i) =>
                      i === idx ? { ...band, color: newColor } : band
                    )
                  );
                }}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 4,
                  border: "1px solid #ccc",
                  cursor: "pointer",
                }}
              />
              <span style={{ fontSize: 12 }}>
                {b.from.toFixed(1)} – {b.to.toFixed(1)}
              </span>
            </div>
          ))}
        </>
      );
    }

    // 5. Sector KPI legend (editable colors via overrides)
    if (legendMode === "sector" && colorColumn && colorRanges[colorColumn]) {
      return (
        <>
          <div className="legend-title">Sector KPI — {colorColumn}</div>
          {Object.entries(colorRanges[colorColumn]).map(
            ([baseColor, [min, max]]) => {
              const key = `${colorColumn}__${baseColor}`;
              const currentColor = sectorKpiColors[key] || baseColor;
              return (
                <div
                  key={baseColor}
                  className="legend-item"
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <input
                    type="color"
                    value={currentColor}
                    onChange={(e) => {
                      const newColor = e.target.value;
                      setSectorKpiColors((prev) => ({
                        ...prev,
                        [key]: newColor,
                      }));
                    }}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 4,
                      border: "1px solid #ccc",
                      cursor: "pointer",
                    }}
                  />
                  <span style={{ fontSize: 12 }}>
                    {min} – {max}
                  </span>
                </div>
              );
            }
          )}
        </>
      );
    }

    // 6. Drive Test legend (editable)
    if (
      legendMode === "driveTest" &&
      selectedDriveKPI &&
      colorRanges[selectedDriveKPI]
    ) {
      return (
        <>
          <div className="legend-title">Drive Test — {selectedDriveKPI}</div>
          {Object.entries(colorRanges[selectedDriveKPI]).map(
            ([baseColor, [min, max]]) => {
              const key = `${selectedDriveKPI}__${baseColor}`;
              const currentColor = driveKpiColors[key] || baseColor;
              return (
                <div
                  key={baseColor}
                  className="legend-item"
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <input
                    type="color"
                    value={currentColor}
                    onChange={(e) => {
                      const newColor = e.target.value;
                      setDriveKpiColors((prev) => ({
                        ...prev,
                        [key]: newColor,
                      }));
                    }}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 4,
                      border: "1px solid #ccc",
                      cursor: "pointer",
                    }}
                  />
                  <span style={{ fontSize: 12 }}>
                    {min} – {max}
                  </span>
                </div>
              );
            }
          )}
        </>
      );
    }

    // 7. Grid legend (editable gradient)
    if (legendMode === "grid" && selectedGridKPI) {
      return (
        <>
          <div className="legend-title">Grid KPI — {selectedGridKPI}</div>
          <div
            className="legend-item"
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <input
              type="color"
              value={gridGradientColors.low}
              onChange={(e) =>
                setGridGradientColors((prev) => ({
                  ...prev,
                  low: e.target.value,
                }))
              }
              style={{
                width: 22,
                height: 22,
                borderRadius: 4,
                border: "1px solid #ccc",
                cursor: "pointer",
              }}
            />
            <span>Low</span>
          </div>
          <div
            className="legend-item"
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <input
              type="color"
              value={gridGradientColors.mid}
              onChange={(e) =>
                setGridGradientColors((prev) => ({
                  ...prev,
                  mid: e.target.value,
                }))
              }
              style={{
                width: 22,
                height: 22,
                borderRadius: 4,
                border: "1px solid #ccc",
                cursor: "pointer",
              }}
            />
            <span>Medium</span>
          </div>
          <div
            className="legend-item"
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <input
              type="color"
              value={gridGradientColors.high}
              onChange={(e) =>
                setGridGradientColors((prev) => ({
                  ...prev,
                  high: e.target.value,
                }))
              }
              style={{
                width: 22,
                height: 22,
                borderRadius: 4,
                border: "1px solid #ccc",
                cursor: "pointer",
              }}
            />
            <span>High</span>
          </div>
        </>
      );
    }
    // 8. Alarm legend (editable)
    if (legendMode === "alarm" && alarmLegend?.length > 0) {
      return (
        <>
          <div className="legend-title">
            Alarm Analysis — {geojsonData?.color_config?.color_column || "KPI"}
          </div>
          {alarmLegend.map((item, idx) => (
            <div
              key={idx}
              className="legend-item"
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <input
                type="color"
                value={item.color}
                onChange={(e) => {
                  const newColor = e.target.value;
                  const updated = alarmLegend.map((i, j) =>
                    j === idx ? { ...i, color: newColor } : i
                  );
                  setAlarmLegend(updated); // <-- YOU MUST CREATE THIS STATE
                }}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 4,
                  border: "1px solid #ccc",
                  cursor: "pointer",
                }}
              />
              <span style={{ fontSize: 12 }}>
                {remapAlarmValue(item.value)}
              </span>
            </div>
          ))}
        </>
      );
    }
    // 9. Traffic legend (editable)
    if (legendMode === "traffic" && trafficLegend?.length > 0) {
      return (
        <>
          <div className="legend-title">
            Traffic Analysis —{" "}
            {geojsonData?.color_config?.color_column || "KPI"}
          </div>
          {trafficLegend.map((item, idx) => (
            <div
              key={idx}
              className="legend-item"
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <input
                type="color"
                value={item.color}
                onChange={(e) => {
                  const newColor = e.target.value;
                  const updated = trafficLegend.map((i, j) =>
                    j === idx ? { ...i, color: newColor } : i
                  );
                  setTrafficLegend(updated); // <-- YOU MUST CREATE THIS STATE
                }}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 4,
                  border: "1px solid #ccc",
                  cursor: "pointer",
                }}
              />
              <span style={{ fontSize: 12 }}>
                {remapTrafficValue(item.value)}
              </span>
            </div>
          ))}
        </>
      );
    }

    return <div className="legend-title">No legend available</div>;
  };

  return (
    <>
      
    
      

      <div
        style={{
          position: "fixed",
          top: 10,
          right: 420,
          zIndex: 10001,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "3px",
        }}
      >
        {/* TOGGLE ROW */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <span
            style={{
              fontSize: 13,
              color: expandBandMode ? "#9ca3af" : "#111827",
              fontWeight: 500,
            }}
          >
            Normal
          </span>

          <label
            className={`md-toggle ${expandBandMode ? "md-toggle-on" : ""}`}
          >
            <input
              type="checkbox"
              checked={expandBandMode}
              onChange={() => setExpandBandMode((v) => !v)}
              className="md-toggle-input"
            />
            <div className="md-toggle-track">
              <div className="md-toggle-thumb" />
            </div>
          </label>

          <span
            style={{
              fontSize: 13,
              color: expandBandMode ? "#059669" : "#9ca3af",
              fontWeight: 600,
            }}
          >
            With Bands
          </span>
        </div>

        {/* SEARCH BUTTON (independent offset) */}
        <div
          style={{
            position: "relative",
            top: 3, // ⬅ move down slightly
            right: -478, // ⬅ move slightly to the right
          }}
        >
          <button
            className="icon-btn"
            title="Toggle Search Panel"
            onClick={() => setShowSearchPanel((v) => !v)}
            style={{
              boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
              background: showSearchPanel ? "#30e879ff" : "#a7fcb9ff",
              fontSize: 11,
              transition: "background 0.2s",
            }}
          >
            🔍
          </button>
        </div>
      </div>

      {/* 🔍 Search Bar UI */}
      {showSearchPanel && (
        <form
          style={{
            color: "#000",
            position: "absolute",
            top: 18,
            left: 660,
            zIndex: 10,
            background: "#fff",
            padding: "4px 8px",
            borderRadius: "8px",
            boxShadow: "0 1px 5px rgba(0,0,0,0.08)",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            border: "1px solid #e5e7eb",
            minHeight: 40,
          }}
          onSubmit={handleSearch}
        >
          <input
            type="text"
            placeholder="Search Site/Cell/KPI"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              color: "#000",
              minWidth: 220,
              border: "1px solid #ccc",
              borderRadius: 4,
              padding: "6px 8px",
              fontSize: 13,
              background: "#f9fafb",
            }}
          />
          <button
            type="submit"
            className="btn-outline"
            style={{ padding: "6px 12px", borderRadius: 4, fontWeight: 500 }}
          >
            Search
          </button>
          <button
            type="button"
            className="btn-outline"
            onClick={handleUndoSearch}
            disabled={searchHistory.length === 0}
            style={{ padding: "6px 10px", borderRadius: 4 }}
          >
            Undo
          </button>
          {searchResults.length > 1 && (
            <select
              onChange={(e) => {
                const idx = Number(e.target.value);
                const f = searchResults[idx];
                setInternalHighlight(f);
              }}
              style={{
                marginLeft: 8,
                padding: "6px 8px",
                borderRadius: 4,
                minWidth: 140,
              }}
            >
              {searchResults.map((f, idx) => (
                <option key={idx} value={idx}>
                  {f.properties.Site_ID ||
                    f.properties.Cell_name ||
                    f.properties.CELLNAME ||
                    `Result ${idx + 1}`}
                </option>
              ))}
            </select>
          )}
        </form>
      )}

      {/* Map container */}
      <div
        ref={mapRef}
        className="map-container"
        style={{ position: "absolute", inset: 0 }}
      />

        {tableType === "TA" && <TALegend />}

      {/* ℹ️ Info Sidebar */}

  
      {showInfoPanel && tableType != "TA" && (
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
              Site Info {selectedSiteIdState ? `— ${selectedSiteIdState}` : ""}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn-outline"
                onClick={() => {
                  if (!selectedSiteIdState && geojsonData?.features?.length) {
                    const first = geojsonData.features[0]?.properties || {};
                    const sid =
                      first?.site_id ||
                      first?.Site_ID ||
                      first?.["SITE ID"] ||
                      first?.siteid ||
                      first?.SITE ||
                      first?.site;
                    if (sid) showSiteInfoBySiteId(sid, geojsonData);
                  } else if (selectedSiteIdState) {
                    showSiteInfoBySiteId(selectedSiteIdState, geojsonData);
                  }
                }}
                title="Refresh site info"
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
            {/* 🔗 KPI Trend Analysis Link */}
            {buildKpiTrendUrl() && (
              <div
                style={{
                  marginBottom: 14,
                  padding: "8px 10px",
                  background: "#f0fdf4",
                  border: "1px solid #bbf7d0",
                  borderRadius: 6,
                }}
              >
                <a
                  href={buildKpiTrendUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: "#047857",
                    fontWeight: 600,
                    fontSize: 13,
                    textDecoration: "underline",
                    cursor: "pointer",
                  }}
                >
                  📈 KPI Trend Analysis
                </a>
              </div>
            )}

            {/* Source table */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>📊 Source</div>
              {Object.keys(infoSource || {}).length === 0 ? (
                <div style={{ color: "#6b7280" }}>
                  Click a site to view details…
                </div>
              ) : (
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 12,
                  }}
                >
                  <tbody>
                    {Object.entries(infoSource).map(([k, v]) => (
                      <tr key={`src-${k}`}>
                        <td
                          style={{
                            padding: "6px 8px",
                            borderBottom: "1px solid #f3f4f6",
                            fontWeight: 600,
                            width: "45%",
                          }}
                        >
                          {labelize(k)}
                        </td>
                        <td
                          style={{
                            padding: "6px 8px",
                            borderBottom: "1px solid #f3f4f6",
                            wordBreak: "break-word",
                          }}
                        >
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
                <div style={{ color: "#6b7280" }}>
                  No target fields present in this feature.
                </div>
              ) : (
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 12,
                  }}
                >
                  <tbody>
                    {Object.entries(infoTarget).map(([k, v]) => (
                      <tr key={`tgt-${k}`}>
                        <td
                          style={{
                            padding: "6px 8px",
                            borderBottom: "1px solid #f3f4f6",
                            fontWeight: 600,
                            width: "45%",
                          }}
                        >
                          {labelize(k)}
                        </td>
                        <td
                          style={{
                            padding: "6px 8px",
                            borderBottom: "1px solid #f3f4f6",
                            wordBreak: "break-word",
                          }}
                        >
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

      {/* 🧰 Toolbar (top-right vertical stack) */}

      <div
        style={{
          position: "absolute",
          top: 120,
          right: 12,
          zIndex: 1200,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <button
          onClick={toggleStyle}
          className="icon-btn"
          title="Toggle satellite"
        >
          🛰️
        </button>
        <button
          onClick={toggleLightStyle}
          className="icon-btn"
          title="Toggle light"
        >
          💡
        </button>
        <button
          className="icon-btn"
          title="Zoom to dataset"
          onClick={zoomToData}
        >
          🔎
        </button>
        <button
          onClick={() => {
            rulerActiveRef.current = !rulerActiveRef.current;
            if (!rulerActiveRef.current) {
              rulerGeoJSON.current = {
                type: "FeatureCollection",
                features: [],
              };
              rulerLinestring.current = {
                type: "Feature",
                geometry: { type: "LineString", coordinates: [] },
                properties: {},
              };
              if (
                mapInstance.current &&
                mapInstance.current.getSource("ruler-geojson")
              ) {
                mapInstance.current
                  .getSource("ruler-geojson")
                  .setData(rulerGeoJSON.current);
              }
              if (distanceRef.current) distanceRef.current.innerText = "";
            }
          }}
          className="icon-btn"
          title="Toggle Ruler"
        >
          🧭
        </button>
        <button
          onClick={() => setShowLegend((v) => !v)}
          className="icon-btn"
          title="Toggle Legend"
        >
          📊
        </button>
        <button
          onClick={() => setShowInfoPanel((v) => !v)}
          className="icon-btn"
          title="Toggle Site Info"
          style={{ fontWeight: 600 }}
        >
          ℹ️
        </button>
        {/* Extra zoom shortcut, if you still want a second zoom button */}
        {/* <button
          className="icon-btn"
          title="Zoom to dataset (shortcut)"
          onClick={zoomToData}
        >
          🔍
        </button> */}
        {/* 🧱 Polygon Tool — SINGLE VISUAL UNIT */}
<div
  style={{
    position: "relative",
    width: 36,           // 🔒 fixed footprint (does NOT affect others)
    height: 36,
  }}
>
  {/* 🧩 SHARED BACKGROUND (makes it look ONE) */}
  {/* <div
    style={{
      position: "absolute",
      inset: 0,
      background: "#ffffff",
      borderRadius: 10,
      boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
      zIndex: 1,
    }}
  /> */}

<button
  onClick={() => setShowPolygonPanel((v) => !v)}
  title="Polygon Tools"
  style={{
    width: 36,          // 🔽 reduced width
    height: 22,         // balanced height
    borderRadius: 5,

    display: "flex",
    alignItems: "center",
    justifyContent: "center",

    fontSize: 15,       // slightly smaller to fit slim button
    fontWeight: 700,

    background: showPolygonPanel ? "#f81307" : "#b4fec2",
    color: showPolygonPanel ? "#ffffff" : "#1aa585",

    border: "1px solid #070707",
    outline: "none",

    boxShadow: showPolygonPanel
      ? "0 0 6px rgba(248,19,7,0.55)"   // red glow when active
      : "0 0 4px rgba(26,165,133,0.45)",

    padding: 0,        // ✅ prevents width expansion
    lineHeight: 1,

    transition: "all 0.15s ease",
    cursor: "pointer",
  }}
>
  ⬟
</button>


  {/* 🔧 EXPANDED TOOLS — SAME VISUAL SURFACE */}
  <div
    style={{
  position: "absolute",
  right: "100%",              // attaches to button edge
  top: 0,                     // SAME vertical origin
  height: 22,                 // SAME height as main button
  display: "flex",
  alignItems: "center",
  gap: 6,

  padding: "0 6px",
  background: showPolygonPanel ? "#94faa9" : "#b4fec2", // SAME surface
  border: "1px solid #070707",
  borderRight: "none",        // seamless join
  borderRadius: "5px 0 0 5px",

  boxShadow: showPolygonPanel
    ? "0 0 6px rgba(248,19,7,0.45)"
    : "0 0 4px rgba(26,165,133,0.35)",

  transform: showPolygonPanel
    ? "scaleX(1)"
    : "scaleX(0)",
  transformOrigin: "right center",

  opacity: showPolygonPanel ? 1 : 0,
  pointerEvents: showPolygonPanel ? "auto" : "none",

  transition: "transform 0.18s ease, opacity 0.15s ease",
  zIndex: 1,
}}

  >
    <button
      onClick={() => activateTool("draw_polygon")}
      className="icon-btn"
      title="Draw Polygon"
    >
      <Pentagon size={16} />
    </button>

    <button
      onClick={() => activateTool("draw_freehand")}
      className="icon-btn"
      title="Freehand Draw"
    >
      <Pencil size={16} />
    </button>

    <button
      onClick={() => {
        drawRef.current?.deleteAll();
        setPolygonCount(0);
      }}
      className="icon-btn"
      title="Clear Polygons"
    >
      <Trash2 size={16} />
    </button>
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setShowPolygonList((v) => !v)}
        className="icon-btn"
        title="Saved Zones"
      >
        <Save size={16} />
      </button>
      <>
      {/* Open main polygon popup */}
      {showPolygonList && (
        <div className="polygon-overlay" onClick={() => setShowPolygonList(false)}>
          <div className="polygon-modal" onClick={(e) => e.stopPropagation()}>
            {/* BODY */}
            <div className="polygon-body">
              {/* LEFT PANEL — PROJECT */}
              <div className="polygon-panel project-panel">
                Project Specific Polygon List

                {/* ===== SHP POPUP INSIDE LEFT PANEL ===== */}
                {showShpPopup && (
                  <div className="shp-popup-inside-panel">
                    <h4>Select SHP File</h4>
                    <div className="shp-list">
                      {polygonFiles.map((file) => (
                        <div
                          key={file}
                          className={`shp-item ${selectedShpFile === file ? "active" : ""}`}
                          onClick={() => setSelectedShpFile(file)}
                        >
                          {file}
                        </div>
                      ))}
                    </div>

                    <div className="shp-footer">
                      <button
                        className="btnStyle"
                        disabled={!selectedShpFile}
                        onClick={() => {
                          if (!selectedShpFile) return;
                          fetchProjectZones(selectedShpFile);
                        }}
                      >
                        Continue
                      </button>
                      <button className="btnStyle danger" onClick={() => setShowShpPopup(false)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* ===== LIST ZONES AFTER SHP SELECT ===== */}
                 {projectZones.length > 0 && (
                  <div className="polygon-scroll">
                    {projectZones.length > 0 && (
              <div className="polygon-scroll">
                {projectZones
                  .slice()
                  .sort((a, b) => {
                    const idA = Number(a.id);
                    const idB = Number(b.id);
                    return idA - idB;
                  })
                  .map((lp, index) => (
                    <div
                      key={lp.id}
                      className={`polygon-row ${
                        selectedPolygon?.id === lp.id
                          ? "active"
                          : index % 2 === 0
                          ? "even"
                          : "odd"
                      }`}
                      onClick={() => setSelectedPolygon(lp)}
                    >
                 
                      <div className="zone-id">{lp.zone_id}</div>
                      <div className="zone-name">{lp.zone_name}</div>
                     
                    </div>
                  ))}
              </div>
            )}

                  </div>
                )}
              </div>

              {/* RIGHT PANEL — USER */}
              <div className="polygon-panel user-panel">
                <div className="panel-title">User Specific Polygon List</div>
                <div className="polygon-scroll">
                  {listpolygon.map((lp, index) => (
                    <div
                      key={lp.id}
                      className={`polygon-row ${
                        userselectedPolygon?.id === lp.id
                          ? "active"
                          : index % 2 === 0
                          ? "even"
                          : "odd"
                      }`}
                      onClick={() => setUserSelectedPolygon(lp)}
                    >
                      <div className="zone-id">{lp.zone_id}</div>
                      <div className="zone-name">{lp.zone_name}</div>
                    </div>
                  ))}
                </div>
              </div>

            </div>

            {/* FOOTER */}
            <div className="polygon-footer">
              {/* LEFT FOOTER */}
              <div className="footer-section">
                 {userRole === "PROJECT_MANAGER" && (
                  <div className="project-footer">
                    <button className="btnStyle primary" onClick={onButtonClick}>
                      Choose File
                    </button>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handlePolygonZipUpload}
                      accept=".zip"
                      className="hidden-input"
                    />

                    <button
                    className="btnStyle primary"
                    disabled={!selectedPolygon}
                    onClick={() => {
                      const geojson = {
                        type: "FeatureCollection",
                        features: [
                          {
                            type: "Feature",
                            geometry: selectedPolygon.geometry,
                            properties: {
                              id: selectedPolygon.id,
                              zone_id: selectedPolygon.zone_id,
                              zone_name: selectedPolygon.zone_name,
                            },
                          },
                        ],
                      };

                      console.log("📦 Final GeoJSON:", geojson);

                      window.loadPolygonLayer(geojson);
                      setShowPolygonList(false)
                    }}
                  >
                    Upload
                  </button>


                  </div>
                )}
              </div>

              {/* RIGHT FOOTER */}
              <div className="footer-section">
                <button
                  className="btnStyle secondary"
                  onClick={() => {handleApply(userselectedPolygon),console.log(userselectedPolygon) }}
                  disabled={!userselectedPolygon}
                >
                  Apply
                </button>
                <button className="btnStyle danger" onClick={() => setShowPolygonList(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>

    
</div>
  </div> 
  {/* Drive & Grid buttons anchored under polygon */}
    <div
  style={{
    position: "absolute",
    left: 0,
    top: "100%",
    marginTop: 6,
    transform: "translate(-2px, -13px)",// lifts buttons up
    display: "flex",
    flexDirection: "column",
    gap: 6,
    alignItems: "center",
    zIndex: 2,
  }}
>
  <button
    onClick={() => setShowDrivePanel((v) => !v)}
    className="icon-btn"
    title="Drive Test"
    style={{
      width: 36,
      height: 22,
      padding: 0,
      fontSize: 13,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    📡
  </button>

  <button
    onClick={() => setShowGridPanel((v) => !v)}
    className="icon-btn"
    title="Grid Heatmap"
    style={{
      width: 36,
      height: 22,
      padding: 0,
      fontSize: 13,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    🔥
  </button>
</div>

</div>

        
      </div>

      {/* Distance box for ruler */}
      <div
        ref={distanceRef}
        id="distance-box"
        style={{
          position: "absolute",
          bottom: 40,
          right: 10,
          zIndex: 1200,
          background: "rgba(136, 233, 173, 0.47)",
          padding: "6px 8px",
          borderRadius: 6,
          color: "#333",
        }}
      />
      {showDrivePanel && (
  <div className="center-overlay" onClick={() => setShowDrivePanel(false)}>
    <div className="center-modal" onClick={e => e.stopPropagation()}>

      <div>
        {/* === Drive Test Upload === */}
        <div className="form-section">
          <label htmlFor="driveTestFile">📂 Upload Drive Test File</label>
          <input
            id="driveTestFile"
            type="file"
            accept=".csv,.xlsx,.xls,.geojson,.json"
            onChange={handleDriveTestFileChange}
            style={{ display: "block", marginTop: "6px" }}
          />

          {/* Progress Bar */}
          {fetchingKPI && (
            <div
              style={{
                height: "4px",
                background: "#e0e0e0",
                borderRadius: "2px",
                marginTop: "4px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${kpiProgress}%`,
                  background: "#4caf50",
                  transition: "width 0.2s",
                }}
              />
            </div>
          )}
        </div>

        {/* === Drive Test KPI Selection === */}
        <label>Select Drive Test KPI</label>
        {renderDropdown(
          "driveKPI",
          driveTestColumns,
          false,
          selectedDriveKPI,
          (selected) => {
            setSelectedDriveKPI(selected);
            if (!selected) return;

            setFetchingKPI(true);
            setKpiProgress(0);

            // Animate progress bar
            const interval = setInterval(() => {
              setKpiProgress((prev) => (prev < 95 ? prev + 5 : prev));
            }, 100);

            fetch(
              `${import.meta.env.VITE_API_URL}/drive-test/column-range?column=${encodeURIComponent(
                selected
              )}`
            )
              .then((res) => res.json())
              .then(({ min, max }) => {
                if (typeof min === "number" && typeof max === "number") {
                  setDriveLayerRange({ min, max });

                  const step = (max - min) / 3;
                  const defaultBands = {
                    "#00ff00": [min, min + step],
                    "#ffff00": [min + step, min + 2 * step],
                    "#ff0000": [min + 2 * step, max],
                  };

                  setLocalColorRanges((prev) => {
                    const newRanges = {
                      ...prev,
                      [selected]: prev[selected] || defaultBands,
                    };

                    // ✅ Immediately trigger drive test layer redraw
                    window.refreshDriveTestLayer?.(selected);

                    return newRanges;
                  });
                } else {
                  setDriveLayerRange({ min: null, max: null });
                }
              })
              .catch((err) => {
                console.error("❌ Failed fetching KPI range:", err);
                setDriveLayerRange({ min: null, max: null });
              })
              .finally(() => {
                clearInterval(interval);
                setKpiProgress(100);
                setTimeout(() => {
                  setFetchingKPI(false);
                  setKpiProgress(0);
                }, 300);

                // Still refresh visuals
                window.refreshDriveTestLayer?.();
              });
          }
        )}

        {/* === Range Info === */}
        {selectedDriveKPI &&
          driveLayerRange.min != null &&
          driveLayerRange.max != null && (
            <p
              className="range-info"
              style={{ fontSize: "10px", fontWeight: "bold" }}
            >
              Range <strong>{selectedDriveKPI}</strong>: {" "}
              <span>
                {driveLayerRange.min} – {driveLayerRange.max}
              </span>
            </p>
          )}

        {/* === Dynamic Color Bands for Drive Test KPI === */}
        {selectedDriveKPI && localColorRanges[selectedDriveKPI] && (
          <div className="color-range-wrapper">
            {Object.entries(localColorRanges[selectedDriveKPI]).map(
              ([color, [min, max]]) => (
                <div
                  key={color}
                  className="color-range-row"
                  style={{ marginBottom: "6px" }}
                >
                  <label style={{ minWidth: 70, fontWeight: 500 }}>
                    {getColorLabel(color)}:
                  </label>

                  {/* Color Picker */}
                  <input
                    type="color"
                    value={color.startsWith("#") ? color : ""}
                    onChange={(e) => {
                      const newColor = e.target.value;
                      setLocalColorRanges((prev) => {
                        const bands = { ...prev[selectedDriveKPI] };
                        bands[newColor] = bands[color];
                        delete bands[color];
                        return { ...prev, [selectedDriveKPI]: bands };
                      });
                      window.refreshDriveTestLayer?.();
                    }}
                    style={{
                      width: 24,
                      height: 24,
                      border: "none",
                      marginRight: 8,
                    }}
                  />

                  {/* Min */}
                  <input
                    type="number"
                    className="input"
                    style={{ width: 70 }}
                    value={min ?? ""}
                    onChange={(e) => {
                      setLocalColorRanges((prev) => ({
                        ...prev,
                        [selectedDriveKPI]: {
                          ...prev[selectedDriveKPI],
                          [color]: [Number(e.target.value), max],
                        },
                      }));
                      window.refreshDriveTestLayer?.();
                    }}
                  />

                  {/* Max */}
                  <input
                    type="number"
                    className="input"
                    style={{ width: 70 }}
                    value={max ?? ""}
                    onChange={(e) => {
                      setLocalColorRanges((prev) => ({
                        ...prev,
                        [selectedDriveKPI]: {
                          ...prev[selectedDriveKPI],
                          [color]: [min, Number(e.target.value)],
                        },
                      }));
                      window.refreshDriveTestLayer?.();
                    }}
                  />

                  {/* Remove Band */}
                  <button
                    className="btn-remove"
                    style={{ marginLeft: 6 }}
                    onClick={() => {
                      setLocalColorRanges((prev) => {
                        const updated = { ...prev[selectedDriveKPI] };
                        delete updated[color];
                        return { ...prev, [selectedDriveKPI]: updated };
                      });
                      window.refreshDriveTestLayer?.();
                    }}
                  >
                    ❌
                  </button>
                </div>
              )
            )}

            {/* === Add New Color Band === */}
            {!addingDriveColor ? (
              <button
                className="btn-add"
                style={{ marginTop: 8 }}
                onClick={() => {
                  setAddingDriveColor(true);
                  setNewDriveColorHex("#0000ff");
                  setNewDriveMin(driveLayerRange.min ?? 0);
                  setNewDriveMax(driveLayerRange.max ?? 0);
                }}
              >
                + Add Color Band
              </button>
            ) : (
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  alignItems: "center",
                  marginTop: 8,
                }}
              >
                <input
                  type="color"
                  value={newDriveColorHex ?? ""}
                  onChange={(e) => setNewDriveColorHex(e.target.value)}
                  style={{ width: 32, height: 32, border: "none" }}
                />
                <input
                  type="number"
                  placeholder="Min"
                  value={newDriveMin ?? ""}
                  onChange={(e) => setNewDriveMin(Number(e.target.value))}
                  className="input"
                  style={{ width: 70 }}
                />
                <input
                  type="number"
                  placeholder="Max"
                  value={newDriveMax ?? ""}
                  onChange={(e) => setNewDriveMax(Number(e.target.value))}
                  className="input"
                  style={{ width: 70 }}
                />
                <button
                  className="btn-add"
                  onClick={() => {
                    if (localColorRanges[selectedDriveKPI]?.[newDriveColorHex]) {
                      toast.error("Color already exists!");
                      return;
                    }
                    if (newDriveMin >= newDriveMax) {
                      toast.error("Min must be less than Max.");
                      return;
                    }
                    setLocalColorRanges((prev) => ({
                      ...prev,
                      [selectedDriveKPI]: {
                        ...prev[selectedDriveKPI],
                        [newDriveColorHex]: [newDriveMin, newDriveMax],
                      },
                    }));
                    setAddingDriveColor(false);
                    window.refreshDriveTestLayer?.();
                  }}
                >
                  ✅ Add
                </button>
                <button
                  className="btn-remove"
                  style={{ marginLeft: 6 }}
                  onClick={() => setAddingDriveColor(false)}
                >
                  ❌
                </button>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  </div>
)}
{showGridPanel && (
  <div className="center-overlay" onClick={() => setShowGridPanel(false)}>
    <div className="center-modal" onClick={e => e.stopPropagation()}>

      <div>
        {/* === Grid Map / Heatmap Upload === */}
        <div className="form-section">
          <label htmlFor="gridMapFile">📂 Upload Grid Map File</label>
          <input
            id="gridMapFile"
            type="file"
            accept=".csv,.xlsx,.xls,.geojson,.json"
            onChange={handleGridMapFileChange}
            style={{ display: "block", marginTop: "6px" }}
          />

          {/* Progress Bar */}
          {fetchingGridKPI && (
            <div
              style={{
                height: "6px",
                background: "#ddd",
                borderRadius: "3px",
                marginTop: "6px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${gridKpiProgress}%`,
                  background: "linear-gradient(90deg, #4caf50, #81c784)",
                  transition: "width 0.15s ease-in-out",
                }}
              />
            </div>
          )}
        </div>

        <label>Select KPI for Heatmap</label>
        {renderDropdown(
          "gridKPI",
          gridKPIColumns,
          false,
          selectedGridKPI,
          async (selected) => {
            setSelectedGridKPI(selected);
            setSelectedLayerColumn?.(selected);

            setFetchingGridKPI(true);
            setGridKpiProgress(0);

            const interval = setInterval(() => {
              setGridKpiProgress((prev) => (prev < 90 ? prev + 5 : prev));
            }, 120);

            try {
              let min, max;

              if (kpiSource.type === "file") {
                const res = await fetch(
                  appendDateParams(
                    `${getApiBaseUrl()}/grid-map/column-range?column=${encodeURIComponent(
                      selected
                    )}&table=${encodeURIComponent(phdbTable || "")}`
                  )
                );
                ({ min, max } = await res.json());
              } else if (kpiSource.type === "target" && kpiSource.table) {
                const resRange = await fetch(
                  `${import.meta.env.VITE_API_URL}/grid-map/column-range?column=${encodeURIComponent(
                    selected
                  )}&table=${encodeURIComponent(kpiSource.table)}`
                );
                ({ min, max } = await resRange.json());

                const resData = await fetch(
                  appendDateParams(
                    `${getApiBaseUrl()}/grid-map/data?table=${encodeURIComponent(
                      kpiSource.table
                    )}`
                  )
                );
                const geojson = await resData.json();
                if (geojson?.features) {
                  setGridMapGeoJSON(geojson);
                  onGridData?.(geojson);
                }
              }

              // ✅ Same range logic as before
              if (typeof min === "number" && typeof max === "number") {
                setGridLayerRange({ min, max });

                const step = (max - min) / 3;
                const defaultBands = {
                  "#00ff00": [min, min + step],
                  "#ffff00": [min + step, min + 2 * step],
                  "#ff0000": [min + 2 * step, max],
                };

                setLocalColorRanges((prev) => {
                  const newRanges = {
                    ...prev,
                    [selected]: prev[selected] || defaultBands,
                  };
                  return newRanges;
                });

                window.refreshGridLayer?.();
              } else {
                setGridLayerRange({ min: null, max: null });
              }
            } catch (err) {
              console.error("❌ Failed fetching Grid KPI range/data:", err);
              setGridLayerRange({ min: null, max: null });
            } finally {
              clearInterval(interval);
              setGridKpiProgress(100);
              setTimeout(() => {
                setFetchingGridKPI(false);
                setGridKpiProgress(0);
              }, 500);
            }
          }
        )}

        {/* === Show KPI Source Info === */}
        {(kpiSource.type === "file" || kpiSource.type === "target") && (
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
            KPI source: {" "}
            {kpiSource.type === "file" ? "Uploaded file" : `Table: ${kpiSource.table}`}
          </div>
        )}

        {/* === Range Info === */}
        {selectedGridKPI &&
          gridLayerRange.min != null &&
          gridLayerRange.max != null && (
            <p className="range-info" style={{ fontSize: "10px", fontWeight: "bold" }}>
              Range <strong>{selectedGridKPI}</strong>: {" "}
              <span>
                {gridLayerRange.min} – {gridLayerRange.max}
              </span>
            </p>
          )}

        {/* === Dynamic Color Bands for Heatmap KPI === */}
        {selectedGridKPI && localColorRanges[selectedGridKPI] && (
          <div className="color-range-wrapper">
            {Object.entries(localColorRanges[selectedGridKPI]).map(([color, [min, max]]) => (
              <div key={color} className="color-range-row" style={{ marginBottom: "6px" }}>
                <label style={{ minWidth: 70, fontWeight: 500 }}>{getColorLabel(color)}:</label>

                {/* Color Picker */}
                <input
                  type="color"
                  value={color.startsWith("#") ? color : "#000000"}
                  onChange={(e) => {
                    const newColor = e.target.value;

                    setLocalColorRanges((prev) => {
                      const bands = { ...prev[selectedGridKPI] };
                      bands[newColor] = bands[color];
                      delete bands[color];
                      return { ...prev, [selectedGridKPI]: bands };
                    });
                    window.refreshGridLayer?.();
                  }}
                  style={{ width: 24, height: 24, border: "none", marginRight: 8 }}
                />

                {/* Min */}
                <input
                  type="number"
                  className="input"
                  style={{ width: 70 }}
                  value={min ?? ""}
                  onChange={(e) => {
                    const newMin = Number(e.target.value);
                    setLocalColorRanges((prev) => ({
                      ...prev,
                      [selectedGridKPI]: {
                        ...prev[selectedGridKPI],
                        [color]: [newMin, max],
                      },
                    }));
                    window.refreshGridLayer?.();
                  }}
                />

                {/* Max */}
                <input
                  type="number"
                  className="input"
                  style={{ width: 70 }}
                  value={max ?? ""}
                  onChange={(e) => {
                    const newMax = Number(e.target.value);
                    setLocalColorRanges((prev) => ({
                      ...prev,
                      [selectedGridKPI]: {
                        ...prev[selectedGridKPI],
                        [color]: [min, newMax],
                      },
                    }));
                    window.refreshGridLayer?.();
                  }}
                />

                {/* Remove Band */}
                <button
                  className="btn-remove"
                  style={{ marginLeft: 6 }}
                  onClick={() => {
                    setLocalColorRanges((prev) => {
                      const updated = { ...prev[selectedGridKPI] };
                      delete updated[color];
                      return { ...prev, [selectedGridKPI]: updated };
                    });
                    window.refreshGridLayer?.();
                  }}
                >
                  ❌
                </button>
              </div>
            ))}

            {/* === Add New Color Band === */}
            {!addingGridColor ? (
              <button className="btn-add" style={{ marginTop: 8 }} onClick={() => {
                setAddingGridColor(true);
                setNewGridColorHex("#0000ff");
                setNewGridMin(gridLayerRange.min ?? 0);
                setNewGridMax(gridLayerRange.max ?? 0);
              }}>
                + Add Color Band
              </button>
            ) : (
              <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: 8 }}>
                <input type="color" value={newGridColorHex ?? "#0000ff"} onChange={(e) => setNewGridColorHex(e.target.value)} style={{ width: 32, height: 32, border: "none" }} />
                <input type="number" placeholder="Min" value={newGridMin ?? ""} onChange={(e) => setNewGridMin(Number(e.target.value))} className="input" style={{ width: 70 }} />
                <input type="number" placeholder="Max" value={newGridMax ?? ""} onChange={(e) => setNewGridMax(Number(e.target.value))} className="input" style={{ width: 70 }} />
                <button className="btn-add" onClick={() => {
                  if (localColorRanges[selectedGridKPI]?.[newGridColorHex]) {
                    toast.error("Color already exists!");
                    return;
                  }
                  if (newGridMin >= newGridMax) {
                    toast.error("Min must be less than Max.");
                    return;
                  }
                  setLocalColorRanges((prev) => ({
                    ...prev,
                    [selectedGridKPI]: {
                      ...prev[selectedGridKPI],
                      [newGridColorHex]: [newGridMin, newGridMax],
                    },
                  }));
                  setAddingGridColor(false);
                  window.refreshGridLayer?.();
                }}>
                  ✅ Add
                </button>
                <button className="btn-remove" style={{ marginLeft: 6 }} onClick={() => setAddingGridColor(false)}>❌</button>
              </div>
            )}
          </div>
        )}

      </div>

    </div>
  </div>
)}


      {/* Legend popup */}
      {showLegend && (
        <div
          className="map-legend-popup"
          style={{
            position: "absolute",
            bottom: 10,
            right: 2,
            zIndex: 12000,
            background: "#ffffff",
            borderRadius: 8,
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            overflow: "hidden", // ⭐ important for clean stacking
            width: 260, // ⭐ SINGLE SOURCE OF WIDTH
          }}
        >
          {/* 📅 Date panel — looks like legend header */}
          {renderDatePanel()}

          {/* Legend body */}
          <div style={{ padding: 12 }}>
            <select
              value={legendMode}
              onChange={(e) => setLegendMode(e.target.value)}
              className="input"
              style={{ marginBottom: 10, width: "100%" }}
            >
              <option value="generation">Generation Colors</option>
              <option value="sector">Sector KPI</option>
              <option value="band">Band Colors</option>
              <option value="driveTest">Drive Test KPI</option>
              <option value="grid">Grid KPI</option>
              <option value="rca">RCA Analysis</option>
              <option value="cmchange">CM Change Analysis</option>
              <option value="alarm">Alarm Analysis</option>
              <option value="traffic">Traffic Analysis</option>
            </select>

            <div style={{ maxHeight: 280, overflow: "auto" }}>
              {renderLegendContent()}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default MapRenderer;
