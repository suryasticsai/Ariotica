---

name: ariotica-ui
description: >-
Premium dark-space UI system for any web page, app mockup, or tool the agent
generates. Produces Android-app-grade interfaces (glass chrome, bottom dock
with center FAB, status bar) over a living starfield, with the "Ariotica"
watermark blended into the layout as a signature. Use whenever the user asks
for UI, a page, a demo, a mockup, or "make it look stunning".
version: 1.0.0

---

Ariotica UI/UX Skill

The house style: deep-space dark, comet-amber accents, glass chrome, motion
that breathes, and an Ariotica watermark that is part of the scenery — never a
stamp. Every page generated with this skill must look like a flagship Android
app ported to the web, sitting inside a living night sky.

---

1. When to use

- Any generated HTML/CSS/JS page, demo, dashboard, mockup, or tool.
- Whenever the user says "make it beautiful", "stunning UI", "modern design",
  "app-like", or provides a screenshot of an Android app as reference.
- Works for marketing pages, internal tools, games, docs — the system adapts,
  the signature elements stay.

---

2. Non-negotiables (apply to EVERY output)

#	Rule	
1	Dark space backdrop: layered starfield + nebula glow + vignette. Never a flat dark color.	
2	Ariotica watermark blended into the chrome (see §6). Every file, no exceptions.	
3	Typography: Syne (display, 700, tight `-0.04em`) + Outfit (body/UI).	
4	Motion: CSS keyframes for ambient loops; GSAP for scroll/entrance. Respect `prefers-reduced-motion`.	
5	Accessibility: `focus-visible` outlines, `aria-current` on nav, aria labels on icon buttons, keyboard-safe interactive elements.	
6	Mobile-first; content must survive a 360px viewport.	
7	All third-party code via CDN bundles only — no build step, no local assets.	

---

3. Design tokens

Copy verbatim into `:root`. Do not invent new hues; derive variants with
`color-mix(in oklab, …)` — this keeps every output visually consistent.

```css
:root {
  /* palette */
  --void:    #06080d;   /* page background        */
  --surface: #141b26;   /* raised cards, glass    */
  --bone:    #e8edf4;   /* primary text           */
  --fog:     #93a0b3;   /* secondary text         */
  --comet:   #e7a15a;   /* THE accent — use sparingly: 1 active element per screen */
  /* type */
  --sans:    "Outfit", ui-sans-serif, system-ui, sans-serif;
  --display: "Syne", "Outfit", ui-sans-serif, sans-serif;
  /* elevation */
  --glass:   color-mix(in oklab, var(--void) 55%, transparent);
  --line:    color-mix(in oklab, var(--bone) 12%, transparent);
}
```

Accent discipline: comet-amber marks exactly one thing per screen — the
active nav indicator, the FAB, the primary CTA. Everything else stays bone/fog.
This single rule is 80% of the "premium" feel.

Spacing rhythm: multiples of `0.25rem`. Section gaps `≥ 1.25rem`. Touch
targets `≥ 2.75rem` (Android standard).

---

4. CDN bundle (pin these)

```html
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600&family=Syne:wght@600;700&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js"></script>
```

Tailwind is optional sugar; the tokens in §3 remain the source of truth.
Never add more than these + one domain-specific library (charts, 3D, etc.).

---

5. Signature layout — the "Android shell"

Every app-style page gets this chrome. Content panes swap inside it.

```
┌─ status bar (time · icons · camera dot)          ─ 2.4rem
├─ app header (brand + logo | chip)                ─ glass, sticky
│   └─ tab row (active = bone + comet underline)
├─ scroll viewport (panes swap here, blur-in)
│   └─ ✦ Ariotica watermark rides this layer ✦
├─ bottom dock (5 slots, center = raised FAB)      ─ glass, blur(18px)
└─ home indicator pill
```

Key CSS:

```css
.glass   { background: var(--glass); backdrop-filter: blur(18px) saturate(140%);
           border: 1px solid var(--line); }
.dock-fab{ width: 3.6rem; height: 3.6rem; border-radius: 999px; margin-top: -1.35rem;
           background: radial-gradient(circle at 50% 35%, color-mix(in oklab, var(--bone) 32%, var(--comet)), var(--comet) 62%);
           box-shadow: 0 0 0 .38rem color-mix(in oklab, var(--comet) 22%, transparent),
                       0 12px 28px rgb(0 0 0 / .45); }
```

