<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&height=190&color=0:0b1410,50:1f6f3a,100:5ab552&text=ARIOTICA&fontColor=e6f2ea&fontSize=64&fontAlignY=38&desc=The%20AI%20developer%20that%20lives%20in%20your%20repo&descAlignY=60&descSize=18" alt="Ariotica — the AI developer that lives in your repo" width="100%" />

<img src="https://raw.githubusercontent.com/suryasticsai/Ariotica/main/Ariotica-logo.png" alt="Ariotica logo" width="150" />

<a href="https://suryasticsai.github.io/Ariotica/">
  <img src="https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=600&size=20&pause=1400&color=5AB552&center=true&vCenter=true&width=640&lines=Open+an+issue.+Get+a+working+app.;Comment+%5Bfix%5D+%E2%80%94+it+patches+itself.;Comment+%5Bask%5D+%E2%80%94+it+answers+from+your+repo.;No+server.+No+database.+No+framework." alt="Open an issue. Get a working app. No server. No database. No framework." />
</a>

<br/>

[![Launch](https://img.shields.io/badge/▶_LAUNCH_THE_DASHBOARD-0b1410?style=for-the-badge&logo=github&logoColor=5ab552)](https://suryasticsai.github.io/Ariotica/)
[![Assign a task](https://img.shields.io/badge/ASSIGN_A_TASK-238636?style=for-the-badge&logo=github&logoColor=white)](https://github.com/suryasticsai/Ariotica/issues/new)

![Vanilla JS](https://img.shields.io/badge/Vanilla_JS-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![GitHub Actions](https://img.shields.io/badge/Runs_on-GitHub_Actions-2088FF?style=flat-square&logo=githubactions&logoColor=white)
![No server](https://img.shields.io/badge/Servers-0-1f6f3a?style=flat-square)
![No database](https://img.shields.io/badge/Databases-0-1f6f3a?style=flat-square)
![Bring your own model](https://img.shields.io/badge/Models-bring_your_own-5ab552?style=flat-square)

</div>

---

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


<details>
<summary><b>Project layout</b></summary>

<br/>

```text
generate.js          the agent: inputs, pipeline, status comment, [ask]
build-index.js       builds knowledge/index.json on demand
lib/providers.js     multi-provider LLM client with fallback
lib/rag.js           BM25 search (runs in Node and in the browser)
lib/knowledge.js     what the agent knows: files, manifest, issues
lib/scan.js          static security scanners
lib/smoke.js         jsdom runtime test
lib/text.js          parsing and validation helpers
projects/            the apps it has built
projects.json        manifest of every build
```

</details>

---

## 🚀 Give it a home in your GitHub

1. **Fork** this repository.
2. Under **Settings → Actions → General**, set workflow permissions to **Read and write**.
3. Under **Settings → Secrets and variables → Actions**, add one or more keys: `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `HF_TOKEN`. None are required, because Pollinations works without a key.
4. Turn on **GitHub Pages** from the `main` branch for the dashboard.
5. Open an issue titled `[BUILD] calculator` and describe what you want.

No Python environment, no Docker image, no server fleet.

> **Security note:** The dashboard's Direct mode uses a GitHub personal access token. Treat it like a password, give it fine-grained permissions on this repo only, and never commit it. Issue mode needs no token.

---

<div align="center">

## ☀️ The human behind the agent

<a href="https://github.com/suryasticsai">
  <img src="https://github.com/suryasticsai.png" alt="Surya, creator of Ariotica" width="140" style="border-radius:50%" />
</a>

**Surya** · [@suryasticsai](https://github.com/suryasticsai)

*AI toolmaker · independent developer · automation architect*

> "I didn't want another AI that tells me how to write code.
> I wanted one that actually does the work."

<br/>

[![GitHub](https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/suryasticsai)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/suryasticsai)
[![Medium](https://img.shields.io/badge/Medium-000000?style=for-the-badge&logo=medium&logoColor=white)](https://suryasticsai.medium.com/)
[![Hugging Face](https://img.shields.io/badge/Hugging_Face-FFD21E?style=for-the-badge&logo=huggingface&logoColor=black)](https://huggingface.co/Suryasticsai)
[![Portfolio](https://img.shields.io/badge/Portfolio-2563EB?style=for-the-badge&logo=googlechrome&logoColor=white)](https://suryasticsai.8b.io/)
[![Alkembic](https://img.shields.io/badge/Alkembic-8B5CF6?style=for-the-badge&logo=netlify&logoColor=white)](https://alkembic.netlify.app/)

<br/>

**The agent writes software. The human wrote the agent.**

<sub>Built with JavaScript. Powered by GitHub. Designed to ship. © 2026 Surya</sub>

<img src="https://capsule-render.vercel.app/api?type=waving&height=110&color=0:5ab552,50:1f6f3a,100:0b1410&section=footer" alt="" width="100%" />

</div>
