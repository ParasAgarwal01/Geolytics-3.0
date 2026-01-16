# Site Data Storage After Line 1200 - Complete Mapping

## 📊 Your Data Sample
```json
{
  "type": "Feature",
  "properties": {
    "D1DATE": "2025-11-17",
    "D1HOUR": "00:00:00",
    "D2EL01": "KP00015015",
    "D2EL02": "15",
    "Lat": 52.502128972525007,
    "Long": -2.051811129569864,
    "Azimuth": 90,
    "SITENAME": "15",
    "CELLNAME": "KP00015015",
    "NRARFCNDL": 627404.0,
    "BAND": "N35",
    "SITE ID": "15248",
    "TECH": "5G",
    "OPERATOR": "Vodafone",
    "VENDOR": "Ericsson",
    "B4_Polygon": "West4"
  },
  "geometry": {
    "type": "Point",
    "coordinates": [-2.051811129569864, 52.502128972525007]
  }
}
```

---

## 🎯 WHERE THIS DATA IS STORED (Lines 1200+)

### **1️⃣ LINE 1419-1420: DATE EXTRACTION**
```jsx
// In findOriginalFeature()
const date = clickedProps.Date ||
             clickedProps.date ||
             clickedProps.D1DATE ||         // ← YOUR D1DATE HERE
             clickedProps.Delta_Date;
```
**Storage:** Used for matching in `geojsonData.features.find()`

---

### **2️⃣ LINE 1440-1441: DATE IN SEARCH STRATEGY**
```jsx
// In findRepresentativeCell()
const date = props.Date ||
             props.date ||
             props.D1DATE ||               // ← YOUR D1DATE HERE
             props.Delta_Date;
```
**Storage:** Used for 3-tier matching (Exact → Band → Site)

---

### **3️⃣ LINE 2007-2025: DATA IN SECTOR FEATURES**
```jsx
// In sector layer generation (Generation fan mode)
sectorFeatures.push({
  type: "Feature",
  geometry: wedge.geometry,
  properties: {
    ...ref,                               // ← ALL YOUR PROPERTIES COPIED
    site_id: site,
    generation: gen,
    color,
    fillColor: color,
    lat: ref.lat || ref.Lat || ct[1],    // ← USES YOUR Lat
    lon: ref.lon || ref.Long || ct[0],   // ← USES YOUR Long
  },
});
```

**Storage Location:** `sectorsRef.current` (Line 2032)
```jsx
sectorsRef.current = fc;
if (map.getSource("sectors")) {
  map.getSource("sectors").setData(fc);
}
```

---

### **4️⃣ LINE 2100-2200: BAND + GENERATION GROUPING**
```jsx
// In FIXED-GEN-RADIUS mode
const bySite = {};
geojsonData.features.forEach((f) => {
  const site = normalize(getSiteId(f.properties || {}));  // ← Gets SITE ID: "15248"
  if (!site) return;
  if (!bySite[site]) bySite[site] = [];
  bySite[site].push(f);  // ← YOUR FEATURE STORED HERE
});
```

**Storage:** Grouped by SITE ID in `bySite` object

---

### **5️⃣ LINE 2120-2125: EXTRACTING YOUR COORDINATES**
```jsx
// Site centroid calculation
const cents = feats.map((f) => turf.centroid(f).geometry.coordinates);
const cx = cents.reduce((s, c) => s + c[0], 0) / cents.length;  // ← [-2.051811129569864]
const cy = cents.reduce((s, c) => s + c[1], 0) / cents.length;  // ← [52.502128972525007]
const center = [cx, cy];
```

**Storage:** `center` = [-2.051811129569864, 52.502128972525007]

---

### **6️⃣ LINE 2135-2140: EXTRACTING YOUR AZIMUTH**
```jsx
// Get azimuth from your properties
const rawAz = feats
  .map((f) => getAzimuth(f.properties || {}, NaN))  // ← Gets YOUR Azimuth: 90
  .filter((a) => Number.isFinite(a));
```

**Storage:** `rawAz = [90, 90, ...]`

---

