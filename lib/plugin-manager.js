'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

async function runPlugins(context) {
  const dir = path.join(__dirname, 'plugins');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  if (!files.length) return context;

  console.log(`[plugins] Found ${files.length} plugin(s).`);

  for (const file of files) {
    try {
      delete require.cache[require.resolve(path.join(dir, file))];
      const plugin = require(path.join(dir, file));
      if (plugin && typeof plugin.execute === 'function') {
        console.log(`[plugins] Running ${plugin.name || file}...`);
        await plugin.execute(context);
        console.log(`[plugins] ✅ ${plugin.name || file} finished.`);
      }
    } catch (e) {
      console.error(`[plugins] ❌ ${file} failed: ${e.message}`);
      context.pluginErrors = context.pluginErrors || [];
      context.pluginErrors.push(`${file}: ${e.message}`);
    }
  }
  return context;
}

// Validate AI-generated plugin code in a child process with NO access to secrets.
// vm.createContext is NOT a sandbox; this actually isolates the code.
function validatePlugin(pluginCode, testContext) {
  return new Promise((resolve) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ariotica-forge-'));
    const pluginPath = path.join(tmpDir, 'plugin.js');
    const testPath = path.join(tmpDir, 'context.json');
    const outPath = path.join(tmpDir, 'out.json');
    const runnerPath = path.join(tmpDir, 'runner.js');

    fs.writeFileSync(pluginPath, pluginCode);
    fs.writeFileSync(testPath, JSON.stringify(testContext));

    const runner = `
      const fs = require('fs');
      (async () => {
        try {
          const plugin = require(${JSON.stringify(pluginPath)});
          const ctx = JSON.parse(fs.readFileSync(${JSON.stringify(testPath)}, 'utf8'));
          if (!plugin || typeof plugin.execute !== 'function') {
            throw new Error('Plugin did not export an execute(context) function.');
          }
          await Promise.resolve(plugin.execute(ctx));
          fs.writeFileSync(${JSON.stringify(outPath)}, JSON.stringify({
            ok: true,
            name: plugin.name || 'unnamed',
            files: ctx.files
          }));
          process.exit(0);
        } catch (e) {
          fs.writeFileSync(${JSON.stringify(outPath)}, JSON.stringify({
            ok: false,
            error: String(e && e.message || e)
          }));
          process.exit(1);
        }
      })();
    `;
    fs.writeFileSync(runnerPath, runner);

    // Stripped env: no GITHUB_TOKEN, no API keys, no NODE_OPTIONS injection
    const childEnv = {
      PATH: process.env.PATH || '/usr/bin:/bin',
      NODE_OPTIONS: ''
    };

    const child = spawn(process.execPath, [runnerPath], {
      env: childEnv,
      cwd: tmpDir,
      timeout: 5000,
      stdio: 'ignore'
    });

    child.on('close', () => {
      try {
        const out = JSON.parse(fs.readFileSync(outPath, 'utf8'));
        if (!out.ok) return resolve({ ok: false, error: out.error });
        const changed = JSON.stringify(testContext.files) !== JSON.stringify(out.files);
        if (!changed) return resolve({ ok: false, error: 'Plugin ran but did not modify context.files.' });
        resolve({ ok: true, name: out.name });
      } catch (e) {
        resolve({ ok: false, error: 'Sandbox returned invalid output: ' + e.message });
      } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      }
    });

    child.on('error', (e) => {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      resolve({ ok: false, error: e.message });
    });
  });
}

module.exports = { runPlugins, validatePlugin };