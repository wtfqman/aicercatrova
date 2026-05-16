const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const config = require('./config');
const { logError, logInfo } = require('./utils/logger');

const PREVIEW_MAX_LENGTH = 300;
const VIDEO_ANALYSIS_SYSTEM_PROMPT = [
  'Ты редактор коротких fashion/creator-видео.',
  'Превращай автоматические расшифровки в понятный русский перевод, разбор и идеи для контента.',
  'Исправляй очевидные ошибки распознавания по контексту, но не выдумывай факты.',
  'Отвечай строго JSON.'
].join(' ');

function preview(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PREVIEW_MAX_LENGTH);
}

function assertXAIConfigured() {
  if (!config.xai.apiKey) {
    throw new Error('XAI_API_KEY is not configured.');
  }
}

function assertOpenAIConfigured() {
  if (!config.openai.apiKey) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }
}

function getConfiguredProviderOrder() {
  if (config.video.aiProvider === 'openrouter') {
    return ['openrouter'];
  }

  if (config.video.aiProvider === 'openai') {
    return ['openai'];
  }

  if (config.video.aiProvider === 'xai') {
    return ['xai'];
  }

  return ['openrouter', 'openai', 'xai'];
}

function isProviderAvailable(provider) {
  if (provider === 'openrouter') {
    return Boolean(config.openRouter.apiKey);
  }

  if (provider === 'openai') {
    return Boolean(config.openai.apiKey);
  }

  if (provider === 'xai') {
    return Boolean(config.xai.apiKey);
  }

  return false;
}

function isProviderAccessError(error) {
  const status = error?.response?.status;
  const data = JSON.stringify(error?.response?.data || {}).toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  const combined = `${data} ${message}`;

  return [401, 402, 403, 429].includes(status) ||
    combined.includes('credits') ||
    combined.includes('license') ||
    combined.includes('quota') ||
    combined.includes('billing') ||
    combined.includes('permission');
}

async function runWithVideoAIProvider(actionName, handlers) {
  const providerOrder = getConfiguredProviderOrder().filter(isProviderAvailable);
  let lastError = null;

  if (providerOrder.length === 0) {
    throw new Error('OPENAI_API_KEY or XAI_API_KEY is not configured.');
  }

  for (const provider of providerOrder) {
    const handler = handlers[provider];

    if (!handler) {
      continue;
    }

    try {
      return await handler();
    } catch (error) {
      lastError = error;

      if (!isProviderAccessError(error)) {
        throw error;
      }

      logError(`[VIDEO_AI_PROVIDER_FAILED] provider=${provider} action=${actionName}`, error);
    }
  }

  throw lastError || new Error(`No configured video AI provider could run ${actionName}.`);
}

function parseJsonObject(rawText) {
  const text = String(rawText || '').trim()
    .replace(/```\s*json/gi, '')
    .replace(/```/g, '')
    .trim();

  const startIndex = text.indexOf('{');
  const endIndex = text.lastIndexOf('}');

  if (startIndex < 0 || endIndex <= startIndex) {
    return null;
  }

  try {
    return JSON.parse(text.slice(startIndex, endIndex + 1));
  } catch (error) {
    return null;
  }
}

function normalizeStringList(value, fallback = []) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  return value
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.trim())
    .slice(0, 5);
}

function normalizeVideoIdeas(parsed, transcript) {
  const summary = typeof parsed?.summary === 'string' && parsed.summary.trim()
    ? parsed.summary.trim()
    : 'Видео уже расшифровано. Ниже — идеи, которые можно использовать для контента.';
  const translation = typeof parsed?.translation === 'string' && parsed.translation.trim()
    ? parsed.translation.trim()
    : '';

  return {
    summary,
    translation,
    titles: normalizeStringList(parsed?.titles, [
      'Как упаковать главную мысль ролика в сильный заголовок?',
      'Почему этот хук может удержать внимание зрителя?',
      'Как превратить идею ролика в полезный пост?'
    ]),
    hooks: normalizeStringList(parsed?.hooks, [
      'Начни с главной боли зрителя и сразу покажи пользу.',
      'Сравни ошибку и правильный вариант в первом кадре.',
      'Сделай короткое обещание результата без длинного вступления.'
    ]),
    post_plan: normalizeStringList(parsed?.post_plan, [
      'Коротко обозначить проблему из видео.',
      'Разобрать главную мысль простыми словами.',
      'Дать 3 практических вывода для подписчика.',
      'Закончить вопросом или призывом сохранить пост.'
    ]),
    cta: typeof parsed?.cta === 'string' && parsed.cta.trim()
      ? parsed.cta.trim()
      : 'Сохрани, чтобы вернуться к этой идее перед съёмкой следующего ролика.',
    transcript
  };
}

