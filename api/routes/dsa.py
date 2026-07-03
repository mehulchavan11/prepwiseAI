"""DSA practice routes."""
from fastapi import APIRouter
from pydantic import BaseModel
from datetime import datetime
import pandas as pd, re
from functools import lru_cache
from api.config import get_db, DSA_CSV
from api.services.executor import run_test_cases

router = APIRouter()


@lru_cache(maxsize=1)
def _df() -> pd.DataFrame:
    df = pd.read_csv(DSA_CSV)
    df["topics"] = df["topics"].fillna("[]").apply(
        lambda x: [t.strip()
                   for t in x.strip("[]").replace("'", "").replace('"', "").split(",")
                   if t.strip()]
    )
    df["isPaidOnly"] = df["isPaidOnly"].fillna(False)
    return df[df["isPaidOnly"] != True].copy()


def _clean_html(raw: str) -> str:
    for k, v in {"&nbsp;": " ", "&quot;": '"', "&gt;": ">", "&lt;": "<", "&amp;": "&"}.items():
        raw = raw.replace(k, v)
    return re.sub(r'<.*?>', '', raw, flags=re.DOTALL)


def _test_cases(text: str) -> list:
    inputs  = re.findall(r'Input:\s*(.+?)(?:\n|$)',  text, re.IGNORECASE)
    outputs = re.findall(r'Output:\s*(.+?)(?:\n|$)', text, re.IGNORECASE)
    return [{"input": i.strip(), "output": o.strip()} for i, o in zip(inputs, outputs)]


def _py_template(csv_code: str) -> str:
    if csv_code and str(csv_code).strip() not in ("", "nan"):
        base = str(csv_code).strip()
        if not re.search(r'\n\s{8}\S', base):
            base = base.rstrip() + "\n        pass"
        return "from typing import List, Optional, Dict, Set, Tuple\n\n" + base + "\n"
    return "from typing import List, Optional, Dict, Set, Tuple\n\nclass Solution:\n    def solve(self):\n        pass\n"


_TEMPLATES = {
    "Java":  "import java.util.*;\n\npublic class Solution {\n    // Add your solution here\n}",
    "C":     "#include <stdio.h>\n#include <stdlib.h>\n\nint main() {\n    // write your code here\n    return 0;\n}",
    "C++":   "#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    // write your code here\n    return 0;\n}",
}


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/topics")
def topics():
    return sorted({t for ts in _df()["topics"] for t in ts})


@router.get("/difficulties")
def difficulties():
    return sorted(_df()["difficulty"].dropna().unique().tolist())


@router.get("/problems")
def problems(page: int = 1, difficulty: str = "", topic: str = "", page_size: int = 25):
    df = _df().copy()
    if difficulty and difficulty != "All":
        df = df[df["difficulty"] == difficulty]
    if topic and topic != "All":
        df = df[df["topics"].apply(lambda t: topic in t)]

    total = len(df)
    start = (page - 1) * page_size
    chunk = df.iloc[start: start + page_size]

    return {
        "problems": [
            {"qid": int(r.QID), "title": r.title, "difficulty": r.difficulty, "topics": r.topics[:4]}
            for r in chunk.itertuples()
        ],
        "total":     total,
        "page":      page,
        "page_size": page_size,
    }


@router.get("/problem/{qid}")
def problem(qid: int):
    row_df = _df()[_df()["QID"] == qid]
    if row_df.empty:
        return None
    row = row_df.iloc[0]
    body_html = str(row.get("Body", ""))
    body_text = _clean_html(body_html)
    tcs = _test_cases(body_text)
    hints_raw = str(row.get("Hints", "[]"))
    hints = [h.strip() for h in hints_raw.strip("[]").replace('"', "").replace("'", "").split(",")
             if len(h.strip()) > 5]
    csv_code = row.get("Code", "")
    return {
        "qid":        int(row["QID"]),
        "title":      row["title"],
        "difficulty": row["difficulty"],
        "topics":     row["topics"],
        "body_html":  body_html,
        "test_cases": tcs,
        "hints":      hints,
        "templates": {
            "Python": _py_template(csv_code),
            "Java":   _TEMPLATES["Java"],
            "C":      _TEMPLATES["C"],
            "C++":    _TEMPLATES["C++"],
        },
    }


class ExecutePayload(BaseModel):
    code:       str
    language:   str
    test_cases: list


@router.post("/execute")
def execute(p: ExecutePayload):
    return {"results": run_test_cases(p.code, p.language, p.test_cases)}


class SubmitPayload(BaseModel):
    username:   str
    qid:        int
    difficulty: str
    topics:     list
    language:   str
    time_taken: str


@router.post("/submit")
def submit(p: SubmitPayload):
    get_db("DSA_code_app_db")["submissions"].insert_one({
        "username":   p.username,
        "qid":        p.qid,
        "difficulty": p.difficulty,
        "topics":     p.topics,
        "coding_lang": p.language,
        "time_taken": p.time_taken,
        "status":     "submitted",
        "timestamp":  datetime.now(),
    })
    return {"ok": True}


@router.get("/stats/{username}")
def stats(username: str):
    subs = get_db("DSA_code_app_db")["submissions"].find({"username": username})
    return {
        s["qid"]: {"status": s["status"], "time_taken": s.get("time_taken", "—"), "language": s.get("coding_lang", "—")}
        for s in subs
    }


@router.get("/performance/{username}")
def performance(username: str):
    subs = list(get_db("DSA_code_app_db")["submissions"].find({"username": username}))
    df = _df()
    problems = []
    for s in subs:
        qid = s["qid"]
        row_df = df[df["QID"] == qid]
        title      = row_df.iloc[0]["title"]      if not row_df.empty else f"Problem #{qid}"
        difficulty = row_df.iloc[0]["difficulty"]  if not row_df.empty else s.get("difficulty", "—")
        topics     = row_df.iloc[0]["topics"]      if not row_df.empty else s.get("topics", [])
        problems.append({
            "qid":        qid,
            "title":      title,
            "difficulty": difficulty,
            "topics":     topics if isinstance(topics, list) else [],
            "language":   s.get("coding_lang", "—"),
            "time_taken": s.get("time_taken", "—"),
            "timestamp":  s["timestamp"].isoformat() if s.get("timestamp") else None,
        })
    # sort newest first
    problems.sort(key=lambda x: x["timestamp"] or "", reverse=True)
    return {"problems": problems}
