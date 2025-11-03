import React, { useEffect, useState } from 'react';

export default function ColumnSelector({ tableName, selected, onChange }) {
  const [columns, setColumns] = useState([]);

  useEffect(() => {
    if (!tableName) return;

    fetch(`http://10.129.7.247/geolytics/columns/${tableName}`)
      .then(res => res.json())
      .then(data => setColumns(data))
      .catch(() => setColumns([]));
  }, [tableName]);

  useEffect(() => {
  if (tableName) {
    fetch(`${import.meta.env.VITE_BACKEND_URL}/columns/${tableName}`)
      .then((res) => res.json())
      .then(setColumns)
      .catch(console.error);
  }
}, [tableName]);


  return (
    <div className="mb-4">
      <label className="block text-sm font-semibold mb-1">Site ID Column</label>
      <select
        className="w-full px-3 py-2 border rounded"
        value={selected}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select column</option>
        {columns.map(col => (
          <option key={col} value={col}>{col}</option>
        ))}
      </select>
    </div>
  );
}
