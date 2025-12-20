from .db import users
import bcrypt
import os
import json
import bcrypt
from django.http import JsonResponse
from pymongo import MongoClient

MONGO_URI = os.environ.get("MONGO_URI")

if not MONGO_URI:
    raise Exception("MONGO_URI is not set")

client = MongoClient(MONGO_URI)
db = client["ediary"]
users = db["users"]


from django.views.decorators.csrf import csrf_exempt

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
        return JsonResponse({"success": True})
    else:
        return JsonResponse({"message": "Invalid credentials"}, status=401)
