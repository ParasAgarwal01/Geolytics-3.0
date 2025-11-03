import React, { useState, useEffect, useRef } from 'react';
import './Styles.css';
import KPIGridUploader from './KPIGridUploader';

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
  let base = import.meta.env.VITE_API_URL || "";
  base = base.replace(/\/+$/, ""); // remove trailing slashes
  if (!/\/geo-?api$/i.test(base)) base += "/geo-api"; // ensure /geo-api suffix
  return base;
}


const LEGEND_TYPES = [
  { value: 'kpi', label: 'KPI Heatmap' },
  { value: 'band', label: 'Band Colors' },
  { value: 'sector', label: 'Sector Colors' },
  { value: 'driveTest', label: 'Drive Test KPI' }
];






function getColorForValue(value, colorBands) {
  for (const { color, from, to } of colorBands) {
    if (value >= from && value <= to) return color;
  }
  return '#cccccc'; // Default gray
}
let warned = false;
let missingColorKeysLogged = new Set();

function generateSectorGeoJSON(features, colorColumn, colorBands) {
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
    '#ff0000': 'red',
    '#00ff00': 'lime',
    '#0000ff': 'blue',
    '#ffff00': 'yellow',
    '#ff00ff': 'magenta',
    '#00ffff': 'cyan',
    '#ffffff': 'white',
    '#000000': 'black',
    '#808080': 'gray',
    '#800000': 'maroon',
    '#008000': 'green',
    '#000080': 'navy',
    '#ffa500': 'orange',
    '#a52a2a': 'brown',
    '#800080': 'purple',
    '#ffc0cb': 'pink',
    '#808000': 'olive',
    '#f0e68c': 'khaki',
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

  driveLayerRange,
   setDriveLayerRange,
  // Data & map generation
  onGenerateMap,
  geoJsonData,
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
  
}) => {

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
const [radiusScale, setRadiusScale] = useState(1);

const [gridMapGeoJSON, setGridMapGeoJSON] = useState(null);


const [filters, setFilters] = useState([]);
  const [searchTexts, setSearchTexts] = useState({});
  const [layerRange, setLayerRange] = useState({ min: null, max: null });
  const [newColorHex, setNewColorHex] = useState('#663399');
  const [newColorMin, setNewColorMin] = useState(layerRange.min || 0);
  const [newColorMax, setNewColorMax] = useState(layerRange.max || 0);
  const [bandRange, setBandRange] = useState({ min: null, max: null }); 
  const [kpiSource, setKpiSource] = useState({ type: null, table: null });
  const [searchBand, setSearchBand] = useState("");
const [searchTerms, setSearchTerms] = useState({});

  const [availableTableTypes, setAvailableTableTypes] = useState([]);


  // === Band dropdown UI state (UI only, doesn't change your data flow) ===
const [isBandDropdownOpen, setIsBandDropdownOpen] = useState(false);
const [bandSearch, setBandSearch] = useState('');
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
  const [phdbTable, setPhdbTable] = useState('');
  const [requiredCols, setRequiredCols] = useState({
    site_id: ['Site_ID' ,'D2EL02'],
    cellname: ['Cell_name' ,'D2EL01'],
    lat: 'Lat',
    lon: 'Long',
    azimuth: 'Azimuth'
  });
  const [popupColumns, setPopupColumns] = useState([]);
  const [layerColumn, setLayerColumn] = useState('');
  
  const [bandColumn, setBandColumn] = useState('');
  // const [kpiColumn, setKpiColumn] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [savedTemplates, setSavedTemplates] = useState([]);
  const [loadFilterTemplate, setLoadFilterTemplate] = useState('');
  const [showDropdowns, setShowDropdowns] = useState({});
  const dropdownRefs = useRef({});
  const [driveTestColumns, setDriveTestColumns] = useState([]);
  const [kpiProgress, setKpiProgress] = useState(0);
const [fetchingKPI, setFetchingKPI] = useState(false);

const [fetchingGridKPI, setFetchingGridKPI] = useState(false);
const [gridKpiProgress, setGridKpiProgress] = useState(0);




const handleTableTypeSelect = async (type, projectName) => {
  try {
    const safeType = type.replace("’", "'").trim();
    const url = `${getApiBaseUrl()}/projects/${encodeURIComponent(
      projectName
    )}/config?table_type=${encodeURIComponent(safeType)}`;

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
      console.warn("⚠️ No configs found for:", projectName, safeType, configs);
      return;
    }

    // ✅ Use the first config row
    const cfg = configArray[0];
    console.log("⚙️ Using config row:", cfg);

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

    // === Auto fetch joined data (GeoJSON etc.) ===
    const queryUrl = `${getApiBaseUrl()}/query?project=${encodeURIComponent(
      cfg.project_name
    )}&table_type=${encodeURIComponent(
      cfg.table_type.replace("’", "'").trim()
    )}`;

    console.log("▶️ Auto-fetching polygons:", queryUrl);
    const qRes = await fetch(queryUrl);
    if (!qRes.ok) throw new Error(`Query failed: ${qRes.status}`);

    const qData = await qRes.json();
    console.log("📦 Query response (summary):", {
      features: qData.features?.length,
      bands: qData.bands?.length,
      available_kpis: qData.available_kpis?.length,
    });

    // ✅ Log sample of features
    if (qData?.features?.length > 0) {
      qData.features.slice(0, 5).forEach((f, i) => {
        console.log(`Feature ${i + 1}:`, f.properties);
      });
    } else {
      console.warn("⚠️ No features returned in query response");
    }

    // ✅ Send map data to App.jsx
    if (qData?.features) {
  console.log("🚀 Sending data to App.jsx -> onGenerateMap()");

  // ✅ Inject active table type and project name into payload
  const enrichedData = {
    ...qData,
    table_type: safeType || cfg.table_type || "KPI's",
    project_name: cfg.project_name || projectName,
  };

  onGenerateMap(enrichedData);
}


    // ✅ Populate band/KPI options
    if (Array.isArray(qData.bands)) {
      console.log("🎨 Available bands:", qData.bands);
      setBandCellOptions(qData.bands.map((band) => ({ band, cellname: band })));
    }

    if (Array.isArray(qData.available_kpis)) {
      console.log("📊 KPI columns:", qData.available_kpis);
      setGridKPIColumns(qData.available_kpis);
    }

    setKpiSource({ type: "query", table: type });
  } catch (err) {
    console.error("❌ TableType select failed:", err);
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
    const res = await fetch(`${import.meta.env.VITE_API_URL}/upload-grid-map`, {
      method: "POST",
      body: formData,
    });

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
    alert("Grid map upload failed. Please check the file format or backend logs.");
  } finally {
    clearInterval(interval);
    setGridKpiProgress(100);
    setTimeout(() => {
      setFetchingGridKPI(false);
      setGridKpiProgress(0);
    }, 500);
  }
};



  
  
