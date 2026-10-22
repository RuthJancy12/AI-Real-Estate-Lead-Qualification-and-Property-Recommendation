# 🏡 AI Real Estate Lead Qualification and Property Recommendation

An AI-powered real estate platform designed to help users discover suitable properties, qualify potential leads, and receive personalized property recommendations based on their preferences and budget.

## 📌 Overview

The **AI Real Estate Lead Qualification and Property Recommendation** system combines property search, conversational AI, and intelligent lead qualification to simplify the real estate discovery process.

Users can explore properties, specify their requirements, and interact with an AI assistant to find suitable options. The platform aims to make property discovery more efficient for both customers and real estate professionals.

## ✨ Features

- **Property Search:** Search properties based on location, budget, and other preferences.
- **Smart Recommendations:** Identify suitable properties based on user requirements.
- **AI Voice Agent:** Enable voice-based interaction for a more natural user experience.
- **Lead Qualification:** Collect and analyze customer requirements to understand their buying or rental intent.
- **Property Filtering:** Filter properties by location, price range, bedrooms, purpose, and property type.
- **Sorting:** Sort properties by price and property size.
- **Conversational Chatbot:** Allow users to communicate their property requirements through chat.
- **Responsive Interface:** Provide a user-friendly experience across different screen sizes.
- **Backend API Integration:** Retrieve property records from the backend and display them on the frontend.

## 🛠️ Tech Stack

### Frontend
- React
- TypeScript
- Vite
- CSS

### Backend
- Python
- FastAPI
- REST API

### AI and Data
- Ollama
- Llama 3.2 (3B)
- Python
- Pandas
- CSV-based property dataset

### Development Tools
- Visual Studio Code
- Git
- GitHub
- Node.js
- npm
- Uvicorn

## 🏗️ System Architecture

```text
User
  |
  v
React + TypeScript Frontend
  |
  +---- Property Search and Filters
  |
  +---- AI Chat / Voice Interface
  |
  v
FastAPI Backend
  |
  +---- Property Search API
  |
  +---- AI Chat Service
  |
  +---- Property Dataset (CSV)
  |
  v
Ollama Local Language Model
```

## 📂 Project Structure

```text
AI-Real-Estate-Lead-Qualification-and-Property-Recommendation/
│
├── frontend/
│   └── src/
│       ├── assets/
│       ├── components/
│       │   └── VoiceAgent/
│       └── ...
│
├── backend/
│   ├── main.py
│   ├── ...
│   └── property_dataset.csv
│
├── README.md
└── .gitignore
```

*Note: Update the directory tree to match the actual files and folders in your repository.*

## ⚙️ Prerequisites

Install the following tools before running the application:

- Node.js and npm
- Python 3.10 or a compatible version
- Git
- Ollama, if using the local AI chat service

## 🚀 Installation and Setup

### 1. Clone the Repository

```bash
git clone https://github.com/RuthJancy12/AI-Real-Estate-Lead-Qualification-and-Property-Recommendation.git
```

Navigate to the project directory:

```bash
cd AI-Real-Estate-Lead-Qualification-and-Property-Recommendation
```

### 2. Set Up the Backend

Navigate to the backend directory:

```bash
cd backend
```

Create a virtual environment:

```bash
python -m venv .venv
```

Activate it on Windows:

```powershell
.venv\Scripts\Activate.ps1
```

Install the required packages:

```bash
pip install fastapi uvicorn pandas
```

Install any additional dependencies listed in the project's `requirements.txt`, if available:

```bash
pip install -r requirements.txt
```

Start the backend server:

```bash
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Backend URL: `http://127.0.0.1:8000`

API documentation: `http://127.0.0.1:8000/docs`

### 3. Set Up the Frontend

Open a new terminal and navigate to the frontend directory:

```bash
cd frontend
```

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open the local URL displayed in the terminal, typically:

`http://localhost:5173`

### 4. Configure Ollama (Optional)

If the application uses Ollama for local AI chat, install Ollama and download the required model:

```bash
ollama pull llama3.2:3b
```

Start Ollama:

```bash
ollama serve
```

The default local API endpoint is:

`http://localhost:11434`

Make sure the backend is configured to use the correct Ollama model and endpoint.

## 🔍 Property Search

The property search functionality can support filters such as:

| Filter | Description |
|---|---|
| Location | Search by community or area |
| Budget | Set minimum and maximum prices |
| Bedrooms | Select studio or the required number of bedrooms |
| Purpose | Choose buying or renting |
| Property Type | Select an apartment, villa, penthouse, or townhouse |
| Sorting | Sort by price or property size |

Available options depend on the records in the configured property dataset.

## 🔗 API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/properties/search` | Search and filter properties |
| POST | `/api/chat` | Send a message to the AI chat service |

Use `/docs` on the running FastAPI server to verify the available endpoints and their request parameters.

## 🔐 Configuration and Security

- Keep API keys and credentials out of source control.
- Store secrets in environment variables or a local `.env` file.
- Add `.env`, `.venv/`, `node_modules/`, and generated files to `.gitignore` where appropriate.
- Do not expose private credentials in public repositories.
- Validate user inputs and handle API errors safely.

## 🧪 Testing

Before deployment, verify the following:

- Property search returns matching records.
- Budget and location filters work correctly.
- Property recommendations reflect user preferences.
- Chat responses work with the configured AI service.
- Voice interactions handle interruptions and repeated speech appropriately.
- Loading, empty-result, and error states display correctly.
- Frontend and backend communicate successfully.

## 🔮 Future Enhancements

- Advanced recommendation algorithms.
- Improved lead scoring and customer-intent classification.
- Integration with verified live property listings.
- Multilingual AI chat and voice support.
- Appointment scheduling for property visits.
- Lead analytics dashboard.
- Deployment to a cloud hosting platform.

## 🤝 Contributing

Contributions and suggestions are welcome.

1. Fork the repository.
2. Create a feature branch.
3. Implement and test your changes.
4. Submit a pull request with a clear description.

## 📄 License

A license has not yet been specified. Add an appropriate license before distributing the project for reuse.

## 👩‍💻 Project

**AI Real Estate Lead Qualification and Property Recommendation**

Built to make real estate discovery more accessible through AI-assisted search, conversational interaction, and personalized recommendations.
