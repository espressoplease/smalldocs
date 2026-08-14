const path = require('path');
const crypto = require('crypto');

const DEPLOYED_MODES = new Set(['staging', 'production']);
const REQUIRED_SHARED = [
  'CLOUD_AUTH_PEPPER',
  'CLOUD_IDEMPOTENCY_SECRET',
  'CLOUD_CURSOR_SECRET',
  'CLOUD_AUTH_DB',
  'CLOUD_OAUTH_DB',
  'CLOUD_DB',
  'CLOUD_BILLING_DB',
  'CLOUD_JOBS_DB',
  'STRIPE_PORTAL_CONFIGURATION_ID',
  'STRIPE_PERSONAL_PRICE_ID',
  'STRIPE_TEAM_PRICE_ID',
  'NOTIFY_SMTP_USER',
  'NOTIFY_EMAIL_FROM',
];
const DATABASE_PATHS = [
  'CLOUD_AUTH_DB', 'CLOUD_OAUTH_DB', 'CLOUD_DB', 'CLOUD_BILLING_DB', 'CLOUD_JOBS_DB',
];

class CloudDeploymentConfigError extends Error {
  constructor(problems) {
    super('Cloud deployment configuration is invalid: ' + problems.join('; '));
    this.name = 'CloudDeploymentConfigError';
    this.code = 'cloud_deployment_config_invalid';
    this.problems = problems;
  }
}

function present(env, name) {
  return typeof env[name] === 'string' && env[name].trim() !== '';
}

function validateCloudDeploymentConfig(env) {
  env = env || {};
  const mode = String(env.CLOUD_MODE || 'off').trim().toLowerCase();
  if (!['off', 'staging', 'production'].includes(mode)) {
    throw new CloudDeploymentConfigError(['CLOUD_MODE must be off, staging, or production']);
  }
  if (!DEPLOYED_MODES.has(mode)) return { mode, enabled: false };

  const problems = [];
  if (env.NODE_ENV !== 'production') problems.push('NODE_ENV must be production');
  if (env.SDOCS_DEV === '1') problems.push('SDOCS_DEV must be unset');
  if (env.CLOUD_AUTH_DEV_LOG_CODES === '1') problems.push('CLOUD_AUTH_DEV_LOG_CODES must be unset');

  let origin;
  try {
    origin = new URL(env.CLOUD_AUTH_PUBLIC_ORIGIN || '');
    if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search ||
        origin.hash || origin.username || origin.password) throw new Error('invalid origin');
  } catch (_) {
    problems.push('CLOUD_AUTH_PUBLIC_ORIGIN must be a bare HTTPS origin');
  }

  REQUIRED_SHARED.forEach((name) => {
    if (!present(env, name)) problems.push(name + ' is required');
  });
  const stripeSecretSources = ['STRIPE_SECRET_KEY', 'STRIPE_SECRET_KEY_FILE']
    .filter((name) => present(env, name));
  if (stripeSecretSources.length !== 1) {
    problems.push('exactly one of STRIPE_SECRET_KEY or STRIPE_SECRET_KEY_FILE is required');
  }
  const stripeWebhookSources = ['STRIPE_WEBHOOK_SECRET', 'STRIPE_WEBHOOK_SECRET_FILE']
    .filter((name) => present(env, name));
  if (stripeWebhookSources.length !== 1) {
    problems.push('exactly one of STRIPE_WEBHOOK_SECRET or STRIPE_WEBHOOK_SECRET_FILE is required');
  }
  if (!present(env, 'NOTIFY_SMTP_PASS') && !present(env, 'NOTIFY_SMTP_PASS_FILE')) {
    problems.push('NOTIFY_SMTP_PASS or NOTIFY_SMTP_PASS_FILE is required');
  }
  DATABASE_PATHS.forEach((name) => {
    if (present(env, name) && !path.isAbsolute(env[name])) problems.push(name + ' must be an absolute path');
  });
  if (String(env.CLOUD_ENVIRONMENT || '') !== mode) {
    problems.push('CLOUD_ENVIRONMENT must equal ' + mode);
  }

  if (mode === 'production') {
    if (!present(env, 'CLOUD_KMS_KEY_ID')) problems.push('CLOUD_KMS_KEY_ID is required');
    if (!present(env, 'CLOUD_KMS_CLIENT_MODULE') &&
        !present(env, 'CLOUD_KMS_REGION') && !present(env, 'AWS_REGION') &&
        !present(env, 'AWS_DEFAULT_REGION')) {
      problems.push('CLOUD_KMS_REGION or an AWS region variable is required');
    }
    if (present(env, 'CLOUD_MASTER_KEY')) problems.push('CLOUD_MASTER_KEY is not allowed');
  } else {
    const hasKms = present(env, 'CLOUD_KMS_KEY_ID');
    const hasLocal = present(env, 'CLOUD_MASTER_KEY');
    if (hasKms === hasLocal) {
      problems.push('staging requires exactly one of CLOUD_KMS_KEY_ID or CLOUD_MASTER_KEY');
    }
    if (hasKms && !present(env, 'CLOUD_KMS_CLIENT_MODULE') &&
        !present(env, 'CLOUD_KMS_REGION') && !present(env, 'AWS_REGION') &&
        !present(env, 'AWS_DEFAULT_REGION')) {
      problems.push('CLOUD_KMS_REGION or an AWS region variable is required');
    }
  }

  if (problems.length) throw new CloudDeploymentConfigError(problems);
  return { mode, enabled: true, origin: origin.origin,
    keyProvider: present(env, 'CLOUD_KMS_KEY_ID') ? 'kms' : 'local' };
}

async function checkCloudKmsReadiness(keyProvider, randomBytes) {
  if (!keyProvider || typeof keyProvider.wrapProjectKey !== 'function' ||
      typeof keyProvider.unwrapProjectKey !== 'function') {
    throw new CloudDeploymentConfigError(['managed KMS provider is unavailable']);
  }
  const bytes = randomBytes || crypto.randomBytes;
  const projectKey = bytes(32);
  const projectId = crypto.randomUUID();
  let opened;
  try {
    const wrapped = await keyProvider.wrapProjectKey(projectId, 1, projectKey);
    if (typeof keyProvider.clearCache === 'function') keyProvider.clearCache();
    opened = await keyProvider.unwrapProjectKey(projectId, 1, wrapped);
    if (!Buffer.isBuffer(opened) || opened.length !== projectKey.length ||
        !crypto.timingSafeEqual(opened, projectKey)) {
      throw new CloudDeploymentConfigError(['managed KMS readiness check failed']);
    }
    return { ok: true, keyReference: wrapped.reference };
  } finally {
    projectKey.fill(0);
    if (Buffer.isBuffer(opened)) opened.fill(0);
    if (typeof keyProvider.clearCache === 'function') keyProvider.clearCache();
  }
}

module.exports = { CloudDeploymentConfigError, checkCloudKmsReadiness,
  validateCloudDeploymentConfig };
