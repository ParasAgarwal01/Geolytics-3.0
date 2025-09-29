import React, {
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef
} from "react";
import mapboxgl from 'mapbox-gl';
import * as turf from '@turf/turf';
import 'mapbox-gl/dist/mapbox-gl.css';
import '../Styles.css';



const addHighlightLayer = (map, feature) => {
  if (!map.isStyleLoaded()) {
    map.once("idle", () => addHighlightLayer(map, feature));
    return;
  }

  if (!map.getSource("highlight")) {
    map.addSource("highlight", {
      type: "geojson",
      data: feature
    });
  } else {
    map.getSource("highlight").setData(feature);
  }

  if (!map.getLayer("highlight")) {
    map.addLayer({
      id: "highlight",
      type: "line",
      source: "highlight",
      paint: {
        "line-color": "#FFD700",
        "line-width": 3
      }
    });
  }
};



// Use Vite's env for the token
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const enrichGeoJSON = (rawGeoJSON, cityLookup = {}, kpiList = []) => {
  if (!rawGeoJSON?.features?.length) return rawGeoJSON;

  return {
    ...rawGeoJSON,
    features: rawGeoJSON.features.map((f) => {
      const cell = f.properties?.Cell_name || f.properties?.cellname;
      const enrichedProps = {
        ...f.properties,
        city: cityLookup?.[cell] || f.properties?.city || 'unknown',
      };

      // Enrich numeric KPIs
      kpiList.forEach((kpi) => {
        const rawValue = enrichedProps[kpi];
        enrichedProps[`__${kpi}`] =
          rawValue == null || rawValue === '' || isNaN(Number(rawValue))
            ? NaN
            : Number(rawValue);
      });

      return { ...f, properties: enrichedProps };
    }),
  };
};

const enrichGeoJSONWithKPIs = (geojson, kpiData, joinKey = 'cellname') => {
  return {
    ...geojson,
    features: geojson.features.map(f => {
      const joinValue = f.properties?.[joinKey];
      const matchingKpis = kpiData[joinValue] || {}; 
      return {
        ...f,
        properties: {
          ...props, 
          ...f.properties,
          ...matchingKpis,
          city: cityLookup[joinValue] || 'unknown', 
        }
      };
    })
  };
};
function generateSectorGeoJSON(data, selectedCellBand, colorRanges) {
  let firstColoredFeature = null;

  
  let filteredData = data;
  if (Array.isArray(selectedCellBand) && selectedCellBand.length > 0) {
    filteredData = data.filter((props) =>
      selectedCellBand.includes(props.cellname)
    );
  }

  
  filteredData.sort((a, b) => {
    const numA = parseInt((a.BAND || a.band || "").replace(/\D/g, "")) || 0;
    const numB = parseInt((b.BAND || b.band || "").replace(/\D/g, "")) || 0;
    return numB - numA;
  });

 
  const features = filteredData.map((props, idx) => {
    const { site_id, cellname, azimuth, city } = props;


    const fillColor =
      (colorRanges[cellname] &&
        Object.keys(colorRanges[cellname]).length > 0 &&
        Object.keys(colorRanges[cellname])[0]) || "#ccc"; 

   
    const maxRadius = 500; 
    const scaleFactor = 1 - idx * 0.15; 
    const geometry = generateSectorGeometry(azimuth, maxRadius * scaleFactor);

    const feature = {
  type: "Feature",
  geometry,
  properties: {
    ...props, 
    band: props.BAND || props.band || props.Band || "default",
    color: fillColor,
    azimuth,
    city: props.city || "unknown", 
    site_id,
  },
};


    if (!firstColoredFeature && fillColor !== "#ccc") {
      firstColoredFeature = feature;
    }

    return feature;
  });

  return {
    geojson: {
      type: "FeatureCollection",
      features,
    },
    firstColoredFeature,
  };
}


function getColorForValue(value, colorBands) {
  for (const { color, from, to } of colorBands) {
    if (value >= from && value <= to) return color;
  }
  return '#cccccc'; 
}






// Compute dynamic radius based on clutter, density, zoom, and user scale
// const getDynamicRadius = (props, mapZoom, siteDensity, userScale = 1) => {
//   let baseRadius = 0.1; // km default
//   const clutter = props.clutter_type?.toLowerCase();

//   // if (clutter === "urban") baseRadius = 0.2;
//   // else if (clutter === "suburban") baseRadius = 0.4;
//   // else if (clutter === "rural") baseRadius = 0.8;

//   // const densityFactor = siteDensity > 10 ? 0.6 : siteDensity > 5 ? 0.8 : 1.0;
//   // const zoomFactor = mapZoom < 8 ? 0.5 : mapZoom < 12 ? 1.0 : 1.5;

//   return baseRadius * userScale;
// };

const getDynamicRadius = (_props, _mapZoom, _siteDensity, userScale = 1) => {
  return userScale; // directly use slider radius (already in km)
};
const createSectorPolygon = (center, radiusKm, azimuth, beamWidth = 65) => {
  const points = [center];
  const startAngle = azimuth - beamWidth / 2;
  const endAngle = azimuth + beamWidth / 2;

  for (let angle = startAngle; angle <= endAngle; angle += 5) {
    const destination = turf.destination(center, radiusKm, angle, { units: "kilometers" });
    points.push(destination.geometry.coordinates);
  }
  points.push(center);
  return turf.polygon([points]);
};


const getColorForBand = (band) => {
  const colors = {
    '1800': '#1d4ed8',
    '900': '#10b981',
    '2100': '#eab308',
    '2300': '#f97316',
    'default': '#6366f1'
  };
  return colors[band] || colors['default'];
};

const KPI_OPTIONS = [
  { value: 'SINR', label: 'SINR' },
  { value: 'RSRP', label: 'RSRP' },
  { value: 'Complaints', label: 'Complaints' }
];

const BAND_OPTIONS = [
  { value: '1800', label: '1800 MHz' },
  { value: '900', label: '900 MHz' },
  { value: '2100', label: '2100 MHz' },
  { value: '2300', label: '2300 MHz' }
];


const createPopupHtml = (properties) => {
  const escapeHtml = (str) => 
    String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  let html = `<div class="popup-table-bordered">
    <table>
      <thead>
        <tr><th>Property</th><th>Value</th></tr>
      </thead>
      <tbody>`;

  for (const key in properties) {
    const formattedKey = key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
    let value = properties[key] ?? "";

    // Highlight city differently
    if (key.toLowerCase() === "city") {
      value = `<strong>${escapeHtml(value)}</strong>`;
    } else {
      value = escapeHtml(value);
    }

    html += `<tr><td>${formattedKey}</td><td>${value}</td></tr>`;
  }

  html += `</tbody></table></div>`;
  return html;
};


const addCityToGeoJSON = (geojson, cityLookup = {}) => {
  if (!geojson?.features) return geojson;

  geojson.features.forEach((feature) => {
    const cell = feature.properties?.cellname || feature.properties?.Cell_name;
    feature.properties.city =
      feature.properties.city || cityLookup[cell] || "unknown";
  });

  return geojson;
};

