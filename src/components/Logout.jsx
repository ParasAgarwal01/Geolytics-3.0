import Cookies from 'js-cookie';
import { navigator } from '../pages/nevigator'; 

export const redirectToLogin = () => {
  console.log("🔄 Redirecting to login page...");
  Cookies.remove('userInfo', { path: '/' });
  window.location.href = "/auth/login"; 
};



export const logoutUser = () => {
  console.log("👋 Logging out user...");
  Cookies.remove('userInfo', { path: '/' });
  localStorage.clear();
  sessionStorage.clear();
  redirectToLogin();
};


// export const UserProfile = () => {
//   console.log("👤 Redirecting to user profile...");
//   window.location.href = "http://localhost:5173/auth/user_profile";
// };


export const redirectToProfile = (e) => {
  if (e) e.preventDefault(); 
  
  const targetUrl = `http://${TARGET_IP}/auth/user_information`;
  
  window.location.href = targetUrl;
};



