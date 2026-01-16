# Site Data Storage in MapRenderer - Complete Guide

## 📊 Data Flow Overview

```
geojsonData (App.jsx)
    ↓
MapRenderer Props
    ↓
Features Array (geojsonData.features)
    ↓
Properties Object (feature.properties)
    ↓
Refs & State Storage
    ↓
UI Display & Export
```

---

## 🗂️ 1. PRIMARY DATA SOURCE: geojsonData

**Where it comes from:** Passed as a prop from `App.jsx` to `MapRenderer`

```jsx
// MapRenderer receives this:
const MapRenderer = ({
  geojsonData,  // ← PRIMARY SOURCE OF ALL SITE DATA
  colorColumn,  // ← Which property to color-code
  // ... other props
})
```

---

## 📦 2. DATA STRUCTURE: Feature Object

Each site is stored as a GeoJSON Feature with this structure:

```javascript
{
  type: "Feature",
  id: unique_identifier,
  geometry: {
    type: "Point" | "Polygon",
    coordinates: [longitude, latitude]  // ← COORDINATES STORED HERE
  },
  properties: {
    // SITE IDENTIFICATION
    site_id: "SITE_001",
    Site_ID: "SITE_001",
    SITEID: "SITE_001",
    sitename: "London Tower 1",
    SITENAME: "London Tower 1",
    
    // LOCATION
    Lat: 51.5074,
    LATITUDE: 51.5074,
    latitude: 51.5074,
    Long: -0.1276,
    LONGITUDE: -0.1276,
    longitude: -0.1276,
    
    // TECHNOLOGY
    band: "1800",
    BAND: "1800",
    Band: "1800",
    generation: "4G",
    cellname: "LDN_TW1_1800_A",
    CELLNAME: "LDN_TW1_1800_A",
    azimuth: 45,
    Azimuth: 45,
    AZIMUTH: 45,
    
    // KPI DATA (Varies by tableType)
    [colorColumn]: value,  // e.g., RSRP: -110
    
    // CUSTOM COLUMNS
    Date: "2024-01-15",
    region: "North",
    city: "London",
    status: "Active",
    // ... any other columns in CSV
  }
}
```

---

## 🔍 3. HELPER FUNCTIONS: Extract Site Data

These utility functions extract data from properties:

```jsx
// SITE IDENTIFICATION
const getSiteId = (props) =>
  getFirstProp(props, [
    "site_id", "Site_ID", "SITE ID", "SITEID", "SITE", "site"
  ]);

// BAND/FREQUENCY
const getBand = (props) =>
  getFirstProp(props, ["band", "BAND", "Band"]);

// CELL NAME
const getCellName = (props) =>
  getFirstProp(props, [
    "cellname", "Cellname", "Cell_name", "CELLNAME", "CELL_NAME"
  ]);

// AZIMUTH
const getAzimuth = (props, fallback) =>
  getFirstProp(props, ["azimuth", "Azimuth", "AZIMUTH", "Azimuth_degrees"]);

// GENERIC PROP GETTER
const getFirstProp = (props, keys) => {
  for (const k of keys) {
    if (k in props && props[k] != null && props[k] !== "" && props[k] !== "[NULL]") {
      return props[k];
    }
  }
  return null;
};
```

---

## 💾 4. DATA STORAGE LOCATIONS IN MapRenderer

### A. **useRef() - Persistent Storage (survives re-renders)**

```jsx
// POLYGON DRAWING STORAGE
const currentMatchedSitesRef = useRef([]);           // Sites inside polygon
const currentActiveZoneIdRef = useRef(null);         // Current zone ID
const rulerGeoJSON = useRef({                        // Ruler coordinates
  type: "FeatureCollection",
  features: []
});

// CACHED DATA (for style switching)
const sectorsRef = useRef({                          // Sector polygons
  type: "FeatureCollection",
  features: []
});
const driveTestRef = useRef({                        // Drive test points
  type: "FeatureCollection",
  features: []
});
const gridRef = useRef({                             // Grid map data
  type: "FeatureCollection",
  features: []
});
```

