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


export function getToken() {
  try {
    const userInfo = JSON.parse(Cookies.get("userInfo") || "{}");
    return userInfo.token || '';
  } catch (err) {
    return '';
  }
}


// utils/csrf.js
export function getCSRFToken() {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.startsWith('csrftoken=')) {
                cookieValue = decodeURIComponent(cookie.substring('csrftoken='.length));
                break;
            }    
        }
    }
    return cookieValue;
}


export function isUserLoggedIn() {
  return checkCookieExpiration().isValid;
}



export const getEnabledFeatures =()=>{
    try{
        const data = Cookies.get('userInfo');
        console.log(data,'data')
        return data?JSON.parse(data):
        null
    }
    catch{
        return null
    }
}

// navigation.js

const TARGET_IP = "10.164.167.122"; 


export const redirectToProfile = (e) => {
  if (e) e.preventDefault(); 
  
  const targetUrl = `http://${TARGET_IP}/auth/user_information`;
  
  window.location.href = targetUrl;
};




