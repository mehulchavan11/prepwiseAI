"""Mock interview routes."""
from fastapi import APIRouter
from pydantic import BaseModel
from datetime import datetime
from google.genai.errors import ClientError
from api.config import get_db
from api.services.gemini import generate_interview_questions, evaluate_answer

router = APIRouter()


class GeneratePayload(BaseModel):
    role:       str
    stack:      str
    experience: int


@router.post("/generate")
def generate(p: GeneratePayload):
    try:
        qs = generate_interview_questions(p.role, p.stack, p.experience)
        if not qs:
            return {"error": "Could not generate questions. Please try again."}
        return {"questions": qs}
    except ClientError as e:
        if "RESOURCE_EXHAUSTED" in str(e) or "429" in str(e):
            return {"error": "API quota exceeded. Please wait a moment and try again."}
        return {"error": f"API error: {e}"}


class EvaluatePayload(BaseModel):
    question: str
    answer:   str


@router.post("/evaluate")
def evaluate(p: EvaluatePayload):
    try:
        return {"feedback": evaluate_answer(p.question, p.answer)}
    except ClientError as e:
        if "RESOURCE_EXHAUSTED" in str(e):
            return {"feedback": "⚠️ API quota exceeded. Feedback unavailable — try again later."}
        return {"feedback": f"⚠️ Error generating feedback: {e}"}


class Response(BaseModel):
    question: str
    answer:   str
    feedback: str


class SavePayload(BaseModel):
    username:   str
    role:       str
    stack:      str
    experience: int
    responses:  list[Response]


@router.post("/save")
def save(p: SavePayload):
    col = get_db("mock_interviews")["feedbacks"]
    for r in p.responses:
        col.insert_one({
            "username":  p.username,
            "role":      p.role,
            "question":  r.question,
            "answer":    r.answer,
            "feedback":  r.feedback,
            "timestamp": datetime.now(),
        })
    return {"ok": True}


class ViolationLog(BaseModel):
    username:  str
    violation: str


@router.post("/log-violation")
def log_violation(p: ViolationLog):
    get_db("mock_interviews")["face_logs"].insert_one({
        "student_id": p.username,
        "timestamp":  datetime.now(),
        "violation":  p.violation,
    })
    return {"ok": True}


class TerminatePayload(BaseModel):
    username:        str
    role:            str
    violation_count: int
    violations:      list   # [{type, time}]


@router.post("/terminate")
def terminate_interview(p: TerminatePayload):
    get_db("mock_interviews")["cheating_reports"].insert_one({
        "student_id":      p.username,
        "test_type":       "interview",
        "role":            p.role,
        "violation_count": p.violation_count,
        "violations":      p.violations,
        "timestamp":       datetime.now(),
        "terminated":      True,
    })
    return {"ok": True}
