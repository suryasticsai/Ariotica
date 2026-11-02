'use strict';
const { chromium } = require('playwright');
const { critiqueDesign } = require('./vision');

// Helper to deduplicate and limit error spam
function processErrors(errors, max = 8) {
  const unique = [...new Set(errors)].filter(e => {
    // Ignore harmless browser noise
    if (e.includes('favicon.ico')) return false;
    if (e.includes('net::ERR_ABORTED')) return false;
    return true;
  });
  return unique.slice(0, max);
}

async function visualAudit(htmlContent) {
  console.log('[Cyclops] Rendering app in headless browser...');
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  
  const consoleErrors = [];
  const networkErrors = [];
  const structuralErrors = [];

  try {
    // 1. Desktop Context
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    // Capture JS Console Errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // Capture Uncaught Exceptions
    page.on('pageerror', (err) => {
      consoleErrors.push(`Uncaught Exception: ${err.message}`);
    });

    // Capture Failed Network Requests (missing assets, 404s)
    page.on('requestfailed', (req) => {
      const url = req.url();
      // Ignore external analytics/fonts that might be blocked by the sandbox
      if (url.includes('google-analytics') || url.includes('fonts.gstatic')) return;
      networkErrors.push(`Failed to load: ${url.split('/').pop()} (${req.failure()?.errorText || 'Unknown'})`);
    });

    // Load the HTML
    await page.setContent(htmlContent, { waitUntil: 'domcontentloaded', timeout: 15000 });
    
    // Wait for load event and a small buffer for animations/scripts
    await page.waitForLoadState('load').catch(() => {});
    await page.waitForTimeout(1500);

    // Structural Check 1: Horizontal Overflow (Responsive Bug)
    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    if (hasOverflow) {
      structuralErrors.push("Horizontal overflow detected. The page is wider than the viewport, causing a horizontal scrollbar.");
    }

    // Structural Check 2: Missing Title
    const title = await page.title();
    if (!title || title.trim() === '' || title === 'App') {
      structuralErrors.push("Document title is missing or left as the default 'App'.");
    }

    // Take Desktop Screenshot
    const buffer = await page.screenshot({ type: 'png', fullPage: false });
    console.log(`[Cyclops] Desktop screenshot captured (${buffer.length} bytes)`);
    
    // 2. Mobile Context (Checks if the app breaks on small screens)
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(500); // Let CSS media queries apply
    const mobileOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    if (mobileOverflow && !hasOverflow) {
      structuralErrors.push("Mobile horizontal overflow detected (375px). Elements are breaking out of the mobile layout.");
    }

    // 3. Visual Critique (using the desktop screenshot)
    const critique = await critiqueDesign(buffer.toString('base64'));
    
    // 4. Aggregate and Format Errors
    const finalErrors = processErrors([
      ...structuralErrors,
      ...networkErrors,
      ...consoleErrors
    ]);

    if (finalErrors.length > 0) {
      console.log(`[Cyclops] Captured ${finalErrors.length} runtime/structural issue(s).`);
    } else {
      console.log(`[Cyclops] No runtime errors detected.`);
    }

    return {
      critique: critique || '',
      errors: finalErrors
    };

  } catch (e) {
    console.error(`[Cyclops] Audit failed: ${e.message}`);
    return { 
      critique: '', 
      errors: [`Cyclops runtime failure: ${e.message}`] 
    };
  } finally {
    await browser.close();
  }
}

module.exports = { visualAudit };