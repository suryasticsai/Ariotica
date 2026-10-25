# Changelog

## v1.0.0 — 2026-10-25 14:00 UTC — inspire

**Model:** Groq/openai/gpt-oss-120b · **Cost:** $0.0000

### What changed
- ✨ Pure vanilla JavaScript with no build step
- ✨ PeerJS based WebRTC audio call and data channel for text chat
- ✨ Hash‑based room identifier with automatic share‑link generation
- ✨ Responsive layout using Bootstrap’s Flex utilities and custom media queries
- ✨ CSS variables for color theming and smooth 0.3s transitions
- ✨ Accessibility: semantic HTML, aria‑labels, high‑contrast focus outlines
- ✨ Empty state message for chat
- ✨ Copy‑to‑clipboard share link button
- ✨ Mute/unmute microphone toggle
- 🐛 Ensures media permissions are requested on load and gracefully alerts if denied
- 🐛 Handles both incoming and outgoing PeerJS connections to avoid errors
- 🐛 Updates document.title based on the active room
- 🐛 Hides empty‑state once a message appears

### Files
New project — see source files for initial content.

### Human follow-up
Minimal – the app runs automatically after the user opens the page and grants microphone access. Only manual actions required are copying the share link, muting/unmuting, and typing messages.

### Next
- Add a video element for optional webcam sharing
- Persist user nickname in localStorage with a "peerchat_nickname" key
- Implement a small notification sound for incoming chat messages