const MapRenderer = ({
  geojsonData,
  driveTestGeoJSON,
  highlightedFeature: externalHighlight,
  gridGeoJSON,
  colorColumn,          
  gridMapGeoJSON,
  colorBands,
  onSiteClick,
   selectedDriveKPI,
    colorRanges, 
    layerRange,
    gridData,
    driveLayerRange, 
    layerColumn,
    selectedGridKPI, 
    radiusScale = 1 ,
    selectedUniqueBands,
    filters,
    selectedColumnValues,
    cityLookup,
}) => {
  const [enrichedGeoJSON, setEnrichedGeoJSON] = useState(null);

  const [columnFilters, setColumnFilters] = useState([]);

  const [hasZoomedToSectors, setHasZoomedToSectors] = useState(false);
  const [rulerActive, setRulerActive] = useState(false);
  const rulerGeoJSON = useRef({ type: 'FeatureCollection', features: [] });
  const rulerLinestring = useRef({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });
  const distanceRef = useRef(null);
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const [driveTestColumns, setDriveTestColumns] = useState([]);

 
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [highlightedFeature, setHighlightedFeature] = useState(null);
  const [searchHistory, setSearchHistory] = useState([]);

 
  const [selectedKPI, setSelectedKPI] = useState('null');
  const [threshold, setThreshold] = useState(17);
  // const [gridMapGeoJSON, setGridMapGeoJSON] = useState(null);

const [gridLayerRange, setGridLayerRange] = useState({ min: null, max: null });



 
  const [showHeatmapPanel, setShowHeatmapPanel] = useState(false);
  const [showSearchPanel, setShowSearchPanel] = useState(false);

 
  const [showLegend, setShowLegend] = useState(false);
  const [legendType, setLegendType] = useState('kpi'); 
  const [siteCellOptions, setSiteCellOptions] = useState([]);
  const [selectedCellBand, setSelectedCellBand] = useState(null);
  const [perCellColorRanges, setPerCellColorRanges] = useState({});



const [selectedBandCells, setSelectedBandCells] = useState([]);
const [bandColorMap, setBandColorMap] = useState({});
// Remove local selectedUniqueBands state; use prop from App.jsx

const [availableGridKPIs, setAvailableGridKPIs] = useState([]);


  


   useEffect(() => {
  // whenever prop changes, update internal state
  setColumnFilters(selectedColumnValues || []);
}, [selectedColumnValues]);

useEffect(() => {
  if (!geojsonData) return;
  addSectorLayer({ columnFilters });
}, [columnFilters, selectedUniqueBands, geojsonData]);

  useEffect(() => {
    if (externalHighlight !== undefined) {
      setHighlightedFeature(externalHighlight);
      if (externalHighlight) setSearchHistory((prev) => [...prev, externalHighlight]);
    }
  }, [externalHighlight]);
 
 
  const rulerActiveRef = useRef(rulerActive);
  useEffect(() => {
    rulerActiveRef.current = rulerActive;
  }, [rulerActive]);

  const [mapStyle, setMapStyle] = useState('mapbox://styles/mapbox/outdoors-v12');



useEffect(() => {
  if (!mapInstance.current || !geojsonData) return;

  const { features } = generateSectorGeoJSON(geojsonData, mapInstance.current, radiusScale);

  if (mapInstance.current.getSource("sectors")) {
    mapInstance.current.getSource("sectors").setData({
      type: "FeatureCollection",
      features,
    });
  }
}, [radiusScale, geojsonData]); //  re-run when radiusScale changes






 
useEffect(() => {
  if (!mapRef.current || !gridData) return;
  const map = mapRef.current;

  
  if (map.getSource("kpi-grid")) {
    map.removeLayer("kpi-grid-layer");
    map.removeSource("kpi-grid");
  }


  map.addSource("kpi-grid", {
    type: "geojson",
    data: gridData,
  });

 
  map.addLayer({
    id: "kpi-grid-layer",
    type: "fill",
    source: "kpi-grid",
    paint: {
      "fill-color": [
        "interpolate",
        ["linear"],
        ["get", "value"], 
        0, "#f7fbff",
        50, "#6baed6",
        100, "#08306b"
      ],
      "fill-opacity": 0.6,
    },
  });
}, [gridData]);





const generateSectorGeoJSON = (geojson, map, userScale = 1) => {
  const grouped = new Map();
  let firstValid = null;

  geojson?.features?.forEach((feature) => {
    const coords = feature.geometry?.coordinates;
    const props = feature.properties || {};
    const azimuth = parseFloat(props.azimuth ?? props.Azimuth);
    const band = props.band ?? props.Band ?? "default";
    const siteId = props.site_id || props.Site_ID || props.SITEID || "unknown";
    const city = props.city || props.City || "unknown"; // <-- extract city

    if (!coords || isNaN(azimuth)) return;

    // --- Use radius from slider (userScale is in km) ---
    const radiusKm = userScale;

    // --- Color logic ---
    const fallbackColor = getColorForBand(band);
    let dynamicColor = fallbackColor;
    const rawValue = props[colorColumn];
    const parsedValue =
      rawValue !== undefined && !isNaN(Number(rawValue))
        ? Number(rawValue)
        : null;

    if (parsedValue !== null) {
      for (const { from, to, color } of colorBands || []) {
        if (parsedValue >= from && parsedValue <= to) {
          dynamicColor = color;
          break;
        }
      }
    }

    // --- Build polygon ---
    const sectorPolygon = createSectorPolygon(coords, radiusKm, azimuth);

    const sectorFeature = {
      type: "Feature",
      geometry: sectorPolygon.geometry,
      properties: {
        ...props,      // include all original fields
        band,
        siteId,
        azimuth,
        radiusKm,
        color: dynamicColor,
        city: props.city || "unknown",// <-- include city
      },
    };

    if (!firstValid && dynamicColor !== fallbackColor) {
      firstValid = sectorFeature;
    }

    // --- Group by site + azimuth (NOT band) ---
    const key = `${siteId}|${azimuth}`;
    if (!grouped.has(key)) {
      grouped.set(key, sectorFeature); // keep only first per azimuth
    }
  });

  return {
    type: "FeatureCollection",
    features: Array.from(grouped.values()), // only 1 per azimuth
    firstValidFeature: firstValid,
    groupedCells: grouped,
  };
};






const addThematicLayer = (map, data, colorColumn, colorBands) => {
  if (!map || !data || !colorColumn || !colorBands?.length) return;

  const sampleValue = Number(data.features[0]?.properties[colorColumn]);
  const allProps = data.features[0]?.properties;

  


  if (map.getLayer('thematic-layer')) map.removeLayer('thematic-layer');
  if (map.getSource('thematic')) map.removeSource('thematic');

  const filteredFeatures = data.features.filter(f =>
  typeof f.properties[colorColumn] === 'number' && !isNaN(f.properties[colorColumn])
);
const firstValid = filteredFeatures[0];



  

  const thematicGeoJSON = {
    type: 'FeatureCollection',
    features: filteredFeatures
  };
  map.addSource('thematic', { type: 'geojson', data: thematicGeoJSON });

  map.addLayer({
    id: 'thematic-layer',
    type: 'circle',
    source: 'thematic',
    paint: {
      'circle-radius': 0,
      'circle-opacity': 0.8,
      'circle-stroke-width': 1,
      'circle-stroke-color': '#000',
      'circle-color': [
        'case',
        ...colorBands.flatMap(({ from, to, color }) => ([
          ['all',
            ['>=', ['to-number', ['get', colorColumn]], from],
            ['<=', ['to-number', ['get', colorColumn]], to]
          ],
          color
        ])),
        '#999'
      ]
    }
  });

  // Debug band match
  let matched = '#999';
  for (const { from, to, color } of colorBands) {
    if (sampleValue >= from && sampleValue <= to) {
      matched = color;
      break;
    }
  }

};
//heatMap
// === Add Grid Map Layer ===
const addGridMapLayer = (kpi, ranges) => {
  const map = mapInstance.current;
  if (!map) {
    
    return;
  }
  if (!gridMapGeoJSON?.features?.length) {
    
    return;
  }

  if (!kpi || !ranges || Object.keys(ranges).length === 0) {
    
    return;
  }

  

  // 🔄 Reset old layers/sources
  ["gridMap-points", "gridMap-heatmap"].forEach((layer) => {
    if (map.getLayer(layer)) {
      
      map.removeLayer(layer);
    }
  });
  if (map.getSource("grid-map")) {
    
    map.removeSource("grid-map");
  }

  // ✅ Prepare GeoJSON with numeric values
  const pointGeoJSON = {
    type: "FeatureCollection",
    features: gridMapGeoJSON.features.map((f) => {
      const raw = f.properties[kpi];
      const value =
        raw === null || raw === undefined || raw === "" || isNaN(Number(raw))
          ? NaN
          : Number(raw);

      return {
        type: "Feature",
        geometry: f.geometry,
        properties: {
          
          ...f.properties,
          __numericValue: value,
        },
      };
    }),
  };

  

  // ✅ Add source back
  map.addSource("grid-map", { type: "geojson", data: pointGeoJSON });

  // === Auto zoom to dataset region ===
  try {
    const bounds = turf.bbox(pointGeoJSON);
    map.fitBounds(bounds, { padding: 50, maxZoom: 12 });
    
  } catch (err) {
    
  }

  // === Build circle color scale dynamically from Sidebar ranges ===
  const circleColorExpr = ["interpolate", ["linear"], ["to-number", ["get", "__numericValue"]]];
  Object.entries(ranges).forEach(([color, [min, max]]) => {
    circleColorExpr.push(min, color);
    circleColorExpr.push(max, color);
  });
  

  // === Circle Layer (points) ===
  map.addLayer({
    id: "gridMap-points",
    type: "circle",
    source: "grid-map",
    paint: {
      "circle-radius": 4,
      "circle-color": circleColorExpr,
    },
  });
  

  // === Heatmap Layer ===
  const rangeKeys = Object.keys(ranges);
  const firstRange = ranges[rangeKeys[0]];
  const lastRange = ranges[rangeKeys[rangeKeys.length - 1]];

  map.addLayer({
    id: "gridMap-heatmap",
    type: "heatmap",
    source: "grid-map",
    paint: {
      "heatmap-weight": [
        "interpolate",
        ["linear"],
        ["to-number", ["get", "__numericValue"]],
        firstRange[0], 0,
        lastRange[1], 1,
      ],
      "heatmap-intensity": 1,
      "heatmap-radius": 15,
      "heatmap-opacity": 0.8,
      "heatmap-color": [
        "interpolate",
        ["linear"],
        ["heatmap-density"],
        0, "rgba(0,0,255,0)",
        0.2, "blue",
        0.4, "cyan",
        0.6, "lime",
        0.8, "yellow",
        1, "red",
      ],
    },
  });
  

  // === Hover popup for points (bind once) ===
  map.off("mousemove", "gridMap-points"); // remove old
  map.off("mouseleave", "gridMap-points");

  const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false });
  map.on("mousemove", "gridMap-points", (e) => {
    if (!e.features?.length) return;
    const feature = e.features[0];
    const value = feature.properties[kpi];
    if (value == null) return;

    popup
      .setLngLat(e.lngLat)
      .setHTML(`
        <div style="font-size: 12px; line-height: 1.4">
          <strong>${kpi}</strong>: ${value}
        </div>
      `)
      .addTo(map);
  });

  map.on("mouseleave", "gridMap-points", () => popup.remove());
  
};






