import React, { useState } from 'react';
import Papa from 'papaparse';

const KPIGridUploader = ({ onGridData }) => {
  const [file, setFile] = useState(null);
  const [kpiColumn, setKpiColumn] = useState('');
  const [columns, setColumns] = useState([]);
  const [geojson, setGeojson] = useState(null);
  const [gridSize, setGridSize] = useState(0.01);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setFile(selectedFile);

    // Parse CSV to get columns
    Papa.parse(selectedFile, {
      header: true,
      dynamicTyping: true,
      complete: (results) => {
        const headers = Object.keys(results.data[0] || {});
        setColumns(headers);
      },
    });
  };

  const convertToGeoJSON = (csvData) => {
    const features = csvData.map(row => {
      const lat = parseFloat(row.Lat) || parseFloat(row.lat) || parseFloat(row.latitude) || parseFloat(row.Y);
      const lon = parseFloat(row.Long) || parseFloat(row.lon) || parseFloat(row.lng) || parseFloat(row.longitude) || parseFloat(row.x);

      if (isNaN(lat) || isNaN(lon)) return null;

      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [lon, lat],
        },
        properties: row,
      };
    }).filter(Boolean);

    return {
      type: 'FeatureCollection',
      features,
    };
  };

  const validateKPIColumn = (csvData, column) => {
    const sampleValues = csvData.slice(0, 50).map(row => row[column]).filter(v => v !== undefined && v !== null && v !== '');
    return sampleValues.every(v => !isNaN(parseFloat(v)));
  };

  const handleSubmit = async () => {
    setError('');
    if (!file || !kpiColumn) {
      setError('Please select a file and KPI column');
      return;
    }
    setLoading(true);

    // Parse CSV and convert to GeoJSON
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      complete: async (results) => {
        const csvData = results.data;

        // Validate KPI column numeric
        if (!validateKPIColumn(csvData, kpiColumn)) {
          setLoading(false);
          setError(`The selected KPI column "${kpiColumn}" contains non-numeric values. Please choose a numeric KPI.`);
          return;
        }

        const geojsonData = convertToGeoJSON(csvData);
        setGeojson(geojsonData);

        // Send to backend as .geojson file in FormData
        const blob = new Blob([JSON.stringify(geojsonData)], { type: 'application/geo+json' });
        const formData = new FormData();
        formData.append('file', blob, 'converted.geojson');

        try {
          const response = await fetch(`http://localhost:8000/generate-grid?kpi=${encodeURIComponent(kpiColumn)}&grid_size=${gridSize}`, {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            throw new Error('Failed to generate grid');
          }

          const result = await response.json();
          setLoading(false);
          setGeojson(result);
          if (onGridData) onGridData(result);
          alert('Grid generated successfully. Check map!');
        } catch (err) {
          setLoading(false);
          setError('Error generating grid.');
          console.error('Upload failed:', err);
        }
      },
    });
  };

  return (
    <div style={{ padding: '1rem', backgroundColor: '#f4f4f4', borderRadius: '8px', maxWidth: 400, margin: '2rem auto' }}>
      <h3>Upload Drive Test CSV for Grid KPI/Complaints Heatmap</h3>

      {/* File Upload */}
      <input type="file" accept=".csv" onChange={handleFileChange} style={{marginBottom: '1rem'}} />

      {/* KPI Column Selection */}
      {columns.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <label>Select KPI/Complaints Column:</label>
          <select value={kpiColumn} onChange={(e) => setKpiColumn(e.target.value)} style={{marginLeft: '0.5rem'}}>
            <option value="">-- Select KPI/Complaints --</option>
            {columns.map(col => (
              <option key={col} value={col}>{col}</option>
            ))}
          </select>
        </div>
      )}

      {/* Grid Size Selection */}
      <div style={{ marginTop: '1rem' }}>
        <label>Grid Size (degrees):</label>
        <select value={gridSize} onChange={(e) => setGridSize(parseFloat(e.target.value))} style={{marginLeft: '0.5rem'}}>
          <option value={0.01}>0.01 (default)</option>
          <option value={0.005}>0.005 (finer)</option>
          <option value={0.02}>0.02 (coarser)</option>
          <option value={0.05}>0.05 (very coarse)</option>
        </select>
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={loading}
        style={{
          marginTop: '1rem',
          padding: '8px 12px',
          backgroundColor: loading ? '#aaa' : '#28a745',
          color: '#fff',
          border: 'none',
          borderRadius: '4px',
          cursor: loading ? 'not-allowed' : 'pointer'
        }}
      >
        {loading ? 'Generating...' : 'Generate Grid Map'}
      </button>

      {/* Error */}
      {error && <div style={{ color: 'red', marginTop: '1rem' }}>{error}</div>}

      {/* Preview */}
      {geojson && geojson.features && geojson.features.length > 0 && (
        <div style={{ marginTop: '2rem', padding: '0.5rem', background: '#fff', borderRadius: '6px', fontSize: '0.95em', color: '#222' }}>
          <b>Grid GeoJSON preview:</b>
          <pre style={{ maxHeight: 180, overflowY: 'auto', fontSize: '0.8em', background: '#f9f9f9', padding: '0.5rem', borderRadius: '4px' }}>
            {JSON.stringify(geojson.features.slice(0, 3), null, 2)}
            {geojson.features.length > 3 && '...\n'}
          </pre>
          <span style={{fontSize:"0.9em"}}>Total grid cells: {geojson.features.length}</span>
        </div>
      )}
    </div>
  );
};

export default KPIGridUploader;
