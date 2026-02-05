// frontend/scripts/auth.js

import { supabase } from './supabase.js'; 

const loginForm = document.getElementById('login-form');
// Assuming your login form exists and you have an element to show errors

supabase.auth.onAuthStateChange((event, session) => {
    // This listener runs every time the authentication state changes (login, logout, refresh)
    if (session) {
        // User is logged in, now check their role via the Django API
        checkUserRoleAndRedirect();
    }
});


async function checkUserRoleAndRedirect() {
    // 1. Call your Django API to get the user's role
    const response = await fetch('/api/user/role/', {
        method: 'GET',
        headers: {
            // Include your Django CSRF token if necessary, or ensure the endpoint allows GET without it
            'Authorization': `Bearer ${supabase.auth.session().access_token}` // Using Supabase token for auth if Django uses it
        }
    });

    if (!response.ok) {
        console.error('Failed to fetch user role from Django.');
        // Handle error, maybe redirect to a generic error page
        return;
    }

    const userData = await response.json();
    const role = userData.role;
    console.log(role)
    // 2. Perform the Redirection
    if (role === 'teacher') {
        window.location.href = '/dashboard.html'; // Redirect to the teacher dashboard HTML
    } else if (role === 'student') {
        window.location.href = '/student-diary.html'; // Create a student-specific page
    } else if (role === 'admin') {
        window.location.href = '/admin-control.html'; // Create an admin page
    } else {
        // Fallback for missing role
        console.warn('User logged in but has no assigned role.');
        window.location.href = '/index.html'; // Send them back to the login page
    }
}