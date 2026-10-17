const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './test',
  testMatch: ['cloud-email-onboarding.spec.js', 'cloud-single-plan.spec.js', 'cloud-onboarding-real.spec.js',
    'cloud-admin.spec.js', 'cloud-invite.spec.js', 'cloud-onboarding.spec.js', 'cloud-ui-real.spec.js', 'homepage-next.spec.js'],
  timeout: 30000, workers: 2,
  use: { baseURL: 'http://localhost:3199', headless: true, serviceWorkers: 'block' },
  webServer: { command: 'node test/onboarding-ui-server.js', url: 'http://localhost:3199/version-check', reuseExistingServer: false,
    env: { GOOGLE_OAUTH_CLIENT_ID: 'ui-fixture-client', GOOGLE_OAUTH_CLIENT_SECRET: 'ui-fixture-secret' } },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
