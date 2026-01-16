import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import Cookies from 'js-cookie';
import { redirectToLogin } from './components/Logout';
import App from './App.jsx';
import './index.css';
import 'mapbox-gl/dist/mapbox-gl.css';

// ============================================================================
// 🔐 CHECK COOKIE EXPIRATION ON APP START
// ============================================================================
// Verify user is logged in before rendering the app
// If cookies are expired or missing, redirect to login page
const checkUserSession = () => {
  try {
    const userInfo = Cookies.get('userInfo');
    
    // If no userInfo cookie, user is not logged in
    if (!userInfo) {
      console.warn("❌ No userInfo cookie found - Redirecting to login");
      redirectToLogin();
      return false;
    }

    const userData = JSON.parse(userInfo);
    
    // Check if token exists
    if (!userData.token) {
      console.warn("❌ No token in userInfo - Session expired");
      redirectToLogin();
      return false;
    }

    console.log("✅ User session is valid - Rendering app");
    return true;
  } catch (error) {
    console.error("❌ Error checking session:", error);
    redirectToLogin();
    return false;
  }
};

// Check session before rendering
if (!checkUserSession()) {
  // Don't render the app if session check fails
  console.log("🔄 Redirecting to login page...");
  // Exit early - the redirect will handle it
} else {
  // Session is valid, render the app
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <BrowserRouter basename="/geo">
        <App />
      </BrowserRouter>
    </StrictMode>
  );
}
