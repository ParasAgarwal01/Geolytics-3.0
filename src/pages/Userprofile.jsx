import React, { useEffect, useState } from 'react';
import axiosInstance from './axiousInstance';
import Navbar from './Navbar';

import "./styles.css"; 

const UserProfile = () => {
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);

    // useEffect(() => {
    //     axios.get('/auth/users') // Adjust to your API
    //         .then((response) => {
    //             setProfile(response.data);
    //             setLoading(false);
    //         })
    //         .catch((error) => {
    //             console.error('Failed to fetch profile:', error);
    //             setLoading(false);
    //         });
    // }, []);


    useEffect(() => {
        // Use axiosInstance instead of axios
        axiosInstance.get('/auth/users') 
            .then((response) => {
                setProfile(response.data);
                setLoading(false);
            })
            .catch((error) => {
                console.error('Failed to fetch profile:', error);
                setLoading(false);
            });
    }, []);

    if (loading) return <div>Loading profile...</div>;
    if (!profile) return <div>No profile found.</div>;

    return (
        <>
            <Navbar />
            <div className="max-w-md mx-auto p-6 bg-white shadow-md rounded-md">
                <h2 className="text-2xl font-bold mb-4">User Profile</h2>
                <table className="w-full table-auto">
                    <tbody>
                        <tr className="border-t">
                            <td className="font-semibold p-2">Name</td>
                            <td className="p-2">{profile.first_name} {profile.last_name}</td>
                        </tr>
                        <tr className="border-t">
                            <td className="font-semibold p-2">Username</td>
                            <td className="p-2">{profile.username}</td>
                        </tr>
                        <tr className="border-t">
                            <td className="font-semibold p-2">Email</td>
                            <td className="p-2">{profile.email}</td>
                        </tr>
                        {/* Add more fields as needed */}
                    </tbody>
                </table>
            </div>
        </>
    );
};

export default UserProfile;
