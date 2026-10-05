# Ariotica

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=suryasticsai_Ariotica&metric=alert_status)](https://sonarcloud.io/dashboard?id=suryasticsai_Ariotica)
[![Bugs](https://sonarcloud.io/api/project_badges/measure?project=suryasticsai_Ariotica&metric=bugs)](https://sonarcloud.io/dashboard?id=suryasticsai_Ariotica)
[![Vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=suryasticsai_Ariotica&metric=vulnerabilities)](https://sonarcloud.io/dashboard?id=suryasticsai_Ariotica)
[![Code Smells](https://sonarcloud.io/api/project_badges/measure?project=suryasticsai_Ariotica&metric=code_smells)](https://sonarcloud.io/dashboard?id=suryasticsai_Ariotica)

An agentic app generator. Describe an app in a GitHub issue → the agent generates pure vanilla-JS HTML, scans it for security issues, and commits it to `projects/`.

## How to use

1. Open https://suryasticsai.github.io/Ariotica/
2. Enter a project name and description
3. Tap **Generate** → submit the GitHub issue
4. Watch live progress on the page
5. The app appears in `projects/` in ~1 minute

## Issue title format

| Title | What it does |
|---|---|
| `[BUILD] my-app` | Create a new app |
| `[BUILD] my-app [improve]` | Improve the existing version |
| `[BUILD] my-app [fix]` | Fix a reported bug |
| `[BUILD] my-app [audit]` | Scan for security issues and auto-fix |
| `[BUILD] my-app [delete]` | Remove the app |

The issue **body** is the prompt (for create/improve), the bug report (for fix), or extra audit instructions (for audit).

## Stack

- **Pure vanilla JavaScript** — no frameworks, no CDNs, no build step
- **AI providers** (tried in order): GitHub Models → uncloseai → OVHcloud → KeylessAI → Pollinations
- **Security**: custom heuristics + ESLint + Sparrow SAST + SonarCloud
- **Hosting**: GitHub Pages
- No servers, no API keys for the core flow

## Structure

```
.
├── .github/workflows/
│   ├── ai-cron.yml       # Generation workflow
│   └── sonar.yml         # SonarCloud scan
├── projects/             # Generated apps live here
├── index.html            # Dashboard (GitHub Pages)
├── generate.js           # The agent
├── projects.json         # Manifest of generated apps
├── progress.json         # Live progress state
├── sonar-project.properties
└── README.md
```

## Setup

1. Settings → Actions → General → Workflow permissions → **Read and write**
2. Settings → Pages → Source: **Deploy from a branch** → `main` / `(root)`
3. (Optional) Settings → Secrets and variables → Actions → add `SONAR_TOKEN` for SonarCloud

That's it. No API keys required.