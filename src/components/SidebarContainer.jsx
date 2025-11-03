// src/SidebarContainer.jsx
import React from 'react';
import Sidebar from './components/Sidebar';
import MapRenderer from './components/MapRenderer';
import './Styles.css';

const SidebarContainer = ({ onGenerateMap, geoJsonData }) => {
  return (
    <div className="sidebar-container">
      <div className="left-panel">
        <Sidebar onGenerateMap={onGenerateMap} />
      </div>

      <div className="map-panel">
        <MapRenderer mapData={geoJsonData} />
      </div>
    </div>
  );
};

export default SidebarContainer;