### **7️⃣ LINE 1783-1837: SECTOR LAYER CLICK - COLLECT ALL DATA**
```jsx
// When you click on a sector
map.on("click", "sector-layer", (e) => {
  const feat = e.features[0];                        // ← YOUR FEATURE
  const props = feat.properties || {};               // ← ALL YOUR PROPERTIES
  
  const siteId = getSiteId(props) || "Unknown";      // ← "15248"
  
  // Create popup with your data
  const popupHtml = createPopupHtml(props, {
    Site_ID: siteId,                                 // ← "15248"
    Cell_Name: getCellName(props) || "N/A",          // ← "KP00015015"
    Band: getBand(props) || "N/A",                   // ← "N35"
    KPI: props[colorColumn] ?? "N/A",                // ← YOUR KPI VALUE
  });

  // FIND ORIGINAL FEATURE
  const originalFeature = findOriginalFeature(
    feat.properties || {}, 
    geojsonData
  ) || feat;  // ← COMPLETE FEATURE WITH ALL PROPERTIES

  // STORE IN REFS
  lastClickedOriginalFeatureRef.current = originalFeature;  // ← STORED HERE
  
  // SHOW IN INFO PANEL
  showSiteInfoFromFeature(originalFeature);  // ← LINE 1796
  
  // STORE IN STATE
  setSelectedSiteIdState(normalize(siteId));
  setShowInfoPanel(true);

  // NOTIFY PARENT
  if (typeof onSiteClick === "function" && geojsonData?.features) {
    const siteFeatures = geojsonData.features.filter((f) => {
      return normalize(getSiteId(f.properties || {})) === normalize(siteId);
    });
    onSiteClick(siteId, siteFeatures);  // ← ALL MATCHING SITES PASSED
  }
});
```

---

### **8️⃣ LINE 3039-3087: SHOW SITE INFO FROM FEATURE**
```jsx
const showSiteInfoFromFeature = (feature) => {
  if (!feature) return;

  const props = feature.properties || {};  // ← YOUR PROPERTIES
  const src = {};
  const tgt = {};

  // SEPARATE SOURCE & TARGET PROPERTIES
  Object.entries(props).forEach(([k, v]) => {
    const lower = String(k).toLowerCase();
    if (lower.includes("target") || lower.startsWith("tgt_")) {
      tgt[k] = v;  // Target properties
    } else {
      src[k] = v;  // Source properties
    }
  });

  // src will contain:
  // {
  //   "D1DATE": "2025-11-17",
  //   "D1HOUR": "00:00:00",
  //   "D2EL01": "KP00015015",
  //   "Lat": 52.502128972525007,
  //   "Long": -2.051811129569864,
  //   "Azimuth": 90,
  //   "SITENAME": "15",
  //   "CELLNAME": "KP00015015",
  //   "NRARFCNDL": 627404.0,
  //   "BAND": "N35",
  //   "SITE ID": "15248",
  //   "TECH": "5G",
  //   "OPERATOR": "Vodafone",
  //   "VENDOR": "Ericsson",
  //   "B4_Polygon": "West4"
  // }

  // RESOLVE COLOR BASED ON TABLE TYPE
  let resolvedColor = props.fillColor || props.color || "#cccccc";
  
  if (tableType?.toLowerCase().includes("alarm") && alarmLegend?.length) {
    // Match against alarm legend
  }
  if (tableType?.toLowerCase().includes("traffic") && trafficLegend?.length) {
    // Match against traffic legend
  }
  if (tableType?.toLowerCase().includes("cm change")) {
    // Match remarks
  }

  src["Color"] = resolvedColor;
  src["Fillcolor"] = resolvedColor;

  // FIND REPRESENTATIVE CELL IF MISSING
  if (!getCellName(src)) {
    const fallbackCell = findRepresentativeCell(props, geojsonData);
    if (fallbackCell?.properties) {
      src["Cellname"] = getCellName(fallbackCell.properties);
      src["generation"] = src["generation"] || fallbackCell.properties.generation;
      src["Derived Cell"] = "Yes";
    }
  }

  // STORE IN STATE
  setInfoSource(src);  // ← STORED HERE ✅
  setInfoTarget(tgt);  // ← STORED HERE ✅
};
```

