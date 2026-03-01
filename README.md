# Amazon Audit MVP

Seller analytics dashboard for Amazon. Week 1 implementation per MVP roadmap.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14 (App Router) |
| UI | Tailwind CSS + Headless UI |
| Charts | Recharts |
| Auth | AWS Cognito |
| API Gateway | AWS API Gateway |
| Backend | FastAPI + Mangum |
| Compute | AWS Lambda |
| File Storage | AWS S3 |
| Database | AWS RDS PostgreSQL |
| Secrets | AWS Secrets Manager |
| CSV Parsing | Pandas |
| Hosting | Vercel |

## Week 1 Scope (AUD-1 to AUD-6)

- [x] CSV Upload & Parser (Business Reports, Active Listings, Account Health, Ads, FBA Inventory)
- [x] AWS S3 File Storage (structure ready)
- [x] AWS Cognito Auth (endpoints ready)
- [x] RDS PostgreSQL Setup (schema in `infra/schema.sql`)
- [x] FastAPI + Lambda Core (Mangum adapter)
- [x] API Gateway Setup (Lambda handler ready)
- [x] Next.js Dashboard UI (Tailwind + Headless UI)

## Quick Start

### 1. Backend (FastAPI)

```bash
cd backend
python -m venv venv
venv\Scripts\activate   # Windows
pip install -r requirements.txt
python run_local.py     # Runs on http://localhost:8000
```

### 2. Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev             # Runs on http://localhost:3000
```

### 3. Environment

- **Backend**: Copy `backend/.env.example` to `backend/.env` and fill AWS credentials when deploying.
- **Frontend**: Set `NEXT_PUBLIC_API_URL=http://localhost:8000` for local dev.

## Project Structure

```
amazon audit/
├── frontend/           # Next.js 14 + Tailwind + Headless UI + Recharts
│   └── src/
│       ├── app/        # App Router pages
│       └── components/ # CsvUpload, ReportPreview
├── backend/            # FastAPI + Mangum
│   ├── app/
│   │   ├── api/        # upload, auth, health
│   │   ├── core/       # config
│   │   └── services/   # csv_parser, s3_storage
│   └── lambda_handler.py
├── infra/
│   └── schema.sql      # RDS tables
└── mvp/                # Roadmap
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/health | Health check |
| POST | /api/auth/signup | Register (Cognito) |
| POST | /api/auth/signin | Login (Cognito) |
| POST | /api/upload/csv | Upload CSV, parse, store in S3 |
| POST | /api/upload/csv/preview | Preview CSV without storing |

## Deployment

1. **Vercel**: Connect frontend repo, set `NEXT_PUBLIC_API_URL` to API Gateway URL.
2. **AWS Lambda**: Package backend, deploy with Mangum handler. Point API Gateway to Lambda.
3. **RDS**: Run `infra/schema.sql` on PostgreSQL instance.
4. **S3**: Create bucket for uploads, configure IAM for Lambda.
5. **Cognito**: Create User Pool, wire `COGNITO_USER_POOL_ID` and `COGNITO_CLIENT_ID`.
