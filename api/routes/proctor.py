"""Server-side face detection for proctoring via OpenCV Haar Cascade."""
from fastapi import APIRouter, UploadFile, File
import cv2
import numpy as np

router = APIRouter()

_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')


@router.post("/detect")
async def detect_faces(file: UploadFile = File(...)):
    data = await file.read()
    arr  = np.frombuffer(data, np.uint8)
    img  = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        return {"faces": -1, "error": "Could not decode frame"}
    try:
        gray  = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        faces = _cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))
        return {"faces": int(len(faces))}
    except Exception as e:
        return {"faces": -1, "error": str(e)}
