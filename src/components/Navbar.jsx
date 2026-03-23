import React, { useState, useRef, useEffect } from "react";
import { logoutUser } from "./Logout";
import { checkCookieExpiration, redirectToProfile } from "./CookiesUtils";
import { useNavigate } from "react-router-dom";

const Navbar = ({
  activeSubModule,
  setActiveSubModule,
  selectedProject,
  setSelectedProject,
}) => {
  const [showSubModuleMenu, setShowSubModuleMenu] = useState(false);
  const [showModuleMenu, setShowModuleMenu] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [subModulePosition, setSubModulePosition] = useState("down");

  const moduleMenuRef = useRef(null);
  const subModuleBtnRef = useRef(null);
  const subModuleMenuRef = useRef(null);

  const navigate = useNavigate();

  // 🔹 HARDCODED PROJECT LIST
  const HARDCODED_PROJECTS = [
    "BHAZ01",
    "VFUK01",
    "BHAU01",
    "SPRK01",
    "TPGA01",
  ];

  // 🔹 Get projects assigned to user from cookie
  const cookieData = checkCookieExpiration();
  const cookieProjects = cookieData?.userData?.project_codes || [];

  // 🔹 Filter hardcoded projects by cookie
  const allowedProjects = HARDCODED_PROJECTS.filter((project) =>
    cookieProjects.includes(project)
  );

  // 🔹 Handle dropdown position dynamically (up/down)
  useEffect(() => {
    if (
      showSubModuleMenu &&
      subModuleBtnRef.current &&
      subModuleMenuRef.current
    ) {
      const btnRect = subModuleBtnRef.current.getBoundingClientRect();
      const dropdownHeight = subModuleMenuRef.current.offsetHeight;
      const spaceBelow = window.innerHeight - btnRect.bottom;
      const spaceAbove = btnRect.top;

      setSubModulePosition(
        spaceBelow < dropdownHeight && spaceAbove > dropdownHeight
          ? "up"
          : "down"
      );
    }
  }, [showSubModuleMenu]);

  // 🔹 Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        subModuleMenuRef.current &&
        !subModuleMenuRef.current.contains(event.target) &&
        !subModuleBtnRef.current.contains(event.target)
      ) {
        setShowSubModuleMenu(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () =>
      document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <>
      <style>{`
        .geolytics-navbar {
          background-color: #dcfce7;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 4px 12px;
          font-family: 'Segoe UI', sans-serif;
          height: 36px;
          border-bottom: 1px solid #ccc;
        }

        .navbar-left {
          display: flex;
          align-items: center;
        }

        .geolytics-logo {
          font-weight: bold;
          font-size: 13px;
          text-decoration: none;
          color: #000;
          margin-left: 8px;
        }

        .navbar-right {
          display: flex;
          align-items: center;
          gap: 8px;
          position: relative;
        }

        .dropdown-btn, .icon-btn {
          background-color: #bbf7d0;
          border: 1px solid #000;
          border-radius: 4px;
          padding: 2px 8px;
          font-size: 11px;
          color: #000;
          font-weight: 500;
          cursor: pointer;
          display: flex;
          align-items: center;
        }

        .dropdown-btn.active {
          background-color: #4ade80 !important;
          font-weight: 600;
        }

        .dropdown-btn:hover, .icon-btn:hover {
          background-color: #86efac;
        }

        .dropdown-content {
          position: absolute;
          background-color: white;
          border: 1px solid #ccc;
          border-radius: 4px;
          z-index: 9999 !important;
          box-shadow: 0 2px 6px rgba(0,0,0,0.1);
          font-size: 12px;
          min-width: 120px;
          max-height: 200px;
          overflow-y: auto;
          -ms-overflow-style: none;
          scrollbar-width: none;
        }

        .dropdown-content::-webkit-scrollbar {
          width: 0;
          height: 0;
        }

        .dropdown-content button {
          color: #000;
          background: none;
          border: none;
          text-align: left;
          padding: 6px 10px;
          width: 100%;
          cursor: pointer;
        }

        .dropdown-content button:hover {
          background-color: #d1fae5;
        }

        .drop-up {
          bottom: 100%;
          margin-bottom: 6px;
        }

        .drop-down {
          top: 100%;
          margin-top: 6px;
        }

        .profile-btn {
          background-color: #dcfce7;
          border: 1px solid #000;
          border-radius: 4px;
          padding: 2px 8px;
          font-size: 11px;
          color: #000;
          font-weight: 500;
          cursor: pointer;
          display: flex;
          align-items: center;
        }

        .dropdown-content .dropdown-item {
          color: #000 !important;
          text-decoration: none;
          display: block;
          padding: 6px 10px;
          width: 100%;
          box-sizing: border-box;
        }

        .dropdown-content .dropdown-item:hover {
          background-color: #d1fae5;
          color: #000;
        }

        .drop-down-model {
          top: 100%;
          margin-top: 6px;
          right: 50%;
        }
      `}</style>

      <nav className="geolytics-navbar">
        {/* Left Section */}
        <div className="navbar-left">
          <span className="profile-btn" title="Toggle Sidebar">
            <span>≡</span>
          </span>

          <a className="geolytics-logo" href="/">
            Geolytics
          </a>
        </div>

        {/* Right Section */}
        <div className="navbar-right">

          {/* Module Dropdown */}
          <button
            className="dropdown-btn"
            onClick={() => setShowModuleMenu(!showModuleMenu)}
          >
            Module — GeoLytics <span>▾</span>
          </button>

          {showModuleMenu && (
            <ul
              className="dropdown-content drop-down-model"
              ref={moduleMenuRef}
              id="module-menu"
            >
              <li>
                <a
                  className="dropdown-item"
                  href={`${import.meta.env.VITE_GEO_URL}/KPI-Analysis/`}
                >
                  KPI Trend Analytics
                </a>
              </li>

              <li>
                <a
                  className="dropdown-item"
                  href={`${import.meta.env.VITE_GEO_URL}/map`}
                >
                  Geolytics
                </a>
              </li>

              <li>
                <a
                  className="dropdown-item active"
                  href={`${import.meta.env.VITE_PM_TOOL_URL}/pm_tool/create_ticket`}
                >
                  PM Tool
                </a>
              </li>
            </ul>
          )}

          {/* Project Dropdown */}
          <div style={{ position: "relative" }}>
            <button
              ref={subModuleBtnRef}
              className="dropdown-btn"
              onClick={() => setShowSubModuleMenu((prev) => !prev)}
            >
              {selectedProject || "Select Project"} <span>▾</span>
            </button>

            {showSubModuleMenu && (
              <div
                ref={subModuleMenuRef}
                className={`dropdown-content ${
                  subModulePosition === "up" ? "drop-up" : "drop-down"
                }`}
              >
                {allowedProjects.map((db) => (
                  <button
                    key={db}
                    className={
                      db === selectedProject
                        ? "dropdown-btn active"
                        : "dropdown-btn"
                    }
                    onClick={() => {
                      setActiveSubModule(db);
                      setSelectedProject(db);
                      setShowSubModuleMenu(false);
                    }}
                  >
                    {db}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Profile Dropdown */}
          <div style={{ position: "relative" }}>
            <button
              className="profile-btn"
              onClick={() => setShowProfileMenu((prev) => !prev)}
              title="Profile"
            >
              👤 <span>▾</span>
            </button>

            {showProfileMenu && (
              <div className="dropdown-content drop-down" style={{ right: 0 }}>
                <button onClick={redirectToProfile}>Profile</button>
                <button onClick={logoutUser}>Logout</button>
              </div>
            )}
          </div>
        </div>
      </nav>
    </>
  );
};

export default Navbar;