// Record one SmallDocs onboarding path per video from onboarding-preview.js.
// Authentication starts from disposable fictional identities seeded by that preview.
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const base = process.env.ONBOARDING_PREVIEW_URL || 'http://localhost:3102';
const output = path.resolve(process.argv[2] || '/tmp/smalldocs-onboarding-videos');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
fs.mkdirSync(output, { recursive: true });

async function record(browser, file, width, run) {
  const height = width === 390 ? 844 : 900;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1,
    recordVideo: { dir: output, size: { width, height } } });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  try {
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await pause(2500);
    await run(page);
    await pause(2500);
  } finally {
    const video = page.video();
    await context.close();
    await video.saveAs(path.join(output, file + '.webm'));
    console.log('Saved ' + file + '.webm');
  }
}

async function signup(page, scenario = 'email', name = ['Alex', 'Rivera']) {
  await page.getByRole('link', { name: scenario === 'google' ? 'Google with profile name' : scenario === 'missing' ? 'Google without a profile name' : 'New email signup', exact: true }).click();
  if (scenario !== 'google') {
    await page.getByLabel('First name').waitFor();
    await page.getByLabel('First name').pressSequentially(name[0], { delay: 80 });
    await page.getByLabel('Last name').pressSequentially(name[1], { delay: 80 });
    await pause(350);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
}

async function personal(page, scenario, name) {
  await signup(page, scenario, name);
  await page.getByRole('heading', { name: 'Install SmallDocs', exact: true }).waitFor();
}

(async () => {
  const browser = await chromium.launch();
  let requestUrl = '', inviteUrl = '', requesterSwitchUrl = '', requesterActor = '';
  try {
    await record(browser, '01-email-signup-personal-library', 1280, async page => {
      await signup(page, 'email');
      await page.getByRole('heading', { name: 'Install SmallDocs', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Billing', exact: true }).click();
      await page.getByText(/Free until/).waitFor();
      await pause(1000);
      await page.getByRole('button', { name: 'Install', exact: true }).click();
      await page.getByRole('heading', { name: 'Install SmallDocs', exact: true }).waitFor();
    });

    await record(browser, '02-google-signup-with-profile', 1280, async page => {
      await personal(page, 'google');
    });

    await record(browser, '03-google-signup-add-missing-name', 1280, async page => {
      await personal(page, 'missing', ['Sam', 'Taylor']);
    });

    await record(browser, '04-trial-library-to-team', 1280, async page => {
      await signup(page, 'email', ['Jamie', 'Chen']);
      await page.getByRole('heading', { name: 'Install SmallDocs', exact: true }).waitFor();
      await page.getByRole('link', { name: 'Join or create a team', exact: true }).click();
      await page.getByRole('button', { name: 'Create a team', exact: true }).click();
      await page.getByLabel('Team name', { exact: true }).fill('Engineering');
      await page.getByRole('button', { name: 'Review team upgrade', exact: true }).click();
      await page.getByText(/original trial deadline/).waitFor();
      await pause(1000);
      await page.getByRole('button', { name: 'Create team', exact: true }).click();
      await page.getByRole('heading', { name: 'People', exact: true }).waitFor();
    });

    await record(browser, '05-request-team-access-create-link', 1280, async page => {
      await signup(page, 'email', ['Casey', 'Morgan']);
      await page.getByRole('heading', { name: 'Install SmallDocs', exact: true }).waitFor();
      await page.getByRole('link', { name: 'Join or create a team', exact: true }).click();
      await page.getByRole('button', { name: 'Request to join a team at joes.com', exact: true }).click();
      await page.getByLabel('Anything else? (optional)').fill('I work with engineering.');
      await page.locator('#request-consent').check();
      await page.getByRole('button', { name: 'Create request link', exact: true }).click();
      await page.locator('#request-link').waitFor();
      requestUrl = await page.locator('#request-link').inputValue();
      const actorCookie = (await page.context().cookies(base)).find(cookie => cookie.name === 'sdocs_preview_actor');
      if (!actorCookie) throw new Error('Preview requester identity cookie was not set');
      requesterActor = decodeURIComponent(actorCookie.value);
      const handoff = new URL(requestUrl);
      handoff.searchParams.set('requester', requesterActor);
      requestUrl = handoff.toString();
    });

    await record(browser, '06-admin-review-request-send-invitation', 1280, async page => {
      if (!requestUrl) throw new Error('Request URL was not created');
      await page.goto(requestUrl, { waitUntil: 'domcontentloaded' });
      await page.getByRole('link', { name: 'View as Bob (admin)', exact: true }).click();
      await page.getByText('Casey Morgan', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Send invitation', exact: true }).click();
      await page.locator('#invite-link').waitFor();
      await page.getByRole('button', { name: 'Copy invitation link', exact: true }).click();
      inviteUrl = await page.locator('#invite-link').inputValue();
      requesterSwitchUrl = await page.getByRole('link', { name: 'View as requester', exact: true }).getAttribute('href');
    });

    await record(browser, '07-requester-accept-team-invitation', 1280, async page => {
      if (!inviteUrl) throw new Error('Invitation URL was not created');
      await page.goto(base + requesterSwitchUrl, { waitUntil: 'domcontentloaded' });
      await page.goto(inviteUrl, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: "Join Joe's engineering" }).waitFor();
      await pause(800);
      await page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
      await page.getByRole('heading', { name: 'Install SmallDocs', exact: true }).waitFor();
    });

    await record(browser, '08-direct-invitation-add-name-and-join', 1280, async page => {
      await page.getByRole('link', { name: 'Invited to a team', exact: true }).click();
      await page.getByLabel('First name').waitFor();
      await page.getByLabel('First name').pressSequentially('Morgan', { delay: 80 });
      await page.getByLabel('Last name').pressSequentially('Lee', { delay: 80 });
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByRole('heading', { name: "Join Joe's engineering" }).waitFor();
      await pause(800);
      await page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
      await page.getByRole('heading', { name: 'Install SmallDocs', exact: true }).waitFor();
    });

    await record(browser, '09-returning-personal-library', 1280, async page => {
      await page.getByRole('link', { name: 'Existing personal library', exact: true }).click();
      await page.getByRole('heading', { name: 'Install SmallDocs', exact: true }).waitFor();
    });

    await record(browser, '10-existing-team-member-library', 1280, async page => {
      await page.getByRole('link', { name: 'Existing team member', exact: true }).click();
      await page.getByRole('heading', { name: 'Install SmallDocs', exact: true }).waitFor();
    });

    await record(browser, '11-connected-machine-settings', 1280, async page => {
      await page.getByRole('link', { name: 'Already connected', exact: true }).click();
      await page.getByText('Alexs-MacBook.local', { exact: true }).waitFor();
    });

    await record(browser, '12-mobile-email-signup-personal-library', 390, async page => {
      await signup(page, 'email', ['Riley', 'Park']);
      await page.getByRole('heading', { name: 'Install SmallDocs', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Billing', exact: true }).click();
      await page.getByText(/Free until/).waitFor();
    });

    await record(browser, '13-mobile-trial-library-to-team', 390, async page => {
      await signup(page, 'email', ['Drew', 'Kim']);
      await page.getByRole('heading', { name: 'Install SmallDocs', exact: true }).waitFor();
      await page.getByRole('link', { name: 'Join or create a team', exact: true }).click();
      await page.getByRole('button', { name: 'Create a team', exact: true }).click();
      await page.getByLabel('Team name', { exact: true }).fill('Design');
      await page.getByRole('button', { name: 'Review team upgrade', exact: true }).click();
      await page.getByText(/original trial deadline/).waitFor();
      await pause(1000);
      await page.getByRole('button', { name: 'Create team', exact: true }).click();
      await page.getByRole('heading', { name: 'People', exact: true }).waitFor();
    });
  } finally { await browser.close(); }
  console.log('Recorded onboarding videos in ' + output);
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
