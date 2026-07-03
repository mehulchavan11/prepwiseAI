"""PrepWise AI — FastAPI backend (replaces all Streamlit apps)."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.routes import aptitude, dsa, mock_interview, resume_ats, admin, proctor

app = FastAPI(title="PrepWise AI API", version="2.0.0", docs_url="/docs")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(aptitude.router,      prefix="/api/aptitude",  tags=["Aptitude"])
app.include_router(dsa.router,           prefix="/api/dsa",       tags=["DSA"])
app.include_router(mock_interview.router, prefix="/api/interview", tags=["Interview"])
app.include_router(resume_ats.router,    prefix="/api/resume",    tags=["Resume ATS"])
app.include_router(admin.router,         prefix="/api/admin",     tags=["Admin"])
app.include_router(proctor.router,       prefix="/api/proctor",   tags=["Proctor"])


@app.get("/")
def root():
    return {"message": "PrepWise AI API v2.0", "docs": "/docs"}
