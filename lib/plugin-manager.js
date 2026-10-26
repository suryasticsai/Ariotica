'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

async function runPlugins(context) {
  const dir = path.join(__dirname, 'plugins');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  if (!files.length) return context;

  console.log(`[plugins] Found ${files.length} plugin(s).`);

  for (const file of files) {
    try {
      delete require.cache[require.resolve(path.join(dir, file))]; // clear cache for fresh runs
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

// Safely test the AI-generated code in a sandbox before saving it
async function validatePlugin(pluginCode, testContext) {
  const sandbox = { module: { exports: {} }, context: JSON.parse(JSON.stringify(testContext)) };
  vm.createContext(sandbox);
  
  try {
    // 1. Run the code in the sandbox
    vm.runInContext(pluginCode, sandbox, { timeout: 2000 });
    
    // 2. Check if it exported correctly
    const plugin = sandbox.module.exports;
    if (!plugin || typeof plugin.execute !== 'function') {
      throw new Error('Plugin did not export an `execute(context)` function.');
    }

    // 3. Execute the plugin against the test context
    await plugin.execute(sandbox.context);

    // 4. Verify the plugin actually changed something
    const changed = JSON.stringify(testContext.files) !== JSON.stringify(sandbox.context.files);
    if (!changed) {
      throw new Error('Plugin ran successfully but did not modify context.files.');
    }

    return { ok: true, name: plugin.name || 'unnamed-plugin' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { runPlugins, validatePlugin };