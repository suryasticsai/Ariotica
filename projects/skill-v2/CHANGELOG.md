# Changelog

## v1.2.0 — 2026-10-28 16:10 UTC — improve

**Model:** Groq/openai/gpt-oss-120b · **Cost:** $0.0043

### What changed
- ✨ Peer‑to‑peer audio/video call using PeerJS
- ✨ Real‑time text chat over the same PeerJS data channel
- ✨ Dynamic room sharing via URL hash
- ✨ Copy‑to‑clipboard share link
- ✨ Responsive layout with Flexbox and CSS variables
- ✨ Accessibility‑focused markup (ARIA live regions, labels, high contrast)
- 🐛 Added a logo image to the header
- 🐛 Converted header to a flex container for proper logo + title alignment
- 🐛 Ensured logo has appropriate size and alt text for accessibility

### Files
- `index.html` (+1 −0)
- `style.css` (+9 −1)

#### `index.html`
```diff
@@ … @@
 </head>
 <body>
   <header class="header">
+    <img src="logo.png" alt="P2P Voice &amp; Chat logo" class="logo" aria-hidden="true">
     <h1>P2P Voice &amp; Chat</h1>
   </header>
 
```

#### `style.css`
```diff
@@ … @@
 /* Layout */
 .header {
   padding: 1rem;
-  text-align: center;
+  display: flex;
+  align-items: center;
+  justify-content: center;
+  gap: 0.5rem;
   background: var(--color-primary);
   color: #fff;
+}
+
+.logo {
+  height: 40px;
+  width: auto;
 }
 
 .main {
```

### Human follow-up
Create or supply a logo image (logo.png) that matches the app branding.

### Next
- Provide an actual logo file (logo.png) in the project root
- Add dark‑mode support by extending CSS variables
- Persist last used room in localStorage (prefixed with "p2p_") for quick re‑join
- Implement a small settings panel (hash‑based routing) for toggling video‑only mode


## v1.1.0 — 2026-10-28 07:37 UTC — improve

**Model:** Groq/openai/gpt-oss-120b · **Cost:** $0.0040

### What changed
- ✨ Peer‑to‑peer voice and video calls using PeerJS
- ✨ Real‑time text chat over DataConnection
- ✨ Room sharing via URL hash
- ✨ Copy‑to‑clipboard share link
- ✨ Responsive layout with Flexbox
- ✨ Accessibility via semantic HTML, ARIA attributes
- ✨ Automatic title and share‑link updates on hash change
- 🐛 Buttons are now pill‑shaped (rounded) by introducing --btn-radius and applying it to .btn

### Files
- `style.css` (+4 −2)
- `script.js` (+1 −2)

#### `style.css`
```diff
@@ … @@
   --color-secondary: #6c757d;
   --color-text: #212529;
   --color-muted: #6c757d;
-  --radius: 8px;
+  --radius: 8px;               /* used for cards, inputs, etc. */
+  --btn-radius: 9999px;        /* makes buttons pill‑shaped */
   --transition: 0.3s ease;
   --max-width: 800px;
 }
@@ … @@
 .btn {
   padding: 0.5rem 1rem;
   border: none;
-  border-radius: var(--radius);
+  border-radius: var(--btn-radius);
   background: var(--color-secondary);
   color: #fff;
   cursor: pointer;
@@ … @@
     max-width: 100%;
   }
 }
+
```

#### `script.js`
```diff
@@ … @@
   }
 
   function copyLink() {
-    // Prefer Clipboard API, fallback to execCommand for older browsers
     if (navigator.clipboard && navigator.clipboard.writeText) {
       navigator.clipboard.writeText(shareLink.value).catch(() => fallbackCopy());
     } else {
@@ … @@
     try {
       document.execCommand('copy');
     } catch (e) {
-      // Silently ignore – copying is best‑effort
+      // ignore
     }
   }
 
```

### Human follow-up
User requested rounder buttons; developer updated CSS to use a pill‑shaped radius while keeping other UI components unchanged.

### Next
- Consider adding a dark‑mode toggle using CSS variables
- Persist last used room ID in localStorage with a namespaced key (e.g., "p2p_lastRoom")
- Add visual feedback for connection states (e.g., icons or colored status bar)


## v1.0.0 — 2026-10-27 16:59 UTC — create

**Model:** Groq/openai/gpt-oss-120b · **Cost:** $0.0096

### Files
New project — see source files for initial content.

### Human follow-up
Low