### B. **useState() - State Variables**

```jsx
// DRAWING STATE
const [isDrawing, setIsDrawing] = useState(false);
const [polygonCount, setPolygonCount] = useState(0);
const [selectedCountry, setSelectedCountry] = useState(null);

// INFO PANEL STATE
const [showInfoPanel, setShowInfoPanel] = useState(false);
const [selectedSiteIdState, setSelectedSiteIdState] = useState("");
const [infoSource, setInfoSource] = useState({});     // Source site data
const [infoTarget, setInfoTarget] = useState({});     // Target site data

// LEGEND STATE
const [alarmLegend, setAlarmLegend] = useState([]);
const [trafficLegend, setTrafficLegend] = useState([]);
const [uniqueBands, setUniqueBands] = useState([]);
```

---

## 🎯 5. DATA EXTRACTION FLOW: From Click to Storage

### **Step 1: Map Click Event**
```jsx
map.on("click", "sector-layer", (e) => {
  const feat = e.features[0];                        // ← Clicked feature
  const props = feat.properties || {};               // ← Properties object
  const siteId = getSiteId(props);                   // ← Extract Site ID
  
  // COORDINATES
  const clickCoords = e.lngLat;  // {lng, lat}
});
```

### **Step 2: Store in Refs**
```jsx
// When polygon is drawn, find all sites inside
const detectClickedSites = (polygon) => {
  const sites = geojsonData?.features || [];
  
  sites.forEach((feature) => {
    const coordinates = feature.geometry.coordinates;  // Get coords
    const point = turf.point(coordinates);
    
    if (turf.booleanPointInPolygon(point, polygon)) {
      currentMatchedSitesRef.current.push(feature);  // ← STORE IN REF
    }
  });
};
```

### **Step 3: Display in Info Panel**
```jsx
const showSiteInfoFromFeature = (feature) => {
  const props = feature.properties || {};
  setInfoSource({
    site_id: getSiteId(props),
    band: getBand(props),
    cell: getCellName(props),
    azimuth: getAzimuth(props, NaN),
    lat: props.Lat || props.LATITUDE,
    lon: props.Long || props.LONGITUDE,
  });
  setSelectedSiteIdState(normalize(getSiteId(props)));
};
```

### **Step 4: Export to CSV**
```jsx
const handleExportCSV = () => {
  const csv = Papa.unparse(
    currentMatchedSitesRef.current.map((s) => s.properties)  // ← PROPERTIES
  );
  // Download file...
};
```

### **Step 5: Save to Backend**
```jsx
const handleSubmitToBackend = async () => {
  const payload = {
    zoneId: currentActiveZoneIdRef.current,
    site_data: {
      feature: currentPolygon,                    // ← Full geometry
      matched_sites: currentMatchedSitesRef.current.map(
        (s) => s.properties  // ← All properties
      ),
    },
    timestamp: new Date().toISOString(),
  };
  
  await fetch("http://127.0.0.1:8000/api/.../polygon/save_polygon", {
    method: "POST",
    body: JSON.stringify(payload),
  });
};
```

---

## 📍 6. COORDINATE STORAGE LOCATIONS

### **In Feature Geometry**
```javascript
{
  geometry: {
    type: "Point",
    coordinates: [longitude, latitude]  // ← Primary storage
  }
}
```

### **In Feature Properties**
```javascript
{
  properties: {
    Lat: 51.5074,
    LATITUDE: 51.5074,
    Long: -0.1276,
    LONGITUDE: -0.1276
  }
}
```

