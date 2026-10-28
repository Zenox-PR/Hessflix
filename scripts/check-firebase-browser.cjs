// Diagnostic réseau facultatif : vrai SDK, sans connexion ni création de compte.
const { chromium } = require('@playwright/test');
const { once } = require('node:events');
const assert = require('node:assert/strict');
const { createMovixServer } = require('../server.cjs');
(async () => {
  const server = createMovixServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.MOVIX_TEST_BROWSER_CHANNEL ? { channel: process.env.MOVIX_TEST_BROWSER_CHANNEL } : {}) });
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { window.cspViolations = []; document.addEventListener('securitypolicyviolation', event => window.cspViolations.push({ directive: event.violatedDirective, blocked: event.blockedURI })); });
    await page.goto(`http://127.0.0.1:${server.address().port}/connexion.html`);
    await page.waitForFunction(() => window.MovixAuthStatus && window.MovixAuthStatus.state !== 'loading', null, { timeout: 25000 });
    const result = await page.evaluate(() => ({ state: window.MovixAuthStatus, adapter: Boolean(window.MovixAuthAdapter), violations: window.cspViolations }));
    assert.equal(result.state.state, 'ready'); assert.equal(result.adapter, true); assert.deepEqual(result.violations, []); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ realSDK: 'ready', cspViolations: 0, pageErrors: 0, realAccountUsed: false }));
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
