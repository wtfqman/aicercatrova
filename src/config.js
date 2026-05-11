require('dotenv').config();
const path = require('path');

const REQUIRED_ENV = [
  'BOT_TOKEN',
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
  'OPENROUTER_BASE_URL'
];

function getEnv(name, fallback = '') {
  return (process.env[name] || fallback).trim();
}

function parsePositiveInteger(name, fallback) {
  const value = Number.parseInt(getEnv(name), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseBoolean(name, fallback = false) {
  const value = getEnv(name).toLowerCase();

  if (!value) {
    return fallback;
  }

  return value === 'true';
}

function assertValidUrl(name, value) {
  try {
    new URL(value);
  } catch (error) {
    throw new Error(`Invalid ${name}: expected a valid URL.`);
  }
}

function assertRequiredEnv() {
  const missing = REQUIRED_ENV.filter((name) => !getEnv(name));

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. Fill them in .env before starting the bot.`
    );
  }
}

assertRequiredEnv();

const openRouterBaseUrl = getEnv('OPENROUTER_BASE_URL').replace(/\/+$/, '');
const openRouterAppUrl = getEnv('OPENROUTER_APP_URL', 'https://example.com');
const xaiBaseUrl = getEnv('XAI_BASE_URL', 'https://api.x.ai/v1').replace(/\/+$/, '');
const openAIBaseUrl = getEnv('OPENAI_BASE_URL', 'https://api.openai.com/v1').replace(/\/+$/, '');

assertValidUrl('OPENROUTER_BASE_URL', openRouterBaseUrl);
assertValidUrl('OPENROUTER_APP_URL', openRouterAppUrl);
assertValidUrl('XAI_BASE_URL', xaiBaseUrl);
assertValidUrl('OPENAI_BASE_URL', openAIBaseUrl);

const config = {
  botToken: getEnv('BOT_TOKEN'),
  aiTimeoutMs: parsePositiveInteger('AI_TIMEOUT_MS', 45000),
  telegramHandlerTimeoutMs: parsePositiveInteger('TELEGRAM_HANDLER_TIMEOUT_MS', 420000),
  historyLimit: Math.min(parsePositiveInteger('HISTORY_LIMIT', 4), 4),
  useHistory: parseBoolean('USE_HISTORY', false),
  video: {
    tempDir: getEnv('VIDEO_TEMP_DIR', path.join(process.cwd(), 'tmp', 'video')),
    maxDurationSec: parsePositiveInteger('VIDEO_MAX_DURATION_SEC', 600),
    jobTimeoutMs: parsePositiveInteger('VIDEO_JOB_TIMEOUT_MS', 300000),
    ytDlpFormat: getEnv('YT_DLP_FORMAT', 'ba/b[height<=720]/worst'),
    ytDlpForceIp: getEnv('YT_DLP_FORCE_IP', 'auto').toLowerCase(),
    ytDlpSocketTimeoutSec: parsePositiveInteger('YT_DLP_SOCKET_TIMEOUT_SEC', 60),
    ytDlpRetries: parsePositiveInteger('YT_DLP_RETRIES', 3),
    ytDlpExtractorRetries: parsePositiveInteger('YT_DLP_EXTRACTOR_RETRIES', 3),
    ytDlpProxy: getEnv('YT_DLP_PROXY'),
    tiktokAppInfo: getEnv('TIKTOK_APP_INFO', '7355728856979392262'),
    tiktokApiHostname: getEnv('TIKTOK_API_HOSTNAME', 'api16-normal-c-useast1a.tiktokv.com'),
    tiktokTryYtDlpFallback: parseBoolean('TIKTOK_TRY_YT_DLP_FALLBACK', false),
    ytDlpCookiesFile: getEnv('YT_DLP_COOKIES_FILE') || getEnv('INSTAGRAM_COOKIES_FILE'),
    ytDlpCookiesFromBrowser: getEnv('YT_DLP_COOKIES_FROM_BROWSER'),
    aiProvider: getEnv('VIDEO_AI_PROVIDER', 'auto').toLowerCase()
  },
  openRouter: {
    apiKey: getEnv('OPENROUTER_API_KEY'),
    model: getEnv('OPENROUTER_MODEL'),
    videoModel: getEnv('OPENROUTER_VIDEO_MODEL', getEnv('OPENROUTER_MODEL')),
    transcribeModel: getEnv('OPENROUTER_TRANSCRIBE_MODEL', 'openai/whisper-large-v3'),
    baseUrl: openRouterBaseUrl,
    appName: getEnv('OPENROUTER_APP_NAME', 'Cerca Trova Creator Bot'),
    appUrl: openRouterAppUrl
  },
  xai: {
    apiKey: getEnv('XAI_API_KEY') || getEnv('GROK_API_KEY'),
    model: getEnv('XAI_MODEL', 'grok-4.3'),
    baseUrl: xaiBaseUrl
  },
  openai: {
    apiKey: getEnv('OPENAI_API_KEY'),
    transcribeModel: getEnv('OPENAI_TRANSCRIBE_MODEL', 'gpt-4o-mini-transcribe'),
    chatModel: getEnv('OPENAI_CHAT_MODEL', 'gpt-4.1-mini'),
    baseUrl: openAIBaseUrl
  }
};

module.exports = config;
