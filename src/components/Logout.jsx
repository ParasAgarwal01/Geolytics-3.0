import Cookies from 'js-cookie';


export const redirectToLogin = () => {
  console.log("🔄 Redirecting to login page...");
  console.log("📍 Redirecting to: http://localhost:5173/auth/login");
  Cookies.remove('userInfo', { path: '/' });
  window.location.href = "http://localhost:5173/auth/login";
};

// Logout user - clear all data and redirect to login
export const logoutUser = () => {
  console.log("👋 Logging out user...");
  Cookies.remove('userInfo', { path: '/' });
  localStorage.clear();
  sessionStorage.clear();
  redirectToLogin();
};

// Redirect to user profile page (separate auth service on port 5174)
export const UserProfile = () => {
  console.log("👤 Redirecting to user profile...");
  window.location.href = "http://localhost:5173/auth/user_profile";
};

