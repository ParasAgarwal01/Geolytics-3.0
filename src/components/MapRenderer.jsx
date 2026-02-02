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
<<<<<<< HEAD
import {getToken, checkCookieExpiration,isUserLoggedIn } from "./CookiesUtils";
import { redirectToLogin } from "./Logout";

=======
import { getEnabledFeatures, getToken } from "./CookiesUtils";
>>>>>>> 651384dfa488677c9c85e4042eba64151d50df11

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

const getCellName = (props) =>
  getFirstProp(props, [
    "cellname",
    "Cellname",
    "Cell_name",
    "CELLNAME",
    "CELL_NAME",
  ]);

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


  const generateColors = (values) => {
    const colors = {};
    const step = 360 / values.length;
    values.forEach((val, i) => {
      colors[val] = `hsl(${Math.round(i * step)},70%,50%)`;
    });
    return colors;
  };
  
<<<<<<< HEAD
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

=======
  const buildMatchExpression = (geojson) => {
    const zones = [...new Set(geojson.features.map(f => f.properties.B4_Polygon))];
    const colors = generateColors(zones);
    const expression = ['match', ['get', 'B4_Polygon']];
    zones.forEach(zone => {
      expression.push(zone, colors[zone]);
    });
    expression.push('#cccccc');
    return expression;
  };
>>>>>>> 651384dfa488677c9c85e4042eba64151d50df11







/* ---------------- Component ---------------- */

