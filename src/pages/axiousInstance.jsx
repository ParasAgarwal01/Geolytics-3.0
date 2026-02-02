import axios from "axios";
// import { getCSRFToken } from '../Utils/csrf';
import { getCSRFToken } from "../components/CookiesUtils";
// import { getToken } from "../Utils/cookieUtils"; 
import { checkCookieExpiration } from "../components/CookiesUtils";
// import Cookies from 'js-cookie';
import { getToken } from "../components/CookiesUtils";
const csrfToken = getCSRFToken();

const axiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
    'X-CSRFToken': csrfToken
  },
});

// Add a request interceptor to include the token
axiosInstance.interceptors.request.use(
  (config) => {

    // const userInfo = localStorage.getItem("userInfo"); // Replace with your token retrieval method
    // const userInfo = Cookies.get('userInfo')
    // const token = userInfo ? JSON.parse(userInfo).token : null;
    const token = getToken()

    if (token) {
      config.headers.Authorization = `Token ${token}`;
    }

    return config;
  },
  (error) => {
    // Handle the error before it is sent
    return Promise.reject(error);
  }
);

export default axiosInstance;
