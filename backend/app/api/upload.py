"""
File Upload & Parser — CSV, Excel, Word, PDF
Supports Amazon Seller Central exports and client-provided documents.
"""
import base64

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from app.services.csv_parser import (
    parse_csv, parse_excel, parse_docx, parse_pdf, detect_report_type,
)
from app.services.s3_storage import upload_to_s3, download_from_s3
from app.core.dependencies import get_current_user

router = APIRouter()

ACCEPTED_EXTENSIONS = {".csv", ".xlsx", ".xls", ".docx", ".pdf"}

CONTENT_TYPES = {
    ".csv":  "text/csv",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls":  "application/vnd.ms-excel",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pdf":  "application/pdf",
}


def _ext(filename: str) -> str:
    return "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


@router.post("/csv")
async def upload_file(file: UploadFile = File(...), user: str = Depends(get_current_user)):
    """
    Upload CSV, Excel, Word, or PDF file.
    - CSV / Excel: parsed into tabular data, report type auto-detected.
    - Word / PDF: text extracted and returned as document context.
    """
    if not file.filename:
        raise HTTPException(400, "No filename provided")

    ext = _ext(file.filename)
    if ext not in ACCEPTED_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file type '{ext}'. Accepted: CSV, Excel, Word, PDF")

    try:
        contents = await file.read()

        # ── Tabular formats (CSV / Excel) ──────────────────────────────────
        if ext in (".csv", ".xlsx", ".xls"):
            df = parse_csv(contents) if ext == ".csv" else parse_excel(contents)
            report_type = detect_report_type(df)
            preview = df.head(20).fillna("").astype(str).to_dict(orient="records")

            s3_key = await upload_to_s3(
                contents, filename=file.filename, report_type=report_type,
                content_type=CONTENT_TYPES[ext],
            )

            return {
                "success":     True,
                "filename":    file.filename,
                "file_type":   ext.lstrip("."),
                "report_type": report_type,
                "rows":        len(df),
                "columns":     list(df.columns),
                "preview":     preview,
                "s3_key":      s3_key,
            }

        # ── Document formats (Word / PDF) ──────────────────────────────────
        if ext == ".docx":
            raw_text = parse_docx(contents)
            df_from_doc = None
        else:  # .pdf
            df_from_doc, raw_text = parse_pdf(contents)

        s3_key = await upload_to_s3(
            contents, filename=file.filename, report_type="document",
            content_type=CONTENT_TYPES[ext],
        )

        # If a table was found in the PDF, treat it like a tabular upload
        if df_from_doc is not None and not df_from_doc.empty:
            report_type = detect_report_type(df_from_doc)
            preview = df_from_doc.head(20).fillna("").astype(str).to_dict(orient="records")
            return {
                "success":     True,
                "filename":    file.filename,
                "file_type":   ext.lstrip("."),
                "report_type": report_type,
                "rows":        len(df_from_doc),
                "columns":     list(df_from_doc.columns),
                "preview":     preview,
                "raw_text":    raw_text[:2000],
                "s3_key":      s3_key,
            }

        # Pure document — return text context
        return {
            "success":     True,
            "filename":    file.filename,
            "file_type":   ext.lstrip("."),
            "report_type": "document",
            "rows":        0,
            "columns":     [],
            "preview":     [],
            "raw_text":    raw_text[:4000],
            "s3_key":      s3_key,
        }

    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Upload failed: {str(e)}")


@router.post("/csv/preview")
async def preview_file(file: UploadFile = File(...), user: str = Depends(get_current_user)):
    """Preview file structure without storing."""
    if not file.filename:
        raise HTTPException(400, "No filename provided")

    ext = _ext(file.filename)
    if ext not in ACCEPTED_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file type '{ext}'")

    contents = await file.read()

    if ext in (".csv", ".xlsx", ".xls"):
        df = parse_csv(contents) if ext == ".csv" else parse_excel(contents)
        return {
            "report_type": detect_report_type(df),
            "rows":        len(df),
            "columns":     list(df.columns),
            "preview":     df.head(5).fillna("").astype(str).to_dict(orient="records"),
        }

    if ext == ".docx":
        raw_text = parse_docx(contents)
    else:
        _, raw_text = parse_pdf(contents)

    return {
        "report_type": "document",
        "rows":        0,
        "columns":     [],
        "preview":     [],
        "raw_text":    raw_text[:1000],
    }


@router.get("/file")
async def get_file(s3_key: str = Query(...), user: str = Depends(get_current_user)):
    """Download a previously uploaded file from S3 as base64."""
    # Basic path traversal guard: key must start with "uploads/"
    if not s3_key.startswith("uploads/"):
        raise HTTPException(400, "Invalid S3 key")

    result = await download_from_s3(s3_key)
    if not result:
        raise HTTPException(404, "File not found")

    contents, content_type = result
    filename = s3_key.rsplit("/", 1)[-1]
    # Strip timestamp prefix (YYYYMMDD_HHMMSS_)
    if len(filename) > 16 and filename[15] == "_":
        filename = filename[16:]

    return {
        "filename":     filename,
        "content_type": content_type,
        "file_data":    base64.b64encode(contents).decode("ascii"),
    }