**Storage Locations:**
- `setInfoSource(src)` → STATE → Info Panel Left Side
- `setInfoTarget(tgt)` → STATE → Info Panel Right Side

---

### **9️⃣ LINE 3098-3137: SHOW BY SITE ID**
```jsx
const showSiteInfoBySiteId = (siteId, data) => {
  if (!data?.features?.length) return;

  // FIND FIRST MATCHING FEATURE
  const feat = data.features.find((f) => {
    const p = f.properties || {};
    return normalize(getSiteId(p)) === normalize(siteId);  // ← "15248"
  });

  if (!feat) return;

  // FIND ORIGINAL FEATURE
  const originalFeature = findOriginalFeature(
    feat.properties || {},
    geojsonData
  ) || feat;

  // SHOW INFO
  showSiteInfoFromFeature(originalFeature);  // ← CALLS FUNCTION ABOVE
  setSelectedSiteIdState(normalize(siteId));
  setShowInfoPanel(true);
};
```

---

## 📍 COMPLETE DATA FLOW FOR YOUR SAMPLE

```
Your Feature (geojsonData.features[])
    ↓
[Click on Sector]
    ↓
map.on("click", "sector-layer") [LINE 1783]
    ↓
findOriginalFeature(props, geojsonData) [LINE 1288]
    ↓
lastClickedOriginalFeatureRef.current = feature [LINE 1812]
    ↓
showSiteInfoFromFeature(feature) [LINE 1796] [LINE 3039]
    ↓
Separate into src/tgt properties
    ↓
Add resolved color
    ↓
Find fallback cell if needed
    ↓
setInfoSource(src) [LINE 3087]
setInfoTarget(tgt) [LINE 3088]
    ↓
INFO PANEL DISPLAYS:
  Left Side (infoSource):
    - D1DATE: "2025-11-17"
    - Lat: 52.502128972525007
    - Long: -2.051811129569864
    - SITENAME: "15"
    - CELLNAME: "KP00015015"
    - BAND: "N35"
    - SITE ID: "15248"
    - TECH: "5G"
    - OPERATOR: "Vodafone"
    - VENDOR: "Ericsson"
    - B4_Polygon: "West4"
    - Color: [resolved color]
```

---

## 🔄 STORAGE HIERARCHY

| Level | Storage Type | Line | Purpose |
|-------|--------------|------|---------|
| 1 | `geojsonData.features[]` | Props | Original data source |
| 2 | `sectorsRef.current` | useRef | Cached for style switching |
| 3 | `lastClickedOriginalFeatureRef.current` | useRef | Current clicked feature |
| 4 | `infoSource` / `infoTarget` | useState | Display in UI |
| 5 | `currentMatchedSitesRef.current` | useRef | Sites in polygon |

---

## ✅ YOUR DATA MAPPING

| Your Property | Used Where | Line |
|---------------|-----------|------|
| `D1DATE` | findOriginalFeature() | 1419 |
| `Lat` | Site centroid | 2125 |
| `Long` | Site centroid | 2125 |
| `Azimuth` | Sector positioning | 2140 |
| `SITENAME` | Display/info panel | 1799 |
| `CELLNAME` | Cell identification | 1799 |
| `BAND` | Band grouping | 2180 |
| `SITE ID` | Site grouping | 2081 |
| `TECH` | Technology tracking | Display |
| `OPERATOR` | Info panel | Display |
| `VENDOR` | Info panel | Display |
| `B4_Polygon` | Polygon coloring | 239 |
| All properties | Sector features | 2014-2021 |

---

## 💾 FINAL STORAGE LOCATION SUMMARY

**Your complete feature data is stored in:**

1. **Input:** `geojsonData.features[]` (from App.jsx)
2. **Cache:** `sectorsRef.current` (Line 2032)
3. **Click Ref:** `lastClickedOriginalFeatureRef.current` (Line 1812)
4. **UI State:** `infoSource` & `infoTarget` (Line 3087-3088)
5. **Backend:** Sent via `currentMatchedSitesRef.current.map(s => s.properties)` (Line 1117)

**All properties are accessible and stored!** ✅

