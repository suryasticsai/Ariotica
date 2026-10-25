# Adding a library

1. Pick a CDN URL that ends in `.js` or `.css`. Prefer `cdn.jsdelivr.net` with an exact version pin (`@x.y.z`).
2. Confirm the CDN host is in `trusted_domains.json`. If not, add it.
3. Add an entry to `libraries_catalog.json`:
   - `name` — human-readable
   - `purpose` — one line, what it's for
   - `tags` — keywords so the AI matches it to prompts
   - `cdn` — array of exact URLs (CSS + JS together when needed)
   - `connects` — WebSocket URLs the lib needs (PeerJS is the classic case; leave empty otherwise)
   - `global` — the JS global the lib defines (Vue → "Vue", PeerJS → "Peer")
   - `docs` — documentation URL
   - `usage` — 1–3 sentences: the API surface the AI should use and pitfalls
   - `example` — a self-contained working snippet (HTML)
4. Commit. Next build picks it up automatically. SRI hashes are computed and cached in `libraries_cache.json` — no manual step.

# Removing a library

Delete the entry from `libraries_catalog.json`. Existing apps that use it keep working (they reference the exact URL), but new builds won't know about it.

# Refreshing SRI after a version bump

Edit the URL(s) in the catalog entry. The build detects the new URL has no cache entry, fetches, rehashes, and stores under the new URL. Old cache entries become orphans — safe to prune occasionally.

# Bumping the pin

Same as above. Versions are pinned per-entry so a jsdelivr update can't silently change your bytes.