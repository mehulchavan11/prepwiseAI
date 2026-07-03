import os
from pathlib import Path
from pymongo import MongoClient
from functools import lru_cache
from dotenv import load_dotenv

BASE_DIR = Path(__file__).parent.parent          # D:/PrepWise_AI/
load_dotenv(BASE_DIR / ".env")

APTITUDE_DIR = BASE_DIR / "data"
DSA_CSV = BASE_DIR / "data" / "dsa" / "question_details.csv"

MONGO_URI = os.getenv("MONGO_URI")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL   = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")


@lru_cache(maxsize=1)
def get_mongo() -> MongoClient:
    return MongoClient(MONGO_URI)


def get_db(name: str):
    return get_mongo()[name]
