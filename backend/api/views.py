import json
import bcrypt
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from .db import users

@csrf_exempt
def login(request):
    if request.method != "POST":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    try:
        data = json.loads(request.body)
    except:
        return JsonResponse({"message": "Invalid JSON"}, status=400)

    username = data.get("username")
    password = data.get("password")

    user = users.find_one({"username": username})

    if not user:
        return JsonResponse({"success": False, "message": "Invalid username or password"}, status=401)

    if bcrypt.checkpw(password.encode(), user["password"].encode()):
        return JsonResponse({"success": True})
    
    return JsonResponse({"success": False, "message": "Invalid username or password"}, status=401)
