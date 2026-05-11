function timestamp() {
  return new Date().toISOString();
}

function getSecretValues() {
  return [
    'BOT_TOKEN',
    'TELEGRAM_BOT_TOKEN',
    'OPENROUTER_API_KEY',
    'OPENAI_API_KEY',
    'XAI_API_KEY',
    'GROK_API_KEY'
  ]
    .map((name) => process.env[name])
    .filter((value) => typeof value === 'string' && value.trim().length > 0);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redact(text) {
  let result = String(text)
    .replace(/bot\d+:(?:\[[^\]]+\]|[^/\s]+)/gi, 'bot[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/(BOT_TOKEN|TELEGRAM_BOT_TOKEN|OPENROUTER_API_KEY|OPENAI_API_KEY|XAI_API_KEY|GROK_API_KEY)=\S+/gi, '$1=[REDACTED]');

  for (const secret of getSecretValues()) {
    result = result.replace(new RegExp(escapeRegExp(secret), 'g'), '[REDACTED]');
  }

  return result;
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return '[unserializable]';
  }
}

function formatError(error) {
  if (!error) {
    return '';
  }

  if (error.response) {
    return redact(
      `status=${error.response.status} data=${safeStringify(error.response.data)}`
    );
  }

  const parts = [
    error.name,
    error.code ? `code=${error.code}` : '',
    error.message
  ].filter(Boolean);

  return redact(parts.join(' '));
}

function logInfo(message) {
  console.log(`[${timestamp()}] INFO ${redact(message)}`);
}

function logError(message, error) {
  const details = formatError(error);
  const suffix = details ? ` ${details}` : '';
  console.error(`[${timestamp()}] ERROR ${redact(message)}${suffix}`);
}

module.exports = {
  logInfo,
  logError
};
