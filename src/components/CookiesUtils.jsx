import Cookies from 'js-cookie';
import { redirectToLogin } from './Logout';

// COOKIE CHECKING UTILITIES

export const checkCookieExpiration = () => {
  try {
    const userInfo = Cookies.get('userInfo');
    
    if (!userInfo) {
      console.warn(" No userInfo cookie found - Session expired");
      redirectToLogin();
      return { isValid: false, userData: null };
    }

    const userData = JSON.parse(userInfo);
    const Token = userData.token;
    
    // Check if token exists
    if (!userData.token) {
      console.warn("No token in userInfo - Session expired");
      redirectToLogin();
      return { isValid: false, userData: null };
    }

    // console.log(" Cookie is valid");
    return { isValid: true, userData };
  } catch (error) {
    console.error(" Error checking cookie expiration:", error);
    redirectToLogin();
    return { isValid: false, userData: null };
  }
};

// Get user data directly from cookies

export function isUserLoggedIn() {
  return checkCookieExpiration().isValid;
}


export function getToken() {
  try {
    const userInfo = JSON.parse(Cookies.get("userInfo") || "{}");
    return userInfo.token || '';
  } catch (err) {
    return '';
  }
}


export const redirectToProfile = (e) => {
  if (e) e.preventDefault(); 
  const targetUrl  = `${import.meta.env.VITE_AUTH_URL}/user_information`;
  window.location.href = targetUrl;
};