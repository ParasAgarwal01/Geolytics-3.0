import React, { useState, useEffect } from "react";
import Navbar from "./components/Navbar";
import Sidebar from "./components/Sidebar";
import MapRenderer from "./components/MapRenderer";
import "./App.css";
import "./Styles.css";
import "mapbox-gl/dist/mapbox-gl.css";
import KPIGridUploader from "./components/KPIGridUploader";
import * as turf from "@turf/turf";

// === Generation Colors (for generation overview) ===
const generationColors = {
  "2G": "#4CAF50",
  "3G": "#2196F3",
  "4G": "#FF9800",
  "5G": "#E91E63",
};

// 🕵️ Global fetch interceptor (for debugging /column-range calls)
const oldFetch = window.fetch;
window.fetch = async (...args) => {
  const url = args[0];

  if (typeof url === "string" && url.includes("/column-range")) {
    console.group("🔎 FETCH INTERCEPTED");
    console.log("URL:", url);
    console.trace("🚨 CALL STACK TRACE");
    console.groupEnd();
  }

  return oldFetch(...args);
};

// === Band Normalizer ===
function normalizeBand(raw) {
  if (!raw) return "";
  return String(raw).toUpperCase().trim();
}

// === Multi-Generation Fetch Helper (DB-level Generation Overview) ===
async function fetchAllGenerations(projectName, setGeojsonData, setLoading) {
  if (!projectName) return;

  setLoading(true);
  const gens = ["2G", "3G", "4G", "5G"];
  const mergedFeatures = [];

  try {
    // Base name = DB name or project root (strip _4G/_5G etc)
    const baseName = projectName.replace(/_?\d?G$/i, "").trim();

    for (const gen of gens) {
      const project = `${baseName}_${gen}`;
      const url = `${import.meta.env.VITE_API_URL}/query?project=${encodeURIComponent(
        project,
      )}&table_type=${encodeURIComponent("KPI's")}`;
      console.log(`🌐 [GEN OVERVIEW] Fetching ${url}`);

      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`⚠️ ${project} not found (status ${res.status})`);
        continue;
      }

      const data = await res.json();
      if (data?.features?.length > 0) {
        const genFeatures = data.features.map((f) => ({
          ...f,
          properties: {
            ...f.properties,
            generation: gen,
            color: generationColors[gen] || "#999999",
          },
        }));
        mergedFeatures.push(...genFeatures);
      }
    }

    const mergedGeoJSON = {
      type: "FeatureCollection",
      features: mergedFeatures,
    };

    console.log(
      `✅ [GEN OVERVIEW] Merged ${mergedFeatures.length} features for DB=${baseName}`,
    );
    setGeojsonData(mergedGeoJSON);
  } catch (err) {
    console.error("❌ Error fetching all generations:", err);
  } finally {
    setLoading(false);
  }
}

