const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './test', testMatch: ['cloud-history.spec.js', 'cloud-history-upgrade.spec.js'], timeout: 30000, workers: 2,
  use: { headless: true },
  projects: ['chromium', 'firefox', 'webkit'].map(browserName => ({ name: browserName, use: { browserName } })),
});
