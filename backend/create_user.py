import bcrypt
from pymongo import MongoClient

client = MongoClient("mongodb://localhost:27017/")
users = client["e_diary"]["users"]

password = bcrypt.hashpw("1234".encode(), bcrypt.gensalt())

users.insert_one({
    "username": "admin",
    "password": password.decode()
})

print("User created")
