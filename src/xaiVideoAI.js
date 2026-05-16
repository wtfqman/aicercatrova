const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const config = require('./config');
const { logError, logInfo } = require('./utils/logger');

const PREVIEW_MAX_LENGTH = 300;
const VIDEO_ANALYSIS_SYSTEM_PROMPT = [
  'Ты не генератор красивой AI-воды, а редактор коротких fashion/creator-видео.',
  'Твоя задача — помочь креатору понять, что реально есть в ролике и что из этого можно адаптировать.',
  'Не выдумывай настроение, эстетику, intent автора, эмоции, бренды или смысл, если их нет в расшифровке.',
  'Если исходник слабый, отвечай короче и честнее.',
  'Отвечай строго JSON.'
].join(' ');
const BANNED_VIDEO_PHRASES = [
  'рок-н-ролльный вайб',
  'рок-н-ролльная эстетика',
  'рок-н-ролльный стиль',
  'рок-н-ролл',
  'рок-н-ролль',
  'смелый образ',
  'атмосфера',
  'модный эксперимент',
  'casual to rock',
  'стильный и смелый',
  'идеальный look',
  'идеальный лук',
  'fashion vibe',
  'смелое сочетание',
  'готовы к'
];
const LOW_CONFIDENCE_PATTERNS = [
  /\b(?:inaudible|unintelligible|unknown|noise|music|silence|audio unclear)\b/iu,
  /\b(?:неразборчиво|не слышно|шум|музыка|тишина|непонятно)\b/iu,
  /\[[^\]]*(?:inaudible|music|noise|неразборчиво|музыка|шум)[^\]]*\]/iu,
  /\([^)]*(?:inaudible|music|noise|неразборчиво|музыка|шум)[^)]*\)/iu
];
const STT_ERROR_HINTS = [
  'chaquette',
  'haut-pais',
  'kopein',
  't-shirt bleue',
  'une t-shirt',
  'sur la tête',
  'flèche haut'
];

function preview(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PREVIEW_MAX_LENGTH);
}

