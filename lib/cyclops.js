'use strict';
const { chromium } = require('playwright');
const { critiqueDesign } = require('./vision');

async function visualAudit(htmlContent) {
  console.log('[Cyclops] Rendering app in headless browser...');
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.setContent(htmlContent, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1500);
    const buffer = await page.screenshot({ type: 'png', fullPage: false });
    console.log(`[Cyclops] Screenshot captured (${buffer.length} bytes)`);
    return await critiqueDesign(buffer.toString('base64'));
  } finally {
    await browser.close();
  }
}

module.exports = { visualAudit };