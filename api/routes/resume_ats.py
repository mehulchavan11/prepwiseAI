"""Resume ATS routes."""
from fastapi import APIRouter, UploadFile, File, Form
import PyPDF2, io
from google.genai.errors import ClientError
from api.services.gemini import analyze_resume

router = APIRouter()


@router.post("/analyze")
async def analyze(
    file:    UploadFile = File(...),
    job_desc: str       = Form(""),
    mode:    str        = Form("review"),
):
    try:
        data = await file.read()
        reader = PyPDF2.PdfReader(io.BytesIO(data))
        pdf_text = "".join(page.extract_text() or "" for page in reader.pages)

        if not pdf_text.strip():
            return {"error": "Could not extract text from this PDF. Try a different file."}

        return analyze_resume(pdf_text, job_desc, mode)

    except ClientError as e:
        if "RESOURCE_EXHAUSTED" in str(e):
            return {"error": "API quota exceeded. Please wait a minute and try again."}
        return {"error": f"API error: {e}"}
    except Exception as e:
        return {"error": f"Failed to process file: {e}"}
