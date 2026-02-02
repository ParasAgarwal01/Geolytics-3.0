import Cookies from 'js-cookie';
<<<<<<< HEAD
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
=======

export const logoutUser = () => {
    Cookies.remove('userInfo', { path: '/' });
    localStorage.clear();
    sessionStorage.clear();

    window.location.href = "http://localhost:5173/auth/login";
};

export const UserProfile = ()=>{
    window.location.href ="http://localhost:517/auth/user_profile"
}

>>>>>>> 651384dfa488677c9c85e4042eba64151d50df11
