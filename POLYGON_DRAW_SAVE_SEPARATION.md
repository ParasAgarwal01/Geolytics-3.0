# Polygon Drawing & Save Functionality Separation

## Current Structure in MapRenderer.jsx

### 1. **POLYGON DRAWING SECTION** (Lines 515-637)
**Functions:**
- `initializeDrawingTools(map)` - Creates MapboxDraw instance + loads existing polygons
- `setupDrawingListeners(map, draw)` - Attaches all event listeners
- `setupCursorHandling(map, draw)` - Mouse cursor for hover/click
- `activateTool(mode)` - Activates draw_polygon or draw_freehand

**State Variables:**
```javascript
const drawRef = useRef(null);
const isDrawingRef = useRef(false);
const [isDrawing, setIsDrawing] = useState(false);
const [selectedCountry, setSelectedCountry] = useState(null);
const [polygonCount, setPolygonCount] = useState(0);
```

**Event Listeners Attached:**
- draw.modechange → Sets cursor to crosshair
- draw.create → Sets zone_id property
- draw.update → Calls detectClickedSites
- map.click → Detects polygon clicks
- document.click → Global button handler
- Escape key → Finish drawing
- Right-click → Finish drawing

---

### 2. **SITE DETECTION SECTION** (Lines 744-791)
**Functions:**
- `detectClickedSites(polygon)` - Finds sites inside polygon using turf.booleanPointInPolygon
- `showZonePopup(polygon, sites)` - Displays popup with site list

**Refs Used:**
- `currentMatchedSitesRef` - Stores matched sites
- `currentActiveZoneIdRef` - Stores current zone ID
- `popupRef` - Popup instance

**Data Handled:**
- Flexible coordinate formats (Lat/Long, LATITUDE/LONGITUDE, Point geometry)
- Property name variations (SITENAME, SITE ID, site_id)

---

### 3. **SAVE/EXPORT SECTION** (Lines 933-1019)
**Functions:**
- `handleExportCSV()` - Exports matched sites as CSV file
- `handleSubmitToBackend()` - Saves polygon + sites to backend API

**Backend Endpoint:**
- POST `http://127.0.0.1:8000/api/geolytics/geo-api/polygon/save_polygon`
- Payload: { zoneId, country, site_data: { feature, matched_sites }, timestamp }

**Dependencies:**
- Token from CookiesUtils.getToken()
- Zone ID from currentActiveZoneIdRef
- Matched sites from currentMatchedSitesRef
- Draw instance from drawRef

---

### 4. **LOAD EXISTING POLYGONS** (Lines 1020+)
**Function:**
- `loadExistingPolygons()` - Fetches saved polygons from backend
- GET `/api/geolytics/geo-api/polygon/user_polygon_list`

---

## Proposed Separation Strategy

### **Option 1: Three Separate Files**
```
src/components/
├── MapRenderer.jsx (main component)
├── hooks/
│   ├── usePolygonDrawing.js (polygon drawing only)
│   ├── useSiteDetection.js (site detection only)
│   └── usePolygonSave.js (CSV export + backend save)
```

### **Option 2: Three Custom Hooks in One File**
```
src/components/
├── MapRenderer.jsx (main component)
└── hooks/PolygonHooks.js (all three hooks together)
```

### **Option 3: Separate Utility Functions File**
```
src/components/
├── MapRenderer.jsx (main component)
└── Utils/polygonDrawingUtils.js (all functions extracted)
```

---

## What Each Piece Needs

### **usePolygonDrawing Hook**
**Exports:**
- `initializeDrawingTools(map)`
- `activateTool(mode)`
- `drawRef`
- `isDrawingRef`

**Requires:**
- MapboxDraw library
- Map instance
- username (for zone ID generation)
- selectedCountry state
- polygonCount state

---

### **useSiteDetection Hook**
**Exports:**
- `detectClickedSites(polygon)`
- `showZonePopup(polygon, sites)`
- `currentMatchedSitesRef`
- `currentActiveZoneIdRef`

**Requires:**
- geojsonData (sites to detect)
- turf library
- Mapbox Popup

---

### **usePolygonSave Hook**
**Exports:**
- `handleExportCSV()`
- `handleSubmitToBackend()`

**Requires:**
- Papa (PapaParse)
- getToken() from CookiesUtils
- currentMatchedSitesRef
- currentActiveZoneIdRef
- drawRef

---

## Direct Benefits of Separation

✅ **Easier Maintenance** - Each function has single responsibility
✅ **Reusable** - Can use polygon drawing in other components
✅ **Testable** - Can unit test each piece independently
✅ **Cleaner** - MapRenderer becomes smaller, easier to read
✅ **Scalable** - Easy to add new export formats or backends

---

## Current MapRenderer Line Count
- **Total:** ~4,274 lines
- **Polygon Drawing Functions:** ~400 lines
- **Save/Export Functions:** ~150 lines
- **Potential Reduction:** ~500 lines (13% smaller)

---

## Which Option Do You Want?

1. **Separate Hook Files** - Best for reusability
2. **Single Hooks File** - Best for keeping related code together
3. **Utility Functions** - Best for simple extraction without React hooks