async function transcribeAudioWithXAI(audioPath) {
  assertXAIConfigured();

  const form = new FormData();
  form.append('file', fs.createReadStream(audioPath));

  const response = await axios.post(`${config.xai.baseUrl}/stt`, form, {
    headers: {
      Authorization: `Bearer ${config.xai.apiKey}`,
      ...form.getHeaders()
    },
    timeout: config.video.jobTimeoutMs
  });

  const transcript = String(response.data?.text || '').trim();

  if (!transcript) {
    throw new Error('xAI STT returned an empty transcript.');
  }

  logInfo(`[XAI_STT_DONE] transcript first 300 chars: ${preview(transcript)}`);
  return transcript;
}

async function transcribeAudioWithOpenAI(audioPath) {
  assertOpenAIConfigured();

  const form = new FormData();
  form.append('model', config.openai.transcribeModel);
  form.append('file', fs.createReadStream(audioPath));

  const response = await axios.post(`${config.openai.baseUrl}/audio/transcriptions`, form, {
    headers: {
      Authorization: `Bearer ${config.openai.apiKey}`,
      ...form.getHeaders()
    },
    timeout: config.video.jobTimeoutMs
  });

  const transcript = String(response.data?.text || '').trim();

  if (!transcript) {
    throw new Error('OpenAI transcription returned an empty transcript.');
  }

  logInfo(`[OPENAI_STT_DONE] transcript first 300 chars: ${preview(transcript)}`);
  return transcript;
}

