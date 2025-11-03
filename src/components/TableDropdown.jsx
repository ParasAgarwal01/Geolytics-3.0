import React, { useEffect, useState } from "react";
import axios from "axios";

export default function TableDropdown({ label, value, onChange }) {
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTables = async () => {
      try {
        const response = await axios.get(`${import.meta.env.VITE_BACKEND_URL}/tables`);
        setTables(response.data);
      } catch (error) {
        console.error("Error fetching tables:", error);
        setTables([]);
      } finally {
        setLoading(false);
      }
    };

    fetchTables();
  }, []);

  return (
    <div className="mb-4">
      {label && <label className="block text-sm font-semibold mb-1">{label}</label>}
      <select
        className="w-full px-3 py-2 border rounded shadow focus:outline-none focus:ring-2 focus:ring-blue-400"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select table</option>
        {loading ? (
          <option>Loading...</option>
        ) : (
          tables.map((table) => (
            <option key={table} value={table}>
              {table}
            </option>
          ))
        )}
      </select>
    </div>
  );
}