### **Extraction Logic**
```jsx
let coordinates = null;

// Try geometry first
if (feature.geometry.type === "Point") {
  coordinates = feature.geometry.coordinates;  // [lng, lat]
}
// Fall back to properties
else if (feature.properties) {
  const lat = feature.properties.Lat || feature.properties.LATITUDE;
  const lon = feature.properties.Long || feature.properties.LONGITUDE;
  if (lat && lon) {
    coordinates = [lon, lat];
  }
}
```

---

## 🎨 7. DATA IN POLYGON DRAWING

### **Storage in Refs**
```jsx
// All sites found inside polygon
currentMatchedSitesRef.current = [
  {
    type: "Feature",
    geometry: { type: "Point", coordinates: [...] },
    properties: { site_id, band, cell, lat, lon, ... }
  },
  // ... more sites
]

// Active zone identifier
currentActiveZoneIdRef.current = "UK_0_username"
```

### **Used in Popup**
```jsx
// Popup shows:
const siteList = sites.map((s) => {
  const props = s.properties || {};
  const siteName = props.SITENAME || props.site_name || props["SITE ID"];
  return `<div>${siteName}</div>`;
});

// Total count
<span>${sites.length} sites</span>
```

---

## 📋 8. COLUMN MAPPING: Common Property Names

| **Data Type** | **Possible Column Names** | **Accessed By** |
|---------------|-------------------------|-----------------|
| **Site ID** | site_id, Site_ID, SITEID, SITE | `getSiteId()` |
| **Latitude** | Lat, LATITUDE, latitude | `properties.Lat` |
| **Longitude** | Long, LONGITUDE, longitude | `properties.Long` |
| **Band** | band, BAND, Band | `getBand()` |
| **Cell Name** | cellname, CELLNAME, CELL_NAME | `getCellName()` |
| **Azimuth** | azimuth, AZIMUTH, Azimuth_degrees | `getAzimuth()` |
| **Generation** | generation, Generation, GENERATION | `properties.generation` |
| **KPI** | [varies] - Dynamic column | `properties[colorColumn]` |
| **Date** | Date, date, D1DATE, Delta_Date | `properties.Date` |

---

## 🔄 9. COMPLETE DATA FLOW EXAMPLE

```jsx
// 1. Load CSV/GeoJSON
const geojsonData = {
  features: [
    {
      geometry: { type: "Point", coordinates: [-0.1276, 51.5074] },
      properties: {
        site_id: "SITE_001",
        SITENAME: "London Tower 1",
        Lat: 51.5074,
        Long: -0.1276,
        band: "1800",
        cellname: "LDN_1800_A",
        azimuth: 45,
        RSRP: -110,
        Date: "2024-01-15"
      }
    }
  ]
};

// 2. Pass to MapRenderer
<MapRenderer geojsonData={geojsonData} colorColumn="RSRP" />

// 3. On polygon draw
detectClickedSites(polygon);
// → currentMatchedSitesRef.current = [feature1, feature2, ...]

// 4. Show info panel
showSiteInfoFromFeature(currentMatchedSitesRef.current[0]);
// → Display: Site: SITE_001, Band: 1800, Lat: 51.5074, Lon: -0.1276

// 5. Export
handleExportCSV();
// → CSV contains all properties: site_id, SITENAME, Lat, Long, band, ...

// 6. Save to DB
handleSubmitToBackend();
// → Sends: { zoneId, geometry, properties, matched_sites: [...] }
```

---

## ✅ SUMMARY: Where is Data Stored?

| **Data** | **Storage Location** | **Access Method** |
|----------|-------------------|------------------|
| All sites | `geojsonData.features` | Props → Read only |
| Matched sites (polygon) | `currentMatchedSitesRef.current` | useRef → Mutable |
| Current zone | `currentActiveZoneIdRef.current` | useRef → Mutable |
| Site coordinates | `feature.geometry.coordinates` | Extract from feature |
| Site properties | `feature.properties` | Extract from feature |
| Info panel data | `infoSource`, `infoTarget` | useState → Updates UI |
| Cached sectors | `sectorsRef.current` | useRef → Survives re-renders |

