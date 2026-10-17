const { startFixture } = require('./cloud-onboarding-fixture');
(async () => {
  const fixture = await startFixture({ port: 3199 });
  console.log('Onboarding UI tests: ' + fixture.origin);
  let closing = false;
  async function close() { if (closing) return; closing = true; await fixture.close(); process.exit(0); }
  process.on('SIGTERM', close); process.on('SIGINT', close);
})().catch(error => { console.error(error.message); process.exit(1); });
