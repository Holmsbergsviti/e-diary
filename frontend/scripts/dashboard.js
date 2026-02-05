// frontend/scripts/dashboard.js

// Assuming this function runs when dashboard.html loads
document.addEventListener('DOMContentLoaded', fetchDashboardData);

async function fetchDashboardData() {
    const dashboardContainer = document.getElementById('dashboard-container');
    
    // 1. Fetch data from the new Django API
    const response = await fetch('/api/teacher/dashboard/', {
        method: 'GET',
        // Assuming user is authenticated via session/cookies handled by Django
    });

    if (!response.ok) {
        dashboardContainer.innerHTML = '<p class="text-danger">Error loading dashboard data.</p>';
        return;
    }

    const data = await response.json();
    
    // 2. Update the HTML page elements
    updateStatsCards(data);
    renderAssignments(data.assignments);
    document.getElementById('welcome-header').textContent = `Welcome, ${data.teacher_name}`;
}

function updateStatsCards(data) {
    document.getElementById('total-assignments').textContent = data.assignment_count;
    document.getElementById('total-students').textContent = data.student_count;
    document.getElementById('pending-grades').textContent = data.pending_grades;
}

function renderAssignments(assignments) {
    const assignmentsGrid = document.getElementById('assignments-grid');
    assignmentsGrid.innerHTML = ''; // Clear existing content

    assignments.forEach(assignment => {
        const cardHtml = `
            <div class="col-md-4 mb-4">
                <div class="card class-card h-100">
                    <div class="card-body">
                        <h5 class="card-title fw-bold">${assignment.subject_name}</h5>
                        <h6 class="card-subtitle mb-2 text-muted">${assignment.class_name} (Grade ${assignment.grade_level})</h6>
                        
                        <div class="d-grid gap-2 mt-3">
                            <a href="/class-students.html?class=${assignment.class_id}&subject=${assignment.subject_id}" 
                                class="btn btn-outline-primary btn-sm">View Students</a>
                            <a href="/attendance.html?class=${assignment.class_id}" 
                                class="btn btn-outline-dark btn-sm">Take Attendance</a>
                        </div>
                    </div>
                </div>
            </div>
        `;
        assignmentsGrid.innerHTML += cardHtml;
    });
}