# Lyka Realty – Backend API

## Backend Purpose
The backend provides API services for **Lyka Realty – AI Property Recommendation & Lead Qualification System**. This Step 1 foundation sets up the core FastAPI application, CORS middleware to allow communication with the frontend, and a health check endpoint.

---

## 1. How to Install Dependencies

Make sure Python (version 3.10+) is installed. Navigate to the `backend` directory:

```bash
cd backend
```

Create and activate a virtual environment (optional but recommended):

```bash
# On Windows
python -m venv venv
.\venv\Scripts\activate

# On macOS/Linux
python3 -m venv venv
source venv/bin/activate
```

Install the required dependencies:

```bash
pip install -r requirements.txt
```

---

## 2. How to Start the Server

Run the development server from the `backend` directory using Uvicorn:

```bash
uvicorn app.main:app --reload --port 8000
```

The application will be accessible at:
- Base URL: `http://127.0.0.1:8000`
- Interactive API Docs (Swagger UI): `http://127.0.0.1:8000/docs`

---

## 3. How to Test the Health Endpoint

### In the Browser or via HTTP Client
Navigate to:
[http://127.0.0.1:8000/api/health](http://127.0.0.1:8000/api/health)

### Using cURL
```bash
curl http://127.0.0.1:8000/api/health
```

### Expected JSON Response
```json
{
  "status": "ok",
  "message": "Lyka Realty backend is running"
}
```

---

## 4. How to Test the Gemini AI Endpoint

### Configuration
Ensure `backend/.env` contains your Gemini API key:
```env
GEMINI_API_KEY=your_gemini_api_key_here
```

### Using cURL
```bash
curl -X POST http://127.0.0.1:8000/api/gemini/test \
  -H "Content-Type: application/json" \
  -d "{\"message\": \"Hello, tell me about Dubai real estate in one sentence.\"}"
```

### Expected JSON Response
```json
{
  "response": "Hello, the Dubai real estate market is a highly dynamic, tax-free global hub renowned for its luxury properties, innovative developments, and strong investment returns."
}
```

