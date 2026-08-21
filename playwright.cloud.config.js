// @ts-check
const { defineConfig } = require('@playwright/test');

const liveBaseUrl = String(process.env.CLOUD_E2E_BASE_URL || '').replace(/\/$/, '');
if (liveBaseUrl && liveBaseUrl !== 'https://cloud-staging.smalldocs.org') {
  throw new Error('CLOUD_E2E_BASE_URL must be https://cloud-staging.smalldocs.org');
}
const baseURL = liveBaseUrl || 'https://127.0.0.1:3110';

module.exports = defineConfig({
  testDir: './test',
  testMatch: 'cloud-access-matrix.e2e.js',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    headless: true,
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  },
  webServer: liveBaseUrl ? undefined : {
    command: 'node test/cloud-e2e-server.js',
    url: baseURL + '/version-check',
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 15000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