const [localSelectedGridKPI, setLocalSelectedGridKPI] = React.useState(selectedGridKPI ?? null);
const [addingColor, setAddingColor] = useState(false);
const [newColorName, setNewColorName] = useState('');
const bandSortOrder = (band) => {
  const numericPart = parseInt(band.replace(/[^\d]/g, '')); // L21 -> 21
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
    `${import.meta.env.VITE_API_URL}/grid-map/from-table?table=${encodeURIComponent(
      chosen
    )}`
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

  fetch(`${import.meta.env.VITE_API_URL}/bands/${encodeURIComponent(phdbTable)}`)
    .then(res => res.json())
    .then(data => {
      if (Array.isArray(data)) {
        // expects array of { band: "1800", cellname: "Cell_A" }
        setBandCellOptions(data);
      } else {
        setBandCellOptions([]);
      }
    })
    .catch(err => {
      console.error("❌ Failed fetching bands:", err);
      setBandCellOptions([]);
    });
}, [phdbTable]);
useEffect(() => {
  window.selectedColumnValues = selectedColumnValues;
  window.refreshLayerMap?.();  // re-render map whenever column filters change
}, [selectedColumnValues]);

useEffect(() => {
  const onDocClick = (e) => {
    if (bandDropdownRef.current && !bandDropdownRef.current.contains(e.target)) {
      setIsBandDropdownOpen(false);
    }
  };
  document.addEventListener('mousedown', onDocClick);
  return () => document.removeEventListener('mousedown', onDocClick);
}, []);



useEffect(() => {
  if (!selectedDriveKPI || !colorRanges[selectedDriveKPI]) return;

  // Notify parent that config changed
  onDriveTestUpload?.(driveTestFile, selectedDriveKPI, {
    colorRanges,
    driveLayerRange
  });

  // Optional: if still needed
  window.refreshDriveTestLayer?.();
}, [selectedDriveKPI, colorRanges, driveLayerRange]);

// When bandCellOptions change, extract unique bands
useEffect(() => {
  if (bandCellOptions && bandCellOptions.length > 0) {
    const bands = [...new Set(bandCellOptions.map(opt => opt.band))];
    setUniqueBands(bands);
    
  }
}, [bandCellOptions]);
// Toggle dropdown
const toggleUniqueBandDropdown = () => {
  
  setShowUniqueBandDropdown(prev => !prev);
  
};

// Handle band selection
const handleBandSelection = (band) => {
  setSelectedBands(prev =>
    prev.includes(band) ? prev.filter(b => b !== band) : [...prev, band]
  );
};


useEffect(() => {
  if (geoJsonData && Array.isArray(geoJsonData.features) && selectedBandColumn) {
    const opts = geoJsonData.features.map(f => {
      const props = f.properties || {};
      const bandRaw = props[selectedBandColumn] ?? props.BAND ?? props.band ?? props.Band;
      const band = normalizeBand(bandRaw);
      const cellname = props.cellname || props.Cell_name || props.CELLNAME || '';
      return { band, cellname };
    }).filter(o => o.band && o.cellname);

    setBandCellOptions(opts);
  }
}, [geoJsonData, selectedBandColumn]);


  useEffect(() => {
  if (layerColumn) {
    setSelectedLayerColumn(layerColumn);
  }
}, [layerColumn]);


useEffect(() => {
  // Auto-refresh polygons when colorRanges or layerColumn change
  if (layerColumn && window.refreshLayerMap) {
    console.log("🎨 Auto-refreshing map for color update...");
    window.refreshLayerMap();
  }
}, [colorRanges, layerColumn]);

  // Fetch tables and templates on mount
  // ✅ NEW (fetching /projects instead of /tables)
