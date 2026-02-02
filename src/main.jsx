import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import App from './App.jsx';
import './index.css';
import 'mapbox-gl/dist/mapbox-gl.css';
import ProtectedRoute from './pages/Protected.jsx';
import Login from './pages/Login.jsx';
import Logout from './pages/Logout.jsx';
import UserProfile from './pages/Userprofile.jsx';
import { Toaster } from 'react-hot-toast';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Toaster position="top-right" reverseOrder={false} /> 
    <BrowserRouter> 
      <Routes>
        <Route path="/auth">
          <Route path="login" element={<Login />} />
          <Route path="logout" element={<Logout />} />
          <Route path="user_profile" element={<UserProfile />} />
        </Route>
        <Route path="/geo">
          <Route index element={<Navigate to="map" replace />} />
          <Route path="map" element={
            <ProtectedRoute>
              <App />
            </ProtectedRoute> 
          } />
        </Route>

  
        <Route path="/" element={<Navigate to="/auth/login" replace />} />
        
     
        <Route path="/login" element={<Navigate to="/auth/login" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