const MapRenderer = ({
  mapStyle,
  radiusScale = 0.2,

  geojsonData,
  driveTestGeoJSON,
  gridMapGeoJSON,

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


  const [showLegend, setShowLegend] = useState(true);
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

  // 🔍 Search panel state
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchHistory, setSearchHistory] = useState([]); // stack of previous highlights
  const [searchResults, setSearchResults] = useState([]);
  const [internalHighlight, setInternalHighlight] = useState(null);

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

<<<<<<< HEAD
  //  POLYGON DRAWING & SITE DETECTION SECTION

=======
  // 🎨 POLYGON DRAWING & SITE DETECTION SECTION

  // --- STATE VARIABLES FOR DRAWING ---
>>>>>>> 651384dfa488677c9c85e4042eba64151d50df11
  const drawRef = useRef(null);                           // MapboxDraw instance
  const popupRef = useRef(null);                          // Mapbox Popup instance
  const currentMatchedSitesRef = useRef([]);              // Sites matched in polygon
  const currentActiveZoneIdRef = useRef(null);            // Current zone ID
  const isDrawingRef = useRef(false);                     // Is user currently drawing
  
  const [isDrawing, setIsDrawing] = useState(false);      // Drawing mode state
  const [showCountryPopup, setShowCountryPopup] = useState(false);  // Show country selection popup
  const [pendingMode, setPendingMode] = useState(null);   // Pending draw mode
  const [polygonCount, setPolygonCount] = useState(0);    // Counter for zone IDs
  const [selectedCountry, setSelectedCountry] = useState(null);  // Selected country
<<<<<<< HEAD
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

  

  const username = checkCookieExpiration().userData?.first_name || "User";
  // console.log(checkCookieExpiration(),'cookies')
  const userRole = checkCookieExpiration().userData?.role || 'User';
=======

  const username = getEnabledFeatures()?.first_name || "User";
>>>>>>> 651384dfa488677c9c85e4042eba64151d50df11

  // --- COUNTRY COORDINATES FOR MAP FLYTO ---
  const countryCoordinates = {
    UK: { coords: [-0.1276, 51.5074], prefix: "UK" },
    USA: { coords: [-95.7129, 37.0902], prefix: "USA" },
    India: { coords: [78.9629, 20.5937], prefix: "IND" },
  };

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

<<<<<<< HEAD

useEffect(() => {
  console.log("Auth check useEffect running");
  const value = isUserLoggedIn();
  console.log("isUserLoggedIn:", value);
  setIsLoggedIn(value);
}, []);


  const token = checkCookieExpiration().userData.token
    if (!token) {
      alert("Session expired. Please login again.");
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
    alert("Please upload zip first");
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



  // *** FUNCTION 1: INITIALIZE DRAWING TOOLS ***
//   const initializeDrawingTools = (map) => {
//     if (drawRef.current) {
//       console.log(" Draw already initialized, skipping");
//       return;
//     }

//     console.log(" Starting Draw initialization...");

//     try {
//       const draw = new MapboxDraw({
//         displayControlsDefault: false,
//         controls: {
//           polygon: false,
//           trash: false,
//         },
//         modes: {
//           ...MapboxDraw.modes,
//           draw_circle: CircleMode,
//           draw_freehand: FreehandMode,
//         },
//       });

//        map.on("load", () => {
//     if (!map.getSource("mapbox-gl-draw-cold")) return;

//     if (!map.getLayer("custom-draw-fill")) {
//       map.addLayer({
//         id: "custom-draw-fill",
//         type: "fill",
//         source: "mapbox-gl-draw-cold",
//         filter: ["==", ["geometry-type"], "Polygon"],
//         paint: {
//           "fill-color": ["coalesce", ["get", "fillColor"], "#3b82f6"],
//           "fill-opacity": 0.4,
//         },
//       });
//     }
//   });


      
//       map.addControl(draw);
//       console.log("✅ Draw control added to map");

//       if (!map.getLayer("draw-fill-inactive")) {
//   map.addLayer({
//     id: "draw-fill-inactive",
//     type: "fill",
//     source: "mapbox-gl-draw-cold",
//     filter: ["==", ["get", "$type"], "Polygon"],
//     paint: {
//       "fill-color": ["coalesce", ["get", "fillColor"], "#3b82f6"],
//       "fill-opacity": 0.4
//     }
//   });
// }

// if (!map.getLayer("draw-fill-active")) {
//   map.addLayer({
//     id: "draw-fill-active",
//     type: "fill",
//     source: "mapbox-gl-draw-hot",
//     filter: ["==", ["get", "$type"], "Polygon"],
//     paint: {
//       "fill-color": ["coalesce", ["get", "fillColor"], "#2563eb"],
//       "fill-opacity": 0.6
//     }
//   });
// }


//       drawRef.current = draw;

//       console.log(" drawRef.current is now set");

//       // Setup event listeners
//       setupDrawingListeners(map, draw);
//       console.log(" Event listeners attached");

//       // Load existing polygons
//       loadExistingPolygons();
//       console.log(" Attempted to load existing polygons");
//     } catch (error) {
//       console.error(" Error initializing Draw:", error);
//       drawRef.current = null;
//     }
//   };



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



  


 
=======
  // *** FUNCTION 1: INITIALIZE DRAWING TOOLS ***
  const initializeDrawingTools = (map) => {
    if (drawRef.current) {
      console.log("✅ Draw already initialized, skipping");
      return;
    }

    console.log("🔧 Starting Draw initialization...");

    try {
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
      });

      // Add to map FIRST
      map.addControl(draw);
      console.log("✅ Draw control added to map");

      // THEN set ref
      drawRef.current = draw;
      console.log("✅ drawRef.current is now set");

      // Setup event listeners
      setupDrawingListeners(map, draw);
      console.log("✅ Event listeners attached");

      // Load existing polygons
      loadExistingPolygons();
      console.log("✅ Attempted to load existing polygons");
    } catch (error) {
      console.error("❌ Error initializing Draw:", error);
      drawRef.current = null;
    }
  };
>>>>>>> 651384dfa488677c9c85e4042eba64151d50df11

  const setupDrawingListeners = (map, draw) => {
    console.log("🎯 Setting up drawing listeners...");

    // Mode change listener
<<<<<<< HEAD
map.on("draw.modechange", (e) => {
  const mode = draw.getMode();
  isDrawingRef.current = mode && (mode.includes("draw_polygon") || mode.includes("draw_freehand") || mode.includes("draw_circle"));

  const canvas = map.getCanvas();
  if (isDrawingRef.current && canvas) {
    canvas.style.cursor = "crosshair";
  } else if (canvas) {
    canvas.style.cursor = "default";
  }
});





    



    // Draw create listener - set zone ID on new polygon
      // map.on("draw.create", (e) => {
      //   const feature = e.features?.[0];
      //   if (!feature) return;

      //   const color = getRandomColor();
      //   draw.setFeatureProperty(feature.id, "fillColor", color);

      //   setPolygonCount((prev) => {
      //     const zoneId = `west_${prev}_${username}`;
      //     draw.setFeatureProperty(feature.id, "zone_id", zoneId);
      //     currentActiveZoneIdRef.current = zoneId;
      //     return prev + 1;
      //   });
      // });



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



      


=======
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
      if (!e.features || e.features.length === 0) return;
      const feature = e.features[0];
      if (!feature || !feature.id) return;

      setPolygonCount((prev) => {
        const countryPrefix = "west";
        const zoneId = `${countryPrefix}_${prev}_${username}`;
        draw.setFeatureProperty(feature.id, "zone_id", zoneId);
        currentActiveZoneIdRef.current = zoneId;
        return prev + 1;
      });
    });
