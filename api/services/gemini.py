"""Gemini AI service — all LLM calls in one place."""
import json, re
from google import genai
from google.genai.errors import ClientError
from api.config import GEMINI_API_KEY, GEMINI_MODEL

_client = genai.Client(api_key=GEMINI_API_KEY)


def _call(prompt: str) -> str:
    response = _client.models.generate_content(model=GEMINI_MODEL, contents=prompt)
    return response.text


# ── Mock Interview ────────────────────────────────────────────────────────────

def generate_interview_questions(role: str, stack: str, experience: int) -> list[str]:
    prompt = (
        f"Generate exactly 5 technical interview questions for a {role} role.\n"
        f"Tech stack: {stack}. Candidate experience: {experience} year(s).\n"
        "Format: number each question on its own line (e.g. '1. What is ...')\n"
        "Output ONLY the 5 questions, nothing else."
    )
    text = _call(prompt)
    questions = []
    for line in text.splitlines():
        line = line.strip()
        if line and line[0].isdigit():
            q = re.sub(r'^\d+[\.\)]\s*', '', line).strip()
            if q:
                questions.append(q)
    return questions[:5]


def evaluate_answer(question: str, answer: str) -> str:
    if not answer.strip():
        return "No answer provided."
    prompt = (
        f"Evaluate this interview answer concisely.\n\n"
        f"Question: {question}\n"
        f"Answer: {answer}\n\n"
        "Respond with:\nScore: X/10\nFeedback: [2-3 sentences of specific feedback]"
    )
    return _call(prompt)


# ── Resume ATS ────────────────────────────────────────────────────────────────

_PROMPTS = {
    "review": (
        "You are an experienced Technical HR Manager. Review this resume against the job description.\n"
        "Highlight: strengths, weaknesses, and overall alignment. Be specific and professional.\n\n"
        "Job Description:\n{job_desc}\n\nResume:\n{pdf_text}"
    ),
    "keywords": (
        "As an ATS expert, identify skills required from this job description.\n"
        "Return ONLY valid JSON in this exact format (no markdown, no extra text):\n"
        '{"Technical Skills": [], "Analytical Skills": [], "Soft Skills": []}\n\n'
        "Job Description:\n{job_desc}"
    ),
    "match": (
        "You are an ATS scanner. Evaluate how well this resume matches the job description.\n"
        "Provide:\n1. Match percentage (e.g. 72%)\n2. Missing keywords\n3. Final recommendation\n\n"
        "Job Description:\n{job_desc}\n\nResume:\n{pdf_text}"
    ),
}


def analyze_resume(pdf_text: str, job_desc: str, mode: str) -> dict:
    prompt = _PROMPTS.get(mode, _PROMPTS["review"]).format(
        pdf_text=pdf_text, job_desc=job_desc
    )
    text = _call(prompt)

    if mode == "keywords":
        m = re.search(r'\{.*\}', text, re.DOTALL)
        if m:
            try:
                return {"type": "keywords", "data": json.loads(m.group())}
            except json.JSONDecodeError:
                pass
        return {"type": "keywords", "data": {"Technical Skills": [], "Analytical Skills": [], "Soft Skills": []}}

    return {"type": "text", "data": text}
