import React from "react";
// import "bootstrap/dist/css/bootstrap.min.css";
// import "bootstrap/dist/js/bootstrap.bundle.min.js";
import "./styles.css"; // Adjust the path to your styles.css file

const Navbar = () => {
    return (
        <nav className="navbar navbar-expand-lg navbar-custom navbar-inverse" id="myNavbar">
            <div className="container-fluid">
                {/* Sidebar Icon */}
                <span className="icon-btn" id="sidebarCollapseBtn" onClick={() => console.log("Sidebar toggle")} />

                {/* Logo */}
                <a className="navbar-brand logo" href="/">
                    <span className="biz">Auto</span><span className="bot">Tool</span>
                </a>

                <div className="navbar-right">
                    {/* Module Dropdown */}
                    <div className="btn-group me-4">
                        <button
                            id="module-btn"
                            type="button"
                            className="btn btn-primary dropdown-toggle"
                            data-bs-toggle="dropdown"
                            aria-expanded="false"
                        >
                            Module — <span id="selectedModule">Select Module</span>
                        </button>
                        <ul className="dropdown-menu" id="module-menu">
                            <li><a className="dropdown-item" href="/vizbot">Vizbot</a></li>
                            <li><a className="dropdown-item" href="/geolytics">Geolytics</a></li>
                            <li><a className="dropdown-item" href="/autostudio">Automation Studio</a></li>
                            <li><a className="dropdown-item" href="#">PM Tool</a></li>
                        </ul>
                    </div>

                    {/* Sub-Module Dropdown */}
                    <div className="btn-group me-4">
                        <button
                            id="submodule-btn"
                            type="button"
                            className="btn btn-primary dropdown-toggle"
                            data-bs-toggle="dropdown"
                            aria-expanded="false"
                        >
                            Sub-Module
                        </button>
                        <ul className="dropdown-menu">
                            <li><a className="dropdown-item" href="/auth/profile">Profile</a></li>
                            <li><a className="dropdown-item" href="/auth/change_password">Change Password</a></li>
                        </ul>
                    </div>

                    {/* Project Dropdown */}
                    <div className="btn-group me-4">
                        <button
                            id="projectDropdownBtn"
                            type="button"
                            className="btn btn-primary dropdown-toggle"
                            data-bs-toggle="dropdown"
                            aria-expanded="false"
                        >
                            Select Project
                        </button>
                        <ul id="projectDropdownMenu" className="dropdown-menu">
                            {/* Add options dynamically */}
                        </ul>
                    </div>

                    {/* Settings Dropdown */}
                    <div className="dropdown">
                        <a
                            href="#"
                            className="icon-btn"
                            id="settingsDropdown"
                            role="button"
                            data-bs-toggle="dropdown"
                            aria-expanded="false"
                        >
                            <i className="fas fa-cog"></i>
                        </a>
                        <ul className="dropdown-menu dropdown-menu-end dropdown-menu-color">
                            <li>
                                <div>Select Theme Color:</div>
                                <div className="d-flex mt-2">
                                    <div id="color-box1" className="color-box bg-white" onClick={() => console.log("Set white theme")}></div>
                                    <div id="color-box2" className="color-box bg-dark" onClick={() => console.log("Set dark theme")}></div>
                                    <div id="color-box3" className="color-box bg-primary" onClick={() => console.log("Set primary theme")}></div>
                                </div>
                            </li>
                        </ul>
                    </div>

                    {/* Download Button */}
                    <button id="download-all-images" className="icon-btn" onClick={() => console.log("Download graphs")}>
                        <i className="fas fa-download"></i>
                    </button>

                    {/* Help Icon */}
                    <a href="#" className="icon-btn">
                        <i className="fas fa-question-circle"></i>
                    </a>

                    {/* Profile Dropdown */}
                    <div className="dropdown ms-3" id="profile">
                        <a
                            id="person-icon"
                            className="dropdown-toggle d-flex align-items-center"
                            href="#"
                            role="button"
                            data-bs-toggle="dropdown"
                            aria-expanded="false"
                        >
                            <i className="fas fa-user person-icon"></i>
                        </a>
                        <ul className="dropdown-menu dropdown-menu-end">
                            <li><a className="dropdown-item" href="http://10.164.167.122/auth/user_information">Profile</a></li>
                            <li><a className="dropdown-item" href="/auth/change_password">Change Password</a></li>
                            <li>
                                <hr className="dropdown-divider" />
                            </li>
                            <li><a className="dropdown-item" href="/auth/logout">Logout</a></li>
                        </ul>
                    </div>
                </div>
            </div>
        </nav>
    );
};

export default Navbar;