Phone-frame pages wrap the shell in `.device` (rounded 2.6rem, bezel border);
full-page layouts keep the same shell edge-to-edge. Breakpoint `860px`:
frame dissolves into full-viewport app.

---

6. The Ariotica watermark (the signature)

Blended, not stamped. Three variants — choose by page type, never stack them:

A. Missile mark (app shell — default). A slim horizontal rocket SVG,
`pointer-events: none`, parked `right: .15rem; bottom: 5.7rem` above the dock,
`opacity: .82`, `filter: drop-shadow(0 0 14px comet-55%)`, slow hover loop.
Nose cone = `--comet`; body = `--bone`. This is the Noctis lineage.

B. Sticky sentinel (long-scroll marketing/docs pages). Fixed-position
watermark `right: 18px; bottom: 120px; opacity: .28; mix-blend-mode: screen;`
that tilts ±28° with scroll velocity and bobs on a sine loop. Never covers
content or intercepts clicks.

C. Wordmark thread (data-dense/tools pages). Rotated `ARITICA` — no, always
exact `ARIOTICA` — set in Syne 700, `letter-spacing: .3em`, `opacity: .07`,
sitting along the viewport's left or right edge at `z-index: -1`.

Hard rules: `aria-hidden="true"`, never in the tab order, never above
`opacity: .35` except variant A inside the app shell, always themed from
tokens (never hardcoded hex).

---

7. Backdrop recipe (CSS-first, canvas optional)

Layer order, back to front:
1. `--void` base.
2. `.milky` — one rotated `linear-gradient` wash (bone 7% → comet 10% → transparent).
3. `.stars-far` + `.stars` — pure-CSS radial-gradient star tiles, two sizes,
   counter-drifting (`140s` / `90s linear infinite`). A few stars get oversized
   soft halos; two per tile are comet-tinted.
4. Optional `<canvas>` starfield with twinkle + meteors when the page is a
   hero/immersive piece — cap 260 stars, reuse the same palette.
5. `.vignette` — `radial-gradient(ellipse at center, transparent 42%, void-78% 100%)`.

Meteors: absolutely-positioned 1px gradient bars, `rotate(212deg)`, 9s loop,
two instances offset by half the cycle.

---

8. Motion language

Purpose	Tool	Spec	
Ambient loops (stars, hover, pulse)	CSS keyframes	`ease-in-out`, `alternate`, 8–140s	
Pane/tab swaps	CSS reflow trick	remove class → `void offsetWidth` → re-add (460ms `rise`)	
Scroll entrances / parallax	GSAP ScrollTrigger	`power3.out`, `y: 40 → 0`, start `top 88%`	
Micro-feedback	CSS	`:active { scale: .96 }` on every pressable	

Global guard — always ship:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
```

---

9. Live data hooks (open endpoints)

When the page needs imagery/data, fetch from open APIs with graceful fallback
and a shimmer skeleton while loading:

- NASA APOD: `https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY`
- Images fallback: `https://picsum.photos/seed/<themed-word>/<w>/<h>`

Never block first paint on the fetch — render the shell instantly.

---

10. Quality gate — run before delivering

1. Tokens used, no stray hex colors outside `:root`.
2. Exactly one comet-accented active element per screen.
3. Watermark present, hidden from AT, non-interactive.
4. Shell chrome complete (status bar / header / dock / home pill) if app-style.
5. `prefers-reduced-motion` guard present.
6. Passes 360px width without horizontal scroll.
7. `focus-visible` style on all buttons/links.
8. CDN count ≤ 5; no local asset dependencies.
9. First paint does not wait on network data.
10. View source reads intentional — this skill's output should look designed even in DevTools.

---

11. Starter skeleton (drop-in)

```html
<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Ariotica</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600&family=Syne:wght@600;700&display=swap" rel="stylesheet">
<style>/* §3 tokens + §5 chrome + §7 backdrop + §6 watermark A */</style>
</head><body>
<div class="milky"></div><div class="stars-far"></div><div class="stars"></div><div class="vignette"></div>
<!-- §5 shell: status bar → header → panes → watermark A → dock → home pill -->
<script>/* pane swap + hold/switch controls + GSAP reveals */</script>
</body></html>
```

---

Ariotica — designed even in DevTools.