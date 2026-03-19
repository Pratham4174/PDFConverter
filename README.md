# ResumeSync — AI Resume Optimizer

Tailor your resume to any job description in seconds using Claude AI. Upload your resume, paste the JD, and get an ATS-optimized PDF back — same template, same page count.

---

## Project Structure

```
resume-sync/
├── server.js          # Express backend (API proxy)
├── package.json
├── .env.example       # Copy to .env and add your key
├── .gitignore
└── public/
    └── index.html     # Frontend (served by Express)
```

---

## Local Setup

### 1. Clone & install
```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd resume-sync
npm install
```

### 2. Add your API key
```bash
cp .env.example .env
```
Open `.env` and replace with your real key:
```
ANTHROPIC_API_KEY=sk-ant-...
```
Get your key from [console.anthropic.com](https://console.anthropic.com)

### 3. Run
```bash
npm start
```
Open [http://localhost:3000](http://localhost:3000)

For auto-reload during development:
```bash
npm run dev
```

---

## Deploy to Railway (free tier)

1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**
3. Select your repo
4. Go to **Variables** tab → Add:
   - `ANTHROPIC_API_KEY` = your key
5. Railway auto-detects Node.js and deploys — you get a live URL instantly

---

## Deploy to Render (free tier)

1. Go to [render.com](https://render.com) → **New Web Service**
2. Connect your GitHub repo
3. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Add environment variable: `ANTHROPIC_API_KEY`
5. Deploy ✅

---

## How It Works

```
Browser (index.html)
      ↓  POST /api/optimize  (no API key exposed)
Express Server (server.js)
      ↓  POST + secret API key
api.anthropic.com
      ↓  Optimized resume JSON
Express Server
      ↓
Browser → generates & downloads PDF ✅
```

---

## Features

- 📄 Upload PDF or TXT resume
- 📋 Paste any job description
- ⚡ Claude rewrites bullets to match JD keywords
- 🔒 API key never exposed to browser
- 📥 Download optimized resume as PDF
- 📊 Changelog of every modification made
