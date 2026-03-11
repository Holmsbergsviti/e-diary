import os
import psycopg2

# Set these to your actual DB connection details
DB_HOST = os.environ.get("DB_HOST", "localhost")
DB_PORT = os.environ.get("DB_PORT", "5432")
DB_NAME = os.environ.get("DB_NAME", "ediary")
DB_USER = os.environ.get("DB_USER", "postgres")
DB_PASS = os.environ.get("DB_PASS", "password")

CLASS_ID = "75d8c31a-6431-4297-963f-e12023faf251"
SUBJECT_ID = "df809fe3-9733-4d8e-9c1c-c0a0fa78273f"

conn = psycopg2.connect(
    host=DB_HOST,
    port=DB_PORT,
    dbname=DB_NAME,
    user=DB_USER,
    password=DB_PASS
)
cur = conn.cursor()

# Get all students in the class
cur.execute("""
    SELECT id, name, surname FROM students WHERE class_id = %s
""", (CLASS_ID,))
students = cur.fetchall()

# Get all enrolled student_ids for the subject
cur.execute("""
    SELECT student_id FROM student_subjects WHERE subject_id = %s
""", (SUBJECT_ID,))
enrolled = set(row[0] for row in cur.fetchall())

# Find students missing enrollment
missing = [s for s in students if s[0] not in enrolled]

if missing:
    print("Students missing enrollment in subject:")
    for sid, name, surname in missing:
        print(f"{sid}: {name} {surname}")
    # Optionally, add them:
    for sid, _, _ in missing:
        cur.execute(
            "INSERT INTO student_subjects (student_id, subject_id) VALUES (%s, %s)",
            (sid, SUBJECT_ID)
        )
    conn.commit()
    print(f"Added {len(missing)} enrollments.")
else:
    print("All students are enrolled in the subject.")

cur.close()
conn.close()