const App = () => {
  // === Core States ===
  const [mapStyle, setMapStyle] = useState(
    "mapbox://styles/mapbox/outdoors-v12",
  );
  const [geojsonData, setGeojsonData] = useState(null);
  const [driveTestGeoJSON, setDriveTestGeoJSON] = useState(null);
  const [gridGeoJSON, setGridGeoJSON] = useState(null);
  const [sidebarVisible, setSidebarVisible] = useState(false);

  // === Loader + Progress ===
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({
    progress: 0,
    stage: "Initializing...",
  });

  // Poll backend /progress only while loading is true
  useEffect(() => {
    if (!loading) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL}/progress`);
        if (res.ok) {
          const data = await res.json();
          setProgress(data);
        }
      } catch (err) {
        console.error("❌ Progress fetch failed:", err);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [loading]);

  // === Dynamic Options / Band-Cell selections ===
  const [bandCellOptions, setBandCellOptions] = useState([]);
  const [siteCellOptions, setSiteCellOptions] = useState([]);
  const [selectedCellBand, setSelectedCellBand] = useState([]);
  const [selectedBandCell, setSelectedBandCell] = useState(null);

  // === Table Data ===
  const [tableData, setTableData] = useState([]);
  const [tableColumns, setTableColumns] = useState([]);
  const [selectedTableType, setSelectedTableType] = useState("");
  const [lastPayloadTableType, setLastPayloadTableType] = useState("");

  // === Source/Target columns for info panel ===
  const [sourceColumnsFromSidebar, setSourceColumnsFromSidebar] = useState([]);
  const [targetColumnsFromSidebar, setTargetColumnsFromSidebar] = useState([]);

  // === Drive Test States ===
  const [selectedDriveKPI, setSelectedDriveKPI] = useState(null);
  const [driveTestColumns, setDriveTestColumns] = useState([]);
  const [driveLayerRange, setDriveLayerRange] = useState({
    min: null,
    max: null,
  });

  // === Grid Map States ===
  const [gridData, setGridData] = useState(null);
  const [gridKPIColumns, setGridKPIColumns] = useState([]);
  const [selectedGridKPI, setSelectedGridKPI] = useState(null);
  const [gridLayerRange, setGridLayerRange] = useState({
    min: null,
    max: null,
  });
  const [gridMapGeoJSON, setGridMapGeoJSON] = useState(null);

  // === Visual & Layer Controls ===
  const [radiusScale, setRadiusScale] = useState(0.1);
  const [selectedLayerColumn, setSelectedLayerColumn] = useState(null);
  const [selectedBandColumn, setSelectedBandColumn] = useState(null);
  const [legendType, setLegendType] = useState("kpi");
  const [colorRanges, setColorRanges] = useState({});
  const [layerRange, setLayerRange] = useState({ min: null, max: null });
  const [highlightedFeature, setHighlightedFeature] = useState(null);

  // === Project & Target Configs ===
  const [selectedProject, setSelectedProject] = useState(null); // PHDB project (e.g. VF3UK1_4G)
  const [targetConfigs, setTargetConfigs] = useState([]);
  const [targetColorRanges, setTargetColorRanges] = useState({});
  const [polygonGeoJSON, setPolygonGeoJSON] = useState(null);


  // === Filtering & Bands ===
  const [selectedUniqueBands, setSelectedUniqueBands] = useState([]);
  const [selectedColumnValues, setSelectedColumnValues] = useState({});

  // === DB & Generation overview ===
  const [selectedDatabase, setSelectedDatabase] = useState(null); // DB from Navbar (e.g. VF3UK1)
  const [availableProjects, setAvailableProjects] = useState([]); // PHDB projects for current DB

  const [activeSubModule, setActiveSubModule] = useState("TPGA02");

  // === Drive Test KPI Range ===
  useEffect(() => {
    if (!selectedDriveKPI) return;
    const fetchRange = async () => {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_API_URL}/drive-test/column-range?column=${encodeURIComponent(
            selectedDriveKPI,
          )}`,
        );
        if (res.ok) {
          const rangeData = await res.json();
          setDriveLayerRange({ min: rangeData.min, max: rangeData.max });
        }
      } catch (err) {
        console.error("❌ Failed to update drive test range:", err);
      }
    };
    fetchRange();
  }, [selectedDriveKPI]);

  // === Auto DB-Level Generation Overview when DB changes ===
  useEffect(() => {
    if (!selectedDatabase) return;

    console.log("🧩 [GEN OVERVIEW TRIGGER] DB:", selectedDatabase);
    setLegendType("generation");
    fetchAllGenerations(selectedDatabase, setGeojsonData, setLoading);
  }, [selectedDatabase]);

  // === Color Bands (for legends) ===
  const colorBands =
    selectedLayerColumn && colorRanges[selectedLayerColumn]
      ? Object.entries(colorRanges[selectedLayerColumn]).map(
          ([color, [from, to]]) => ({
            color,
            from,
            to,
          }),
        )
      : [];

  const bandColorBands =
    selectedBandColumn && colorRanges[selectedBandColumn]
      ? Object.entries(colorRanges[selectedBandColumn]).map(
          ([color, [from, to]]) => ({
            color,
            from,
            to,
          }),
        )
      : [];
  // helper in Sidebar.jsx
  const getActiveFilterTable = () => {
    if (targetConfigs.length > 0 && targetConfigs[0].table) {
      return targetConfigs[0].table; // e.g. BHAZ_WCELL_4G_ZM
    }
    if (kpiSource.table) {
      return kpiSource.table;
    }
    return phdbTable; // fallback
  };

  // === Site Click Handler (for concentric bands) ===
  const handleSiteClick = (siteId, allFeatures) => {
    const normalize = (str) => str?.toLowerCase()?.trim();
    const normalizedSiteId = normalize(siteId);
    const bandCells = [];

    for (const f of allFeatures) {
      const props = f?.properties || {};
      const fSiteId = normalize(props.site_id || props.Site_ID || props.SITEID);
      if (fSiteId !== normalizedSiteId) continue;

      const band = props.BAND || props.band || props.Band || "default";
      const cellname = props.cellname || props.Cell_name || props.CELLNAME;
      if (cellname) bandCells.push({ band, cellname });
    }

    // Sort highest band first
    bandCells.sort((a, b) => {
      const numA = parseInt(String(a.band).replace(/\D/g, ""), 10) || 0;
      const numB = parseInt(String(b.band).replace(/\D/g, ""), 10) || 0;
      return numB - numA;
    });

    setSelectedBandCell(null);
    setBandCellOptions(bandCells);
  };

  // === Main Map Generation (KPI / RCA / CM Change etc) ===
  const handleGenerateMap = async (payload) => {
    try {
      console.group("🗺️ handleGenerateMap()");
      setLoading(true);

      console.log("🔹 Incoming payload:", payload);
      console.log("🔹 Current selectedProject:", selectedProject);

      const projectName =
        payload.project_name || selectedProject || "Unknown_Project";
      if (!projectName) {
        alert("⚠️ Please select a project before generating the map.");
        return;
      }

      // Normalize table_type
      let tableType = payload.table_type?.trim() || "KPI's";
      const lowerType = tableType.toLowerCase();
      if (lowerType.includes("rca")) tableType = "RCA";
      else if (lowerType.includes("cm")) tableType = "CM Change";
      else if (lowerType.includes("kpi")) tableType = "KPI's";

      console.log("🧭 Final table_type:", tableType);

      // Final payload (mainly for logging)
      const finalPayload = {
        ...payload,
        kpiColumn: selectedLayerColumn || null,
        project_name: projectName,
        table_type: tableType,
      };
      console.log("📦 Final payload:", finalPayload);

      // Build /query URL directly (Django: /api/geolytics/query)
      const params = new URLSearchParams({
        project: projectName,
        table_type: tableType,
      });

      setSelectedTableType(tableType);
      if (tableType === "CM Change") setLegendType("cmchange");
      if (tableType === "RCA") setLegendType("rca");
      if (tableType === "KPI's") setLegendType("kpi");

      setLastPayloadTableType(tableType);
      console.log("📍 setSelectedTableType:", tableType);

      if (selectedUniqueBands?.length > 0) {
        params.set("bands", JSON.stringify(selectedUniqueBands));
      }

      if (
        selectedColumnValues &&
        Object.keys(selectedColumnValues).length > 0
      ) {
        params.set("filters", JSON.stringify(selectedColumnValues));
      }

      const queryUrl = `${
        import.meta.env.VITE_API_URL
      }/query?${params.toString()}`;
      console.log("▶️ Fetching GeoJSON + Rows from:", queryUrl);

      const res = await fetch(queryUrl);
      // ⭐ Detect backend cache hit → stop loader instantly
      if (res.headers.get("X-Cache") === "HIT") {
        console.log("⚡ Cache HIT from backend → stopping loader instantly");
        setLoading(false); // stop /progress polling
      }

      if (!res.ok)
        throw new Error(
          `Query failed (status ${res.status} ${res.statusText})`,
        );
      const data = await res.json();

      console.log("✅ Full API response:", data);

      // --- Validate ---
      if (!data?.features || !Array.isArray(data.features)) {
        console.warn("⚠️ Invalid GeoJSON: missing features array");
        alert("⚠️ No data found for the selected configuration.");
        return;
      }
      if (!data.features.length) {
        alert("⚠️ No data found for the selected configuration.");
        return;
      }

      // --- Normalize properties (lowercase, but preserve RCA-like names) ---
      const parsedFeatures = data.features.map((f) => ({
        ...f,
        properties: Object.fromEntries(
          Object.entries(f.properties || {}).map(([k, v]) => {
            const lower = k.toLowerCase().trim();

            // Preserve RCA/error-bucket style columns
            if (
              k.includes(" ") ||
              k.includes("/") ||
              k.includes("(") ||
              k.includes(")")
            ) {
              return [k.trim(), v];
            }
            if (lower.includes("issue") || lower.includes("analysis")) {
              return [lower, v];
            }

            // Normalize
            if (lower === "remarks" || lower.includes("remarks")) {
              return ["Remarks", v];
            }
            if (lower === "total_score" || lower.includes("totalscore")) {
              return ["TOTAL_SCORE", v];
            }

            return [lower, v];
          }),
        ),
      }));

      console.log(`🧩 Parsed ${parsedFeatures.length} GeoJSON features`);

      // ✅ Update Bands
      if (Array.isArray(data.bands) && data.bands.length > 0) {
        const opts = data.bands.map((b) => ({ band: b, cellname: null }));
        setBandCellOptions(opts);
        console.log("🎨 Band options updated:", opts);
      }

      // ✅ Update KPI Columns (from backend available_kpis)
      if (Array.isArray(data.available_kpis)) {
        setGridKPIColumns(data.available_kpis);
        console.log("📊 KPI columns updated:", data.available_kpis);
      }

      // ✅ Update Tabular Data
      if (Array.isArray(data.rows) && data.rows.length > 0) {
        console.log(`📋 ${data.rows.length} rows fetched`);
        setTableData(data.rows);
        setTableColumns(data.columns || Object.keys(data.rows[0] || {}));
        console.log("🧾 Columns:", data.columns);

        // Auto-map source/target columns
        if (Array.isArray(data.columns) && data.columns.length > 0) {
          const allCols = data.columns.map((c) => c.toString());

          // Source columns: structural/identifier fields
          const srcCols = allCols.filter((c) =>
            /cell|lat|long|azimuth|site|band|city|target_key/i.test(c),
          );

          // Target columns: remaining (likely KPI/numeric)
          const tgtCols = allCols.filter(
            (c) =>
              !srcCols.includes(c) &&
              !/id|name|lat|long|azimuth|band|city|target_key/i.test(c),
          );

          setSourceColumnsFromSidebar(srcCols);
          setTargetColumnsFromSidebar(tgtCols);

          console.log("🧩 Auto-mapped Source Columns:", srcCols);
          console.log("🧩 Auto-mapped Target Columns:", tgtCols);
        }
      }

      // ✅ Push to map
      setGeojsonData({ ...data, features: parsedFeatures });
      // ==================================================
      // ⭐ Apply backend color column (critical for CM Change)
      // ==================================================
      if (data?.color_config?.color_column) {
        const backendCol = data.color_config.color_column.trim();

        console.log("🎨 Backend color column →", backendCol);
        setSelectedLayerColumn(backendCol); // <--- the FIX
      }

      setDriveTestGeoJSON(null);
      setHighlightedFeature(null);

      console.log(
        `✅ Map updated successfully with ${parsedFeatures.length} features`,
      );
    } catch (err) {
      console.error("❌ handleGenerateMap failed:", err);
      alert("❌ Map generation failed. Check console for details.");
    } finally {
      console.groupEnd();
      setLoading(false);
    }
  };

  // === Drive Test Upload ===
  const handleDriveTestUpload = async (file) => {
    if (!file) return alert("⚠️ Please upload a file.");

    setLoading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/upload-drive-test`,
        {
          method: "POST",
          body: formData,
        },
      );

      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();

      setDriveTestColumns(data.available_kpis || []);
      setDriveTestGeoJSON(data.geojson);
    } catch (err) {
      console.error("Upload error:", err);
      alert("❌ Drive test upload failed.");
    } finally {
      setLoading(false);
    }
  };

  // === Export Handler ===
  const onExportData = async (format) => {
    const exportData = geojsonData || driveTestGeoJSON;
    if (!exportData) return alert("⚠️ No data to export.");

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, data: exportData }),
      });

      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `geolytics-export.${format}`;
      a.click();
      a.remove();
    } catch (err) {
      console.error("Export failed:", err);
      alert(`❌ Export ${format.toUpperCase()} failed.`);
    }
  };

  const handleSidebarSearch = (feature) => setHighlightedFeature(feature);

  // === JSX ===
  return (
    <div className="app-container">
      {/* Navbar: DB selection comes through selectedDatabase */}
      <Navbar
        activeSubModule={activeSubModule}
        setActiveSubModule={setActiveSubModule}
        selectedProject={selectedDatabase}
        setSelectedProject={setSelectedDatabase}
      />

      {/* Hover zone to show sidebar */}
      <div
        className="sidebar-hover-zone"
        onMouseEnter={() => setSidebarVisible(true)}
      />

      {/* Sidebar */}
      <div
        className={`sidebar ${sidebarVisible ? "show" : ""}`}
        onMouseLeave={() => setSidebarVisible(false)}
      >
        <Sidebar
          selectedColumnValues={selectedColumnValues}
          setSelectedColumnValues={setSelectedColumnValues}
          onGridData={setGridMapGeoJSON}
          gridMapGeoJSON={gridMapGeoJSON}
          setGridMapGeoJSON={setGridMapGeoJSON}
          driveTestColumns={driveTestColumns}
          setDriveTestColumns={setDriveTestColumns}
          geojsonData={geojsonData}
          setDriveTestGeojson={setDriveTestGeoJSON}
          driveTestData={driveTestGeoJSON}
          onGenerateMap={handleGenerateMap}
          onExportData={onExportData}
          onDriveTestUpload={handleDriveTestUpload}
          onSearch={handleSidebarSearch}
          selectedLayerColumn={selectedLayerColumn}
          setSelectedLayerColumn={setSelectedLayerColumn}
          selectedBandColumn={selectedBandColumn}
          setSelectedBandColumn={setSelectedBandColumn}
          legendType={legendType}
          setLegendType={setLegendType}
          colorRanges={colorRanges}
          setColorRanges={setColorRanges}
          colorBands={colorBands}
          bandColorBands={bandColorBands}
          bandCellOptions={bandCellOptions}
          setBandCellOptions={setBandCellOptions}
          selectedBandCell={selectedBandCell}
          setSelectedBandCell={setSelectedBandCell}
          setSelectedCellBand={setSelectedCellBand}
          siteCellOptions={siteCellOptions}
          setSiteCellOptions={setSiteCellOptions}
          layerRange={layerRange}
          setLayerRange={setLayerRange}
          driveLayerRange={driveLayerRange}
          setDriveLayerRange={setDriveLayerRange}
          setGridData={setGridData}
          selectedDriveKPI={selectedDriveKPI}
          setSelectedDriveKPI={setSelectedDriveKPI}
          gridKPIColumns={gridKPIColumns}
          setGridKPIColumns={setGridKPIColumns}
          selectedGridKPI={selectedGridKPI}
          setSelectedGridKPI={setSelectedGridKPI}
          gridLayerRange={gridLayerRange}
          setGridLayerRange={setGridLayerRange}
          onRadiusScaleChange={setRadiusScale}
          selectedUniqueBands={selectedUniqueBands}
          setSelectedUniqueBands={setSelectedUniqueBands}
          targetColorRanges={targetColorRanges}
          setTargetColorRanges={setTargetColorRanges}
          targetConfigs={targetConfigs}
          setTargetConfigs={setTargetConfigs}
          setSourceColumnsFromSidebar={setSourceColumnsFromSidebar}
          setTargetColumnsFromSidebar={setTargetColumnsFromSidebar}
          selectedDatabase={selectedDatabase}
          setSelectedDatabase={setSelectedDatabase}
          selectedProject={selectedProject}
          setSelectedProject={setSelectedProject}
          availableProjects={availableProjects}
          setAvailableProjects={setAvailableProjects}
          setLoading={setLoading}
        />
      </div>

      {/* Map */}
      <div className="map-container">
        {/* {console.log("🧭 MapRenderer props check →", {
          selectedDB: selectedDatabase,
          selectedProject,
          legendType,
          availableProjects,
        })} */}

        <MapRenderer
          radiusScale={radiusScale}
          mapStyle={mapStyle}
          geojsonData={geojsonData}
          driveTestGeoJSON={driveTestGeoJSON}
          highlightedFeature={highlightedFeature}
          selectedKPI={selectedLayerColumn}
          selectedBandColumn={selectedBandColumn}
          legendType={legendType}
          colorColumn={
            selectedLayerColumn || geojsonData?.color_config?.color_column
          }
          colorBands={colorBands}
          bandColorBands={bandColorBands}
          colorRanges={colorRanges}
          selectedBandCell={selectedBandCell}
          selectedCellBand={selectedCellBand}
          gridGeoJSON={gridGeoJSON}
          selectedDriveKPI={selectedDriveKPI}
          layerRange={layerRange}
          onSiteClick={handleSiteClick}
          driveLayerRange={driveLayerRange}
          gridData={gridData}
          gridMapGeoJSON={gridMapGeoJSON}
          selectedGridKPI={selectedGridKPI}
          selectedUniqueBands={selectedUniqueBands}
          targetColorRanges={targetColorRanges}
          targetConfigs={targetConfigs}
          selectedColumnValues={Object.entries(selectedColumnValues).map(
            ([column, values]) => ({ column, values }),
          )}
          tableType={selectedTableType || lastPayloadTableType}
          sourceColumns={sourceColumnsFromSidebar}
          targetColumns={targetColumnsFromSidebar}
          selectedDB={selectedDatabase}
          setSelectedDB={setSelectedDatabase}
          availableProjects={availableProjects}
        />
      </div>

      {/* Loader + Progress Overlay */}
      {loading && (
        <div className="loader-wrapper">
          <div className="loader"></div>
          <div className="progress-text">
            {progress.stage} <br />
            <strong>{progress.progress}%</strong>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
