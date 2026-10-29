'use strict';
const { Octokit } = require('@octokit/rest');
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

async function scrapeUrl(url) {
  // 1. GitHub Repos (Raw Code)
  const ghMatch = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (ghMatch) {
    const [_, owner, repo] = ghMatch;
    console.log(`[scraper] Detected GitHub repo: ${owner}/${repo}. Fetching raw files...`);
    try {
      const paths = ['index.html', 'README.md', 'script.js', 'package.json'];
      let content = '';
      for (const path of paths) {
        try {
          const { data } = await octokit.repos.getContent({ owner, repo, path });
          if (data && data.content) {
            content += `\n--- FILE: ${path} ---\n` + Buffer.from(data.content, 'base64').toString('utf8');
          }
        } catch (e) { /* File doesn't exist, ignore */ }
      }
      if (content) return content.slice(0, 30000);
    } catch (e) { console.log(`[scraper] GitHub fetch failed: ${e.message}`); }
  }

  // 2. Firecrawl (Premium RAG Scraper)
  if (process.env.FIRECRAWL_API_KEY) {
    try {
      console.log(`[scraper] Fetching ${url} via Firecrawl...`);
      const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.FIRECRAWL_API_KEY}`
        },
        body: JSON.stringify({
          url: url,
          formats: ['markdown'],
          onlyMainContent: true
        })
      });
      const data = await res.json();
      if (data.success && data.data && data.data.markdown) {
        return data.data.markdown.slice(0, 30000);
      }
      console.log(`[scraper] Firecrawl returned no markdown, falling back...`);
    } catch (e) {
      console.log(`[scraper] Firecrawl failed: ${e.message}`);
    }
  }

  // 3. Jina Reader (Free Fallback)
  try {
    console.log(`[scraper] Fetching ${url} via Jina (fallback)...`);
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { 'Accept': 'text/plain', 'X-Return-Format': 'markdown' }
    });
    if (!res.ok) throw new Error(`Jina HTTP ${res.status}`);
    const markdown = await res.text();
    return markdown.slice(0, 30000);
  } catch (e) {
    console.log(`[scraper] Jina failed: ${e.message}`);
    return null;
  }
}

module.exports = { scrapeUrl };