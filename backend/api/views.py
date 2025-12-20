import json
import bcrypt
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from .db import users

@csrf_exempt
def login(request):
    if request.method != "POST":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    data = json.loads(request.body)
    username = data.get("username")
    password = data.get("password")

    user = users.find_one({"username": username})

    if not user:
        return JsonResponse({"message": "Invalid credentials"}, status=401)

    if bcrypt.checkpw(password.encode(), user["password"]):
        return JsonResponse({"message": "Login successful"}, status=200)

    return JsonResponse({"message": "Invalid credentials"}, status=401)
