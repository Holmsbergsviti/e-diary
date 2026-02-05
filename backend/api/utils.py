# backend/api/utils.py

import psycopg2
from django.conf import settings
from uuid import UUID

def get_user_role_and_name(user_id: UUID):
    """
    Checks the database to determine if the user_id belongs to a teacher, student, or admin.
    Returns a dictionary: {'role': 'teacher'/'student'/'admin', 'name': 'Full Name'}
    """
    conn = None
    data = {'role': None, 'name': None}
    db_settings = settings.DATABASES['default']
    
    try:
        conn = psycopg2.connect(
            dbname=db_settings['NAME'], 
            user=db_settings['USER'], 
            password=db_settings['PASSWORD'], 
            host=db_settings['HOST']
        )
        cur = conn.cursor()

        # Check Teacher
        cur.execute("SELECT name, surname FROM ediary_schema.teachers WHERE id = %s;", (user_id,))
        if row := cur.fetchone():
            data['role'] = 'teacher'
            data['name'] = f"{row[0]} {row[1]}"
            return data

        # Check Student
        cur.execute("SELECT name, surname FROM ediary_schema.students WHERE id = %s;", (user_id,))
        if row := cur.fetchone():
            data['role'] = 'student'
            data['name'] = f"{row[0]} {row[1]}"
            return data
            
        # Check Admin
        cur.execute("SELECT name, surname FROM ediary_schema.admins WHERE id = %s;", (user_id,))
        if row := cur.fetchone():
            data['role'] = 'admin'
            data['name'] = f"{row[0]} {row[1]}"
            return data

    except psycopg2.Error as e:
        print(f"Database error during role check: {e}")
    
    finally:
        if conn:
            conn.close()
            
    return data

# backend/api/utils.py (Add this function)

from uuid import UUID

def get_teacher_assignments_data(teacher_uuid: UUID):
    """
    Fetches assignments and stats for the teacher dashboard.
    """
    conn = None
    # Assuming db_settings and psycopg2 imports are already handled in this file
    db_settings = settings.DATABASES['default']
    
    try:
        conn = psycopg2.connect(
            dbname=db_settings['NAME'], 
            user=db_settings['USER'], 
            password=db_settings['PASSWORD'], 
            host=db_settings['HOST']
        )
        cur = conn.cursor()
        
        # 1. GET CLASSES & SUBJECTS ASSIGNED TO THIS TEACHER
        # This will be used to populate the 'My Classes' section
        cur.execute("""
            SELECT 
                c.class_name, 
                c.grade_level, 
                s.name as subject_name, 
                c.id as class_id, 
                s.id as subject_id
            FROM ediary_schema.teacher_assignments ta
            JOIN ediary_schema.classes c ON ta.class_id = c.id
            JOIN ediary_schema.subjects s ON ta.subject_id = s.id
            WHERE ta.teacher_id = %s
            ORDER BY c.grade_level, c.class_name;
        """, (teacher_uuid,))
        
        # Convert UUIDs to strings before returning to ensure JSON compatibility
        assignments_raw = cur.fetchall()
        assignments = []
        for row in assignments_raw:
            assignments.append({
                'class_name': row[0],
                'grade_level': row[1],
                'subject_name': row[2],
                'class_id': str(row[3]), # Convert UUID to string
                'subject_id': str(row[4]) # Convert UUID to string
            })


        # 2. GET TOTAL UNIQUE STUDENTS TAUGHT (For the stats card)
        cur.execute("""
            SELECT COUNT(DISTINCT st.id)
            FROM ediary_schema.students st
            JOIN ediary_schema.teacher_assignments ta ON st.class_id = ta.class_id
            WHERE ta.teacher_id = %s;
        """, (teacher_uuid,))
        student_count = cur.fetchone()[0]

        # 3. GET PENDING GRADES (For the stats card)
        # Assuming a grade is 'pending' if the percentage or grade_code is NULL
        cur.execute("""
            SELECT COUNT(g.id)
            FROM ediary_schema.grades g
            WHERE g.created_by_teacher_id = %s 
              AND (g.percentage IS NULL OR g.grade_code IS NULL);
        """, (teacher_uuid,))
        pending_grades = cur.fetchone()[0]


        cur.close()
        return {
            "assignments": assignments, 
            "student_count": student_count,
            "pending_grades": pending_grades
        }

    except psycopg2.Error as e:
        print(f"Database error fetching dashboard data: {e}")
        return {"assignments": [], "student_count": 0, "pending_grades": 0}
    finally:
        if conn:
            conn.close()