const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/browser', fullyParallel: false, workers: 1,
  use: { headless: true, ...(process.env.MOVIX_TEST_BROWSER_CHANNEL ? { channel: process.env.MOVIX_TEST_BROWSER_CHANNEL } : {}) },
  reporter: 'list', timeout: 30000
});