>>>>>>> 651384dfa488677c9c85e4042eba64151d50df11

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

<<<<<<< HEAD

=======
  // *** FUNCTION 3: ACTIVATE TOOL ***
  // Activates polygon or freehand drawing mode
  // ❌ COUNTRY POPUP COMMENTED OUT - Direct drawing start
>>>>>>> 651384dfa488677c9c85e4042eba64151d50df11

  const activateTool = (mode) => {
    
    
<<<<<<< HEAD

=======
    // ❌ COMMENTED OUT: Country popup check
    // If country not selected, show popup first
    // if (!selectedCountry) {
    //   setPendingMode(mode);
    //   openCountryPopup();
    //   return;
    // }

    // Country already selected, activate directly
>>>>>>> 651384dfa488677c9c85e4042eba64151d50df11
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

<<<<<<< HEAD
=======
  // *** FUNCTION 4: OPEN COUNTRY POPUP ***
  // Displays country selection modal for first-time activation
  const openCountryPopup = () => {
    console.log("🌍 Opening country selection popup");
    setShowCountryPopup(true);
  };

  // *** FUNCTION 5: HANDLE COUNTRY SELECT ***
  const handleCountrySelect = (country) => {
    console.log(`📍 Selected country: ${country}`);
    const { coords, prefix } = countryCoordinates[country];
    const map = mapInstance.current;

    // Save selected country
    setSelectedCountry(country);

    if (map) {
      map.flyTo({
        center: coords,
        zoom: 5,
        duration: 2000,
      });
    }

    setShowCountryPopup(false);
    setTimeout(() => {
      console.log("🎯 Activating drawing tool now...");
      activateTool(pendingMode || "draw_polygon");
    }, 2500);
  };

>>>>>>> 651384dfa488677c9c85e4042eba64151d50df11
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

<<<<<<< HEAD

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



=======
  const handleMapClick = (e) => {
    const map = mapInstance.current;
    const draw = drawRef.current;
    if (!map || !draw) return;

    // Skip if currently drawing
    const mode = draw.getMode();
    if (mode && (mode.includes("draw_polygon") || mode.includes("draw_freehand") || mode.includes("draw_circle"))) {
      console.log("⏸ Still drawing, skipping polygon click");
      return;
    }

    // Get clicked features from draw layer
    const ids = draw.getFeatureIdsAt(e.point);
    if (!ids || ids.length === 0) {
      console.log(" No polygon clicked");
      if (popupRef.current) {
        popupRef.current.remove();
      }
      // Reset cursor to default
      map.getCanvas().style.cursor = "default";
      return;
    }

    // Get the clicked feature
    const feature = draw.get(ids[0]);
    if (!feature || !feature.geometry || feature.geometry.type !== "Polygon") {
      console.log(" Clicked feature is not a polygon");
      return;
    }

    console.log("✅ Polygon clicked:", feature);
    map.getCanvas().style.cursor = "pointer";
    detectClickedSites(feature);
  };
>>>>>>> 651384dfa488677c9c85e4042eba64151d50df11

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
      alert("No sites to export");
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
      alert("Error exporting CSV");
    }
  };

  // *** FUNCTION 10: HANDLE SUBMIT TO BACKEND ***
 
  const handleSubmitToBackend = async () => {
<<<<<<< HEAD
    const token = checkCookieExpiration().userData.token
    if (!token) {
      toast.error("Session expired. Please login again.");
      redirectToLogin();
=======
    const token = getToken();
    if (!token) {
      alert("Session expired. Please login again.");
      window.location.reload();
>>>>>>> 651384dfa488677c9c85e4042eba64151d50df11
      return;
    }

    const draw = drawRef.current;
    if (!draw) {
<<<<<<< HEAD
      toast.error("Drawing tools not ready");
=======
      alert("Drawing tools not ready");
>>>>>>> 651384dfa488677c9c85e4042eba64151d50df11
      return;
    }

    const zoneId = currentActiveZoneIdRef.current;
    const sites = currentMatchedSitesRef.current;

<<<<<<< HEAD
    console.log(zoneId,'z')

    if (!zoneId) {
      toast.error("No zone ID set");
=======
    if (!zoneId) {
      alert("No zone ID set");
      return;
>>>>>>> 651384dfa488677c9c85e4042eba64151d50df11
    }

    const allFeatures = draw.getAll().features;
    const currentPolygon = allFeatures.find((f) => f.properties?.zone_id === zoneId);
<<<<<<< HEAD
    console.log(currentPolygon,'hj')

    if (!currentPolygon) {
      toast.error("Could not find the polygon geometry to save.");
=======

    if (!currentPolygon) {
      alert("Could not find the polygon geometry to save.");
>>>>>>> 651384dfa488677c9c85e4042eba64151d50df11
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

<<<<<<< HEAD

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


const zoomToPolygon = (polygon) => {
  const draw = drawRef.current;
  if (!draw) return;

  const feature = draw.get(polygon.id);
  if (!feature?.geometry) return;

  const geometry = feature.geometry;

  const coordinates =
    geometry.type === "MultiPolygon"
      ? geometry.coordinates.flat(2)
      : geometry.coordinates[0];

  const bounds = coordinates.reduce(
    (b, coord) => b.extend(coord),
    new mapboxgl.LngLatBounds(coordinates[0], coordinates[0])
  );

  // ✅ USE THE REAL MAP INSTANCE
  const map = mapInstance.current;
  if (!map) {
    console.warn("⚠️ Map instance not ready");
    return;
  }

  map.fitBounds(bounds, {
    padding: 60,
    duration: 1000,
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
=======
    try {
      const response = await fetch(
        "http://127.0.0.1:8000/api/geolytics/geo-api/polygon/save_polygon",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Token ${token}`,
          },
          body: JSON.stringify(payload),
        }
      );

      if (response.ok) {
        alert("✅ Polygon and geometry saved successfully");
      } else {
        alert("❌ Server error");
      }
    } catch (err) {
      alert("❌ Network error");
      console.error("Error:", err);
    }
  };

  // *** FUNCTION 11: LOAD EXISTING POLYGONS ***
  const loadExistingPolygons = async () => {
    const token = getToken();
    if (!token) {
      alert("Session expired. Please login again.");
      return;
    }

    try {
      const response = await fetch(
        "http://127.0.0.1:8000/api/geolytics/geo-api/polygon/user_polygon_list",
        {
          headers: { Authorization: `Token ${token}` },
        }
      );

      const data = await response.json();
      console.log(data, "polygons data");

      if (data.success && data.results) {
        const draw = drawRef.current;
        if (!draw) return;

        draw.deleteAll();

        const features = data.results
          .map((item) => {
            if (item.site_data && item.site_data.feature) {
              return {
                ...item.site_data.feature,
                id: item.id,
                properties: {
                  ...item.site_data.feature.properties,
                  zone_id: item.zone_id,
                  country: item.country,
                },
              };
            }

            if (Array.isArray(item.site_data) && item.site_data.length > 2) {
              const points = item.site_data.map((s) => [
                s.LONGITUDE,
                s.LATITUDE,
              ]);
              if (points[0][0] !== points[points.length - 1][0]) {
                points.push(points[0]);
              }
              return turf.polygon([points], {
                zone_id: item.zone_id,
                id: item.id,
              });
            }

            return null;
          })
          .filter((f) => f !== null);

        draw.add({
          type: "FeatureCollection",
          features,
        });

        console.log("✅ Polygons loaded successfully");
      } else {
        console.warn("No polygons found");
      }
    } catch (err) {
      console.error("Error loading polygons:", err);
      alert("Error loading polygons");
    }
  };


  // UI COMPONENTS FOR POLYGON DRAWING
  const drawingUI = (
    <div style={{
      position: "absolute",
      top: "30px",
      right: "50px",
      backgroundColor: "white",
      borderRadius: "8px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
      padding: "5px",
      display: "flex",
      // flexDirection: "column",
      gap: "4px",
      zIndex: 10,
    }}>
      <button
        onClick={() => activateTool("draw_polygon")}
        title="Draw Polygon"
        style={{
          padding: "5px",
          borderRadius: "4px",
          border: "1px solid #d1d5db",
          cursor: "pointer",
          // backgroundColor: "#f3f4f6",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Pentagon size={15} />
      </button>
      <button
        onClick={() => activateTool("draw_freehand")}
        title="Draw Freehand"
        style={{
          padding: "5px",
          borderRadius: "4px",
          border: "1px solid #d1d5db",
          cursor: "pointer",
          backgroundColor: "#f3f4f6",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Pencil size={15} />
      </button>
      <button
        onClick={() => {
          if (drawRef.current) {
            drawRef.current.deleteAll();
            setPolygonCount(0);
          }
        }}
        title="Clear All"
        style={{
          padding: "5px",
          borderRadius: "4px",
          border: "1px solid #d1d5db",
          cursor: "pointer",
          backgroundColor: "#f3f4f6",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Trash2 size={15} />
      </button>
      <button
        onClick={() => loadExistingPolygons()}
        title="Load Saved Polygons"
        style={{
          padding: "5px",
          borderRadius: "4px",
          border: "1px solid #d1d5db",
          cursor: "pointer",
          backgroundColor: "#f3f4f6",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Save size={15} />
      </button>
      {selectedCountry && (
        <button
          onClick={() => {
            setSelectedCountry(null);
            setTimeout(() => openCountryPopup(), 0);
          }}
          title="Change Country"
          style={{
            padding: "10px 12px",
            borderRadius: "6px",
            border: "1px solid #fbbf24",
            cursor: "pointer",
            backgroundColor: "#fef3c7",
            fontSize: "12px",
            fontWeight: "600",
            color: "#92400e",
            transition: "all 0.2s",
          }}
          onMouseOver={(e) => e.target.style.backgroundColor = "#fcd34d"}
          onMouseOut={(e) => e.target.style.backgroundColor = "#fef3c7"}
        >
          🌍 {selectedCountry}
        </button>
      )}
    </div>
  );

  // 🗺️ COUNTRY SELECTION POPUP
  // Modal that appears when user first clicks polygon/freehand button
  // Shows UK, USA, India options
  // On selection: saves country, animates map to coordinates, activates drawing tool
  // Has "Change Country" button visible in toolbar after selection
  const countryPopup = showCountryPopup && (
    <div style={{
      position: "fixed",
      top: 0,
      left: 0,
      width: "100%",
      height: "100%",
      backgroundColor: "rgba(0,0,0,0.5)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1000,
    }}>
      <div style={{
        backgroundColor: "white",
        borderRadius: "8px",
        padding: "24px",
        maxWidth: "400px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
      }}>
        <h2 style={{ marginTop: 0, marginBottom: "16px" }}>Select Country</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {Object.keys(countryCoordinates).map((country) => (
            <button
              key={country}
              onClick={() => handleCountrySelect(country)}
              style={{
                padding: "12px",
                backgroundColor: "#3b82f6",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "14px",
              }}
            >
              {country}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowCountryPopup(false)}
          style={{
            marginTop: "12px",
            padding: "8px",
            backgroundColor: "#ef4444",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            width: "100%",
            fontSize: "12px",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
>>>>>>> 651384dfa488677c9c85e4042eba64151d50df11

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

<<<<<<< HEAD
      

=======
      useEffect(() => {
        if (!mapInstance.current || drawRef.current) return;

        const draw = new MapboxDraw({
          displayControlsDefault: false,
          userProperties: true,
          modes: {
            ...MapboxDraw.modes,
            draw_circle: CircleMode,
            draw_freehand: FreehandMode,
          },
          styles: [
            // Default Mapbox Draw styles or custom styles here
            {
              id: 'gl-draw-polygon-fill-inactive',
              type: 'fill',
              filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon']],
              paint: { 'fill-color': '#3bb2d0', 'fill-opacity': 0.2 }
            },
            {
              id: 'gl-draw-polygon-stroke-active',
              type: 'line',
              filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']],
              paint: { 'line-color': '#fbb03b', 'line-dasharray': [0.2, 2], 'line-width': 2 }
            }
          ]
        });

        mapInstance.current.addControl(draw);
        drawRef.current = draw;

        // Event Listeners
        mapInstance.current.on('draw.create', handleDrawCreate);
        mapInstance.current.on('draw.modechange', (e) => {
          setIsDrawing(e.mode !== 'simple_select');
        });

        return () => {
          if (mapInstance.current && drawRef.current) {
            mapInstance.current.removeControl(drawRef.current);
          }
        };
      }, [mapInstance.current]);

>>>>>>> 651384dfa488677c9c85e4042eba64151d50df11

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

    const empty = { type: "FeatureCollection", features: [] };

    if (!geojsonData?.features?.length) {
      if (map.getSource("sectors")) map.getSource("sectors").setData(empty);
      return;
    }
    

    const features = geojsonData.features;
    const tableTypeLower = (tableType || "").toLowerCase();

    // 👇 Detect CM Change mode + whether color_column is "remarks"
    const cmColorColumn = geojsonData?.color_config?.color_column || "";
    const isCmRemarks =
      tableTypeLower.includes("cm change") &&
      cmColorColumn.trim().toLowerCase() === "remarks";
      

    // 0) Precompute CM buckets (global) if needed (ONLY when NOT remarks mode)
    let cmBands = cmLegend && cmLegend.length ? cmLegend : null;
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
    console.log("🏠 Site:", site, {
      totalFeats: feats.length,
      generations: Array.from(
        new Set(feats.map((f) => f.properties?.generation))
      ),
    });

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

      console.log("🌀 Drawing generation", gen, {
        site,
        innerR,
        outerR,
      });

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
          <div className="legend-title">Generation Colors (click to edit)</div>
          {["2G", "3G", "4G", "5G"].map((g) => (
            <div
              key={g}
              className="legend-item"
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <input
                type="color"
                value={generationColorMap[g] || GENERATION_COLORS[g]}
                onChange={(e) => handleGenerationColorChange(g, e.target.value)}
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
<<<<<<< HEAD
      
    
      

=======
      {/* Drawing UI */}
      {drawingUI}
      {countryPopup}
      
      {/* 🔍 Search + Band Expander Toggle (top-right offset) */}
>>>>>>> 651384dfa488677c9c85e4042eba64151d50df11
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

      {/* ℹ️ Info Sidebar */}
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

  {/* ⬟ MAIN BUTTON */}
  <button
    onClick={() => setShowPolygonPanel((v) => !v)}
    className="icon-btn"
    title="Polygon Tools"
    style={{
      position: "relative",
      zIndex: 3,
      color: "#dc2626",      // 🔴 red polygon
      fontSize: 18,
      fontWeight: 700,
      background: showPolygonPanel ? "#80f3a2" : "#80f3a2", // light red when active
      boxShadow: showPolygonPanel
        ? "0 2px 8px rgba(220, 38, 38, 0.3)"
        : "0 2px 6px rgba(0,0,0,0.12)",
      transition: "background 0.2s, box-shadow 0.2s",
      width: 36,
      height: 36,
      
    }}
  >
    ⬟
  </button>

  {/* 🔧 EXPANDED TOOLS — SAME VISUAL SURFACE */}
  <div
    style={{
      position: "absolute",
      right: "100%",               // ⬅ expand LEFT
      top: "50%",
      transform: showPolygonPanel
        ? "translateY(-50%)"
        : "translateY(-50%) scaleX(0.85)",
      transformOrigin: "right center",
      display: "flex",
      alignItems: "center",
      gap: 6,
      padding: "6px 8px",
      background: "#ffffff",       // SAME background
      borderRadius: 10,
      boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
      opacity: showPolygonPanel ? 1 : 0,
      pointerEvents: showPolygonPanel ? "auto" : "none",
      transition: "opacity 0.18s ease, transform 0.18s ease",
      zIndex: 2,
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
                {listpolygon.length > 0 && (
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
                {userRole === "USER" && (
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