const addSectorLayer = (
  map,
  data,
  selectedBandCells = [],
  bandColorMap = {},
  selectedUniqueBands = [],
  selectedColumnFilters = [],
  layerColumn = null,        // 👈 column name to color by
  colorRanges = {}           // 👈 ranges { columnName: { color: [min,max] } }
) => {
  if (!map || !data) return;

  console.log("=== addSectorLayer called ===");
  console.log("Selected Band Cells:", selectedBandCells);
  console.log("Band Color Map:", bandColorMap);
  console.log("Selected Unique Bands:", selectedUniqueBands);
  console.log("Selected Column Filters:", selectedColumnFilters);
  console.log("Layer Column:", layerColumn);
  console.log("Color Ranges:", colorRanges);
  console.log("Number of features before filtering:", data.length);

  // === Generate all polygons ===
  let { features = [], firstValidFeature } = generateSectorGeoJSON(
    data,
    map,
    radiusScale
  );

  console.log("Number of features after generateSectorGeoJSON:", features.length);
  console.log("Sample feature properties:", features[0]?.properties);

  // === Band filter ===
  if (Array.isArray(selectedUniqueBands) && selectedUniqueBands.length > 0) {
    const bandsSet = new Set(
      selectedUniqueBands.map((b) => String(b).toUpperCase().trim())
    );
    features = features.filter((f) => {
      const bandName = (f.properties.band || "").toUpperCase().trim();
      return bandsSet.has(bandName);
    });
    console.log("Number of features after band filter:", features.length);
  }

  // === Column filters ===
  if (Array.isArray(selectedColumnFilters) && selectedColumnFilters.length > 0) {
    console.log("🟢 Applying column filters:", selectedColumnFilters);

    features = features.filter((feature) => {
      const props = feature.properties || {};
      return selectedColumnFilters.every(({ column, values }) => {
        if (!column || !Array.isArray(values) || values.length === 0) return true;

        const propValue = String(
          props[column] ??
            props[column.toLowerCase()] ??
            props[column.toUpperCase()] ??
            ""
        )
          .trim()
          .toLowerCase();

        const selectedVals = new Set(
          values.map((v) => String(v).trim().toLowerCase())
        );

        return selectedVals.has(propValue);
      });
    });

    console.log("Number of features after ALL column filters:", features.length);
  }

  // === Prepare GeoJSON ===
  console.log("Sample props in features:", features[0]?.properties);
  const sectorGeoJSON = { type: "FeatureCollection", features };
  if (!map.getSource("sectors")) {
    map.addSource("sectors", { type: "geojson", data: sectorGeoJSON });
  } else {
    map.getSource("sectors").setData(sectorGeoJSON);
  }

  // === Build fill-color expression ===
  let fillColorExpr = ["get", "color"]; // fallback

  if (layerColumn && colorRanges[layerColumn]) {
    const bands = Object.entries(colorRanges[layerColumn]);
    bands.sort(([, [minA]], [, [minB]]) => minA - minB);

    // Mapbox step expression: [step, ["get", col], default, stop1, color1, stop2, color2...]
    fillColorExpr = ["step", ["to-number", ["get", layerColumn]], "#cccccc"];
    bands.forEach(([color, [min]]) => {
      fillColorExpr.push(min, color);
    });

    console.log("🎨 Using dynamic color expression for", layerColumn, fillColorExpr);
  }

  // === Add/Update fill layer ===
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
    map.setPaintProperty("sector-layer", "fill-color", fillColorExpr);
  }

  // === Hover & popup handlers ===
  map.off("mouseenter", "sector-layer");
  map.off("mouseleave", "sector-layer");
  map.off("click", "sector-layer");

  map.on("mouseenter", "sector-layer", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "sector-layer", () => (map.getCanvas().style.cursor = ""));

  map.on("click", "sector-layer", (e) => {
    if (!e.features || !e.features.length) return;
    const feat = e.features[0];
    const props = feat.properties || {};

    // Restrict popup by band
    if (selectedUniqueBands.length > 0) {
      const bandsSet = new Set(
        selectedUniqueBands.map((b) => String(b).toUpperCase().trim())
      );
      if (!bandsSet.has(String(props.band || "").toUpperCase().trim())) return;
    }

    // Restrict popup by column filters
    if (selectedColumnFilters.length > 0) {
      const pass = selectedColumnFilters.every(({ column, values }) => {
        if (!column || !Array.isArray(values) || values.length === 0) return true;
        const matchedKey = Object.keys(props).find(
          (k) => k.toLowerCase() === column.toLowerCase()
        );
        if (!matchedKey) return false;
        const val = String(props[matchedKey] || "").trim().toLowerCase();
        const selectedVals = new Set(values.map((v) => String(v).trim().toLowerCase()));
        return selectedVals.has(val);
      });
      if (!pass) return;
    }

    const html = createPopupHtml(props);
    if (window.currentPopup) window.currentPopup.remove();
    window.currentPopup = new mapboxgl.Popup({ offset: 15 })
      .setLngLat(e.lngLat)
      .setHTML(html)
      .addTo(map);
  });

  // === Band overlay logic (unchanged) ===
  const haveSelection =
    (Array.isArray(selectedBandCells) && selectedBandCells.length > 0) ||
    (Object.keys(bandColorMap || {}).length > 0);

  if (haveSelection) {
    const selectedSet = new Set(
      selectedBandCells.map((v) => String(v).trim().toLowerCase())
    );
    const bandColorKeys = Object.keys(bandColorMap).map((k) =>
      k.trim().toLowerCase()
    );

    const groups = new Map();
    features.forEach((f) => {
      const p = f.properties || {};
      const cellname = (p.cellname || "").toString();
      const bandName = (p.band || "").toString();
      const matches =
        selectedSet.has(cellname.toLowerCase()) ||
        selectedSet.has(bandName.toLowerCase()) ||
        bandColorKeys.includes(bandName.toLowerCase()) ||
        bandColorKeys.includes(cellname.toLowerCase());
      if (!matches) return;
      const siteId = (p.site_id || "").toString();
      const az = Number(p.azimuth || 0);
      const key = `${siteId}::${az}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(f);
    });

    const overlayFeatures = [];
    const baseScale = 0.92;
    const ringStep = 0.1;
    const minScale = 0.2;

    groups.forEach((arr) => {
      arr.sort((a, b) =>
        (a.properties.band || "").toString().localeCompare(
          (b.properties.band || "").toString()
        )
      );
      arr.forEach((f, idx) => {
        const p = f.properties || {};
        const bandKey = (p.band || "").toString();
        const cellKey = (p.cellname || "").toString();
        const color =
          bandColorMap[bandKey] || bandColorMap[cellKey] || p.color || "#ff0000";
        const scaleFactor = Math.max(minScale, baseScale - idx * ringStep);
        let geom = f.geometry;
        try {
          geom = turf.transformScale(f, scaleFactor, { origin: "centroid" }).geometry;
        } catch {}
        overlayFeatures.push({
          type: "Feature",
          geometry: geom,
          properties: { ...p, color, outline: "#1f2937" },
        });
      });
    });

    const overlayGeoJSON = { type: "FeatureCollection", features: overlayFeatures };
    if (map.getSource("band-sectors"))
      map.getSource("band-sectors").setData(overlayGeoJSON);
    else map.addSource("band-sectors", { type: "geojson", data: overlayGeoJSON });

    if (map.getLayer("band-sectors")) map.removeLayer("band-sectors");
    if (map.getLayer("band-sectors-outline")) map.removeLayer("band-sectors-outline");

    map.addLayer({
      id: "band-sectors",
      type: "fill",
      source: "band-sectors",
      paint: { "fill-color": ["get", "color"], "fill-opacity": 0.85 },
    });

    map.addLayer({
      id: "band-sectors-outline",
      type: "line",
      source: "band-sectors",
      paint: {
        "line-color": ["get", "outline"],
        "line-width": 1.2,
        "line-opacity": 0.9,
      },
    });
  }

  console.log("🏁 addSectorLayer finished", {
    totalAfterOverlay: features.length,
    filters: {
      bands: selectedUniqueBands,
      columns: selectedColumnFilters,
    },
  });
};










// === Add Drive Test Layer ===
const addDriveTestLayer = () => {
  const map = mapInstance.current;
  if (!map || !driveTestGeoJSON?.features?.length) return;

  
  if (map.getLayer("driveTest-points")) map.removeLayer("driveTest-points");
  if (map.getLayer("driveTest-heatmap")) map.removeLayer("driveTest-heatmap");
  if (map.getSource("drive-test")) map.removeSource("drive-test");

  
  const selectedKPI =
    selectedDriveKPI && colorRanges[selectedDriveKPI]
      ? selectedDriveKPI
      : Object.keys(colorRanges)[0] || "RSRP";

 
  const sorted = [...driveTestGeoJSON.features].sort((a, b) => {
    const ta = a.properties.timestamp || a.properties.time || a.properties.date || 0;
    const tb = b.properties.timestamp || b.properties.time || b.properties.date || 0;
    return new Date(ta) - new Date(tb);
  });

  // ✅ Sanitize KPI values
  const pointGeoJSON = {
    type: "FeatureCollection",
    features: sorted.map((f) => {
      const raw = f.properties[selectedKPI];
      const value =
        raw === null || raw === undefined || raw === "" || isNaN(Number(raw))
          ? NaN
          : Number(raw);

      return {
        type: "Feature",
        geometry: f.geometry,
        properties: {
          
          ...f.properties,
          __numericValue: value, 
        },
      };
    }),
  };



   map.addSource("drive-test", { type: "geojson", data: pointGeoJSON });

  // === Build paint expression dynamically ===
  let colorExpression = ["case"];
  if (colorRanges[selectedKPI] && Object.keys(colorRanges[selectedKPI]).length > 0) {
    Object.entries(colorRanges[selectedKPI]).forEach(([color, [min, max]], idx, arr) => {
      const isLast = idx === arr.length - 1;
      colorExpression.push(
        [
          "all",
          [">=", ["to-number", ["get", "__numericValue"]], min],
          isLast
            ? ["<=", ["to-number", ["get", "__numericValue"]], max]
            : ["<", ["to-number", ["get", "__numericValue"]], max],
        ],
        color
      );
    });
  }
  colorExpression.push("gray"); // fallback

  // 🔵 Add points
  map.addLayer({
    id: "driveTest-points",
    type: "circle",
    source: "drive-test",
    paint: {
      "circle-radius": 4,
      "circle-color": colorExpression.length > 3 ? colorExpression : "gray",
    },
  });



  // === ✅ Add hover popup for drive test points ===
  const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false });

  map.on("mousemove", "driveTest-points", (e) => {
    if (!e.features?.length) return;
    const feature = e.features[0];
    const value = feature.properties[selectedKPI];
    if (value == null) return;

   
    let rangeLabel = "Uncategorized";
    if (colorRanges[selectedKPI]) {
      for (const [color, [min, max]] of Object.entries(colorRanges[selectedKPI])) {
        if (value >= min && value <= max) {
          rangeLabel = `${min} → ${max}`;
          break;
        }
      }
    }

    popup
      .setLngLat(e.lngLat)
      .setHTML(`
        <div style="font-size: 12px; line-height: 1.4">
          <strong>${selectedKPI}</strong>: ${value}<br/>
          Range: ${rangeLabel}
        </div>
      `)
      .addTo(map);
  });

  map.on("mouseleave", "driveTest-points", () => popup.remove());
};







  


// 🔄 Unified auto-refresh effect
useEffect(() => {
  if (!mapInstance.current) return;
  if (!gridMapGeoJSON?.features?.length) return;

  const kpi = selectedGridKPI;
  const ranges = colorRanges?.[kpi];

  

  if (!kpi) {
    
    return;
  }

  if (!ranges || Object.keys(ranges).length === 0) {
    
    return;
  }

  
  addGridMapLayer(kpi, ranges);
}, [gridMapGeoJSON, selectedGridKPI, colorRanges]);










// 🌐 Expose manual refresh
// useEffect(() => {
//   window.refreshGridLayer = () => {
//     if (mapInstance.current) {
//       addGridMapLayer();
//     }
//   };
//   return () => {
//     delete window.refreshGridLayer;
//   };
// }, [gridMapGeoJSON, selectedGridKPI, colorRanges]);

  

  useEffect(() => {
  const map = mapInstance.current;
  if (map && geojsonData && colorColumn && colorBands && colorBands.length > 0) {
   


    addThematicLayer(map, geojsonData, colorColumn, colorBands);
  }
}, [geojsonData, colorColumn, colorBands]);

 

  // === Map Init ===
  useEffect(() => {
    if (mapInstance.current) return;
    const map = new mapboxgl.Map({
      container: mapRef.current,
      style: mapStyle,
      center: [78.9629, 20.5937],
      zoom: 5,
    });
  
    window._map = map;
    mapInstance.current = map;
    map.addControl(new mapboxgl.NavigationControl());
    map.on('load', () => {
      mapRef.current = map;
      map.addSource('ruler-geojson', {
        type: 'geojson',
        data: rulerGeoJSON.current,
      });
      map.addLayer({
        id: 'measure-points',
        type: 'circle',
        source: 'ruler-geojson',
        paint: {
          'circle-radius': 4,
          'circle-color': '#000',
        },
        filter: ['==', '$type', 'Point'],
      });
      map.addSource('highlighted-feature', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });


  map.addLayer({
  id: 'highlighted-feature-layer',
  type: 'circle',
  source: 'highlighted-feature',
  paint: {
    // Fill of the circle (slightly transparent)
    'circle-color': 'rgba(255,0,0,0.3)',
    // Radius of the circle
    'circle-radius': 9,
    // Border width
    'circle-stroke-width': 3,
    // Border color
    'circle-stroke-color': 'red',
    // Optional: make the edges smoother
    'circle-blur': 0.5
  },
});


      map.addLayer({
        id: 'measure-lines',
        type: 'line',
        source: 'ruler-geojson',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#000',
          'line-width': 2,
        },
        filter: ['==', '$type', 'LineString'],
      });
      // Ruler tool
      map.on('click', (e) => {
        if (!rulerActiveRef.current) return;
        const coords = [e.lngLat.lng, e.lngLat.lat];
        rulerGeoJSON.current.features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: coords }
        });
        rulerLinestring.current.geometry.coordinates.push(coords);
        const distance = turf.length(rulerLinestring.current);
        if (distanceRef.current) {
          distanceRef.current.innerText = `📏 ${distance.toFixed(2)} km`;
        }
        if (map.getSource('ruler-geojson')) {
          map.getSource('ruler-geojson').setData({
            type: 'FeatureCollection',
            features: [...rulerGeoJSON.current.features, rulerLinestring.current],
          });
        }
      });
      map.on('click', 'measure-points', (e) => {
        if (!rulerActiveRef.current) return;
        if (!e.features || e.features.length === 0) return;
        const clickedCoords = e.features[0].geometry.coordinates;
        const points = rulerGeoJSON.current.features;
        const idx = points.findIndex(
          (pt) =>
            pt.geometry.type === 'Point' &&
            pt.geometry.coordinates[0] === clickedCoords[0] &&
            pt.geometry.coordinates[1] === clickedCoords[1]
        );
        if (idx !== -1) {
          points.splice(idx, 1);
          rulerLinestring.current.geometry.coordinates.splice(idx, 1);
          const distance = turf.length(rulerLinestring.current);
          if (distanceRef.current) {
            distanceRef.current.innerText = points.length
              ? `📏 ${distance.toFixed(2)} km`
              : '';
          }
          if (map.getSource('ruler-geojson')) {
            map.getSource('ruler-geojson').setData({
              type: 'FeatureCollection',
              features: [...points, rulerLinestring.current],
            });
          }
        }
        e.originalEvent.cancelBubble = true;
      });
      map.on('mousemove', (e) => {
        if (!rulerActiveRef.current) return;
        map.getCanvas().style.cursor = 'crosshair';
      });
    });
  }, [mapStyle]);

  // === On GeoJSON Update (Cluster, Sector, etc) ===
 useEffect(() => {
  if (mapInstance.current && geojsonData?.features?.length > 0 && !hasZoomedToSectors) {
    const sectorGeoJSON = generateSectorGeoJSON(geojsonData);
    addSectorLayer(mapInstance.current, geojsonData);

    try {
      const valid = sectorGeoJSON.features.filter(f => f.properties?.color);
      if (valid.length > 0) {
        const bounds = turf.bbox({ type: 'FeatureCollection', features: valid });
        mapInstance.current.fitBounds(bounds, { padding: 40, maxZoom: 15, essential: true });
        setHasZoomedToSectors(true); 
      }
    } catch (err) {
      // ignore
    }
  }
}, [geojsonData, colorColumn, colorBands]);


// === Drive Test Popup on Hover ===
useEffect(() => {
  if (!mapInstance.current) return;
  const map = mapInstance.current;

  if (!map.getLayer("driveTest-layer")) return; 

  const popup = new mapboxgl.Popup({
    closeButton: false,
    closeOnClick: false,
  });

  const handleMouseMove = (e) => {
    if (!e.features?.length || !selectedDriveKPI) return;

    const feature = e.features[0];
    const value = feature.properties[selectedDriveKPI];
    if (value == null) return;

    // Find matching color range
    let rangeLabel = "Uncategorized";
    let bandColor = "#999999";
    if (colorRanges[selectedDriveKPI]) {
      for (const [color, [min, max]] of Object.entries(colorRanges[selectedDriveKPI])) {
        if (value >= min && value <= max) {
          rangeLabel = `${min} → ${max}`;
          bandColor = color;
          break;
        }
      }
    }

    popup
      .setLngLat(e.lngLat)
      .setHTML(`
        <div style="font-size: 12px; line-height: 1.4">
          <strong>${selectedDriveKPI}</strong>: ${value}<br/>
          <span style="color:${bandColor}">Range: ${rangeLabel}</span>
        </div>
      `)
      .addTo(map);
  };

  const handleMouseLeave = () => popup.remove();

 
  map.on("mousemove", "driveTest-layer", handleMouseMove);
  map.on("mouseleave", "driveTest-layer", handleMouseLeave);

  return () => {
    map.off("mousemove", "driveTest-layer", handleMouseMove);
    map.off("mouseleave", "driveTest-layer", handleMouseLeave);
    popup.remove();
  };
}, [selectedDriveKPI, colorRanges, driveTestGeoJSON]);





// === Handle Grid Heatmap Upload ===
const handleGridHeatmapUpload = async (file, cityLookup = {}) => {
  if (!file) return;

  const ext = file.name.split(".").pop().toLowerCase();

  try {
    let geojson;

    // --- Parse GeoJSON / JSON files ---
    if (ext === "geojson" || ext === "json") {
      const text = await file.text();
      geojson = JSON.parse(text);
    }

    // --- Parse CSV files ---
    if (ext === "csv") {
      const text = await file.text();
      const rows = text.split("\n").map((r) => r.split(","));
      const headers = rows[0];
      const latIdx = headers.findIndex((h) => h.toLowerCase().includes("lat"));
      const lonIdx = headers.findIndex((h) => h.toLowerCase().includes("lon"));

      if (latIdx === -1 || lonIdx === -1) {
        alert("❌ CSV must contain latitude and longitude columns!");
        return;
      }

      const features = rows.slice(1)
        .filter((r) => r.length > 1)
        .map((r) => ({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [parseFloat(r[lonIdx]), parseFloat(r[latIdx])],
          },
          properties: headers.reduce((acc, h, i) => {
            acc[h] = isNaN(r[i]) ? r[i] : Number(r[i]);
            return acc;
          }, {}),
        }));

      geojson = { type: "FeatureCollection", features };
    }

    // --- Ensure city is populated ---
    geojson.features.forEach((feature) => {
      const cell = feature.properties?.cellname || feature.properties?.Cell_name;
      feature.properties.city =
        feature.properties.city ||
        cityLookup[cell] ||
        "unknown"; // fallback to unknown
    });

    // --- Extract numeric KPIs ---
    const sampleProps = geojson.features?.[0]?.properties || {};
    const kpis = Object.keys(sampleProps).filter(
      (k) => typeof sampleProps[k] === "number"
    );

    setAvailableGridKPIs(kpis);
    setSelectedKPI(kpis[0] || null);

    // --- Add or update GeoJSON source on the map ---
    if (mapInstance.current.getSource("grid-heatmap")) {
      mapInstance.current.getSource("grid-heatmap").setData(geojson);
    } else {
      mapInstance.current.addSource("grid-heatmap", { type: "geojson", data: geojson });
    }
  } catch (err) {
    alert("Upload failed: " + err.message);
  }
};


// useEffect(() => {
//   if (showHeatmapPanel) {
//     addGridHeatmapLayer();
//   }
// }, [gridHeatmapGeoJSON, selectedKPI, threshold, showHeatmapPanel]);



  useEffect(() => {
    if (mapInstance.current && driveTestGeoJSON && driveTestGeoJSON.features?.length > 1) {
      addDriveTestLayer();
    }
  }, [driveTestGeoJSON]);

useEffect(() => {
  if (mapInstance.current && geojsonData) {
    // Use selectedUniqueBands from props, not local state
    addSectorLayer(mapInstance.current, geojsonData, selectedBandCells, bandColorMap, (typeof selectedUniqueBands === 'undefined' ? [] : selectedUniqueBands));
  }
}, [mapInstance.current, geojsonData, selectedBandCells, bandColorMap, selectedUniqueBands]);

  // 🌐 Expose global band filter
useEffect(() => {
  if (!mapInstance.current) return;

  console.log("📝 Current selectedColumnValues:", selectedColumnValues);

  // Normalize selectedColumnValues to an object first
  const columnObj = Array.isArray(selectedColumnValues)
    ? selectedColumnValues.reduce((acc, f) => {
        if (f?.column && Array.isArray(f?.values)) acc[f.column] = f.values;
        return acc;
      }, {})
    : selectedColumnValues || {};

  // Convert to array of { column, values }
  const columnFiltersArray = Object.entries(columnObj)
    .filter(([_, values]) => Array.isArray(values) && values.length > 0)
    .map(([column, values]) => ({ column, values }));

  console.log("📤 Sending filters to map:", {
    bands: selectedUniqueBands,
    filters: columnFiltersArray,
  });

  const applyFilters = () => {
    addSectorLayer(
      mapInstance.current,
      geojsonData,
      [],                  // selectedBandCells
      {},                  // bandColorMap
      selectedUniqueBands, // selectedUniqueBands
      columnFiltersArray,  // column filters (array of objects)
       layerColumn = null,
        colorRanges = {}          

    );
  };

  // Expose a global function for manual band filtering
  window.applyBandFilter = (bands) => {
    addSectorLayer(
      mapInstance.current,
      geojsonData,
      [],
      {},
      bands || selectedUniqueBands,
      columnFiltersArray
    );
  };

  applyFilters();

  return () => {
    delete window.applyBandFilter;
  };
}, [geojsonData, selectedUniqueBands, selectedColumnValues]);







  useEffect(() => {
  setHasZoomedToSectors(false);
}, [geojsonData]);
useEffect(() => {
  if (!mapInstance.current) return;

  const map = mapInstance.current;

  if (!map.isStyleLoaded()) {
   
    map.once("style.load", () => {
      addSectorLayer(map);
    });
  } else {
    addSectorLayer(map);
  }
}, [geojsonData]);


// === Update Drive Test Layer styling dynamically ===
useEffect(() => {
  if (!mapInstance.current) return;
  if (!mapInstance.current.getLayer("driveTest-layer")) return;
  if (!selectedDriveKPI || !colorRanges[selectedDriveKPI]) return;

  const map = mapInstance.current;


  const bands = Object.entries(colorRanges[selectedDriveKPI]);
  bands.sort(([, [minA]], [, [minB]]) => minA - minB);

  const expression = ["step", ["get", selectedDriveKPI], "#999999"];
  bands.forEach(([color, [min]]) => {
    expression.push(min, color);
  });

  

  map.setPaintProperty("driveTest-layer", "circle-color", expression);
}, [selectedDriveKPI, colorRanges, driveLayerRange]);

// === Update Sector Layer styling dynamically ===
useEffect(() => {
  if (!mapInstance.current) return;
  if (!mapInstance.current.getLayer("sectors-layer")) return;
  if (!layerColumn || !colorRanges[layerColumn]) return;

  const map = mapInstance.current;

  const bands = Object.entries(colorRanges[layerColumn]);
  bands.sort(([, [minA]], [, [minB]]) => minA - minB);

  const expression = ["step", ["get", layerColumn], "#cccccc"];
  bands.forEach(([color, [min]]) => {
    expression.push(min, color);
  });

  map.setPaintProperty("sectors-layer", "fill-color", expression);
}, [layerColumn, colorRanges, layerRange]);





  useEffect(() => {
    if (mapInstance.current && geojsonData?.features?.length > 0 && selectedKPI) {
      addGridMapLayer(mapInstance.current, geojsonData, selectedKPI, threshold);
    }
  }, [geojsonData, selectedKPI, threshold]);

useEffect(() => {
  if (!mapInstance.current) return;

  const map = mapInstance.current;
  const source = map.getSource('highlighted-feature');

  if (source) {
    source.setData({
      type: 'FeatureCollection',
      features: highlightedFeature ? [highlightedFeature] : [],
    });
  }


  if (highlightedFeature?.geometry?.coordinates) {
    map.flyTo({
      center: highlightedFeature.geometry.coordinates,
      zoom: 16,
      essential: true,
    });
  }
}, [highlightedFeature]);



  // === Map Style toggles ===
  const handleStyleToggle = () => {
    const newStyle =
      mapStyle === 'mapbox://styles/mapbox/outdoors-v12'
        ? 'mapbox://styles/mapbox/satellite-streets-v12'
        : 'mapbox://styles/mapbox/outdoors-v12';
    setMapStyle(newStyle);
    if (mapInstance.current) {
      const center = mapInstance.current.getCenter();
      const zoom = mapInstance.current.getZoom();
      mapInstance.current.setStyle(newStyle);
      mapInstance.current.once('style.load', () => {
        mapInstance.current.setCenter(center);
        mapInstance.current.setZoom(zoom);
        if (geojsonData) addSectorLayer(mapInstance.current, geojsonData);
        addDriveTestLayer();
        if (highlightedFeature) addHighlightLayer(mapInstance.current, highlightedFeature);
        if (geojsonData && selectedKPI) addGridMapLayer(mapInstance.current, geojsonData, selectedKPI, threshold);
        if (gridGeoJSON && gridGeoJSON.features?.length > 0)
          addGridLayer(mapInstance.current, gridGeoJSON, threshold, 'average');
      });
    }
  };

   const handleLightStyleToggle = () => {
    const newStyle =
      mapStyle === 'mapbox://styles/mapbox/light-v10'
        ? 'mapbox://styles/mapbox/outdoors-v12'
        : 'mapbox://styles/mapbox/light-v10';
    setMapStyle(newStyle);
    if (mapInstance.current) {
      const center = mapInstance.current.getCenter();
      const zoom = mapInstance.current.getZoom();
      mapInstance.current.setStyle(newStyle);
      mapInstance.current.once('style.load', () => {
        mapInstance.current.setCenter(center);
        mapInstance.current.setZoom(zoom);
        if (geojsonData) addSectorLayer(mapInstance.current, geojsonData);
        addDriveTestLayer();
        if (highlightedFeature) addHighlightLayer(mapInstance.current, highlightedFeature);
        if (geojsonData && selectedKPI) addGridMapLayer(mapInstance.current, geojsonData, selectedKPI, threshold);
        if (gridGeoJSON && gridGeoJSON.features?.length > 0)
          addGridLayer(mapInstance.current, gridGeoJSON, threshold, 'average');
      });
    }
  };

  // === Local Search Handler (map search bar) ===
  const handleSearch = (e) => {
    e.preventDefault();
    if (!geojsonData || !geojsonData.features) return;

    const term = searchTerm.trim().toLowerCase();
    if (!term) {
      setSearchResults([]);
      setHighlightedFeature(null);
      setSearchHistory([]);
      return;
    }

    
    const results = geojsonData.features.filter((f) => {
      const props = f.properties || {};
      return (
        (props.Site_ID && props.Site_ID.toString().toLowerCase().includes(term)) ||
        (props.Cell_name && props.Cell_name.toString().toLowerCase().includes(term)) ||
        Object.values(props).some(
          (v) => v && v.toString && v.toString().toLowerCase().includes(term)
        )
      );
    });

    setSearchResults(results);

    if (results.length > 0) {
      setHighlightedFeature(results[0]);
      setSearchHistory((prev) => [...prev, results[0]]);
    } else {
      setHighlightedFeature(null);
    }
  };

  // === Undo Search (local only) ===
  const handleUndoSearch = () => {
  setSearchHistory((prev) => {
    if (prev.length === 0) return prev;

  
    const newHistory = prev.slice(0, -1);

  
    const previousFeature = newHistory.length > 0 ? newHistory[newHistory.length - 1] : null;
    setHighlightedFeature(previousFeature);

    return newHistory;
  });
};

  // === PLMN Layer (for whole network) ===
  useEffect(() => {
    if (!mapInstance.current || !geojsonData) return;
   
    if (mapInstance.current.getLayer('plmn-layer')) mapInstance.current.removeLayer('plmn-layer');
    if (mapInstance.current.getSource('plmn')) mapInstance.current.removeSource('plmn');

   
    mapInstance.current.addSource('plmn', {
      type: 'geojson',
      data: geojsonData
    });

    // mapInstance.current.addLayer({
    //   id: 'plmn-layer',
    //   type: 'circle',
    //   source: 'plmn',
    //   paint: {
    //     'circle-radius': 6,
    //     'circle-color': '#6366f1',
    //     'circle-stroke-width': 2,
    //     'circle-stroke-color': '#fff'
    //   }
    // });
  }, [geojsonData]);


  

// === Legend Dynamic Selection UI & Logic ===
const toggleLegend = () => setShowLegend((prev) => !prev);

// Dynamic legend rendering based on legendType
const renderLegend = () => {
  // === Grid KPI (special case) ===
  if (gridGeoJSON && gridGeoJSON.features?.length > 0) {
    return (
      <>
        <div className="legend-title">Grid KPI (SINR)</div>
        <div className="legend-item">
          <span className="legend-color" style={{ backgroundColor: '#fee08b' }}></span>
          SINR ≥ {threshold} (Yellow, Threshold)
        </div>
        <div className="legend-item">
          <span className="legend-color" style={{ backgroundColor: '#d73027' }}></span>
          SINR &lt; {threshold} (Red, Problematic)
        </div>
        <div className="legend-item">
          <span className="legend-color" style={{ backgroundColor: '#1a9850' }}></span>
          SINR &gt; 30 (Green, Good)
        </div>
      </>
    );
  }

  // === Switch by legendType ===
  switch (legendType) {
    // KPI Heatmap
    case 'kpi':
      return (
        <>
          <div className="legend-title">{'Selected KPI'} Color Ranges</div>
          <div className="legend-item">
            <span className="legend-color" style={{ backgroundColor: '#1a9850' }}></span>
            High Value
          </div>
          <div className="legend-item">
            <span className="legend-color" style={{ backgroundColor: '#fee08b' }}></span>
            Moderate Value
          </div>
          <div className="legend-item">
            <span className="legend-color" style={{ backgroundColor: '#d73027' }}></span>
            Low Value
          </div>
        </>
      );

    // Band Colors
    case 'band':
      return (
        <>
          <div className="legend-title">Band Colors</div>
          {BAND_OPTIONS.map(({ value, label }) => (
            <div className="legend-item" key={value}>
              <span
                className="legend-color"
                style={{ backgroundColor: getColorForBand(value) }}
              ></span>
              {label}
            </div>
          ))}
        </>
      );

    // Sector Colors (dynamic from layerColumn)
    case 'sector':
  if (!colorColumn) {
    return <div className="legend-title">⚠️ No column selected</div>;
  }
  if (!colorRanges[colorColumn]) {
    return <div className="legend-title">⚠️ No color bands defined for {colorColumn}</div>;
  }
  return (
    <>
      <div className="legend-title">Sector Colors: {colorColumn}</div>
      {Object.entries(colorRanges[colorColumn]).map(([color, [min, max]]) => (
        <div
          className="legend-item"
          key={color}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <span
            className="legend-color"
            style={{
              backgroundColor: color,
              width: 16,
              height: 16,
              border: '1px solid #ccc',
              borderRadius: 4,
            }}
          />
          <span>{min} – {max}</span>
        </div>
      ))}
    </>
  );

    // Drive Test KPI
    case 'driveTest':
      console.log("Legend Debug (driveTest):", {
        selectedDriveKPI,
        ranges: colorRanges[selectedDriveKPI],
      });

      if (!selectedDriveKPI) {
        return <div className="legend-title">⚠️ No Drive Test KPI selected</div>;
      }
      if (!colorRanges[selectedDriveKPI]) {
        return (
          <div className="legend-title">
            ⚠️ No color ranges defined for {selectedDriveKPI}
          </div>
        );
      }

      return (
        <>
          <div className="legend-title">
            Drive Test KPI: <strong>{selectedDriveKPI}</strong>
          </div>
          {Object.entries(colorRanges[selectedDriveKPI]).map(([color, [min, max]]) => (
            <div
              className="legend-item"
              key={color}
              style={{ display: "flex", alignItems: "center", gap: "6px" }}
            >
              <span
                className="legend-color"
                style={{
                  backgroundColor: color,
                  width: 16,
                  height: 16,
                  border: "1px solid #ccc",
                  borderRadius: 4,
                }}
              />
              <span>{min} – {max}</span>
            </div>
          ))}
        </>
      );

    default:
      return null;
  }
};


  return (
    <>
      {/* Panel toggles */}
      <div
        style={{
          position: 'fixed',
          top: 37, 
          right: 200, 
          zIndex: 10001,
          display: 'flex',
          gap: '6px',
        }}
      >
        <button
          className="icon-btn"
          title="Toggle Search Panel"
          style={{
            boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
            background: showSearchPanel ? '#e6f5ec' : '#fff',
            fontSize: 15,
            transition: 'background 0.2s',
          }}
          onClick={() => setShowSearchPanel((v) => !v)}
        >
          🔍
        </button>     
      </div>
      {/* Search Bar */}
      {showSearchPanel && (
        <form
          style={{
            color: '#000',
            position: 'absolute',
            top: 18,
            left: 360,
            zIndex: 10,
            background: '#fff',
            padding: '2px 6px',
            borderRadius: '8px',
            boxShadow: '0 1px 5px rgba(0, 0, 0, 0.08)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            border: '1px solid #e5e7eb',
            minHeight: 38,
          }}
          onSubmit={handleSearch}
        >
          <input
            type="text"
            placeholder="Search Site/Cell/KPI"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            style={{
              color: '#000',
              minWidth: 180,
              margin: 0,
              border: '1px solid #ccc',
              borderRadius: 4,
              padding: '4px 8px',
              fontSize: 13,
              background: '#f9fafb',
            }}
          />
          <button type="submit"
            className="btn-outline"
            style={{
              padding: '4px 14px',
              borderRadius: 4,
              fontWeight: 500,
              fontSize: 13,
              margin: 0,
            }}>
            Search
          </button>
          <button
            type="button"
            className="btn-outline"
            style={{
              padding: '4px 10px',
              borderRadius: 4,
              fontWeight: 500,
              fontSize: 13,
              margin: 0,
              opacity: searchHistory.length === 0 ? 0.5 : 1,
              cursor: searchHistory.length === 0 ? 'not-allowed' : 'pointer',
            }}
            onClick={handleUndoSearch}
            disabled={searchHistory.length === 0}
            title="Undo search"
          >
            Undo
          </button>
          {searchResults.length > 1 && (
            <select
              className="input"
              style={{
                marginLeft: 8,
                padding: '4px 8px',
                borderRadius: 4,
                fontSize: 13,
                minWidth: 120,
                background: '#fff',
                border: '1px solid #ccc',
              }}
              onChange={e => setHighlightedFeature(searchResults[e.target.value])}
            >
              {searchResults.map((f, idx) => (
                <option key={idx} value={idx}>
                  {f.properties.Site_ID || f.properties.Cell_name || 'Sector ' + (idx + 1)}
                </option>
              ))}
            </select>
          )}
        </form>
      )}
      <div ref={mapRef} className="map-container" />
      <button onClick={handleStyleToggle} className="style-toggle-btn" title="Toggle Map Style">
        🛰️
      </button>
      <button
        onClick={handleLightStyleToggle}
        className="style-toggle-btn"
        title="Toggle Light Theme"
        style={{ top: '160px', right: '10px' }}
      >
        💡
      </button>
      <button
        onClick={toggleLegend}
        className="legend-toggle-btn"
        title="Toggle Legend"
        style={{ top: '60px', right: '10px' }}
      >
        📊
      </button>
      <button
        onClick={() => {
          setRulerActive((prev) => !prev);
          rulerGeoJSON.current = { type: 'FeatureCollection', features: [] };
          rulerLinestring.current = { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } };
          const map = mapInstance.current;
          const source = map && map.getSource('ruler-geojson');
          if (source) source.setData({ type: 'FeatureCollection', features: [] });
          if (distanceRef.current) distanceRef.current.innerText = '';
        }}
        className="ruler-toggle-btn"
        title="Toggle Ruler Tool"
        style={{
          position: 'absolute',
          top: '160px',
          right: '10px',
          zIndex: 1,
          padding: '3px 3px',
          fontSize: '16px',
          borderRadius: '6px',
          backgroundColor: '#fff',
          boxShadow: '0 1px 5px rgba(0,0,0,0.3)',
          cursor: 'pointer'
        }}
      >
        🧭
      </button>
      <div
        ref={distanceRef}
        id="distance-box"
        style={{
          position: 'absolute',
          bottom: '40px',
          right: '10px',
          background: '#f7f5f550',
          padding: '1px 1px',
          borderRadius: '4px',
          fontWeight: 'bold',
          zIndex: 1,
          color: '#000',
        }}
      ></div>
      {showLegend && (
        <div className="map-legend-popup">
          <select
            value={legendType}
            onChange={e => setLegendType(e.target.value)}
            className="input"
            style={{ marginBottom: '10px', width: '100%' }}
          >
            <option value="kpi">KPI Heatmap</option>
            <option value="band">Band Colors</option>
            <option value="sector">Sector Colors</option>
            <option value="driveTest">Drive Test KPI</option>
          </select>
          {renderLegend()}
        </div>
      )}
    </>
  );
};

export default MapRenderer;