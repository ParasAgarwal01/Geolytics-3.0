import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './Login.css';
import Cookies from 'js-cookie';

const Logout = () => {

    const navigate = useNavigate();

    useEffect(() => {
        // localStorage.removeItem('userinfo');
        // sessionStorage.clear();
        Cookies.remove('userInfo', { path: '/' });

        navigate("/auth/login")
    }, []);

    return (
        <p>Logout in progress</p>
    );
};

export default Logout;