useEffect(() => {
  if (!selectedDatabase) {
    console.log("⏸️ No database selected yet, skipping project fetch...");
    return;
  }

  console.log(`📡 Fetching projects for selected database: ${selectedDatabase}`);

  // --- Fetch and filter projects ---
  fetch(`${import.meta.env.VITE_API_URL}/projects`)
    .then((res) => res.json())
    .then((projects) => {
      console.log("📌 All projects fetched:", projects);

      // 🔍 Filter projects belonging to the selected database
      const filteredProjects = projects.filter((p) =>
        p.toUpperCase().startsWith(selectedDatabase.toUpperCase())
      );

      console.log(`📦 Filtered projects for ${selectedDatabase}:`, filteredProjects);

      setTables(filteredProjects); // update dropdown options

      // ✅ Auto-select first project if available
      if (filteredProjects.length > 0) {
        setPhdbTable(filteredProjects[0]);
        setSelectedProject(filteredProjects[0]);
      } else {
        setPhdbTable("");
        setSelectedProject(null);
      }
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
    `${import.meta.env.VITE_API_URL}/projects/${encodeURIComponent(phdbTable)}/config?table_type=${encodeURIComponent(kpiSource.table)}`
  )
    .then(res => res.json())
    .then(configs => {
      if (!Array.isArray(configs) || configs.length === 0) return;
      const { source_table } = configs[0];

      // now fetch columns for that source table
      return fetch(`${import.meta.env.VITE_API_URL}/columns/${encodeURIComponent(source_table)}`)
        .then(res => res.json())
        .then(fetchedCols => {
          if (!Array.isArray(fetchedCols)) return;

          setColumns(fetchedCols);
          setRequiredCols({
            site_id: fetchedCols.includes('Site_ID')
              ? 'Site_ID'
              : fetchedCols.includes('D2EL02')
              ? 'D2EL02'
              : '',
            cellname: fetchedCols.includes('Cell_name')
              ? 'Cell_name'
              : fetchedCols.includes('D2EL01')
              ? 'D2EL01'
              : '',
            lat: fetchedCols.includes('Lat') ? 'Lat' : '',
            lon: fetchedCols.includes('Long') ? 'Long' : '',
            azimuth: fetchedCols.includes('Azimuth') ? 'Azimuth' : '',
          });
        });
    })
    .catch(err => {
      console.error("❌ Failed fetching config/columns:", err);
    });
}, [phdbTable, kpiSource.table]);

  // Fetch columns for target tables
  // Fetch columns for target tables (preserving selectedCols and joinOn)
useEffect(() => {
  Promise.all(
    targetTables.map((table) =>
      fetch(`${import.meta.env.VITE_API_URL}/columns/${table}`)
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
          joinOn: existing?.joinOn || { physical: '', target: '' },
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
          setShowDropdowns(prev => ({ ...prev, [key]: false }));
        }
      });
    }
    document.addEventListener('mousedown', handleDocumentClick);
    return () => document.removeEventListener('mousedown', handleDocumentClick);
  }, [showDropdowns]);

  // Save filter template
  const handleSaveTemplate = () => {
    const template = {
      name: templateName,
      config: {
        phdbTable, requiredCols, popupColumns,
        target_joins: targetConfigs.map(cfg => ({
          table: cfg.table, target_columns: cfg.selectedCols, join_on: cfg.joinOn
        })),
        layerColumn, bandColumn, kpiColumn,
      }
    };
    fetch(`${import.meta.env.VITE_API_URL}/save-template`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(template),
    })
      .then(res => res.json())
      .then(() => {
        alert('Template saved!');
        setTemplateName('');
        return fetch(`${import.meta.env.VITE_API_URL}/templates`);
      })
      .then(res => res.json())
      .then(setSavedTemplates)
      .catch(() => alert('Failed to save template.'));
  };


  // 🎨 Whenever color ranges or layerColumn change, push updated coloring to map
