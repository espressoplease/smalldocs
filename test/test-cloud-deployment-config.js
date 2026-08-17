module.exports = function(harness) {
  const { assert, test, testAsync } = harness;
  const { CloudDeploymentConfigError, checkCloudKmsReadiness, validateCloudDeploymentConfig } =
    require('../lib/cloud-deployment-config');

  function deployedEnv(mode) {
    return {
      CLOUD_MODE: mode,
      NODE_ENV: 'production',
      CLOUD_AUTH_PUBLIC_ORIGIN: `https://${mode}.smalldocs.example`,
      CLOUD_AUTH_PEPPER: 'auth-pepper-value',
      CLOUD_IDEMPOTENCY_SECRET: 'idempotency-secret-value',
      CLOUD_CURSOR_SECRET: 'cursor-secret-value',
      CLOUD_ENVIRONMENT: mode,
      CLOUD_AUTH_DB: `/var/lib/smalldocs/${mode}/auth.db`,
      CLOUD_OAUTH_DB: `/var/lib/smalldocs/${mode}/oauth.db`,
      CLOUD_DB: `/var/lib/smalldocs/${mode}/cloud.db`,
      CLOUD_BILLING_DB: `/var/lib/smalldocs/${mode}/billing.db`,
      CLOUD_JOBS_DB: `/var/lib/smalldocs/${mode}/jobs.db`,
      STRIPE_SECRET_KEY: 'stripe-secret',
      STRIPE_WEBHOOK_SECRET: 'stripe-webhook-secret',
      STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_portal',
      STRIPE_PERSONAL_PRICE_ID: 'price_personal',
      STRIPE_TEAM_PRICE_ID: 'price_team',
      NOTIFY_SMTP_USER: 'smtp-user',
      NOTIFY_SMTP_PASS: 'smtp-password',
      NOTIFY_EMAIL_FROM: 'login@smalldocs.test',
    };
  }

  test('Cloud deployment mode defaults to off without changing the existing server', () => {
    assert.deepStrictEqual(validateCloudDeploymentConfig({}), {
      mode: 'off', enabled: false, publicMode: 'hidden', publicEnabled: false,
    });
  });

  test('Cloud public visibility defaults hidden and accepts an explicit enabled mode', () => {
    assert.strictEqual(validateCloudDeploymentConfig({ CLOUD_PUBLIC_MODE: 'enabled' }).publicEnabled, true);
    assert.throws(() => validateCloudDeploymentConfig({ CLOUD_PUBLIC_MODE: 'preview' }),
      (error) => error instanceof CloudDeploymentConfigError &&
        error.problems.includes('CLOUD_PUBLIC_MODE must be hidden or enabled'));
  });

  test('staging accepts isolated HTTPS links, databases, Stripe, mail, and a local test key', () => {
    const config = validateCloudDeploymentConfig({
      ...deployedEnv('staging'), CLOUD_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
    });
    assert.deepStrictEqual(config, { mode: 'staging', enabled: true,
      publicMode: 'hidden', publicEnabled: false,
      origin: 'https://staging.smalldocs.example', keyProvider: 'local' });
  });

  test('staging can use its own managed KMS key instead of a local test key', () => {
    const config = validateCloudDeploymentConfig({
      ...deployedEnv('staging'), CLOUD_KMS_KEY_ID: 'alias/smalldocs-cloud-staging',
      CLOUD_KMS_REGION: 'eu-central-1',
    });
    assert.strictEqual(config.keyProvider, 'kms');
  });

  test('production requires managed KMS and refuses the local key provider', () => {
    assert.throws(() => validateCloudDeploymentConfig({
      ...deployedEnv('production'), CLOUD_MASTER_KEY: Buffer.alloc(32, 4).toString('base64'),
    }), (error) => error instanceof CloudDeploymentConfigError &&
      error.problems.includes('CLOUD_KMS_KEY_ID is required') &&
      error.problems.includes('CLOUD_MASTER_KEY is not allowed'));
    const config = validateCloudDeploymentConfig({
      ...deployedEnv('production'), CLOUD_KMS_KEY_ID: 'alias/smalldocs-cloud-production',
      CLOUD_KMS_REGION: 'eu-central-1',
    });
    assert.strictEqual(config.keyProvider, 'kms');
  });

  test('deployed email accepts a systemd credential path instead of an environment secret', () => {
    const env = deployedEnv('production');
    env.CLOUD_KMS_KEY_ID = 'alias/smalldocs-cloud-production';
    env.CLOUD_KMS_REGION = 'eu-central-1';
    delete env.NOTIFY_SMTP_PASS;
    env.NOTIFY_SMTP_PASS_FILE = '/run/credentials/smalldocs.service/resend-api-key';
    assert.strictEqual(validateCloudDeploymentConfig(env).enabled, true);
  });

  test('deployed Stripe accepts exactly one systemd credential path or environment secret', () => {
    const fileEnv = deployedEnv('production');
    fileEnv.CLOUD_KMS_KEY_ID = 'alias/smalldocs-cloud-production';
    fileEnv.CLOUD_KMS_REGION = 'eu-central-1';
    delete fileEnv.STRIPE_SECRET_KEY;
    fileEnv.STRIPE_SECRET_KEY_FILE = '/run/credentials/smalldocs.service/stripe-api-key';
    assert.strictEqual(validateCloudDeploymentConfig(fileEnv).enabled, true);

    delete fileEnv.STRIPE_SECRET_KEY_FILE;
    assert.throws(() => validateCloudDeploymentConfig(fileEnv), (error) =>
      error.problems.includes(
        'exactly one of STRIPE_SECRET_KEY or STRIPE_SECRET_KEY_FILE is required'));

    fileEnv.STRIPE_SECRET_KEY = 'stripe-secret';
    fileEnv.STRIPE_SECRET_KEY_FILE = '/run/credentials/smalldocs.service/stripe-api-key';
    assert.throws(() => validateCloudDeploymentConfig(fileEnv), (error) =>
      error.problems.includes(
        'exactly one of STRIPE_SECRET_KEY or STRIPE_SECRET_KEY_FILE is required'));

    delete fileEnv.STRIPE_SECRET_KEY_FILE;
    fileEnv.STRIPE_SECRET_KEY = 'stripe-secret';
    delete fileEnv.STRIPE_WEBHOOK_SECRET;
    fileEnv.STRIPE_WEBHOOK_SECRET_FILE =
      '/run/credentials/smalldocs.service/stripe-webhook-secret';
    assert.strictEqual(validateCloudDeploymentConfig(fileEnv).enabled, true);
  });

  test('deployed modes reject unsafe origins, implicit paths, and development switches', () => {
    assert.throws(() => validateCloudDeploymentConfig({
      ...deployedEnv('staging'), CLOUD_MASTER_KEY: Buffer.alloc(32, 8).toString('base64'),
      CLOUD_AUTH_PUBLIC_ORIGIN: 'http://localhost:3000/cloud', CLOUD_DB: 'cloud.db',
      SDOCS_DEV: '1', CLOUD_AUTH_DEV_LOG_CODES: '1',
    }), (error) => error.problems.includes('CLOUD_AUTH_PUBLIC_ORIGIN must be a bare HTTPS origin') &&
      error.problems.includes('CLOUD_DB must be an absolute path') &&
      error.problems.includes('SDOCS_DEV must be unset') &&
      error.problems.includes('CLOUD_AUTH_DEV_LOG_CODES must be unset'));
  });

  return async function() {
    await testAsync('deployed KMS readiness wraps, clears, unwraps, compares, and wipes the test key', async () => {
      const cacheClears = [];
      let retainedKey;
      const provider = {
        async wrapProjectKey(projectId, version, key) {
          retainedKey = key;
          assert.match(projectId, /^[0-9a-f-]{36}$/);
          assert.strictEqual(version, 1);
          return { ciphertext: Buffer.from(key), nonce: Buffer.alloc(12), reference: 'kms-key-arn' };
        },
        async unwrapProjectKey(projectId, version, wrapped) {
          assert.strictEqual(wrapped.reference, 'kms-key-arn');
          return Buffer.from(wrapped.ciphertext);
        },
        clearCache() { cacheClears.push(true); },
      };
      const result = await checkCloudKmsReadiness(provider, () => Buffer.alloc(32, 7));
      assert.deepStrictEqual(result, { ok: true, keyReference: 'kms-key-arn' });
      assert.strictEqual(retainedKey.every((value) => value === 0), true);
      assert.strictEqual(cacheClears.length, 2);
    });
  };
};
