# backend/api/views.py (Add this function)

from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.contrib.auth.decorators import login_required
from .utils import get_teacher_assignments_data

@require_http_methods(["GET"])
@login_required 
def teacher_dashboard_data(request):
    """
    API endpoint to fetch all dynamic data for the teacher dashboard.
    """
    user_id = request.user.id
    
    # Get the user's name from the session (set during login)
    teacher_name = request.session.get('user_full_name', 'Teacher')
    
    dashboard_data = get_teacher_assignments_data(user_id)
    
    return JsonResponse({
        'teacher_name': teacher_name,
        'assignments': dashboard_data['assignments'],
        'student_count': dashboard_data['student_count'],
        'assignment_count': len(dashboard_data['assignments']),
        'pending_grades': dashboard_data['pending_grades'],
    })