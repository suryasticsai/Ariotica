#!/usr/bin/env node
'use strict';
// Builds knowledge/index.json (repo files + project manifest + issue history) for the Ask chat.
const fs = require('fs');
const K = require('./lib/knowledge');

(async () => {
  let chunks = K.collectRepoChunks(process.cwd());
  const [owner, repo] = (process.env.GITHUB_REPOSITORY || '').split('/');
  if (owner && repo && process.env.GITHUB_TOKEN) {
    const { Octokit } = require('@octokit/rest');
    chunks = chunks.concat(await K.collectIssueChunks(new Octokit({ auth: process.env.GITHUB_TOKEN }), owner, repo));
  }
  fs.mkdirSync('knowledge', { recursive: true });
  const json = JSON.stringify(K.buildIndexObject(chunks));
  fs.writeFileSync('knowledge/index.json', json);
  console.log(`Indexed ${chunks.length} chunks (${Math.round(json.length / 1024)} KB) -> knowledge/index.json`);
})().catch((e) => { console.error(e); process.exit(1); });