import Cookies from 'js-cookie';

export const logoutUser = () => {
    Cookies.remove('userInfo', { path: '/' });
    localStorage.clear();
    sessionStorage.clear();

    window.location.href = "http://localhost:5173/auth/login";
};

export const UserProfile = ()=>{
    window.location.href ="http://localhost:517/auth/user_profile"
}

