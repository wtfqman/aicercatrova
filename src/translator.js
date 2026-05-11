const axios = require('axios');
const config = require('./config');
const { logInfo } = require('./utils/logger');

const TRANSLATION_PREVIEW_LENGTH = 300;

function preview(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TRANSLATION_PREVIEW_LENGTH);
}

function assertOpenRouterConfigured() {
  if (!config.openRouter.apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured.');
  }
}

async function translateTextToRussian(text) {
  const sourceText = String(text || '').trim();

  if (!sourceText) {
    throw new Error('Translation source text is empty.');
  }

  assertOpenRouterConfigured();

  const response = await axios.post(`${config.openRouter.baseUrl}/chat/completions`, {
    model: config.openRouter.videoModel || config.openRouter.model,
    messages: [
      {
        role: 'system',
        content: 'Ты профессиональный переводчик. Переводи на русский естественно, живо и точно. Сохраняй смысл, тон и порядок мыслей. Не добавляй комментарии, вступления, Markdown или объяснения. Верни только перевод.'
      },
      {
        role: 'user',
        content: `Переведи на русский:\n\n${sourceText}`
      }
    ],
    temperature: 0.2,
    max_tokens: 2500
  }, {
    headers: {
      Authorization: `Bearer ${config.openRouter.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': config.openRouter.appUrl,
      'X-Title': config.openRouter.appName
    },
    timeout: config.aiTimeoutMs
  });

  const translation = String(response.data?.choices?.[0]?.message?.content || '').trim();

  if (!translation) {
    throw new Error('OpenRouter returned an empty translation.');
  }

  logInfo(`[TRANSLATION_DONE] first 300 chars: ${preview(translation)}`);
  return translation;
}

module.exports = {
  translateTextToRussian
};