useEffect(() => {
  if (!geoJsonData || !layerColumn || !colorRanges[layerColumn]) return;

  const colorBands = Object.entries(colorRanges[layerColumn]).map(([color, [from, to]]) => ({
    color,
    from,
    to
  }));

  // Reapply fillColor dynamically
  const updatedFeatures = geoJsonData.features.map(f => {
    const val = parseFloat(f.properties?.[layerColumn]);
    if (!isNaN(val)) {
      const band = colorBands.find(b => val >= b.from && val <= b.to);
      f.properties.fillColor = band ? band.color : '#cccccc';
    }
    return f;
  });

  const updatedGeoJson = { ...geoJsonData, features: updatedFeatures };

  window.refreshLayerMap?.(updatedGeoJson); // OR if you manage it via prop:
  // onGenerateMap({ ...payload, geojsonData: updatedGeoJson });
}, [colorRanges, layerColumn]);


  // Load a saved filter template
  const handleLoadTemplate = () => {
    if (!loadFilterTemplate) return;
    fetch(`${import.meta.env.VITE_API_URL}/template/${loadFilterTemplate}`)
      .then(res => res.json())
      .then(data => {
        const config = data.config;
        setPhdbTable(config.phdbTable);
        setRequiredCols(config.requiredCols);
        setPopupColumns(config.popupColumns || []);
        setTargetConfigs((config.target_joins || []).map(join => ({
          table: join.table, columns: [], selectedCols: join.target_columns || [], joinOn: join.join_on || { physical: '', target: '' },
        })));
        setLayerColumn(config.layerColumn || '');
        setBandColumn(config.bandColumn || '');
        setKpiColumn(config.kpiColumn || '');
      });
  };

  // Generate map payload and call parent handler
  const handleGenerate = () => {
  const payload = {
  physical_table: phdbTable,
  physical_columns: requiredCols,
  physical_extra_cols: [
    ...popupColumns,
    ...(layerColumn ? [layerColumn] : [])
  ],
  target_joins: targetConfigs.map(cfg => ({
    table: cfg.table,
    target_columns: cfg.selectedCols,
    join_on: cfg.joinOn,
  })),
  ...(layerColumn && { layerColumn }),
  ...(bandColumn && { bandColumn }),
  ...(kpiColumn && { kpiColumn }),
  ...(layerColumn && {
    colorRanges: Object.entries(colorRanges[layerColumn] || {}).map(([color, [from, to]]) => ({
      color, from, to
    }))
  })
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
      console.warn(`⚠️ renderDropdown[${key}] received object instead of array:`, options);
      safeOptions = Object.values(options)
        .flat()
        .filter((v) => typeof v === "string");
    }
  } else if (typeof options === "string") {
    safeOptions = [options];
  } else if (options == null) {
    safeOptions = [];
  } else {
    console.warn(`⚠️ renderDropdown[${key}] received invalid options type:`, typeof options, options);
  }

  const filteredOptions = safeOptions.filter((opt) =>
    String(opt).toLowerCase().includes(searchText.toLowerCase())
  );

  return (
    <div className="dropdown-wrapper" ref={(el) => (dropdownRefs.current[key] = el)}>
      <input
        className="input"
        readOnly
        value={
          multiple
            ? Array.isArray(value) && value.length
              ? value.join(", ")
              : ""
            : value
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
          {filteredOptions.map((option, i) => (
            <div
              key={i}
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


{/* === KPI Grid Uploader === */}
<div className="sidebar-section">
  <h3>Grid Heatmap</h3>
   <KPIGridUploader onGridData={setGridData} />
</div>


  // === Drive Test Upload Handler ===
  const handleDriveTestFileChange = async (e) => {
    const file = e.target.files[0];
    setDriveTestFile(file);
    if (!file) return;

    setFetchingKPI(true);
    setKpiProgress(0);

    const interval = setInterval(() => {
      setKpiProgress(prev => (prev < 95 ? prev + 5 : prev));
    }, 100);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/upload-drive-test`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error(`Error: ${response.status}`);
      const result = await response.json();

      // ✅ Extract and store all columns
      if (result.available_kpis?.length) setDriveTestColumns(result.available_kpis);

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
            `${import.meta.env.VITE_API_URL}/drive-test/column-range?column=${encodeURIComponent(defaultKPI)}`
          );
          const range = await res.json();
          if (range.min != null && range.max != null) setDriveLayerRange({ min: range.min, max: range.max });
        } catch (err) {
          console.error("❌ Failed to fetch drive test column range", err);
        }
      }

      // Notify parent
      if (onDriveTestUpload) onDriveTestUpload(file, result.available_kpis?.[0] || selectedDriveKPI);
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
      setKpiProgress(prev => (prev < 95 ? prev + 5 : prev));
    }, 100);

    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/drive-test/column-range?column=${encodeURIComponent(kpi)}`
      );
      const range = await res.json();
      if (range.min != null && range.max != null) setDriveLayerRange({ min: range.min, max: range.max });
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
    if (driveTestFile && onDriveTestUpload) onDriveTestUpload(driveTestFile, kpi);
  };


  // Export CSV/KML handlers
  const handleExportCSV = () => {
    if (!geoJsonData || !geoJsonData.features) {
      alert("No GeoJSON data available.");
      return;
    }
    const headers = Object.keys(geoJsonData.features[0].properties);
    const csvRows = [
      headers.join(","),
      ...geoJsonData.features.map((f) =>
        headers.map((h) => JSON.stringify(f.properties[h] ?? "")).join(",")
      ),
    ];
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "data.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportKML = () => {
    if (!geoJsonData || !geoJsonData.features) {
      alert("No GeoJSON data available.");
      return;
    }
    const kmlHeader = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>`;
    const kmlFooter = `</Document></kml>`;
    const placemarks = geoJsonData.features
      .map((f) => {
        const { geometry, properties } = f;
        if (geometry.type !== "Point") return "";
        const [lon, lat] = geometry.coordinates;
        const name = properties["Site_ID"] || "Point";
        return `<Placemark><name>${name}</name><Point><coordinates>${lon},${lat},0</coordinates></Point></Placemark>`;
      })
      .join("");
    const kmlContent = `${kmlHeader}${placemarks}${kmlFooter}`;
    const blob = new Blob([kmlContent], {
      type: "application/vnd.google-earth.kml+xml",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "data.kml";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="left-panel">
      <div className="sidebar-scroll">
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
        {renderDropdown('loadFilterTemplate', savedTemplates, false, loadFilterTemplate, setLoadFilterTemplate)}
        <button className="btn" onClick={handleLoadTemplate}>Load Template</button>



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

      if (val) {
        try {
          const url = `${getApiBaseUrl()}/projects/${encodeURIComponent(val)}/types`;
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
    <div style={{ display: "flex", gap: "10px", marginTop: "6px" }}>
      {availableTableTypes.map((type) => (
        <button
          key={type}
          className={`btn ${type === kpiSource.table ? "btn-primary" : "btn-outline"}`}
          onClick={() => {
            console.log("▶️ Table type clicked:", type, "for project:", phdbTable);
            handleTableTypeSelect(type, phdbTable);
          }}
        >
          {type}
        </button>
      ))}
    </div>
  </div>
)}

{/* === Join Configuration Section === */}
{targetConfigs.length > 0 && (
  <div
    style={{
      marginTop: "16px",
      padding: "12px",
      border: "1px solid #ccc",
      borderRadius: "8px",
      background: "#fafafa",
    }}
  >
    <h4 style={{ marginBottom: "8px" }}>Join Configuration</h4>

    {targetConfigs.map((cfg, idx) => (
      <div
        key={idx}
        style={{
          borderTop: idx > 0 ? "1px solid #ddd" : "none",
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
            console.log("🔄 Source Table changed:", val);
            setTargetConfigs((prev) =>
              prev.map((c, i) => (i === idx ? { ...c, source_table: val } : c))
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
            console.log("🔄 Source Column changed:", val);
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
            console.log("🔄 Target Table changed:", val);
            setTargetConfigs((prev) =>
              prev.map((c, i) => (i === idx ? { ...c, table: val } : c))
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
            console.log("🔄 Target Column changed:", val);
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




{/* === Layer/Color Column Selection === */}
<label>Select Column for Layer/Color</label>
{renderDropdown(
  'layer',
  [
    ...new Set([
      ...(columns || []),
      ...(targetConfigs.flatMap(c => c.columns) || []),
    ])
  ],
  false,
  layerColumn,
  async (selected) => {
  setLayerColumn(selected);

  try {
    // 🔹 Build merged table name dynamically (source + target)
    // Example: source_table + "_" + target_table
    const mergedTableRaw =
  targetConfigs.length > 0
    ? targetConfigs[0].table
    : phdbTable || "";

const mergedTable = projectMap[mergedTableRaw] || mergedTableRaw;  // ✅ Map friendly → backend-safe

console.log("🔍 Fetching column range from merged table:", mergedTable);

const res = await fetch(
  `${import.meta.env.VITE_API_URL}/column-range?table=${encodeURIComponent(
    mergedTable
  )}&column=${encodeURIComponent(selected)}`
);


    const { min, max, error } = await res.json();

    if (error) {
      console.warn("⚠️ Column range fetch warning:", error);
      setLayerRange({ min: null, max: null });
      return;
    }

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
    } else {
      setLayerRange({ min: null, max: null });
    }
  } catch (err) {
    console.error("❌ Failed to fetch column range:", err);
    setLayerRange({ min: null, max: null });
  } finally {
    // 🔁 Force map refresh after range update
    window.refreshLayerMap?.();
  }
})}

{layerColumn && layerRange.min != null && layerRange.max != null && (
  <p className="range-info">
    Range <strong>{layerColumn}</strong>:{" "}
    <span>{layerRange.min} – {layerRange.max}</span>
  </p>
)}

{layerColumn && colorRanges[layerColumn] && (
  <div className="color-range-wrapper" style={{ marginTop: 10 }}>
    {Object.entries(colorRanges[layerColumn]).map(([color, [min, max]]) => (
      <div
        key={color}
        className="color-range-row"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          marginBottom: "6px",
          flexWrap: "wrap",
        }}
      >
        <label
          style={{
            minWidth: 70,
            fontWeight: "bold",
            textTransform: "capitalize",
          }}
        >
          {color}:
          <span
            style={{
              display: "inline-block",
              width: 18,
              height: 18,
              backgroundColor: color,
              borderRadius: 4,
              marginLeft: 8,
              border: "1px solid #999",
              verticalAlign: "middle",
            }}
            title={color}
          />
        </label>

        {/* Min */}
        <input
          type="number"
          className="input"
          step="any"
          placeholder="Min"
          value={
            typeof min === "number"
              ? parseFloat(min.toFixed(2))
              : min || ""
          }
          onChange={(e) => {
            const val = e.target.value === "" ? "" : Number(e.target.value);
            setColorRanges((prev) => ({
              ...prev,
              [layerColumn]: {
                ...prev[layerColumn],
                [color]: [val, max],
              },
            }));
            window.refreshLayerMap?.();
          }}
          style={{
            width: 190,
            padding: "4px 0px",
            textAlign: "right",
            fontSize: 12,
          }}
        />

        <span style={{ fontWeight: 600 }}>to</span>

        {/* Max */}
        <input
          type="number"
          className="input"
          step="any"
          placeholder="Max"
          value={
            typeof max === "number"
              ? parseFloat(max.toFixed(2))
              : max || ""
          }
          onChange={(e) => {
            const val = e.target.value === "" ? "" : Number(e.target.value);
            setColorRanges((prev) => ({
              ...prev,
              [layerColumn]: {
                ...prev[layerColumn],
                [color]: [min, val],
              },
            }));
            window.refreshLayerMap?.();
          }}
          style={{
            width: 190,
            padding: "4px 0px",
            textAlign: "right",
            fontSize: 12,
          }}
        />

        {/* Remove Button */}
        <button
          className="btn-remove"
          title="Remove color band"
          onClick={() => {
            setColorRanges((prev) => {
              const updated = { ...prev[layerColumn] };
              delete updated[color];
              return { ...prev, [layerColumn]: updated };
            });
            window.refreshLayerMap?.();
          }}
          style={{
            border: "none",
            background: "none",
            cursor: "pointer",
            fontSize: 18,
            color: "#d33",
          }}
        >
          ❌
        </button>
      </div>
    ))}

    {/* === Add New Color Band === */}
    {!addingColor ? (
      <button
        className="btn-add"
        style={{
          marginTop: 10,
          background: "#e8f4ff",
          border: "1px solid #007acc",
          color: "#007acc",
          fontWeight: 600,
        }}
        onClick={() => {
          setAddingColor(true);
          setNewColorName("");
          setNewColorHex("#ff0000");
          setNewColorMin(layerRange.min ?? 0);
          setNewColorMax(layerRange.max ?? 0);
        }}
      >
        + Add Color Band
      </button>
    ) : (
      <div
        className="color-range-add-form"
        style={{
          display: "flex",
          gap: "8px",
          alignItems: "center",
          marginTop: 8,
          flexWrap: "wrap",
        }}
      >
        <input
          type="text"
          placeholder="Color name"
          value={newColorName ?? ""}
          onChange={(e) => setNewColorName(e.target.value)}
          className="input"
          style={{ width: 120 }}
        />
        <input
          type="color"
          value={newColorHex ?? ""}
          onChange={(e) => setNewColorHex(e.target.value)}
          title="Pick color"
        />
        <input
          type="number"
          step="any"
          placeholder="Min"
          value={newColorMin ?? ""}
          onChange={(e) => setNewColorMin(e.target.value)}
          className="input"
          style={{ width: 80 }}
        />
        <input
          type="number"
          step="any"
          placeholder="Max"
          value={newColorMax ?? ""}
          onChange={(e) => setNewColorMax(e.target.value)}
          className="input"
          style={{ width: 80 }}
        />
        <button
          className="btn-add"
          onClick={() => {
            let name = newColorName.trim().toLowerCase();
            if (!name) name = getClosestColorName(newColorHex);
            if (colorRanges[layerColumn]?.[name]) {
              alert("Color already exists!");
              return;
            }
            if (Number(newColorMin) >= Number(newColorMax)) {
              alert("Min must be less than Max.");
              return;
            }

            setColorRanges((prev) => ({
              ...prev,
              [layerColumn]: {
                ...prev[layerColumn],
                [name]: [
                  Number(newColorMin),
                  Number(newColorMax),
                ],
              },
            }));
            setAddingColor(false);
            window.refreshLayerMap?.();
          }}
        >
          ✅ Add
        </button>
        <button
          className="btn-add"
          style={{
            padding: "4px 10px",
            fontSize: 13,
            color: "#c00",
          }}
          onClick={() => setAddingColor(false)}
        >
          ❌ Cancel
        </button>
      </div>
    )}
  </div>
)}


                
        

{/* === Select Band Column (Optional) === */}
<label>Select Band Column (Optional)</label>

<div className="dropdown-wrapper" ref={bandDropdownRef}>
  {/* Trigger bar */}
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

  {/* Dropdown list */}
  {isBandDropdownOpen && (
    <div className="dropdown-list" role="listbox" aria-multiselectable="true">
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
              .filter((b) => b)
          )
        )
          .sort((a, b) => {
            // 🔹 Sort numerically descending by band (e.g., L21 > L18 > L08)
            const numA = parseInt(a.replace(/\D/g, ""), 10) || 0;
            const numB = parseInt(b.replace(/\D/g, ""), 10) || 0;
            return numB - numA;
          })
          .filter((band) =>
            band.toLowerCase().includes(bandSearch.trim().toLowerCase())
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
                  window.refreshLayerMap?.();
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
          <div className="dropdown-item disabled">No bands available</div>
        );
      })()}
    </div>
  )}
</div>

{/* === Color pickers for selected bands === */}
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
        {/* Band name */}
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

        {/* Color preview box */}
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

        {/* Color Picker */}
        <input
          type="color"
          value={colorRanges[band] || "#ff0000"}
          onChange={(e) => {
            const newColor = e.target.value;
            setColorRanges((prev) => ({
              ...prev,
              [band]: newColor,
            }));
            window.refreshLayerMap?.(); // 🔁 Auto-refresh polygons
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

        {/* Remove Button */}
        <button
          className="btn-remove"
          title="Remove band"
          onClick={() => {
            setSelectedBandCell((prev) => prev.filter((b) => b !== band));
            setSelectedCellBand((prev) => prev.filter((b) => b !== band));
            setColorRanges((prev) => {
              const updated = { ...prev };
              delete updated[band];
              return updated;
            });
            window.refreshLayerMap?.();
          }}
        >
          ❌
        </button>
      </div>
    ))}
  </div>
)}


{/* === Filter Button (Band + Multi Column) === */}
<div style={{ marginTop: "12px", position: "relative" }}>
  <button
    type="button"
    className="btn-filter"
    onClick={async () => {
      const newState = !isFilterOpen;
      setIsFilterOpen(newState);

      if (newState) {
        if (filters.length === 0) {
          setFilters([{ column: "", values: [] }]); // start with 1 filter row
        }

        try {
          // ✅ Determine correct active table
          const activeTable =
            (targetConfigs.length > 0 && targetConfigs[0].table) ||
            kpiSource.table ||
            phdbTable;

          if (!activeTable) throw new Error("No active table selected");

          const url = `${getApiBaseUrl()}/columns/${encodeURIComponent(activeTable)}`;
          console.log("📡 Fetching columns from:", url);

          const res = await fetch(url);
          if (!res.ok) throw new Error(`Failed to fetch columns: ${res.status}`);
          let cols = await res.json();

          // ✅ Ensure array format
          if (!Array.isArray(cols)) cols = [];

          // ✅ Add fallback important columns
          const fallbackCols = ["city", "City", "region", "Region", "cluster", "Cluster"];
          fallbackCols.forEach((c) => {
            if (!cols.includes(c)) cols.push(c);
          });

          setAvailableColumns(cols);
        } catch (err) {
          console.error("❌ Failed to fetch columns:", err);
          setAvailableColumns([" "]); // fallback
        }
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
      {/* === Band Multi-Select with Search === */}
      <div style={{ marginBottom: "16px" }}>
        <label style={{ fontWeight: "bold", color: "#000" }}>Filter by Band</label>
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
              const numA = parseInt(String(a || "").replace(/\D/g, ""), 10) || 0;
              const numB = parseInt(String(b || "").replace(/\D/g, ""), 10) || 0;
              return numB - numA;
            })
            .map((band) => {
              const checked = selectedUniqueBands?.includes(band);
              return (
                <div
                  key={band}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    cursor: "pointer",
                    padding: "4px 0",
                  }}
                  onClick={() => {
                    const newBands = checked
                      ? selectedUniqueBands.filter((b) => b !== band)
                      : [...(selectedUniqueBands || []), band];
                    setSelectedUniqueBands(newBands);
                    window.applyBandFilter?.(newBands);
                  }}
                >
                  <input type="checkbox" checked={checked} readOnly />
                  <span style={{ marginLeft: "6px" }}>{band}</span>
                </div>
              );
            })}
        </div>
      </div>

      {/* === Column Filters with Search === */}
      {filters.map((filter, idx) => (
        <div key={idx} style={{ marginBottom: "16px" }}>
          {/* Column Dropdown */}
          <select
            value={filter.column || ""}
            onChange={async (e) => {
              const col = e.target.value;
              if (!col) return;

              if (!availableValues[col]) {
                try {
                  // ✅ Proper encoding & API base handling
                  const encodedTable = encodeURIComponent(phdbTable);
                  const encodedCol = encodeURIComponent(col);
                  const apiUrl = `${getApiBaseUrl()}/distinct-values/${encodedTable}?col=${encodedCol}`;

                  console.log("📡 Fetching distinct values:", apiUrl);

                  const res = await fetch(apiUrl);
                  if (!res.ok)
                    throw new Error(`Failed to fetch distinct values for ${col}`);

                  const vals = await res.json();
                  setAvailableValues((prev) => ({
                    ...prev,
                    [col]: Array.isArray(vals) ? vals : [],
                  }));
                } catch (err) {
                  console.error("❌ Failed to fetch values for column:", col, err);
                  setAvailableValues((prev) => ({ ...prev, [col]: [] }));
                }
              }

              const updated = [...filters];
              updated[idx] = { column: col, values: [] };
              setFilters(updated);

              const newSelectedColumns = {};
              updated.forEach((f) => {
                if (f.column && f.values.length > 0) {
                  newSelectedColumns[f.column] = f.values;
                }
              });
              setSelectedColumnValues(newSelectedColumns);
            }}
            style={{
              width: "100%",
              marginBottom: "6px",
              padding: "6px",
              borderRadius: "6px",
              border: "1px solid #ccc",
            }}
          >
            <option value="">Select a column</option>
            {availableColumns.map((col) => (
              <option key={col} value={col}>
                {col}
              </option>
            ))}
          </select>

          {/* Values Multi-Select with Search */}
          {filter.column && Array.isArray(availableValues[filter.column]) && (
            <>
              <input
                type="text"
                placeholder={`Search ${filter.column}...`}
                value={searchTerms[filter.column] || ""}
                onChange={(e) =>
                  setSearchTerms({ ...searchTerms, [filter.column]: e.target.value })
                }
                style={{
                  width: "100%",
                  padding: "6px",
                  marginBottom: "4px",
                  borderRadius: "4px",
                  border: "1px solid #ccc",
                }}
              />
              <div
                style={{
                  border: "1px solid #ccc",
                  borderRadius: "6px",
                  maxHeight: "120px",
                  overflowY: "auto",
                  padding: "4px",
                }}
              >
                {availableValues[filter.column]
                  .filter((val) =>
                    val
                      ?.toString()
                      .toLowerCase()
                      .includes((searchTerms[filter.column] || "").toLowerCase())
                  )
                  .map((val) => {
                    const checked = filter.values.includes(val);
                    return (
                      <div
                        key={val}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          cursor: "pointer",
                        }}
                        onClick={() => {
                          const updated = [...filters];
                          const newValues = checked
                            ? filter.values.filter((v) => v !== val)
                            : [...filter.values, val];
                          updated[idx] = { ...filter, values: newValues };
                          setFilters(updated);

                          const newSelectedColumns = {};
                          updated.forEach((f) => {
                            if (f.column && f.values.length > 0) {
                              newSelectedColumns[f.column] = f.values;
                            }
                          });
                          setSelectedColumnValues(newSelectedColumns);
                        }}
                      >
                        <input type="checkbox" checked={checked} readOnly />
                        <span style={{ marginLeft: "6px" }}>{val}</span>
                      </div>
                    );
                  })}
              </div>
            </>
          )}
        </div>
      ))}

      {/* === Add Filter Row Button === */}
      <button
        type="button"
        onClick={() => {
          const updatedFilters = [...filters, { column: "", values: [] }];
          setFilters(updatedFilters);

          const newSelectedColumns = {};
          updatedFilters.forEach((f) => {
            if (f.column && f.values.length > 0) {
              newSelectedColumns[f.column] = f.values;
            }
          });
          setSelectedColumnValues(newSelectedColumns);
        }}
        style={{
          color: "#fff",
          width: "40%",
          padding: "6px",
          borderRadius: "6px",
          border: "1px dashed #ccc",
          background: "#1e6e03",
          cursor: "pointer",
          fontWeight: "bold",
          marginTop: "8px",
        }}
      >
        + Add Filter
      </button>
    </div>
  )}
</div>

{/* === Optional: Watch all filters for debugging === */}







 
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

            setColorRanges((prev) => {
              const newRanges = {
                ...prev,
                [selected]: prev[selected] || defaultBands,
              };

              // ✅ Immediately trigger drive test layer redraw
              window.refreshDriveTestLayer?.(selected, newRanges[selected]);

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
        Range <strong>{selectedDriveKPI}</strong>:{" "}
        <span>
          {driveLayerRange.min} – {driveLayerRange.max}
        </span>
      </p>
    )}

  {/* === Dynamic Color Bands for Drive Test KPI === */}
  {selectedDriveKPI && colorRanges[selectedDriveKPI] && (
    <div className="color-range-wrapper">
      {Object.entries(colorRanges[selectedDriveKPI]).map(
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
                setColorRanges((prev) => {
                  const bands = { ...prev[selectedDriveKPI] };
                  bands[newColor] = bands[color];
                  delete bands[color];
                  return { ...prev, [selectedDriveKPI]: bands };
                });
                window.refreshDriveTestLayer?.();
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
                setColorRanges((prev) => ({
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
                setColorRanges((prev) => ({
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
                setColorRanges((prev) => {
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
              if (colorRanges[selectedDriveKPI]?.[newDriveColorHex]) {
                alert("Color already exists!");
                return;
              }
              if (newDriveMin >= newDriveMax) {
                alert("Min must be less than Max.");
                return;
              }
              setColorRanges((prev) => ({
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
    <div style={{
      height: "6px",
      background: "#ddd",
      borderRadius: "3px",
      marginTop: "6px",
      overflow: "hidden",
    }}>
      <div style={{
        height: "100%",
        width: `${gridKpiProgress}%`,
        background: "linear-gradient(90deg, #4caf50, #81c784)",
        transition: "width 0.15s ease-in-out",
      }} />
    </div>
  )}
</div>

<label>Select KPI for Heatmap</label>
{renderDropdown("gridKPI", gridKPIColumns, false, selectedGridKPI, async (selected) => {
  setSelectedGridKPI(selected);
  setSelectedLayerColumn(selected);

  setFetchingGridKPI(true);
  setGridKpiProgress(0);

  const interval = setInterval(() => {
    setGridKpiProgress(prev => (prev < 90 ? prev + 5 : prev));
  }, 120);

  try {
    let min, max;

    if (kpiSource.type === "file") {
      // ✅ Case 1: KPI comes from uploaded file
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/grid-map/column-range?column=${encodeURIComponent(selected)}&table=${phdbTable || ""}`
      );
      ({ min, max } = await res.json());
    } else if (kpiSource.type === "target" && kpiSource.table) {
      // ✅ Case 2: KPI comes from selected target table
      // 1) Fetch range
      const resRange = await fetch(
        `${import.meta.env.VITE_API_URL}/grid-map/column-range?column=${encodeURIComponent(selected)}&table=${encodeURIComponent(kpiSource.table)}`
      );
      ({ min, max } = await resRange.json());

      // 2) Fetch GeoJSON rows for this table
      const resData = await fetch(
        `${import.meta.env.VITE_API_URL}/grid-map/data?table=${encodeURIComponent(kpiSource.table)}`
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

      setColorRanges(prev => {
        const newRanges = {
          ...prev,
          [selected]: prev[selected] || defaultBands,
        };
        return newRanges;
      });
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
})}

{/* === Show KPI Source Info === */}
{(kpiSource.type === 'file' || kpiSource.type === 'target') && (
  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
    KPI source: {kpiSource.type === 'file' ? 'Uploaded file' : `Table: ${kpiSource.table}`}
  </div>
)}

{/* === Range Info === */}
{selectedGridKPI &&
  gridLayerRange.min != null &&
  gridLayerRange.max != null && (
    <p className="range-info" style={{ fontSize: "10px", fontWeight: "bold" }}>
      Range <strong>{selectedGridKPI}</strong>:{" "}
      <span>
        {gridLayerRange.min} – {gridLayerRange.max}
      </span>
    </p>
  )}

{/* === Dynamic Color Bands for Heatmap KPI === */}
{selectedGridKPI && colorRanges[selectedGridKPI] && (
  <div className="color-range-wrapper">
    {Object.entries(colorRanges[selectedGridKPI]).map(([color, [min, max]]) => (
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
          value={color.startsWith("#") ? color : "#000000"}
          onChange={(e) => {
            const newColor = e.target.value;
            
            setColorRanges((prev) => {
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
            setColorRanges((prev) => ({
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
            setColorRanges((prev) => ({
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
            setColorRanges((prev) => {
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
      <button
        className="btn-add"
        style={{ marginTop: 8 }}
        onClick={() => {
          setAddingGridColor(true);
          setNewGridColorHex("#0000ff");
          setNewGridMin(gridLayerRange.min ?? 0);
          setNewGridMax(gridLayerRange.max ?? 0);
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
          value={newGridColorHex ?? "#0000ff"}
          onChange={(e) => setNewGridColorHex(e.target.value)}
          style={{ width: 32, height: 32, border: "none" }}
        />
        <input
          type="number"
          placeholder="Min"
          value={newGridMin ?? ""}
          onChange={(e) => setNewGridMin(Number(e.target.value))}
          className="input"
          style={{ width: 70 }}
        />
        <input
          type="number"
          placeholder="Max"
          value={newGridMax ?? ""}
          onChange={(e) => setNewGridMax(Number(e.target.value))}
          className="input"
          style={{ width: 70 }}
        />
        <button
          className="btn-add"
          onClick={() => {
            if (colorRanges[selectedGridKPI]?.[newGridColorHex]) {
              alert("Color already exists!");
              return;
            }
            if (newGridMin >= newGridMax) {
              alert("Min must be less than Max.");
              return;
            }
            setColorRanges((prev) => ({
              ...prev,
              [selectedGridKPI]: {
                ...prev[selectedGridKPI],
                [newGridColorHex]: [newGridMin, newGridMax],
              },
            }));
            setAddingGridColor(false);
            window.refreshGridLayer?.();
          }}
        >
          ✅ Add
        </button>
        <button
          className="btn-remove"
          style={{ marginLeft: 6 }}
          onClick={() => setAddingGridColor(false)}
        >
          ❌
        </button>
      </div>
    )}
  </div>
)}





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
        <button className="btn" onClick={handleSaveTemplate} disabled={!templateName}>
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