async function transcribeAudioWithOpenRouter(audioPath) {
  const audioBase64 = fs.readFileSync(audioPath).toString('base64');

  const response = await axios.post(`${config.openRouter.baseUrl}/audio/transcriptions`, {
    input_audio: {
      data: audioBase64,
      format: 'mp3'
    },
    model: config.openRouter.transcribeModel
  }, {
    headers: {
      Authorization: `Bearer ${config.openRouter.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': config.openRouter.appUrl,
      'X-Title': config.openRouter.appName
    },
    timeout: config.video.jobTimeoutMs
  });

  const transcript = String(response.data?.text || '').trim();

  if (!transcript) {
    throw new Error('OpenRouter transcription returned an empty transcript.');
  }

  logInfo(`[OPENROUTER_STT_DONE] transcript first 300 chars: ${preview(transcript)}`);
  return transcript;
}

async function transcribeAudio(audioPath) {
  return runWithVideoAIProvider('transcribe', {
    openrouter: () => transcribeAudioWithOpenRouter(audioPath),
    openai: () => transcribeAudioWithOpenAI(audioPath),
    xai: () => transcribeAudioWithXAI(audioPath)
  });
}

function buildTranscriptAnalysisPrompt(transcript, sourceUrl) {
  return `Ты — редактор и помощник креатора по стилю, моде и коротким видео.
Пользователь дал ссылку на TikTok/Reels, аудио уже расшифровано автоматически.
Расшифровка может быть на любом языке и может содержать ошибки STT: сломанные названия брендов, вещей, цветов, падежей и фраз.

ССЫЛКА:
${sourceUrl}

РАСШИФРОВКА:
${transcript}

Сделай результат на живом русском языке.
Главная задача — не буквальный машинный пересказ, а понятный смысловой разбор для креатора.

Правила:
- Не придумывай факты, которых нет в расшифровке.
- Если слово распознано криво, восстанови вероятный смысл по контексту, но не выдумывай точные бренды/предметы, если не уверен.
- Не тащи в русский текст бессмысленные куски вроде "на голову надеваем куртку"; исправляй очевидные ошибки на естественный вариант вроде "сверху добавляем куртку".
- Если деталь непонятна, лучше сформулируй нейтрально: "темная обувь", "куртка", "винтажная футболка".
- Не пиши общие заголовки в стиле "модные советы" или "секреты стиля". Все темы должны опираться на конкретный ролик.
- Хуки должны звучать как короткие надписи для первого кадра, а не как рекламные фразы "Хотите узнать...".
- CTA должен провоцировать комментарии естественно и без канцелярита.

Верни строго JSON без Markdown:
{
  "summary": "2-3 предложения: что происходит в ролике и какая идея/приём в нём полезны для контента",
  "translation": "естественный русский перевод или смысловая адаптация речи из видео, 4-8 предложений",
  "titles": ["ровно 5 конкретных заголовков для поста или Reels по этому ролику"],
  "hooks": ["ровно 5 коротких хуков/надписей для первого кадра по этому ролику"],
  "post_plan": ["4-5 конкретных пунктов плана поста по этому ролику"],
  "cta": "один короткий живой CTA"
}`;
}

async function requestGrokVideoIdeas(transcript, sourceUrl) {
  assertXAIConfigured();

  const body = {
    model: config.xai.model,
    messages: [
      {
        role: 'system',
        content: VIDEO_ANALYSIS_SYSTEM_PROMPT
      },
      {
        role: 'user',
        content: buildTranscriptAnalysisPrompt(transcript, sourceUrl)
      }
    ],
    temperature: 0.45,
    max_tokens: 1800,
    response_format: { type: 'json_object' }
  };

  const response = await axios.post(`${config.xai.baseUrl}/chat/completions`, body, {
    headers: {
      Authorization: `Bearer ${config.xai.apiKey}`,
      'Content-Type': 'application/json'
    },
    timeout: config.video.jobTimeoutMs
  });

  const rawText = response.data?.choices?.[0]?.message?.content?.trim();

  if (!rawText) {
    throw new Error('Grok returned an empty video analysis.');
  }

  logInfo(`[XAI_VIDEO_RAW] first 300 chars: ${preview(rawText)}`);

  const parsed = parseJsonObject(rawText);
  return normalizeVideoIdeas(parsed, transcript);
}

async function requestOpenAIVideoIdeas(transcript, sourceUrl) {
  assertOpenAIConfigured();

  const body = {
    model: config.openai.chatModel,
    messages: [
      {
        role: 'system',
        content: VIDEO_ANALYSIS_SYSTEM_PROMPT
      },
      {
        role: 'user',
        content: buildTranscriptAnalysisPrompt(transcript, sourceUrl)
      }
    ],
    temperature: 0.45,
    max_tokens: 1800,
    response_format: { type: 'json_object' }
  };

  const response = await axios.post(`${config.openai.baseUrl}/chat/completions`, body, {
    headers: {
      Authorization: `Bearer ${config.openai.apiKey}`,
      'Content-Type': 'application/json'
    },
    timeout: config.video.jobTimeoutMs
  });

  const rawText = response.data?.choices?.[0]?.message?.content?.trim();

  if (!rawText) {
    throw new Error('OpenAI returned an empty video analysis.');
  }

  logInfo(`[OPENAI_VIDEO_RAW] first 300 chars: ${preview(rawText)}`);

  const parsed = parseJsonObject(rawText);
  return normalizeVideoIdeas(parsed, transcript);
}

async function requestOpenRouterVideoIdeas(transcript, sourceUrl) {
  const body = {
    model: config.openRouter.videoModel,
    messages: [
      {
        role: 'system',
        content: VIDEO_ANALYSIS_SYSTEM_PROMPT
      },
      {
        role: 'user',
        content: buildTranscriptAnalysisPrompt(transcript, sourceUrl)
      }
    ],
    temperature: 0.45,
    max_tokens: 1800,
    response_format: { type: 'json_object' }
  };

  const response = await axios.post(`${config.openRouter.baseUrl}/chat/completions`, body, {
    headers: {
      Authorization: `Bearer ${config.openRouter.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': config.openRouter.appUrl,
      'X-Title': config.openRouter.appName
    },
    timeout: config.video.jobTimeoutMs
  });

  const rawText = response.data?.choices?.[0]?.message?.content?.trim();

  if (!rawText) {
    throw new Error('OpenRouter returned an empty video analysis.');
  }

  logInfo(`[OPENROUTER_VIDEO_RAW] first 300 chars: ${preview(rawText)}`);

  const parsed = parseJsonObject(rawText);
  return normalizeVideoIdeas(parsed, transcript);
}

async function analyzeTranscriptWithGrok(transcript, sourceUrl) {
  return runWithVideoAIProvider('analyze', {
    openrouter: () => requestOpenRouterVideoIdeas(transcript, sourceUrl),
    openai: () => requestOpenAIVideoIdeas(transcript, sourceUrl),
    xai: () => requestGrokVideoIdeas(transcript, sourceUrl)
  });
}

module.exports = {
  analyzeTranscriptWithGrok,
  transcribeAudio
};
