import os
from pymongo import MongoClient

# Read MongoDB URI from environment variable
MONGO_URI = os.environ.get("MONGO_URI")

if not MONGO_URI:
    raise RuntimeError("MONGO_URI environment variable is not set")

client = MongoClient(MONGO_URI)

db = client["ediary"]   # database name
users = db["users"]     # collection