function normalizeForSearch(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

function countMatches(text, pattern) {
  const matches = String(text || '').match(pattern);
  return matches ? matches.length : 0;
}

function getWords(text) {
  return String(text || '').match(/[\p{L}\p{N}][\p{L}\p{N}'-]{1,}/gu) || [];
}

function isLowConfidenceTranscript(transcript) {
  const text = String(transcript || '').trim();
  const normalized = normalizeForSearch(text);
  const words = getWords(text);
  const uniqueWords = new Set(words.map((word) => normalizeForSearch(word)));
  const reasons = [];

  if (words.length < 18) {
    reasons.push('слишком мало распознанного текста');
  }

  if (text.length < 120) {
    reasons.push('очень короткая расшифровка');
  }

  const unclearPatternCount = LOW_CONFIDENCE_PATTERNS
    .filter((pattern) => pattern.test(text))
    .length;

  if (unclearPatternCount > 0) {
    reasons.push('есть маркеры плохого звука или неразборчивой речи');
  }

  const punctuationCount = countMatches(text, /[.!?,;:]/g);
  const sentenceCount = countMatches(text, /[.!?]/g);

  if (words.length > 35 && sentenceCount === 0 && punctuationCount < 2) {
    reasons.push('текст выглядит как длинный поток обрывков без фраз');
  }

  if (words.length > 30 && uniqueWords.size / words.length < 0.45) {
    reasons.push('много повторов и мало уникальных слов');
  }

  const strangeCharRatio = text.length > 0
    ? countMatches(text, /[^\p{L}\p{N}\s.,!?;:'"«»()/-]/gu) / text.length
    : 0;

  if (strangeCharRatio > 0.08) {
    reasons.push('много технического мусора в тексте');
  }

  const sttHintCount = STT_ERROR_HINTS
    .filter((hint) => normalized.includes(hint))
    .length;

  if (sttHintCount >= 2) {
    reasons.push('есть признаки ошибок автоматической расшифровки');
  }

  return {
    isLowConfidence: reasons.length > 0,
    reasons
  };
}

function buildVideoAnalysisOptions(requestText = '') {
  const normalized = normalizeForSearch(requestText);

  return {
    includeCta: /\bcta\b|призыв|призови|призыв к действию/.test(normalized),
    includePlan: /план|структур|структура поста|сценари|разбей на блоки/.test(normalized),
    includeHooks: /хук|хуки|hook|hooks|надпис/.test(normalized),
    includeTitles: /заголов|назван/.test(normalized)
  };
}

function collectTextValues(value) {
  if (Array.isArray(value)) {
    return value.flatMap(collectTextValues);
  }

  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(collectTextValues);
  }

  return [String(value || '')];
}

function findBannedVideoPhrases(value) {
  const text = collectTextValues(value).join(' ');
  const normalized = normalizeForSearch(text);

  return BANNED_VIDEO_PHRASES.filter((phrase) => normalized.includes(normalizeForSearch(phrase)));
}

function hasAnyExplicitBlock(options) {
  return Boolean(
    options?.includeCta ||
    options?.includePlan ||
    options?.includeHooks ||
    options?.includeTitles
  );
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

function normalizeStringList(value, fallback = [], maxLength = 5) {
  const source = Array.isArray(value) ? value : fallback;
  const result = [];

  for (const item of source) {
    const text = String(item || '').replace(/\s+/g, ' ').trim();

    if (!text || findBannedVideoPhrases(text).length > 0 || result.includes(text)) {
      continue;
    }

    result.push(text);

    if (result.length >= maxLength) {
      break;
    }
  }

  return result;
}

function getFirstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

function normalizeVideoIdeas(parsed, transcript, quality, options = {}) {
  const isLowConfidence = Boolean(quality?.isLowConfidence || parsed?.confidence === 'low');
  const summary = typeof parsed?.summary === 'string' && parsed.summary.trim()
    ? parsed.summary.trim()
    : isLowConfidence
      ? 'Расшифровка получилась слабой, поэтому можно уверенно выделить только общий смысл ролика.'
      : 'В ролике есть несколько деталей, которые можно аккуратно разобрать для контента.';
  const translation = getFirstString(parsed?.translation, parsed?.meaning, parsed?.adapted_translation);
  const contentIdeasFallback = isLowConfidence
    ? [
      'Взять только видимый приём из ролика и показать его на своём примере',
      'Разобрать одну заметную деталь образа без попытки объяснить весь стиль',
      'Сравнить, что делает образ понятнее: слой, фактура или цвет'
    ]
    : [
      'Показать, какие детали образа реально видны в видео',
      'Объяснить один приём из ролика на своём примере',
      'Сравнить простой вариант образа и вариант с дополнительным слоем'
    ];
  const optionalBlocks = {};

  if (options.includeTitles) {
    optionalBlocks.titles = normalizeStringList(parsed?.titles, [], 5);
  }

  if (options.includeHooks) {
    optionalBlocks.hooks = normalizeStringList(parsed?.hooks, [], 5);
  }

  if (options.includePlan) {
    optionalBlocks.post_plan = normalizeStringList(parsed?.post_plan, [], 5);
  }

  if (options.includeCta) {
    optionalBlocks.cta = getFirstString(parsed?.cta);
  }

  return {
    confidence: isLowConfidence ? 'low' : 'normal',
    quality_note: isLowConfidence
      ? `Расшифровка слабая${quality?.reasons?.length ? `: ${quality.reasons.join(', ')}` : ''}. Поэтому анализ сокращён и без выдуманных выводов.`
      : '',
    summary,
    translation,
    content_ideas: normalizeStringList(
      parsed?.content_ideas || parsed?.ideas || parsed?.takeaways,
      contentIdeasFallback,
      isLowConfidence ? 3 : 5
    ),
    key_takeaway: getFirstString(parsed?.key_takeaway, parsed?.insight, parsed?.interesting_point),
    optional_blocks: optionalBlocks,
    transcript,
    requested_extra_blocks: hasAnyExplicitBlock(options)
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

function describeRequestedBlocks(options) {
  const blocks = [];

  if (options.includeTitles) {
    blocks.push('titles');
  }

  if (options.includeHooks) {
    blocks.push('hooks');
  }

  if (options.includePlan) {
    blocks.push('post_plan');
  }

  if (options.includeCta) {
    blocks.push('cta');
  }

  return blocks.length > 0 ? blocks.join(', ') : 'нет';
}

function buildTranscriptAnalysisPrompt(transcript, sourceUrl, options = {}, quality = {}, retryInstruction = '') {
  const confidenceLabel = quality?.isLowConfidence ? 'LOW' : 'NORMAL';
  const qualityReasons = quality?.reasons?.length ? quality.reasons.join('; ') : 'нет';
  const requestedBlocks = describeRequestedBlocks(options);
  const retryBlock = retryInstruction
    ? `\n\nПОВТОРНАЯ ПОПЫТКА:\n${retryInstruction}`
    : '';

  return `Ты — редактор и помощник креатора по стилю, моде и коротким видео.
Пользователь дал ссылку на TikTok/Reels, аудио уже расшифровано автоматически.
Расшифровка может быть на любом языке и может содержать ошибки STT: сломанные слова, бренды, вещи, цвета, падежи и фразы.

ССЫЛКА:
${sourceUrl}

ОЦЕНКА КАЧЕСТВА РАСШИФРОВКИ:
confidence=${confidenceLabel}
reasons=${qualityReasons}

ЯВНО ЗАПРОШЕННЫЕ ДОПОЛНИТЕЛЬНЫЕ БЛОКИ:
${requestedBlocks}

РАСШИФРОВКА:
${transcript}

Сделай результат на живом русском языке.
Главная задача — не сделать красивый AI-текст, а помочь креатору понять, что полезного реально есть в ролике.

Правила:
- По умолчанию НЕ делай CTA, план поста, длинный анализ, хуки и заголовки. Добавляй эти поля только если они есть в списке явно запрошенных блоков.
- Не придумывай факты, которых нет в расшифровке.
- Нельзя придумывать настроение, эстетику, характер образа, эмоции или intent автора.
- Не натягивай "стиль" там, где в расшифровке есть только набор вещей.
- Если слово распознано криво, восстанови вероятный смысл по контексту, но не выдумывай точные бренды/предметы, если не уверен.
- Не тащи в русский текст бессмысленные куски вроде "на голову надеваем куртку"; исправляй очевидные ошибки на естественный вариант вроде "сверху добавляем куртку".
- Если деталь непонятна, лучше сформулируй нейтрально: "темная обувь", "куртка", "винтажная футболка".
- Если расшифровка LOW, отвечай короче: 1-2 предложения summary, 2-3 предложения translation, 2-3 content_ideas.
- Если ролик простой или бытовой, не раздувай его в storytelling.
- Если сильной мысли нет, так и покажи: "сильной идеи в расшифровке нет, можно взять только..."
- Content ideas должны быть конкретными и связанными с роликом, без кликбейта и рекламного тона.
- Перевод должен быть смысловой и естественный, а не дословная калька.

Запрещённые фразы и близкие формулировки:
- рок-н-ролльный вайб
- рок-н-ролльная эстетика
- рок-н-ролльный стиль
- рок-н-ролл
- смелый образ
- атмосфера
- модный эксперимент
- casual to rock
- стильный и смелый
- идеальный look
- fashion vibe
- смелое сочетание
- готовы к

Верни строго JSON без Markdown:
{
  "confidence": "normal или low",
  "summary": "кратко о чём ролик и что реально понятно",
  "translation": "естественный русский перевод или смысловая адаптация речи из видео",
  "content_ideas": ["3-5 полезных идей для контента, при LOW 2-3 идеи"],
  "key_takeaway": "если есть интересная мысль или приём; иначе пустая строка"
}

Если явно запрошены дополнительные блоки, добавь только соответствующие поля:
{
  "titles": ["конкретные заголовки без AI-тона"],
  "hooks": ["короткие хуки без generic-фраз"],
  "post_plan": ["структура поста только если запрошена"],
  "cta": "CTA только если запрошен"
}${retryBlock}`;
}

function getVideoAnalysisProblems(parsed, analysis) {
  const badPhrases = findBannedVideoPhrases({
    summary: analysis?.summary,
    translation: analysis?.translation,
    content_ideas: analysis?.content_ideas,
    key_takeaway: analysis?.key_takeaway,
    optional_blocks: analysis?.optional_blocks
  });
  const problems = [];

  if (!parsed) {
    problems.push('invalid_json');
  }

  if (badPhrases.length > 0) {
    problems.push(`banned_phrases:${badPhrases.join(',')}`);
  }

  if (!analysis?.summary || !analysis?.translation) {
    problems.push('missing_core_fields');
  }

  if (!Array.isArray(analysis?.content_ideas) || analysis.content_ideas.length === 0) {
    problems.push('missing_content_ideas');
  }

  return problems;
}

function buildFallbackVideoAnalysis(transcript, quality, options = {}) {
  const isLowConfidence = Boolean(quality?.isLowConfidence);
  const optionalBlocks = {};

  if (options.includeTitles) {
    optionalBlocks.titles = [];
  }

  if (options.includeHooks) {
    optionalBlocks.hooks = [];
  }

  if (options.includePlan) {
    optionalBlocks.post_plan = [];
  }

  if (options.includeCta) {
    optionalBlocks.cta = '';
  }

  return {
    confidence: isLowConfidence ? 'low' : 'normal',
    quality_note: isLowConfidence
      ? `Расшифровка слабая${quality?.reasons?.length ? `: ${quality.reasons.join(', ')}` : ''}. Поэтому анализ сокращён и без выдуманных выводов.`
      : '',
    summary: isLowConfidence
      ? 'По расшифровке нельзя уверенно сделать подробный разбор. Похоже, автор показывает образ и отдельные детали, но сильная мысль в тексте не считывается.'
      : 'В ролике можно разобрать только те детали, которые явно слышны в расшифровке. Сильную дополнительную идею лучше не додумывать.',
    translation: 'Смысл речи распознан не полностью. Безопаснее использовать это видео как визуальный пример и не опираться на спорные детали текста.',
    content_ideas: [
      'Разобрать один видимый элемент образа вместо попытки объяснить весь ролик',
      'Показать, как один слой или фактура меняют впечатление от простого сочетания',
      'Сделать короткий формат: что видно в образе и что можно повторить у себя'
    ].slice(0, isLowConfidence ? 2 : 3),
    key_takeaway: '',
    optional_blocks: optionalBlocks,
    transcript,
    requested_extra_blocks: hasAnyExplicitBlock(options)
  };
}

async function normalizeVideoAnalysisWithRetry(fetchRaw, transcript, sourceUrl, options, providerName) {
  const quality = isLowConfidenceTranscript(transcript);
  let rawText = await fetchRaw('');
  let parsed = parseJsonObject(rawText);
  let analysis = normalizeVideoIdeas(parsed, transcript, quality, options);
  let problems = getVideoAnalysisProblems(parsed, analysis);

  if (problems.length > 0) {
    logError(`[VIDEO_ANALYSIS_RETRY] provider=${providerName} problems=${problems.join('|')} source=${sourceUrl}`);
    rawText = await fetchRaw(
      'Ответ слишком generic, AI-шаблонный или неполный. Перепиши короче, конкретнее и без воды. ' +
      'Не используй banned phrases. Не добавляй CTA, план, хуки или заголовки, если их не просили явно.'
    );
    parsed = parseJsonObject(rawText);
    analysis = normalizeVideoIdeas(parsed, transcript, quality, options);
    problems = getVideoAnalysisProblems(parsed, analysis);
  }

  if (problems.length > 0) {
    logError(`[VIDEO_ANALYSIS_FALLBACK] provider=${providerName} problems=${problems.join('|')} source=${sourceUrl}`);
    return buildFallbackVideoAnalysis(transcript, quality, options);
  }

  return analysis;
}

async function requestGrokVideoIdeas(transcript, sourceUrl, options = {}) {
  assertXAIConfigured();
  const quality = isLowConfidenceTranscript(transcript);

  const fetchRaw = async (retryInstruction = '') => {
    const body = {
      model: config.xai.model,
      messages: [
        {
          role: 'system',
          content: VIDEO_ANALYSIS_SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: buildTranscriptAnalysisPrompt(transcript, sourceUrl, options, quality, retryInstruction)
        }
      ],
      temperature: 0.25,
      max_tokens: 1400,
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
    return rawText;
  };

  return normalizeVideoAnalysisWithRetry(fetchRaw, transcript, sourceUrl, options, 'xai');
}

async function requestOpenAIVideoIdeas(transcript, sourceUrl, options = {}) {
  assertOpenAIConfigured();
  const quality = isLowConfidenceTranscript(transcript);

  const fetchRaw = async (retryInstruction = '') => {
    const body = {
      model: config.openai.chatModel,
      messages: [
        {
          role: 'system',
          content: VIDEO_ANALYSIS_SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: buildTranscriptAnalysisPrompt(transcript, sourceUrl, options, quality, retryInstruction)
        }
      ],
      temperature: 0.25,
      max_tokens: 1400,
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
    return rawText;
  };

  return normalizeVideoAnalysisWithRetry(fetchRaw, transcript, sourceUrl, options, 'openai');
}

async function requestOpenRouterVideoIdeas(transcript, sourceUrl, options = {}) {
  const quality = isLowConfidenceTranscript(transcript);

  const fetchRaw = async (retryInstruction = '') => {
    const body = {
      model: config.openRouter.videoModel,
      messages: [
        {
          role: 'system',
          content: VIDEO_ANALYSIS_SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: buildTranscriptAnalysisPrompt(transcript, sourceUrl, options, quality, retryInstruction)
        }
      ],
      temperature: 0.25,
      max_tokens: 1400,
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
    return rawText;
  };

  return normalizeVideoAnalysisWithRetry(fetchRaw, transcript, sourceUrl, options, 'openrouter');
}

async function analyzeTranscriptWithGrok(transcript, sourceUrl, options = {}) {
  return runWithVideoAIProvider('analyze', {
    openrouter: () => requestOpenRouterVideoIdeas(transcript, sourceUrl, options),
    openai: () => requestOpenAIVideoIdeas(transcript, sourceUrl, options),
    xai: () => requestGrokVideoIdeas(transcript, sourceUrl, options)
  });
}

module.exports = {
  analyzeTranscriptWithGrok,
  buildVideoAnalysisOptions,
  findBannedVideoPhrases,
  isLowConfidenceTranscript,
  transcribeAudio
};
