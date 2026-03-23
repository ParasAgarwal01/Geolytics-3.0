import React, { useState, useEffect, useRef } from "react";
import "./Styles.css";
import KPIGridUploader from "./KPIGridUploader";
import toast from 'react-hot-toast';


const projectMap = {
  "4G-Nokia_Eric-Master Sheet": "BHAZ01_4G",
  "3G-Nokia_Eric-Master Sheet": "BHAZ01_3G",
  "2G-Nokia_Eric-Master Sheet": "BHAZ01_2G",
};

const colorNameMap = {
  "#00ff00": "Green",
  "#ffff00": "Yellow",
  "#ff0000": "Red",
  "#0000ff": "Blue",
  "#ffa500": "Orange",
  "#800080": "Purple",
  "#808080": "Gray",
};

function getColorLabel(hex) {
  return colorNameMap[hex.toLowerCase()] || hex;
}

function getApiBaseUrl() {
  return (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
}


const LEGEND_TYPES = [
  { value: "kpi", label: "KPI Heatmap" },
  { value: "band", label: "Band Colors" },
  { value: "sector", label: "Sector Colors" },
  { value: "driveTest", label: "Drive Test KPI" },
];
function appendDateParams(url) {
  const params = window.__geoDateFilter || {};
  const q = new URLSearchParams(params);
  if ([...q].length === 0) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${q.toString()}`;
}

function getColorForValue(value, colorBands) {
  for (const { color, from, to } of colorBands) {
    if (value >= from && value <= to) return color;
  }
  return "#cccccc"; // Default gray
}
let warned = false;
let missingColorKeysLogged = new Set();
function normalizeBand(val) {
  if (val == null) return "";
  return String(val).trim().toUpperCase();
}

function generateSectorGeoJSON(features, colorColumn, colorBands) {
  console.log("🧪 generateSectorGeoJSON input:", features?.length);
  if (!colorColumn || typeof colorColumn !== "string") {
    return []; // or just return features unchanged
  }

  return features.map((f) => {
    const props = f.properties || {};
    const rawVal = props[colorColumn];
    const parsed = parseFloat(rawVal);

    const isValidNumber =
      rawVal !== undefined &&
      rawVal !== null &&
      rawVal !== "" &&
      rawVal !== "null" &&
      rawVal !== "--" &&
      !isNaN(parsed);

    if (isValidNumber) {
      f.properties.fillColor = getColorForValue(parsed, colorBands);
    } else {
    }

    return f;
  });
}

function getClosestColorName(hex) {
  const knownColors = {
    "#ff0000": "red",
    "#00ff00": "lime",
    "#0000ff": "blue",
    "#ffff00": "yellow",
    "#ff00ff": "magenta",
    "#00ffff": "cyan",
    "#ffffff": "white",
    "#000000": "black",
    "#808080": "gray",
    "#800000": "maroon",
    "#008000": "green",
    "#000080": "navy",
    "#ffa500": "orange",
    "#a52a2a": "brown",
    "#800080": "purple",
    "#ffc0cb": "pink",
    "#808000": "olive",
    "#f0e68c": "khaki",
  };

  return knownColors[hex.toLowerCase()] || hex.toLowerCase();
}

const Sidebar = ({
  gridKPIColumns,
  setGridKPIColumns,
  selectedGridKPI,
  setSelectedGridKPI,
  gridLayerRange,
  setGridLayerRange,
  setLoading,
  loading,
  activeMapData,

  driveLayerRange,
  setDriveLayerRange,
  // Data & map generation
  onGenerateMap,
  
  onDriveTestUpload,
  onRadiusScaleChange,
  // Legend & KPI
  legendType,
  setLegendType,
  legendOptions,
  kpiColumn,
  setKpiColumn,

  // Layer & color settings
  selectedLayerColumn,
  setSelectedLayerColumn,
  colorRanges,
  setColorRanges,

  // Band column & band cells
  selectedBandColumn,
  bandCellOptions,
  setBandCellOptions,
  selectedBandCell,
  setSelectedBandCell,
  setSelectedCellBand,
  onGridData,
  setGridData,
  selectedDriveKPI,
  setSelectedDriveKPI,
  selectedUniqueBands,
  setSelectedUniqueBands,
  selectedColumnValues,
  setSelectedColumnValues,
  selectedProject,
  setSelectedProject,
  selectedDatabase,
  setSelectedDatabase,
  availableProjects,
  setAvailableProjects,
}) => {
  // === Date Filter State ===
  const [availableDates, setAvailableDates] = useState([]);
  const [selectedDates, setSelectedDates] = useState([]);
  const [dateSearch, setDateSearch] = useState("");
  const [isDateOpen, setIsDateOpen] = useState(false);

  const [targetRanges, setTargetRanges] = useState({});
  const [addingColorTarget, setAddingColorTarget] = useState({});
  const [newColorNameTarget, setNewColorNameTarget] = useState({});
  const [newColorHexTarget, setNewColorHexTarget] = useState({});
  const [newColorMinTarget, setNewColorMinTarget] = useState({});
  const [newColorMaxTarget, setNewColorMaxTarget] = useState({});

  // Table and column states
  const [tables, setTables] = useState([]);
  const [columns, setColumns] = useState([]);
  const [targetTables, setTargetTables] = useState([]);
  const [targetConfigs, setTargetConfigs] = useState([]);

  // Drive test states
  const [driveTestFile, setDriveTestFile] = useState(null);

  // State for dropdown toggle & selected bands
  const [isUniqueBandOpen, setIsUniqueBandOpen] = useState(false);

  const [uniqueBands, setUniqueBands] = useState([]);
  const [selectedBands, setSelectedBands] = useState([]);
  const [radiusScale, setRadiusScale] = useState(0.1);

  const [gridMapGeoJSON, setGridMapGeoJSON] = useState(null);
  const [showJoinConfig, setShowJoinConfig] = useState(false);
  const [activeTableType, setActiveTableType] = useState(null);

  const [filters, setFilters] = useState([]);
  const [searchTexts, setSearchTexts] = useState({});
  const [layerRange, setLayerRange] = useState({ min: null, max: null });
  const [newColorHex, setNewColorHex] = useState("#663399");
  const [newColorMin, setNewColorMin] = useState(layerRange.min || 0);
  const [newColorMax, setNewColorMax] = useState(layerRange.max || 0);
  const [bandRange, setBandRange] = useState({ min: null, max: null });
  const [kpiSource, setKpiSource] = useState({ type: null, table: null });
  const [searchBand, setSearchBand] = useState("");
  const [searchTerms, setSearchTerms] = useState({});

  const [availableTableTypes, setAvailableTableTypes] = useState([]);

  // === Band dropdown UI state (UI only, doesn't change your data flow) ===
  const [isBandDropdownOpen, setIsBandDropdownOpen] = useState(false);
  const [bandSearch, setBandSearch] = useState("");
  const bandDropdownRef = useRef(null);

  // selectedUniqueBands and setSelectedUniqueBands are now props from App.jsx

  const [addingDriveColor, setAddingDriveColor] = useState(false);
  const [newDriveColorHex, setNewDriveColorHex] = useState("#0000ff");
  const [newDriveMin, setNewDriveMin] = useState(0);
  const [newDriveMax, setNewDriveMax] = useState(0);

  const [addingGridColor, setAddingGridColor] = useState(false);
  const [newGridColorHex, setNewGridColorHex] = useState("#0000ff");
  const [newGridMin, setNewGridMin] = useState(0);
  const [newGridMax, setNewGridMax] = useState(0);

  const [availableDriveKPIs, setAvailableDriveKPIs] = useState([]);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [selectedColumnFilters, setSelectedColumnFilters] = useState(null);
  const [availableColumns, setAvailableColumns] = useState([]);
  const [availableValues, setAvailableValues] = useState({});

  const [columnSearch, setColumnSearch] = useState("");

  // Filter config states
  const [phdbTable, setPhdbTable] = useState("");
  const [requiredCols, setRequiredCols] = useState({
    site_id: ["Site_ID", "D2EL02"],
    cellname: ["Cell_name", "D2EL01"],
    lat: "Lat",
    lon: "Long",
    azimuth: "Azimuth",
  });
  const [popupColumns, setPopupColumns] = useState([]);
  const [layerColumn, setLayerColumn] = useState("");

  const [bandColumn, setBandColumn] = useState("");
  // const [kpiColumn, setKpiColumn] = useState('');
  const [templateName, setTemplateName] = useState("");
  const [savedTemplates, setSavedTemplates] = useState([]);
  const [loadFilterTemplate, setLoadFilterTemplate] = useState("");
  const [showDropdowns, setShowDropdowns] = useState({});
  const dropdownRefs = useRef({});
  const [driveTestColumns, setDriveTestColumns] = useState([]);
  const [kpiProgress, setKpiProgress] = useState(0);
  const [fetchingKPI, setFetchingKPI] = useState(false);

  const [fetchingGridKPI, setFetchingGridKPI] = useState(false);
  const [gridKpiProgress, setGridKpiProgress] = useState(0);
  const [polygonFiles, setPolygonFiles] = useState([]);
  const [selectedPolygon, setSelectedPolygon] = useState("");
  const [uploadedZipId, setUploadedZipId] = useState(null);

  const handlePolygonZipUpload = async (e) => {
    const file = e.target.files[0];
    console.log("📂 ZIP Upload triggered. File selected:", file);

    if (!file) {
      console.warn("⚠️ No ZIP file selected.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    const url = `${getApiBaseUrl()}/geo-api/polygon/upload-zip`;
    console.log("⬆️ Uploading ZIP to:", url);

    const res = await fetch(url, {
      method: "POST",
      body: formData,
    });

    console.log("📥 Response status:", res.status);

    const data = await res.json();
    console.log("✅ ZIP Upload Response:", data);

    setUploadedZipId(data.zip_id);
    setPolygonFiles(data.files);
  };

  const fetchPolygonGeoJSON = async () => {
    console.log("🟢 Load Polygon Button Clicked!");
    console.log("➡️ uploadedZipId:", uploadedZipId);
    console.log("➡️ selectedPolygon:", selectedPolygon);

    if (!uploadedZipId || !selectedPolygon) {
      console.warn("⚠️ Missing zip_id or polygon file!");
      return;
    }

    const url = `${getApiBaseUrl()}/geo-api/polygon/geojson?zip_id=${uploadedZipId}&file=${encodeURIComponent(
      selectedPolygon
    )}`;
    console.log("📡 Fetching Polygon GeoJSON:", url);

    const res = await fetch(url);
    console.log("📥 Response status:", res.status);

    const data = await res.json();
    console.log("📦 Polygon GeoJSON received:", data);

    if (!window.loadPolygonLayer) {
      console.error("❌ window.loadPolygonLayer is NOT defined!");
    } else {
      console.log("🚀 Calling window.loadPolygonLayer with data...");
    }

    window.loadPolygonLayer?.(data);
  };

  const handleTableTypeSelect = async (type, projectName) => {
    // NOTE: loader is started synchronously by the button click handler to
    // give instant feedback. Here, we only stop the loader on error or when
    // a fatal condition is encountered — otherwise `onGenerateMap` will
    // conclude the overall flow and stop the loader when map data is loaded.

    try {
      const safeType = type.replace("’", "'").trim();
      const url = appendDateParams(
        `${getApiBaseUrl()}/projects/${encodeURIComponent(
          projectName
        )}/config?table_type=${encodeURIComponent(safeType)}`
      );

      console.log("📡 Fetching config:", url);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const configs = await res.json();

      console.log("✅ Config response:", configs);

      // ✅ Support both array (old) and object-with-rows (new)
      const configArray = Array.isArray(configs)
        ? configs
        : Array.isArray(configs.rows)
        ? configs.rows
        : [];

      if (configArray.length === 0) {
        console.warn(
          "⚠️ No configs found for:",
          projectName,
          safeType,
          configs
        );
        // clear loader when no usable config is found
        setLoading?.(false);
        toast.error("No configuration found for selected project/type.");
        return;
      }

      // ✅ Use the first config row
      const cfg = configArray[0];
      console.log("⚙️ Using config row:", cfg);
      // ===============================
      // 📅 Fetch available dates
      // ===============================
      try {
        const datesUrl = `${getApiBaseUrl()}/available-dates?project=${encodeURIComponent(
          cfg.project_name
        )}&table_type=${encodeURIComponent(
          cfg.table_type.replace("’", "'").trim()
        )}`;

        console.log("📅 Fetching available dates:", datesUrl);

        const datesRes = await fetch(datesUrl);
        if (!datesRes.ok) throw new Error("Failed to fetch dates");

        const datesData = await datesRes.json();

        console.log("📅 Available dates payload:", datesData);

        // ✅ Safely extract available_dates
        const dates = Array.isArray(datesData?.available_dates)
          ? datesData.available_dates
          : [];

        setAvailableDates(dates);

        // ✅ AUTO-SELECT LATEST DATE (DEFAULT SNAPSHOT)
        if (dates.length > 0) {
          const sorted = [...dates].sort((a, b) => new Date(b) - new Date(a));
setSelectedDates(sorted.length ? [sorted[0]] : []); // latest date only
        } else {
          setSelectedDates([]);
        }
      } catch (err) {
        console.error("❌ Failed fetching available dates:", err);
        setAvailableDates([]);
        setSelectedDates([]);
      }

      // === Fetch columns for both tables ===
      const [sourceColsRes, targetColsRes] = await Promise.all([
        fetch(
          `${getApiBaseUrl()}/columns/${encodeURIComponent(cfg.source_table)}`
        ),
        fetch(
          `${getApiBaseUrl()}/columns/${encodeURIComponent(cfg.target_table)}`
        ),
      ]);

      const sourceCols = await sourceColsRes.json();
      const targetCols = await targetColsRes.json();

      console.log("📊 Source columns:", sourceCols);
      console.log("🎯 Target columns:", targetCols);

      // === Update global columns for Source dropdown ===
      setColumns(Array.isArray(sourceCols) ? sourceCols : []);

      // === Prepare join config ===
      const newConfig = {
        source_table: cfg.source_table,
        table: cfg.target_table,
        sourceColumns: Array.isArray(sourceCols) ? sourceCols : [],
        columns: Array.isArray(targetCols) ? targetCols : [],
        selectedCols: [],
        joinOn: {
          physical:
            cfg.source_column && sourceCols?.includes(cfg.source_column)
              ? cfg.source_column
              : sourceCols?.[0] || "",
          target:
            cfg.target_column && targetCols?.includes(cfg.target_column)
              ? cfg.target_column
              : targetCols?.[0] || "",
        },
      };

      // === Update the targetConfigs ===
      setTargetConfigs([newConfig]);
      console.log("🧩 Auto-filled join config:", newConfig);

      setKpiSource({ type: "query", table: type });
    } catch (err) {
      console.error("❌ TableType select failed:", err);
      // stop loader on error
      setLoading?.(false);
      toast.error("Failed to select table type. See console.");
    }
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

  // === Fetch Band + Cellname options ===
  useEffect(() => {
    if (!phdbTable) return;

    fetch(
      `${import.meta.env.VITE_API_URL}/bands/${encodeURIComponent(phdbTable)}`
    )
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          // expects array of { band: "1800", cellname: "Cell_A" }
          setBandCellOptions(data);
        } else {
          setBandCellOptions([]);
        }
      })
      .catch((err) => {
        console.error("❌ Failed fetching bands:", err);
        setBandCellOptions([]);
      });
  }, [phdbTable]);
  useEffect(() => {
    window.selectedColumnValues = selectedColumnValues;
    scheduleRefresh(); // re-render map whenever column filters change
  }, [selectedColumnValues]);

  // Helper to schedule map refresh after React state updates (prevents racing)
  const scheduleRefresh = (payload) => setTimeout(() => window.refreshLayerMap?.(payload), 0);

  useEffect(() => {
    const onDocClick = (e) => {
      if (
        bandDropdownRef.current &&
        !bandDropdownRef.current.contains(e.target)
      ) {
        setIsBandDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    if (!selectedDriveKPI || !colorRanges[selectedDriveKPI]) return;

    // Notify parent that config changed
    onDriveTestUpload?.(driveTestFile, selectedDriveKPI, {
      colorRanges,
      driveLayerRange,
    });

    // Optional: if still needed
    window.refreshDriveTestLayer?.();
  }, [selectedDriveKPI, colorRanges, driveLayerRange]);

  // When bandCellOptions change, extract unique bands
  useEffect(() => {
    if (bandCellOptions && bandCellOptions.length > 0) {
      const bands = [...new Set(bandCellOptions.map((opt) => opt.band))];
      setUniqueBands(bands);
    }
  }, [bandCellOptions]);
  // Toggle dropdown
  const toggleUniqueBandDropdown = () => {
    setShowUniqueBandDropdown((prev) => !prev);
  };

  // Handle band selection
  const handleBandSelection = (band) => {
    setSelectedBands((prev) =>
      prev.includes(band) ? prev.filter((b) => b !== band) : [...prev, band]
    );
  };

  useEffect(() => {
    if (
      activeMapData &&
      Array.isArray(activeMapData.features) &&
      selectedBandColumn
    ) {
      const opts = activeMapData.features
        .map((f) => {
          const props = f.properties || {};
          const bandRaw =
            props[selectedBandColumn] ?? props.BAND ?? props.band ?? props.Band;
          const band = normalizeBand(bandRaw);
          const cellname =
            props.cellname || props.Cell_name || props.CELLNAME || "";
          return { band, cellname };
        })
        .filter((o) => o.band && o.cellname);

      setBandCellOptions(opts);
    }
  }, [activeMapData, selectedBandColumn]);

  useEffect(() => {
    if (layerColumn) {
      setSelectedLayerColumn(layerColumn);
    }
  }, [layerColumn]);

  // Sync App-selected column into local state so UI and map stay consistent
  useEffect(() => {
    if (selectedLayerColumn && selectedLayerColumn !== layerColumn) {
      setLayerColumn(selectedLayerColumn);
    }
  }, [selectedLayerColumn]);

  useEffect(() => {
    // Auto-refresh polygons when colorRanges or layerColumn change
    if (layerColumn && window.refreshLayerMap) {
      console.log("🎨 Auto-refreshing map for color update...");
      scheduleRefresh();
    }
  }, [colorRanges, layerColumn]);

  // Fetch tables and templates on mount
  // ✅ NEW (fetching /projects instead of /tables)
  useEffect(() => {
    if (!selectedDatabase) {
      console.log("⏸️ No database selected yet, skipping project fetch...");
      return;
    }

    console.log(
      `📡 Fetching projects for selected database: ${selectedDatabase}`
    );

    // --- Fetch and filter projects ---
    fetch(`${import.meta.env.VITE_API_URL}/projects`)
      .then((res) => res.json())
      .then((projects) => {
        console.log("📌 All projects fetched:", projects);

        const filteredProjects = projects.filter((p) =>
          p.toUpperCase().startsWith(selectedDatabase.toUpperCase())
        );

        console.log(
          `📦 Filtered projects for ${selectedDatabase}:`,
          filteredProjects
        );

        if (typeof setAvailableProjects === "function") {
          setAvailableProjects(filteredProjects);
        }

        setTables(filteredProjects);

        // ⛔ STOP auto selecting the first project
        setPhdbTable(""); // Force dropdown to show "Select Project"
        setSelectedProject("");
      })
      .catch((err) => {
        console.error("❌ Failed to fetch projects:", err);
        setTables([]);
      });

    // --- Fetch templates (unrelated to DB, so keep it global) ---
    fetch(`${import.meta.env.VITE_API_URL}/templates`)
      .then((res) => res.json())
      .then((data) => {
        console.log("📁 Templates fetched:", data);
        setSavedTemplates(data);
      })
      .catch((err) => console.error("❌ Failed to fetch templates:", err));
  }, [selectedDatabase]);

  // Fetch columns when PHDB table changes
  // Fetch columns once project + type are selected
  useEffect(() => {
    if (!phdbTable || !kpiSource.table) return;

    // get config for this project/type
    fetch(
      `${import.meta.env.VITE_API_URL}/projects/${encodeURIComponent(
        phdbTable
      )}/config?table_type=${encodeURIComponent(kpiSource.table)}`
    )
      .then((res) => res.json())
      .then((configs) => {
        if (!Array.isArray(configs) || configs.length === 0) return;
        const { source_table } = configs[0];

        // now fetch columns for that source table
        return fetch(
          `${import.meta.env.VITE_API_URL}/columns/${encodeURIComponent(
            source_table
          )}`
        )
          .then((res) => res.json())
          .then((fetchedCols) => {
            if (!Array.isArray(fetchedCols)) return;

            setColumns(fetchedCols);
            setRequiredCols({
              site_id: fetchedCols.includes("Site_ID")
                ? "Site_ID"
                : fetchedCols.includes("D2EL02")
                ? "D2EL02"
                : "",
              cellname: fetchedCols.includes("Cell_name")
                ? "Cell_name"
                : fetchedCols.includes("D2EL01")
                ? "D2EL01"
                : "",
              lat: fetchedCols.includes("Lat") ? "Lat" : "",
              lon: fetchedCols.includes("Long") ? "Long" : "",
              azimuth: fetchedCols.includes("Azimuth") ? "Azimuth" : "",
            });
          });
      })
      .catch((err) => {
        console.error("❌ Failed fetching config/columns:", err);
      });
  }, [phdbTable, kpiSource.table]);

  // Fetch columns for target tables
  // Fetch columns for target tables (preserving selectedCols and joinOn)
  useEffect(() => {
    Promise.all(
      targetTables.map((table) =>
        fetch(`${getApiBaseUrl()}/columns/${encodeURIComponent(table)}`)
          .then((res) => res.json())
          .then((columns) => ({ table, columns }))
      )
    ).then((results) => {
      setTargetConfigs((prevConfigs) =>
        results.map(({ table, columns }) => {
          const existing = prevConfigs.find((cfg) => cfg.table === table);
          return {
            table,
            columns,
            selectedCols: existing?.selectedCols || [],
            joinOn: existing?.joinOn || { physical: "", target: "" },
          };
        })
      );
    });
  }, [targetTables]);

  useEffect(() => {
    function handleDocumentClick(e) {
      // For each dropdown, if click is outside, close it
      Object.entries(dropdownRefs.current).forEach(([key, el]) => {
        if (showDropdowns[key] && el && !el.contains(e.target)) {
          setShowDropdowns((prev) => ({ ...prev, [key]: false }));
        }
      });
    }
    document.addEventListener("mousedown", handleDocumentClick);
    return () => document.removeEventListener("mousedown", handleDocumentClick);
  }, [showDropdowns]);

  // Save filter template
  const handleSaveTemplate = () => {
    const template = {
      name: templateName,
      config: {
        phdbTable,
        requiredCols,
        popupColumns,
        target_joins: targetConfigs.map((cfg) => ({
          table: cfg.table,
          target_columns: cfg.selectedCols,
          join_on: cfg.joinOn,
        })),
        layerColumn,
        bandColumn,
        kpiColumn,
      },
    };
    fetch(`${import.meta.env.VITE_API_URL}/save-template`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(template),
    })
      .then((res) => res.json())
      .then(() => {
        toast.success("Template saved!");
        setTemplateName("");
        return fetch(`${import.meta.env.VITE_API_URL}/templates`);
      })
      .then((res) => res.json())
      .then(setSavedTemplates)
      .catch(() => toast.error("Failed to save template."));
  };
  // useEffect(() => {
  //   // expose dates globally for map/query refresh
  //   window.__geoDateFilter = {
  //     from_date: fromDate || null,
  //     to_date: toDate || null,
  //   };

  //   // optional: auto refresh map when date changes
  //   if (window.refreshLayerMap) {
  //     window.refreshLayerMap();
  //   }
  // }, [fromDate, toDate]);

  useEffect(() => {
    // 🛑 Guard: do not set global date filter until context is ready
    if (!phdbTable || !activeTableType) {
      console.log("⏸️ Skipping global date filter (context not ready)", {
        phdbTable,
        activeTableType,
        selectedDates,
      });
      return;
    }

    // ✅ Build date filter only when dates exist
    const filter =
      Array.isArray(selectedDates) && selectedDates.length > 0
        ? { dates: selectedDates.join(",") }
        : {};

    // 🌍 Expose globally for query / grid / drive-test APIs
    window.__geoDateFilter = filter;

    console.log("🌍 Global date filter set:", window.__geoDateFilter);
  }, [selectedDates, phdbTable, activeTableType]);

  useEffect(() => {
    // --------------------------------------------------
    // 🛑 Guard: do NOTHING until everything is ready
    // --------------------------------------------------
    if (
      !phdbTable ||
      !activeTableType ||
      !Array.isArray(selectedDates) ||
      selectedDates.length === 0
    ) {
      console.log("⏸️ Date change ignored (not ready)", {
        phdbTable,
        activeTableType,
        selectedDates,
      });
      return;
    }

    const safeType = activeTableType.replace("’", "'").trim();

    const queryUrl = appendDateParams(
      `${getApiBaseUrl()}/query?project=${encodeURIComponent(
        phdbTable
      )}&table_type=${encodeURIComponent(safeType)}`
    );

    console.log("🔁 Date changed → refetching polygons");
    console.log("📡 Query URL:", queryUrl);

    // --------------------------------------------------
    // 🚀 START LOADER (valid query only)
    // --------------------------------------------------
    setLoading?.(true);

    let aborted = false;

    fetch(queryUrl)
      .then((res) => res.json())
      .then((data) => {
        if (aborted) return;

        console.log("🧩 Date-filtered GeoJSON:", {
          features: data?.features?.length,
        });

        if (!data?.features?.length) {
  setLoading?.(false);
  toast.error("No data for selected date.");
  return;
}

onGenerateMap({
  ...data,
  project_name: phdbTable,
  table_type: safeType,
});

      })
      .catch((err) => {
        if (!aborted) {
          console.error("❌ Date-based query failed:", err);
        }
      });

    // --------------------------------------------------
    // 🧹 Cleanup (prevent stale fetch side-effects)
    // --------------------------------------------------
    return () => {
      aborted = true;
    };
  }, [selectedDates, phdbTable, activeTableType]);

  useEffect(() => {
    const onClick = (e) => {
      if (!e.target.closest(".dropdown-wrapper")) {
        setIsDateOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // 🎨 Whenever color ranges or layerColumn change, push updated coloring to map
  useEffect(() => {
    if (!activeMapData || !layerColumn || !colorRanges[layerColumn]) return;

    const colorBands = Object.entries(colorRanges[layerColumn]).map(
      ([color, [from, to]]) => ({
        color,
        from,
        to,
      })
    );

    // Reapply fillColor dynamically
    const updatedFeatures = activeMapData.features.map((f) => {
      const val = parseFloat(f.properties?.[layerColumn]);
      if (!isNaN(val)) {
        const band = colorBands.find((b) => val >= b.from && val <= b.to);
        f.properties.fillColor = band ? band.color : "#cccccc";
      }
      return f;
    });

    const updatedGeoJson = { ...activeMapData, features: updatedFeatures };

    scheduleRefresh(updatedGeoJson); // OR if you manage it via prop:
    // onGenerateMap({ ...payload, activeMapData: updatedGeoJson });
  }, [colorRanges, layerColumn]);

  // Load a saved filter template
  const handleLoadTemplate = () => {
    if (!loadFilterTemplate) return;
    fetch(`${import.meta.env.VITE_API_URL}/template/${loadFilterTemplate}`)
      .then((res) => res.json())
      .then((data) => {
        const config = data.config;
        setPhdbTable(config.phdbTable);
        setRequiredCols(config.requiredCols);
        setPopupColumns(config.popupColumns || []);
        setTargetConfigs(
          (config.target_joins || []).map((join) => ({
            table: join.table,
            columns: [],
            selectedCols: join.target_columns || [],
            joinOn: join.join_on || { physical: "", target: "" },
          }))
        );
        setLayerColumn(config.layerColumn || "");
        setBandColumn(config.bandColumn || "");
        setKpiColumn(config.kpiColumn || "");
      });
  };

  // Generate map payload and call parent handler
  const handleGenerate = () => {
    const payload = {
      physical_table: phdbTable,
      physical_columns: requiredCols,
      physical_extra_cols: [
        ...popupColumns,
        ...(layerColumn ? [layerColumn] : []),
      ],
      target_joins: targetConfigs.map((cfg) => ({
        table: cfg.table,
        target_columns: cfg.selectedCols,
        join_on: cfg.joinOn,
      })),
      ...(layerColumn && { layerColumn }),
      ...(bandColumn && { bandColumn }),
      ...(kpiColumn && { kpiColumn }),
      ...(layerColumn && {
        colorRanges: Object.entries(colorRanges[layerColumn] || {}).map(
          ([color, [from, to]]) => ({
            color,
            from,
            to,
          })
        ),
      }),
    };

    onGenerateMap(payload);
  };

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

  // === Drive Test Upload Handler ===
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

  // Export CSV/KML handlers
const handleExportCSV = () => {
  if (!activeMapData || !Array.isArray(activeMapData.features)) {

    toast.error("No map data available to export.");
    return;
  }

  if (activeMapData.features.length === 0) {

    toast.error("GeoJSON is empty. Nothing to export.");
    return;
  }

  try {
    const headers = Object.keys(activeMapData.features[0].properties || {});


    if (headers.length === 0) {
      toast.error("No properties found in GeoJSON.");
      return;
    }

    const csvRows = [
      headers.join(","),
      ...activeMapData.features.map((f) =>

        headers.map((h) => JSON.stringify(f.properties?.[h] ?? "")).join(",")
      ),
    ];

    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = "map_data.csv";
    link.click();

    URL.revokeObjectURL(url);

    toast.success("CSV exported successfully!");
  } catch (err) {
    console.error("CSV Export Error:", err);
    toast.error("Failed to export CSV.");
  }
};


const handleExportKML = () => {
  if (!activeMapData || !Array.isArray(activeMapData.features))
{
    toast.error("No map data available to export.");
    return;
  }

  if (activeMapData.features.length === 0) {
    toast.error("GeoJSON is empty. Nothing to export.");
    return;
  }

  try {
    const kmlHeader =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>`;

    const kmlFooter = `</Document></kml>`;

    const placemarks = activeMapData.features
      .map((f) => {
        const { geometry, properties } = f;
        if (!geometry || geometry.type !== "Point") return "";

        const [lon, lat] = geometry.coordinates || [];
        if (lon == null || lat == null) return "";


        const name = properties?.Site_ID || "Point";

        return `<Placemark>
          <name>${name}</name>
          <Point>
            <coordinates>${lon},${lat},0</coordinates>
          </Point>
        </Placemark>`;
      })
      .join("");

    if (!placemarks) {
      toast.error("No valid point data found for KML export.");
      return;
    }

    const kmlContent = `${kmlHeader}${placemarks}${kmlFooter}`;

    const blob = new Blob([kmlContent], {
      type: "application/vnd.google-earth.kml+xml",
    });

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = "map_data.kml";
    link.click();

    URL.revokeObjectURL(url);

    toast.success("KML exported successfully!");
  } catch (err) {
    console.error("KML Export Error:", err);
    toast.error("Failed to export KML.");
  }
};

  return (
    <div className="left-panel">
      <div className="sidebar-scroll">
        {/* === Date Filter (Multi-select) === */}
        <div className="sidebar-section">
          <label style={{ fontWeight: "bold" }}>📅 Select Dates</label>

          <div className="dropdown-wrapper">
            <button
              type="button"
              className="input"
              onClick={() => setIsDateOpen((v) => !v)}
              style={{ display: "flex", justifyContent: "space-between" }}
            >
              <span>
                {selectedDates.length
                  ? `${selectedDates[0]}${
                      selectedDates.length > 1
                        ? ` (+${selectedDates.length - 1})`
                        : ""
                    }`
                  : "Select Dates"}
              </span>
              <span>▾</span>
            </button>

            {isDateOpen && (
              <div className="dropdown-list">
                {/* Search */}
                <input
                  className="search-input"
                  placeholder="Search date..."
                  value={dateSearch}
                  onChange={(e) => setDateSearch(e.target.value)}
                />

                {availableDates
                  .filter((d) => d.includes(dateSearch))
                  .map((date) => {
                    const checked = selectedDates.includes(date);
                    return (
                      <div
                        key={date}
                        className={`dropdown-item ${checked ? "selected" : ""}`}
                        onClick={() => {
                          console.log("📅 Date clicked:", date);
                          console.log("📅 Was already selected?", checked);

                          setSelectedDates((prev) => {
                            const next = checked
                              ? prev.filter((d) => d !== date)
                              : [...prev, date];

                            console.log("📅 Updated selectedDates:", next);
                            return next;
                          });
                        }}
                      >
                        <input type="checkbox" checked={checked} readOnly />
                        <span style={{ marginLeft: 8 }}>{date}</span>
                      </div>
                    );
                  })}

                {availableDates.length === 0 && (
                  <div className="dropdown-item disabled">
                    No dates available
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <h3>Filter</h3>
        {/* Legend type selection
        <label>Legend Type</label>
        <select
          className="input"
          value={legendType}
          onChange={e => setLegendType(e.target.value)}
          style={{ marginBottom: '12px' }}
        >
          {LEGEND_TYPES.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      
        {legendType === 'kpi' && (
          <>
            <label>Select KPI to Display in Legend</label>
            {renderDropdown('kpi', columns, false, kpiColumn, setKpiColumn)}
          </>
        )} */}
        <label>Load Filter Template</label>
        {renderDropdown(
          "loadFilterTemplate",
          savedTemplates,
          false,
          loadFilterTemplate,
          setLoadFilterTemplate
        )}
        <button className="btn" onClick={handleLoadTemplate}>
          Load Template
        </button>

        {/* === Project + Table Types === */}
        <label>Project</label>
        <div className="dropdown-wrapper">
          <select
            className="input"
            value={phdbTable}
            onChange={async (e) => {
              const val = e.target.value;
              console.log("📌 Project selected:", val);

              setPhdbTable(val);
              setSelectedProject(val); // ✅ Sync with App state
              setActiveTableType(null);
              setAvailableDates([]);
              setSelectedDates([]);

              if (val) {
                try {
                  const url = `${getApiBaseUrl()}/projects/${encodeURIComponent(
                    val
                  )}/types`;
                  console.log("📡 Fetching table types from:", url);
                  const res = await fetch(url);

                  if (!res.ok) throw new Error(`Failed ${res.status}`);
                  const types = await res.json();
                  console.log("📌 Table types for", val, "=>", types);

                  setAvailableTableTypes(types);
                } catch (err) {
                  console.error("❌ Failed to fetch table types:", err);
                  setAvailableTableTypes([]);
                }
              } else {
                setAvailableTableTypes([]);
              }
            }}
          >
            <option value="">Select Project</option>
            {tables.map((proj, i) => (
              <option key={i} value={proj}>
                {proj}
              </option>
            ))}
          </select>
        </div>

        {phdbTable && availableTableTypes.length > 0 && (
          <div style={{ marginTop: "12px" }}>
            <label>Table Types</label>
            <div
  style={{
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)", // 👈 3 buttons per row
    gap: "10px",
    marginTop: "6px",
  }}
>

              {availableTableTypes.map((type) => (
                <button
                  key={type}
                  className={`table-type-btn ${
    activeTableType === type ? "active" : ""
  }`}
                  disabled={loading}
                  aria-busy={loading}
                  title={loading ? "Loading..." : ""}
                  onClick={async () => {
                    console.log(
                      "▶️ Table type clicked:",
                      type,
                      "for project:",
                      phdbTable
                    );

                    setActiveTableType(type); // triggers date + query lifecycle
                    // start global loader immediately for instant feedback
                    try {
                      setLoading?.(true);
                    } catch (e) {
                      // ignore if setLoading unavailable
                    }

                    await handleTableTypeSelect(type, phdbTable);
                  }}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* === Join Configuration Section (Collapsible) === */}
        {targetConfigs.length > 0 && (
          <div
            style={{
              marginTop: "1px",
              border: "1px #16a34a", // green accent
              borderRadius: "8px",
              background: "#f0fdf4", // light green background
              boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
            }}
          >
            {/* Header with + / − button on the left */}
            <div
              style={{
                color: "#065f46",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "6px 10px",
                borderBottom: "1px solid #bbf7d0",
              }}
            >
              <button
                onClick={() => setShowJoinConfig((prev) => !prev)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "#16a34a",
                  fontSize: "20px",
                  fontWeight: "bold",
                  cursor: "pointer",
                  lineHeight: 1,
                  padding: 0,
                  margin: 0,
                }}
                title={
                  showJoinConfig
                    ? "Hide Join Configuration"
                    : "Show Join Configuration"
                }
              >
                {showJoinConfig ? "−" : "+"}
              </button>

              <h4
                style={{
                  margin: 0,
                  fontSize: "14px",
                  fontWeight: 600,
                  letterSpacing: "0.3px",
                }}
              >
                Merged Tables
              </h4>
            </div>

            {/* Collapsible content */}
            {showJoinConfig && (
              <div style={{ padding: "10px 12px" }}>
                {targetConfigs.map((cfg, idx) => (
                  <div
                    key={idx}
                    style={{
                      borderTop: idx > 0 ? "1px solid #d1fae5" : "none",
                      paddingTop: idx > 0 ? "10px" : 0,
                      marginTop: idx > 0 ? "10px" : 0,
                    }}
                  >
                    {/* --- Source Table --- */}
                    <label>Source Table</label>
                    {renderDropdown(
                      `sourceTable-${idx}`,
                      [cfg.source_table || ""],
                      false,
                      cfg.source_table || "",
                      (val) => {
                        setTargetConfigs((prev) =>
                          prev.map((c, i) =>
                            i === idx ? { ...c, source_table: val } : c
                          )
                        );
                      }
                    )}

                    {/* --- Source Column --- */}
                    <label>Source Column</label>
                    {renderDropdown(
                      `sourceColumn-${idx}`,
                      columns || [],
                      false,
                      cfg.joinOn?.physical || "",
                      (val) => {
                        setTargetConfigs((prev) =>
                          prev.map((c, i) =>
                            i === idx
                              ? { ...c, joinOn: { ...c.joinOn, physical: val } }
                              : c
                          )
                        );
                      }
                    )}

                    {/* --- Target Table --- */}
                    <label>Target Table</label>
                    {renderDropdown(
                      `targetTable-${idx}`,
                      [cfg.table || ""],
                      false,
                      cfg.table || "",
                      (val) => {
                        setTargetConfigs((prev) =>
                          prev.map((c, i) =>
                            i === idx ? { ...c, table: val } : c
                          )
                        );
                      }
                    )}

                    {/* --- Target Column --- */}
                    <label>Target Column</label>
                    {renderDropdown(
                      `targetColumn-${idx}`,
                      cfg.columns || [],
                      false,
                      cfg.joinOn?.target || "",
                      (val) => {
                        setTargetConfigs((prev) =>
                          prev.map((c, i) =>
                            i === idx
                              ? { ...c, joinOn: { ...c.joinOn, target: val } }
                              : c
                          )
                        );
                      }
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        
        {/* === Layer/Color Column Selection === */}
        <label className="layer-label">Select Column for Layer/Color</label>

{renderDropdown(
  "layer",
  [
    ...new Set([
      ...(columns || []),
      ...(targetConfigs.flatMap((c) => c.columns) || []),
    ]),
  ],
  false,
  layerColumn,
  async (selected) => {
    setLayerColumn(selected);
    // Propagate selection to App so MapRenderer gets colorColumn prop
    setSelectedLayerColumn?.(selected);

    try {
      const mergedTableRaw =
        targetConfigs.length > 0
          ? targetConfigs[0].table
          : phdbTable || "";

      const mergedTable = mergedTableRaw;

      const res = await fetch(
        appendDateParams(
          `${getApiBaseUrl()}/column-range?table=${encodeURIComponent(
            mergedTable
          )}&column=${encodeURIComponent(selected)}`
        )
      );

      const { min, max } = await res.json();

      // NUMERIC
      if (typeof min === "number" && typeof max === "number") {
        setLayerRange({ min, max });

        const step = (max - min) / 3;
        const defaultBands = {
          green: [min, min + step],
          yellow: [min + step, min + 2 * step],
          red: [min + 2 * step, max],
        };

        setColorRanges((prev) => ({
          ...prev,
          [selected]: prev[selected] || defaultBands,
        }));
      }

      // CATEGORICAL
      else {
        setLayerRange({ min: null, max: null });

        const dRes = await fetch(
          appendDateParams(
            `${getApiBaseUrl()}/distinct-values/${encodeURIComponent(
              mergedTable
            )}?col=${encodeURIComponent(selected)}`
          )
        );

        const values = await dRes.json();

        const palette = [
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
        ];

        const categoricalBands = {};
        (values || []).forEach((val, i) => {
          categoricalBands[val] = palette[i % palette.length];
        });

        setColorRanges((prev) => ({
          ...prev,
          [selected]: categoricalBands,
        }));
      }
    } catch (err) {
      setLayerRange({ min: null, max: null });
    } finally {
      scheduleRefresh();
    }
  }
)}

{/* RANGE INFO */}
{layerColumn &&
  layerRange.min != null &&
  layerRange.max != null && (
    <div className="range-box">
      Range <strong>{layerColumn}</strong>:{" "}
      <span>
        {layerRange.min} – {layerRange.max}
      </span>
    </div>
  )}

{/* COLOR EDITOR */}
{layerColumn && colorRanges[layerColumn] && (
  <div className="color-editor">
    {Object.entries(colorRanges[layerColumn]).map(([key, val]) => {
      const isNumericBand = Array.isArray(val);
      const color = isNumericBand ? key : val;
      const min = isNumericBand ? val[0] : null;
      const max = isNumericBand ? val[1] : null;

      return (
        <div key={key} className="color-card">
          <div className="color-card-header">
            <div className="color-title">
              <div
                className="color-preview"
                style={{ backgroundColor: color }}
              />
              <span>{key}</span>
            </div>

            <button
              className="color-remove"
              onClick={() => {
                setColorRanges((prev) => {
                  const updated = { ...prev[layerColumn] };
                  delete updated[key];
                  return { ...prev, [layerColumn]: updated };
                });
                scheduleRefresh();
              }}
            >
              ✕
            </button>
          </div>

          <input
            type="color"
            value={color}
            className="color-picker"
            onChange={(e) => {
              const newColor = e.target.value;
              setColorRanges((prev) => {
                const updated = { ...prev[layerColumn] };
                if (isNumericBand) {
                  updated[newColor] = updated[key];
                  delete updated[key];
                } else {
                  updated[key] = newColor;
                }
                return { ...prev, [layerColumn]: updated };
              });
              scheduleRefresh();
            }}
          />

          {isNumericBand && (
            <div className="range-inputs">
              <input
                type="number"
                value={min ?? ""}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setColorRanges((prev) => ({
                    ...prev,
                    [layerColumn]: {
                      ...prev[layerColumn],
                      [key]: [v, max],
                    },
                  }));
                  scheduleRefresh();
                }}
              />
              <span>to</span>
              <input
                type="number"
                value={max ?? ""}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setColorRanges((prev) => ({
                    ...prev,
                    [layerColumn]: {
                      ...prev[layerColumn],
                      [key]: [min, v],
                    },
                  }));
                  scheduleRefresh();
                }}
              />
            </div>
          )}
        </div>
      );
    })}
  </div>
)}

        {/* === Select Band Column (Optional) === */}

        {/* <label>Select Band Column (Optional)</label>


        <div className="dropdown-wrapper" ref={bandDropdownRef}>
         
          <button
            type="button"
            className="input"
            onClick={() => setIsBandDropdownOpen((v) => !v)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              cursor: "pointer",
            }}
            aria-expanded={isBandDropdownOpen}
            aria-haspopup="listbox"
          >
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {Array.isArray(selectedBandCell) && selectedBandCell.length > 0
                ? `${selectedBandCell[0]}${
                    selectedBandCell.length > 1
                      ? ` (+${selectedBandCell.length - 1})`
                      : ""
                  }`
                : "Select Bands"}
            </span>
            <span aria-hidden>▾</span>
          </button>

        
          {isBandDropdownOpen && (
            <div
              className="dropdown-list"
              role="listbox"
              aria-multiselectable="true"
            >
              <input
                className="search-input"
                placeholder="Search band..."
                value={bandSearch ?? ""}
                onChange={(e) => setBandSearch(e.target.value)}
              />

              {(() => {
                // 🔹 Extract and deduplicate unique bands
                const uniqueBands = Array.from(
                  new Set(
                    (Array.isArray(bandCellOptions) ? bandCellOptions : [])
                      .map((b) => String(b.band || "").trim())
                      .filter((b) => b),
                  ),
                )
                  .sort((a, b) => {
                    // 🔹 Sort numerically descending by band (e.g., L21 > L18 > L08)
                    const numA = parseInt(a.replace(/\D/g, ""), 10) || 0;
                    const numB = parseInt(b.replace(/\D/g, ""), 10) || 0;
                    return numB - numA;
                  })
                  .filter((band) =>
                    band
                      .toLowerCase()
                      .includes(bandSearch.trim().toLowerCase()),
                  );

                return uniqueBands.length > 0 ? (
                  uniqueBands.map((band) => {
                    const isSelected =
                      Array.isArray(selectedBandCell) &&
                      selectedBandCell.includes(band);

                    return (
                      <div
                        key={band}
                        className={`dropdown-item ${isSelected ? "selected" : ""}`}
                        onClick={() => {
                          let next = Array.isArray(selectedBandCell)
                            ? [...selectedBandCell]
                            : [];

                          if (isSelected) {
                            next = next.filter((v) => v !== band);
                          } else {
                            next.push(band);
                          }

                          // Keep both synced
                          setSelectedBandCell(next);
                          setSelectedCellBand(next);

                          // Assign default color if new
                          setColorRanges((prev) => {
                            const updated = { ...prev };
                            if (isSelected) {
                              delete updated[band];
                            } else if (!updated[band]) {
                              updated[band] = "#ff0000";
                            }
                            return updated;
                          });

                          // 🔁 Auto-refresh map
                          scheduleRefresh();
                        }}
                        role="option"
                        aria-selected={isSelected}
                      >
                        <input
                          type="checkbox"
                          readOnly
                          checked={!!isSelected}
                          style={{ marginRight: 8 }}
                        />
                        {band}
                      </div>
                    );
                  })
                ) : (
                  <div className="dropdown-item disabled">
                    No bands available
                  </div>
                );
              })()}
            </div>
          )}
        </div>

   
        {Array.isArray(selectedBandCell) && selectedBandCell.length > 0 && (
          <div className="color-range-wrapper" style={{ marginTop: "10px" }}>
            {selectedBandCell.map((band) => (
              <div
                key={band}
                className="color-range-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                  marginBottom: "6px",
                }}
              >
               
                <label
                  style={{
                    flex: 1,
                    minWidth: 60,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {band}
                </label>

             
                <span
                  style={{
                    display: "inline-block",
                    width: 16,
                    height: 16,
                    backgroundColor: colorRanges[band] || "#ff0000",
                    borderRadius: 4,
                    border: "1px solid #ccc",
                    verticalAlign: "middle",
                    cursor: "pointer",
                  }}
                  title={`Preview: ${colorRanges[band] || "#ff0000"}`}
                />

              
                <input
                  type="color"
                  value={colorRanges[band] || "#ff0000"}
                  onChange={(e) => {
                    const newColor = e.target.value;
                    setColorRanges((prev) => ({
                      ...prev,
                      [band]: newColor,
                    }));
                    scheduleRefresh(); // 🔁 Auto-refresh polygons
                  }}
                  style={{
                    width: 40,
                    height: 26,
                    padding: 0,
                    border: "1px solid #ccc",
                    borderRadius: 4,
                    cursor: "pointer",
                  }}
                />

           
                <button
                  className="btn-remove"
                  title="Remove band"
                  onClick={() => {
                    setSelectedBandCell((prev) =>
                      prev.filter((b) => b !== band),
                    );
                    setSelectedCellBand((prev) =>
                      prev.filter((b) => b !== band),
                    );
                    setColorRanges((prev) => {
                      const updated = { ...prev };
                      delete updated[band];
                      return updated;
                    });
                    scheduleRefresh();
                  }}
                >
                  ❌
                </button>
              </div>
            ))}
          </div>
        )} */}

        {/* === Filter Button (Band + Multi Column) === */}
<div style={{ marginTop: "12px", position: "relative" }}>
  <button
    type="button"
    className="btn-filter"
    onClick={() => {
      const newState = !isFilterOpen;
      setIsFilterOpen(newState);

      if (newState) {
        // Initialize one filter row if empty
        if (filters.length === 0) {
          setFilters([{ column: "", values: [] }]);
        }

        // ✅ MERGE source + target columns (NO API CALL)
        const sourceCols = Array.isArray(columns) ? columns : [];
        const targetCols = Array.isArray(targetConfigs)
          ? targetConfigs.flatMap((c) => c.columns || [])
          : [];

        const mergedCols = Array.from(
          new Set([...sourceCols, ...targetCols])
        ).sort((a, b) => a.localeCompare(b));

        setAvailableColumns(mergedCols);
      }
    }}
    style={{
      color: "#000",
      marginTop: "6px",
      padding: "6px 14px",
      borderRadius: "20px",
      border: "1px solid #ccc",
      background: "#f9f9f9",
      cursor: "pointer",
      fontWeight: "bold",
    }}
  >
    Filter ▾
  </button>

  {isFilterOpen && (
    <div
      style={{
        color: "#000",
        position: "absolute",
        top: "100%",
        left: 0,
        width: "320px",
        marginTop: "6px",
        border: "1px solid #ccc",
        borderRadius: "8px",
        background: "#fff",
        padding: "12px",
        zIndex: 2000,
      }}
    >
      {/* === Band Multi-Select === */}
      <div style={{ marginBottom: "16px" }}>
        <label style={{ fontWeight: "bold" }}>Filter by Band</label>
        <input
          type="text"
          placeholder="Search band..."
          value={searchBand || ""}
          onChange={(e) => setSearchBand(e.target.value)}
          style={{
            width: "100%",
            padding: "6px",
            marginTop: "6px",
            marginBottom: "4px",
            borderRadius: "4px",
            border: "1px solid #ccc",
          }}
        />

        <div
          style={{
            maxHeight: "150px",
            overflowY: "auto",
            border: "1px solid #ccc",
            borderRadius: "6px",
            padding: "4px",
          }}
        >
          {Array.from(new Set((bandCellOptions || []).map((b) => b.band)))
            .filter(Boolean)
            .filter((band) =>
              band.toLowerCase().includes((searchBand || "").toLowerCase())
            )
            .sort((a, b) => {
              const numA = parseInt(String(a).replace(/\D/g, ""), 10) || 0;
              const numB = parseInt(String(b).replace(/\D/g, ""), 10) || 0;
              return numB - numA;
            })
            .map((band) => {
              const checked = selectedUniqueBands?.includes(band);
              return (
                <div
                  key={band}
                  style={{ display: "flex", alignItems: "center", cursor: "pointer" }}
                  onClick={() => {
                    const newBands = checked
                      ? selectedUniqueBands.filter((b) => b !== band)
                      : [...(selectedUniqueBands || []), band];
                    setSelectedUniqueBands(newBands);
                    window.applyBandFilter?.(newBands);
                  }}
                >
                  <input type="checkbox" checked={checked} readOnly />
                  <span style={{ marginLeft: 6 }}>{band}</span>
                </div>
              );
            })}
        </div>
      </div>

      {/* === Column Filters === */}
      {filters.map((filter, idx) => (
        <div
          key={idx}
          style={{
            marginBottom: "14px",
            borderBottom: "1px dashed #ddd",
            paddingBottom: "10px",
          }}
        >
          {/* Column + Remove */}
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>

            <select
              value={filter.column || ""}
              onChange={async (e) => {
                const col = e.target.value;
                if (!col) return;

                if (!availableValues[col]) {
                  try {
                    const encodedTable = encodeURIComponent(
                      targetConfigs[0]?.table || kpiSource.table || phdbTable
                    );
                    const apiUrl = appendDateParams(
                      `${getApiBaseUrl()}/distinct-values/${encodedTable}?col=${encodeURIComponent(
                        col
                      )}`
                    );

                    const res = await fetch(apiUrl);
                    const vals = await res.json();

                    setAvailableValues((prev) => ({
                      ...prev,
                      [col]: Array.isArray(vals) ? vals : [],
                    }));
                  } catch {
                    setAvailableValues((prev) => ({ ...prev, [col]: [] }));
                  }
                }

                const updated = [...filters];
                updated[idx] = { column: col, values: [] };
                setFilters(updated);
                setSelectedColumnValues({});
              }}
              style={{
                flex: 1,
                padding: "6px",
                borderRadius: "6px",
                border: "1px solid #ccc",
              }}
            >
              <option value="">Select column</option>
              {availableColumns.map((col) => (
                <option key={col} value={col}>
                  {col}
                </option>
              ))}
            </select>

            {/* ❌ REMOVE FILTER BUTTON */}
            <button
  title="Remove filter"
  onClick={() => {
    const updated = filters.filter((_, i) => i !== idx);
    setFilters(updated);

    const newSelected = {};
    updated.forEach((f) => {
      if (f.column && f.values.length) {
        newSelected[f.column] = f.values;
      }
    });
    setSelectedColumnValues(newSelected);
  }}
  style={{
    width: "26px",          // ✅ FIX
    minWidth: "26px",       // ✅ FIX
    height: "26px",         // ✅ FIX
    display: "flex",        // ✅ FIX
    alignItems: "center",   // ✅ FIX
    justifyContent: "center", // ✅ FIX
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontSize: "16px",
    color: "#d11a2a",
    padding: 0,             // ✅ FIX
    flexShrink: 0           // ✅ FIX (important)
  }}
>
  ❌
</button>

          </div>

          {/* Values */}
          {filter.column &&
            Array.isArray(availableValues[filter.column]) && (
              <div
                style={{
                  marginTop: "6px",
                  maxHeight: "120px",
                  overflowY: "auto",
                  border: "1px solid #ccc",
                  borderRadius: "6px",
                  padding: "4px",
                }}
              >
                {availableValues[filter.column].map((val) => {
                  const checked = filter.values.includes(val);
                  return (
                    <div
                      key={val}
                      style={{ display: "flex", cursor: "pointer" }}
                      onClick={() => {
                        const updated = [...filters];
                        const newVals = checked
                          ? filter.values.filter((v) => v !== val)
                          : [...filter.values, val];
                        updated[idx] = { ...filter, values: newVals };
                        setFilters(updated);

                        const map = {};
                        updated.forEach((f) => {
                          if (f.column && f.values.length) {
                            map[f.column] = f.values;
                          }
                        });
                        setSelectedColumnValues(map);
                      }}
                    >
                      <input type="checkbox" checked={checked} readOnly />
                      <span style={{ marginLeft: 6 }}>{val}</span>
                    </div>
                  );
                })}
              </div>
            )}
        </div>
      ))}

      {/* === Add Filter Row === */}
      <button
        type="button"
        onClick={() => setFilters([...filters, { column: "", values: [] }])}
        style={{
          width: "100%",
          padding: "6px",
          borderRadius: "6px",
          background: "#1e6e03",
          color: "#fff",
          border: "none",
          fontWeight: "bold",
          cursor: "pointer",
        }}
      >
        + Add Filter
      </button>
    </div>
  )}
</div>

        {/* === Optional: Watch all filters for debugging === */}


        {/* <label>Select KPI to Display</label> */}
        {/* {renderDropdown('kpi', columns, false, kpiColumn, setKpiColumn)} */}
        <label>Save Template</label>
        <input
          type="text"
          className="input"
          placeholder="Template name"
          value={templateName ?? ""}
          onChange={(e) => setTemplateName(e.target.value)}
        />
        <button
          className="btn"
          onClick={handleSaveTemplate}
          disabled={!templateName}
        >
          Save
        </button>

        <label>Export Options</label>
        <div className="button-row"></div>
        <button className="btn btn-outline" onClick={handleExportCSV}>
          Export as CSV
        </button>
        <button className="btn btn-outline" onClick={handleExportKML}>
          Export as KML
        </button>
        <button className="btn-primary" onClick={handleGenerate}>
          Generate Map
        </button>
      </div>
      {/* === Sector Radius Scale === */}
      <div className="sidebar-section">
        <label htmlFor="radiusScale">Sector Radius Scale</label>
        <input
          id="radiusScale"
          type="range"
          min="0.05"
          max="2"
          step="0.1"
          value={radiusScale}
          onChange={(e) => {
            const value = parseFloat(e.target.value);
            setRadiusScale(value);
            onRadiusScaleChange(value);
          }}
        />
        <span>{radiusScale.toFixed(1)}x</span>
      </div>
    </div>
  );
};

export default Sidebar;
