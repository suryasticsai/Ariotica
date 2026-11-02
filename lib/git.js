'use strict';
const { execSync } = require('child_process');
const { Octokit } = require('@octokit/rest');

const [OWNER, REPO] = (process.env.GITHUB_REPOSITORY || '').split('/');
const BRANCH = process.env.GITHUB_REF_NAME || 'main';
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf)$/i;

async function atomicCommit(files, deletedPaths = [], message = 'chore: update files') {
  if (!OWNER || !REPO) throw new Error('GITHUB_REPOSITORY not set');
  
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { data: refData } = await octokit.git.getRef({ owner: OWNER, repo: REPO, ref: `heads/${BRANCH}` });
      const latestCommitSha = refData.object.sha;
      const { data: commitData } = await octokit.git.getCommit({ owner: OWNER, repo: REPO, commit_sha: latestCommitSha });
      
      const treeItems = [];
      
      // 1. Add/Update files (handling binary vs text)
      for (const [p, content] of Object.entries(files)) {
        const isBinary = BINARY_EXT.test(p);
        const { data: blob } = await octokit.git.createBlob({ 
          owner: OWNER, repo: REPO, 
          content, 
          encoding: isBinary ? 'base64' : 'utf-8' 
        });
        treeItems.push({ path: p, mode: '100644', type: 'blob', sha: blob.sha });
      }
      
      // 2. Delete files (sha: null removes the path from the tree)
      for (const p of deletedPaths) {
        treeItems.push({ path: p, mode: '100644', type: 'blob', sha: null });
      }
      
      // 3. Create tree
      const { data: newTree } = await octokit.git.createTree({ 
        owner: OWNER, repo: REPO, 
        base_tree: commitData.tree.sha, 
        tree: treeItems 
      });
      
      // 4. Create commit
      const { data: newCommit } = await octokit.git.createCommit({ 
        owner: OWNER, repo: REPO, 
        message, 
        tree: newTree.sha, 
        parents: [latestCommitSha] 
      });
      
      // 5. Update branch ref
      await octokit.git.updateRef({ 
        owner: OWNER, repo: REPO, 
        ref: `heads/${BRANCH}`, 
        sha: newCommit.sha 
      });
      
      return newCommit.sha;
    } catch (e) {
      if (attempt === 3) throw e;
      console.warn(`[git] Commit attempt ${attempt} failed: ${e.message}. Retrying in 2s...`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

async function syncCheckout() {
  // Safety guard: Do not wipe local changes if running on a dev machine
  if (!process.env.GITHUB_ACTIONS) return;

  try {
    execSync(`git fetch origin ${BRANCH} --quiet`, { stdio: 'pipe' });
    execSync(`git reset --hard -q origin/${BRANCH}`, { stdio: 'pipe' });
    console.log(`[sync] checkout → origin/${BRANCH}`);
  } catch (e) {
    console.log('[sync] non-fatal:', e.message);
  }
}

module.exports = { atomicCommit, syncCheckout };