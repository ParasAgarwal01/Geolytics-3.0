import Cookies from 'js-cookie';
// Import the global object you created
import { navigator } from '../pages/nevigator'; 

export const redirectToLogin = () => {
  console.log("🔄 Redirecting to login page...");
  Cookies.remove('userInfo', { path: '/' });

  if (navigator.navigate) {
    navigator.navigate('/login');
  } else {
    window.location.href = "/login";
  }
};


export const logoutUser = () => {
  console.log("👋 Logging out user...");
  Cookies.remove('userInfo', { path: '/' });
  localStorage.clear();
  sessionStorage.clear();
  redirectToLogin();
};


export const UserProfile = () => {
  console.log("👤 Redirecting to user profile...");
  window.location.href = "http://localhost:5173/auth/user_profile";
};
