// components/FilterPanel.js
import React from 'react';

const FilterPanel = () => {
  return (
    <div className="filter-panel">
      <h4>Load Filter Template</h4>
      <form>
        {/* Form to load template, select size, distance, etc. */}
        <select>
          <option>Select Size</option>
          <option>Size 1</option>
          <option>Size 2</option>
        </select>
        <input type="number" placeholder="Enter Distance" />
        <input type="text" placeholder="Select KPI to Display" />
        <button type="submit">Load Template</button>
      </form>
    </div>
  );
};

export default FilterPanel;
