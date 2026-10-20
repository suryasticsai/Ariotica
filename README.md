<div align="center">
  <img src="https://raw.githubusercontent.com/suryasticsai/Ariotica/main/Ariotica-logo.png" alt="Ariotica Logo" width="150" style="border-radius: 20px; margin-bottom: 20px;" />

  # ⚡ Ariotica
  
  **The 100% Free, Self-Healing AI Engineering Pipeline.**

  An autonomous agent that turns GitHub Issues into fully functional, single-file vanilla JS apps. It writes code, tests it in a headless browser, scans it for vulnerabilities, and fixes its own bugs.

  [![Live Demo](https://img.shields.io/badge/Live_Dashboard-suryasticsai.github.io/Ariotica-5ab552?style=for-the-badge&logo=github)](https://suryasticsai.github.io/Ariotica/)
  [![Vanilla JS](https://img.shields.io/badge/Vanilla_JS-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](#)
  [![Zero Cost](https://img.shields.io/badge/100%25_Free-00a86b?style=for-the-badge)](https://github.com/suryasticsai/Ariotica)
  [![AI Agents](https://img.shields.io/badge/AI_Agentic_Workflow-blueviolet?style=for-the-badge)](#)

</div>

---

## 🚀 What is Ariotica?

Ariotica is an **agentic AI orchestrator** built entirely on GitHub Actions. Unlike simple prompt-to-code wrappers, Ariotica is a closed-loop system. It doesn't just write code; it **tests it, secures it, and iterates on it** until it works perfectly.

By leveraging a multi-provider free API fallback (Groq → Gemini → OpenRouter → Pollinations), it runs **100% free forever** without needing a credit card.

## ✨ Key Superpowers

- 🧠 **RAG Memory (BM25):** The agent remembers every app it has ever built. If you ask for a new app, it searches its own codebase and issue history to reuse your favorite styling and patterns.
- 🩺 **Self-Healing (JSDOM Smoke Tests):** Before committing, it loads the generated app in a headless browser, clicks every button, and catches runtime errors. If it crashes, it feeds the error back to the AI and forces it to fix itself.
- 🛡️ **Built-in Security (SAST):** Every app is scanned by custom XSS filters, ESLint, and Sparrow SAST.
- 💬 **Repo Chat:** Ask the agent questions directly in the issue thread, and it will answer with exact file citations.
- 🎨 **Strictly Vanilla:** Enforces 100% vanilla HTML/CSS/JS. No React, no Tailwind, no CDNs. Just pure, lightweight, offline-ready code.

---

## 🎮 How to Use the Agent

Create a new issue or reply to an existing one using these tags:

| Command | Action |
| :--- | :--- |
| **`[BUILD] my-app`** | Create a new app (use the issue body as the prompt). |
| **`[improve] ...`** | Add features or change the UI of an existing app. |
| **`[fix] ...`** | Describe a bug, and the agent will patch it. |
| **`[audit]`** | Force a deep security scan and auto-fix any vulnerabilities. |
| **`[delete]`** | Completely remove the app from the repo. |
| **`[ask] ...`** | Ask the AI a question about the repo (e.g., *"[ask] how does the drag-and-drop work?"*). |

*Example: Reply to an issue with `[improve] make the buttons larger and add a hover animation`.*

---

## 🖥️ The Live Dashboard

Visit the **[Ariotica Web UI](https://suryasticsai.github.io/Ariotica/)** to interact with the agent visually.

- **Direct Mode:** Paste a Fine-Grained Personal Access Token (with Actions & Contents Read/Write) to trigger builds directly from the UI.
- **Issue Mode:** No token required. Simply opens a pre-filled GitHub issue.
- **Live Progress:** Watch the agent think, write code, run tests, and commit in real-time via the progress modal.

---

## 🏗️ Architecture

Ariotica runs entirely inside a single GitHub Actions workflow:

```text
User Prompt (Issue/UI)
      │
      ▼
[RAG Search] ──► Finds similar past apps & code chunks
      │
      ▼
[LLM Providers] ──► Groq ──► Gemini ──► OpenRouter ──► Pollinations
      │
      ▼
[JSON Parser] ──► Extracts HTML
      │
      ▼
[SAST Scanners] ──► Custom XSS + ESLint + Sparrow
      │
      ▼
[JSDOM Smoke Test] ──► Clicks all buttons, catches errors
      │
      ▼ (If error, automatically fixes and retests)
      │
      ▼
[Commit] ──► Saves to `projects/app-name.html`
```

## 📁 Project Structure

- `generate.js` — The core agentic loop.
- `lib/providers.js` — The self-healing AI provider fallback system.
- `lib/rag.js` — Zero-dependency BM25 search engine.
- `lib/smoke.js` — JSDOM headless browser testing.
- `lib/scan.js` — ESLint & SAST security scanners.
- `index.html` — The GitHub Pages dashboard.

---

## 🛠️ Setup Your Own Instance

Want to fork this and run your own AI engineering team?

1. Fork this repository.
2. Go to **Settings → Actions → General** and set Workflow permissions to **Read and write**.
3. Go to **Settings → Secrets and variables → Actions** and add these free API keys:
   - `GROQ_API_KEY` (Get it free here)
   - `GEMINI_API_KEY` (Get it free here)
   - `OPENROUTER_API_KEY` (Get it free here)
4. Go to **Settings → Pages** and set the source to **Deploy from a branch → main → / (root)**.
5. Open a new issue titled `[BUILD] calculator` and watch the magic happen.

---

<div align="center">
  <i>Built for the open web. Powered by free AI tiers. Tested by robots.</i>
</div>
