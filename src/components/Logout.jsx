import Cookies from 'js-cookie';


export const redirectToLogin = () => {
  console.log("🔄 Redirecting to login page...");
  Cookies.remove('userInfo', { path: '/' });
  const loginUrl = `${import.meta.env.VITE_AUTH_URL}/login`;
   console.log(loginUrl,'l')
  window.location.href = loginUrl;
};

// Logout user - clear all data and redirect to login
export const logoutUser = () => {
  console.log("👋 Logging out user...");
  const loginUrl = `${import.meta.env.VITE_AUTH_URL}/login`;
  Cookies.remove('userInfo', { path: loginUrl });
  localStorage.clear();
  sessionStorage.clear();
  redirectToLogin();
};





export const redirectToProfile = (e) => {
  if (e) e.preventDefault(); 
  
  const targetUrl = `${import.meta.env.VITE_AUTH_URL}/user_information`;
  
  window.location.href = targetUrl;
};

