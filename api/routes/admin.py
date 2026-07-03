"""Admin routes — cheating reports, etc."""
from fastapi import APIRouter
from api.config import get_db

router = APIRouter()


@router.get("/cheating-reports")
def cheating_reports():
    reports = []

    for r in get_db("quiz_system")["cheating_reports"].find({"terminated": True}):
        reports.append({
            "student_id":      r.get("student_id", "—"),
            "test_type":       "Aptitude",
            "category":        r.get("category", "—"),
            "violation_count": r.get("violation_count", 0),
            "violations":      r.get("violations", []),
            "timestamp":       r["timestamp"].isoformat() if r.get("timestamp") else "—",
        })

    for r in get_db("mock_interviews")["cheating_reports"].find({"terminated": True}):
        reports.append({
            "student_id":      r.get("student_id", "—"),
            "test_type":       "Mock Interview",
            "category":        r.get("role", "—"),
            "violation_count": r.get("violation_count", 0),
            "violations":      r.get("violations", []),
            "timestamp":       r["timestamp"].isoformat() if r.get("timestamp") else "—",
        })

    reports.sort(key=lambda x: x["timestamp"], reverse=True)
    return reports
