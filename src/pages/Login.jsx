import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Cookies from 'js-cookie';

import './Login.css';
import axiosInstance from './axiousInstance';


const Login = () => {
    const [isLogin, setIsLogin] = useState(true);
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [password2, setPassword2] = useState('');
    const [message, setMessage] = useState('');
    const navigate = useNavigate();

    // check user is already logged in
    // useEffect(() => {
    //     // const storedData = localStorage.getItem('userinfo');
    //     const storedData = Cookies.get('userInfo')

    //     if (storedData) {
    //         window.location.href = "http://localhost:5173/map";
    //         // navigate('http://localhost:5174/pm_tool/'); // Adjust this navigation based on role if needed
    //     }

    // }, []);

//     useEffect(() => {
//     const storedData = Cookies.get('userInfo');
//     if (storedData) {
//         navigate('/map'); 
//     }
// }, [navigate]); 

//     useEffect(() => {
//     const storedData = Cookies.get('userInfo');
//     if (storedData) {
//         navigate('map/'); 
//         // window.location.href = "http://localhost:5174/geo/";
//     }
// }, [navigate]); 

useEffect(() => {
    const storedData = Cookies.get('userInfo');
    if (storedData) {
        // Point to the new prefixed path
        navigate('/geo/map'); 
    }
}, [navigate]);




    const handleSubmit = async (e) => {
        e.preventDefault();
        const endpoint = isLogin ? 'login' : 'register';
        let payload = isLogin ? {
            username: email,
            password
        } : {
            first_name: firstName,
            last_name: lastName,
            username: email,
            email,
            password,
            password2
        }

        console.log(axiosInstance,'a')

        try {
            const response = await axiosInstance.post(`/auth/${endpoint}`, payload);

            if (isLogin) {
                const { message, ...rest } = response.data

                // Store the data in localStorage as a JSON string
                // localStorage.setItem('userInfo', JSON.stringify(rest));

                // Set cookie to expire in 1 hour
                Cookies.set('userInfo', JSON.stringify(rest), { expires: 2 / 24 }); // 1 hour = 1/24 day
                console.log("userInfo :",Cookies.get('userInfo'));
                console.log('Payload:', payload);
                console.log('Response:', response.data);
                console.log('Cookie:', Cookies.get('userInfo'));
                // window.location.href = "http://localhost:5173/map";
                navigate('/geo/map');
                // window.location.href = "http://localhost:5174/geo/";

                // navigate('http://localhost:5173/pm_tool/'); // Adjust this navigation based on role if needed

            } else {
                setIsLogin(true);
            }

            setMessage(`${isLogin ? 'Login' : 'Signup'} successful!`);
            window.location.reload();
        } catch (error) {
            console.log(error.response.data.error)
            setMessage(error.response.data.error || `Error ${isLogin ? 'logging in' : 'signing up'}`);
        }
    };

    const switchForm = () => {
        setIsLogin(!isLogin);
        setMessage('');
    };

    return (
        <div className='login'>
            <div className="main">
                <div className={`container ${isLogin ? 'b-container' : 'a-container'}`} id={isLogin ? 'b-container' : 'a-container'}>
                    <form className="form" onSubmit={handleSubmit}>
                        <h2 className="form_title title">{isLogin ? 'Step Into the Network' : 'Create Account'}</h2>
                        <div className="form__icons">
                            <img className="form__icon" alt="" />
                            <img className="form__icon" />
                            <img className="form__icon" />
                        </div>

                        {!isLogin && (
                            <>
                                <input
                                    type="text"
                                    className="form__input"
                                    value={firstName}
                                    onChange={(e) => setFirstName(e.target.value)}
                                    placeholder="Enter First Name"
                                    required
                                />
                                <input
                                    type="text"
                                    className="form__input"
                                    value={lastName}
                                    onChange={(e) => setLastName(e.target.value)}
                                    placeholder="Enter Last Name"
                                    required
                                />
                            </>
                        )}

                        <input
                            type="email"
                            className="form__input"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="Enter Email"
                            required={!isLogin}
                        />

                        <input
                            type="password"
                            className="form__input"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter Password"
                            required
                        />

                        {!isLogin && (
                            <input
                                type="password"
                                className="form__input"
                                value={password2}
                                onChange={(e) => setPassword2(e.target.value)}
                                placeholder="Confirm Password"
                                required
                            />
                        )}

                        <button type="submit" className="form__button button">
                            {isLogin ? 'SIGN IN' : 'SIGN UP'}
                        </button>

                        {isLogin && (
                            <p style={{ fontSize: '16px' }}>Forgot Password? <a href="/auth/reset_password">Click here to reset</a></p>
                        )}

                        {message && <p style={{ color: 'red', marginTop: '10px', fontSize: '15px' }}>{message}</p>}

                    </form>
                </div>
                <div className={`switch ${isLogin ? 'switch-signin' : 'switch-signup'}`} id={isLogin ? 'switch-signin' : 'switch-signup'}>
                    <div className="switch__circle"></div>
                    <div className="switch__circle switch__circle--t"></div>
                    <div className="switch__container" id="switch-c1">
                        <h2 className="switch__title title">{isLogin ? 'Welcome !' : 'Welcome Back !'}</h2>
                        <p className="switch__description description">
                            {isLogin
                                ? 'Please enter your personal details to begin your journey with us.'
                                : 'To keep connected with us please login with your personal info'}
                        </p>
                        <button onClick={switchForm} className="switch__button button switch-btn">
                            {isLogin ? 'SIGN UP' : 'SIGN IN'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Login;
