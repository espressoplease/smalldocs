const { defineConfig } = require('@playwright/test');
const baseURL = process.env.SDOCS_TEST_BASE_URL || 'http://localhost:3000';
module.exports = defineConfig({
  testDir: './test',
  testMatch: ['edit-mode-*.spec.js', 'rich-edit-mode*.spec.js'],
  timeout: 30000,
  workers: 2,
  use: { baseURL, headless: true },
  webServer: process.env.SDOCS_TEST_BASE_URL ? undefined : {
    command: 'node server.js', port: 3000, reuseExistingServer: true,
  },
  projects: ['chromium', 'firefox', 'webkit'].map(browserName => ({ name: browserName, use: { browserName } })),
});
