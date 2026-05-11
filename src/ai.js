const axios = require('axios');
const config = require('./config');
const { SYSTEM_PROMPT, buildUserPrompt } = require('./prompts');
const {
  isValidatorFallbackResponse,
  normalizeAIResponse,
  safeParseAIJson,
  validateAIResponse
} = require('./responseValidator');
const { logError, logInfo } = require('./utils/logger');

const HISTORY_LIMIT_FOR_AI = 4;
const HISTORY_MESSAGE_MAX_LENGTH = 350;
const PREVIEW_MAX_LENGTH = 500;
const RAW_LOG_MAX_LENGTH = 300;
const NORMALIZED_LOG_MAX_LENGTH = 150;

const MATERIAL_WORDS = [
  'материал',
  'ткан',
  'состав',
  'шелк',
  'шёлк',
  'шерст',
  'хлоп',
  'лен',
  'лён',
  'синтет',
  'фактур',
  'плотн',
  'блеск'
];

const SPECIFIC_MATERIAL_WORDS = [
  'шелк',
  'шёлк',
  'шерст',
  'хлоп',
  'лен',
  'лён',
  'синтет',
  'полиэстер',
  'вискоз',
  'кашемир'
];

const COLOR_WORDS = [
  'цвет',
  'оттен',
  'палитр',
  'черн',
  'чёрн',
  'сер',
  'син',
  'беж',
  'молоч',
  'корич',
  'бордов',
  'зелен',
  'зелён',
  'графит',
  'нейтральн'
];

const SPECIFIC_COLOR_WORDS = [
  'черн',
  'чёрн',
  'сер',
  'син',
  'беж',
  'молоч',
  'корич',
  'бордов',
  'зелен',
  'зелён',
  'графит',
  'нейтральн',
  'темн',
  'тёмн',
  'приглуш'
];

const BASE_WORDS = ['баз', 'гардероб', 'капсул'];
const READY_CONTENT_REQUEST_FRAGMENTS = [
  'напиши текст',
  'составь текст',
  'помоги составить текст',
  'готовый текст',
  'текст для рилса',
  'текст для reels',
  'текст для видео',
  'текст для ролика',
  'сделай сценар',
  'напиши сценар',
  'составь сценар',
  'сценарий для видео',
  'сценарий для ролика',
  'сценарий для рилса',
  'сценарий для reels',
  'хочу сделать рилс',
  'хочу снять рилс',
  'сделать рилс',
  'снять рилс',
  'рилс про',
  'reels про',
  'shorts про',
  'short про',
  'тик ток про',
  'тикток про',
  'tiktok про',
  'сделай пост',
  'напиши пост',
  'пост про',
  'текст поста',
  'сделай сторис',
  'напиши сторис',
  'сторис про',
  'помоги объяснить другу',
  'объяснить другу',
  'напиши речь',
  'сделай речь',
  'сделай подач',
  'придумай подач'
];
const READY_CONTENT_REQUEST_PATTERNS = [
  /\b(?:напиши|составь|сделай|придумай)\s+(?:мне\s+)?(?:готовый\s+)?(?:текст|сценар\w*|пост|сторис|речь|подач\w*)\b/u,
  /\b(?:хочу|надо|нужно)\s+(?:сделать|снять|написать|составить)\s+(?:рилс|reels|shorts|short|тик\s*ток|тикток|tiktok|видео|ролик|пост|сторис)\b/u,
  /\b(?:текст|сценар\w*)\s+для\s+(?:рилса|reels|shorts|short|тик\s*тока|тиктока|tiktok|видео|ролика|поста|сторис)\b/u,
  /\b(?:видео|ролик|рилс|reels|shorts|short|тик\s*ток|тикток|tiktok)\s+про\b/u
];
const FORBIDDEN_META_ANSWER_PHRASES = [
  'лучше дать',
  'нужно объяснить',
  'важно показать',
  'хороший ответ должен',
  'для контента можно',
  'по текущему вопросу',
  'по этой теме лучше',
  'не общий совет'
];
const FORBIDDEN_STYLE_ANSWER_PHRASES = [
  'must-have',
  'must have',
  'шикарно',
  'идеальный выбор для всех',
  'обязательно',
  'обязательно купите',
  'подходит абсолютно всем',
  'всегда в моде',
  'ваш новый must-have',
  'ваш новый must have',
  'точно нужен каждому',
  'это must-have',
  'это must have',
  'это идеальный выбор',
  'это обязательно должно быть в гардеробе',
  'это всегда выглядит стильно',
  'смело носите',
  'выглядит шикарно',
  'идеальное худи',
  'худи для вашего стиля',
  'худи — must-have',
  'худи must-have',
  'худи нужно в базовом гардеробе',
  'как выбрать идеальное худи',
  'лучшие худи',
  'худи подходит всем'
];
const FORBIDDEN_HOODIE_PHRASES = [
  'идеальное худи',
  'худи для вашего стиля',
  'худи — must-have',
  'худи must-have',
  'худи нужно в базовом гардеробе',
  'как выбрать идеальное худи',
  'лучшие худи',
  'худи подходит всем'
];
const HOODIE_WORDS = ['худи', 'hoodie'];
const HOODIE_TOPIC_REPLACEMENTS = [
  'Как понять, что одежда плохо сидит?',
  'Какие детали сразу портят мужской образ?',
  'Почему образ выглядит неаккуратно?',
  'Как выбрать вещи, которые делают силуэт лучше?',
  'Какие ошибки чаще всего делают в базовом гардеробе?'
];
const SKINNY_PROMOTION_PHRASES = [
  'скини джинсы — это не просто тренд',
  'скинни джинсы — это не просто тренд',
  'скини джинсы ваш новый must have',
  'скинни джинсы ваш новый must have',
  'скини джинсы — ваш новый must have',
  'скинни джинсы — ваш новый must have',
  'скини — ваш новый must have',
  'скинни — ваш новый must have',
  'скини это возможность подчеркнуть',
  'скинни это возможность подчеркнуть',
  'must have в гардеробе',
  'must-have в гардеробе',
  'всегда в моде',
  'скинни — идеальный выбор',
  'скини — идеальный выбор',
  'скинни это идеальный выбор',
  'скини это идеальный выбор',
  'скинни обязательно должны быть',
  'скини обязательно должны быть'
];
const BLACK_PRIORITY_PHRASES = [
  'начните с классических черных',
  'начните с классических черных',
  'начните с классических чёрных',
  'начните с черных',
  'начните с черных',
  'начните с чёрных',
  'начните с черного',
  'начните с чёрного',
  'первым делом берите черный',
  'первым делом берите чёрный',
  'самые универсальные цвета — черный',
  'самые универсальные цвета — черный',
  'самые универсальные цвета — чёрный',
  'самые универсальные цвета — черные',
  'самые универсальные цвета — черные',
  'самые универсальные цвета — чёрные',
  'черные — они подходят ко всему',
  'чёрные — они подходят ко всему',
  'черные подходят ко всему',
  'чёрные подходят ко всему',
  'черный подходит ко всему',
  'чёрный подходит ко всему',
  'черный — подходит ко всему',
  'чёрный — подходит ко всему',
  'черный — самый универсальный',
  'чёрный — самый универсальный',
  'черный самый универсальный',
  'чёрный самый универсальный',
  'черные брюки — база',
  'чёрные брюки — база',
  'черные брюки база',
  'чёрные брюки база',
  'черный — главный цвет базы',
  'чёрный — главный цвет базы'
];

function preview(text, maxLength) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeForCompare(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/["'`«».,!?;:()[\]{}<>/\\|+=*_~#№%^&\r\n\t-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesAny(text, fragments) {
  return fragments.some((fragment) => text.includes(normalizeForCompare(fragment)));
}

function isReadyContentRequest(question) {
  const text = normalizeForCompare(question);
  return includesAny(text, READY_CONTENT_REQUEST_FRAGMENTS) ||
    READY_CONTENT_REQUEST_PATTERNS.some((pattern) => pattern.test(text));
}

function hasForbiddenMetaAnswer(answer) {
  return includesAny(normalizeForCompare(answer), FORBIDDEN_META_ANSWER_PHRASES);
}

function hasForbiddenStylePhrase(answer) {
  return includesAny(normalizeForCompare(answer), FORBIDDEN_STYLE_ANSWER_PHRASES);
}

function mentionsHoodie(text) {
  return includesAny(normalizeForCompare(text), HOODIE_WORDS);
}

function userAskedAboutHoodie(userMessage) {
  return mentionsHoodie(userMessage);
}

function getDataTextForStyleChecks(aiData) {
  return [
    aiData?.answer || '',
    ...(Array.isArray(aiData?.content_topics) ? aiData.content_topics : [])
  ].join('\n');
}

function hasForbiddenHoodieContent(aiData, userMessage) {
  const combined = getDataTextForStyleChecks(aiData);

  if (includesAny(normalizeForCompare(combined), FORBIDDEN_HOODIE_PHRASES)) {
    return true;
  }

  if (userAskedAboutHoodie(userMessage)) {
    return false;
  }

  return mentionsHoodie(combined);
}

function replaceHoodieTopicsIfNeeded(aiData, userMessage) {
  if (!isUsableAIData(aiData) || userAskedAboutHoodie(userMessage)) {
    return aiData;
  }

  const used = new Set();
  let replacementIndex = 0;
  const contentTopics = aiData.content_topics.map((topic) => {
    if (!mentionsHoodie(topic)) {
      used.add(topic);
      return topic;
    }

    while (
      replacementIndex < HOODIE_TOPIC_REPLACEMENTS.length &&
      used.has(HOODIE_TOPIC_REPLACEMENTS[replacementIndex])
    ) {
      replacementIndex += 1;
    }

    const replacement = HOODIE_TOPIC_REPLACEMENTS[replacementIndex] || 'Какие детали помогают образу выглядеть собраннее?';
    used.add(replacement);
    replacementIndex += 1;
    return replacement;
  });

  return {
    ...aiData,
    content_topics: contentTopics
  };
}

function promotesSkinnyJeans(answer) {
  return includesAny(normalizeForCompare(answer), SKINNY_PROMOTION_PHRASES);
}

function prioritizesBlackBasics(answer) {
  return includesAny(normalizeForCompare(answer), BLACK_PRIORITY_PHRASES);
}

function violatesStyleGuide(answer) {
  return hasForbiddenStylePhrase(answer) || promotesSkinnyJeans(answer) || prioritizesBlackBasics(answer);
}

function hasScriptLabel(answer, label) {
  return new RegExp(`(?:^|\\n)\\s*${label}\\s*:`, 'iu').test(String(answer || ''));
}

function hasAnyScriptLabel(answer) {
  return ['Хук', 'Текст', 'Финал'].some((label) => hasScriptLabel(answer, label));
}

function extractScriptBlock(answer, label) {
  const pattern = new RegExp(`(?:^|\\n)\\s*${label}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:Хук|Текст|Финал|🔥\\s*Популярные темы для контента)\\s*:|$)`, 'iu');
  const match = String(answer || '').match(pattern);
  return match?.[1]?.trim() || '';
}

function isPlaceholderText(text) {
  const normalized = normalizeForCompare(text);

  return !normalized ||
    normalized === '...' ||
    normalized.includes('первая фраза') ||
    normalized.includes('готовый текст') ||
    normalized.includes('короткая завершающая') ||
    /^\[[^\]]+\]$/u.test(String(text || '').trim());
}

function hasBrokenScriptStructure(answer) {
  if (!hasAnyScriptLabel(answer)) {
    return false;
  }

  if (!hasScriptLabel(answer, 'Хук') || !hasScriptLabel(answer, 'Текст') || !hasScriptLabel(answer, 'Финал')) {
    return true;
  }

  const hook = extractScriptBlock(answer, 'Хук');
  const text = extractScriptBlock(answer, 'Текст');
  const final = extractScriptBlock(answer, 'Финал');

  return hook.length < 8 ||
    text.length < 60 ||
    final.length < 10 ||
    isPlaceholderText(hook) ||
    isPlaceholderText(text) ||
    isPlaceholderText(final);
}

function hasBadAnswerFormat(answer, userMessage) {
  const readyContentRequest = isReadyContentRequest(userMessage);

  if (!readyContentRequest && hasAnyScriptLabel(answer)) {
    return true;
  }

  if (hasBrokenScriptStructure(answer)) {
    return true;
  }

  if (!readyContentRequest && String(answer || '').trim().length < 150 && String(userMessage || '').trim().length > 10) {
    return true;
  }

  return false;
}

function getBadAnswerReason(aiData, userMessage) {
  const answer = typeof aiData === 'string' ? aiData : aiData?.answer;

  if (hasForbiddenMetaAnswer(answer)) {
    return 'meta_answer';
  }

  if (typeof aiData === 'object' && hasForbiddenHoodieContent(aiData, userMessage)) {
    return 'hoodie_violation';
  }

  if (violatesStyleGuide(answer)) {
    return 'style_guide_violation';
  }

  if (hasBadAnswerFormat(answer, userMessage)) {
    return 'bad_answer_format';
  }

  return '';
}

function extractAssistantAnswer(content) {
  const text = String(content || '').trim();

  if (!text) {
    return '';
  }

  try {
    const parsed = JSON.parse(text);

    if (typeof parsed?.answer === 'string' && parsed.answer.trim()) {
      return parsed.answer.trim();
    }
  } catch (error) {
    return text;
  }

  return text;
}

function normalizeHistory(history = []) {
  return history
    .filter((item) => ['user', 'assistant'].includes(item.role))
    .slice(-Math.min(config.historyLimit || HISTORY_LIMIT_FOR_AI, HISTORY_LIMIT_FOR_AI))
    .map((item) => {
      const originalContent = String(item.content || '').trim();
      const content = item.role === 'assistant'
        ? extractAssistantAnswer(originalContent)
        : originalContent;

      const shortContent = preview(content, HISTORY_MESSAGE_MAX_LENGTH);

      if (!shortContent) {
        return null;
      }

      if (item.role === 'assistant') {
        return {
          role: 'assistant',
          content: `Краткий предыдущий ответ: ${shortContent}\nНе копируй этот ответ, если текущий вопрос отличается.`
        };
      }

      return {
        role: 'user',
        content: `Предыдущий вопрос пользователя: ${shortContent}`
      };
    })
    .filter(Boolean);
}

function getLastHistoryContent(history, role) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.role === role) {
      return String(history[index].content || '').trim();
    }
  }

  return '';
}

function getPreviousQuestion(history) {
  return getLastHistoryContent(history, 'user');
}

function getPreviousAnswer(history) {
  return extractAssistantAnswer(getLastHistoryContent(history, 'assistant'));
}

function isResponseFormatError(error) {
  const status = error.response?.status;
  const data = JSON.stringify(error.response?.data || {}).toLowerCase();
  const message = String(error.message || '').toLowerCase();
  const combined = `${data} ${message}`;

  return Boolean(
    status &&
      status >= 400 &&
      status < 500 &&
      (combined.includes('response_format') ||
        combined.includes('json_object') ||
        combined.includes('unsupported') ||
        combined.includes('not support'))
  );
}

function isAuthorizationError(error) {
  return [401, 403].includes(error.response?.status);
}

function isServerUnavailableError(error) {
  const status = error.response?.status;
  return typeof status === 'number' && status >= 500;
}

function canUseLocalFallbackForAIError(error) {
  if (!error.response?.data) {
    return false;
  }

  if (isAuthorizationError(error) || isServerUnavailableError(error)) {
    return false;
  }

  return true;
}

async function requestOpenRouter(messages, useResponseFormat = true) {
  const body = {
    model: config.openRouter.model,
    messages,
    temperature: 0.55,
    max_tokens: 700,
    presence_penalty: 0.2,
    frequency_penalty: 0.25
  };

  if (useResponseFormat) {
    body.response_format = { type: 'json_object' };
  }

  const response = await axios.post(
    `${config.openRouter.baseUrl}/chat/completions`,
    body,
    {
      headers: {
        Authorization: `Bearer ${config.openRouter.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': config.openRouter.appUrl,
        'X-Title': config.openRouter.appName
      },
      timeout: config.aiTimeoutMs
    }
  );

  const rawText = response.data?.choices?.[0]?.message?.content?.trim();

  if (!rawText) {
    throw new Error('OpenRouter returned an empty answer.');
  }

  return rawText;
}

async function requestOpenRouterWithFallback(messages) {
  try {
    return await requestOpenRouter(messages, true);
  } catch (error) {
    if (!isResponseFormatError(error)) {
      throw error;
    }

    logError('OpenRouter response_format is not supported, retrying without it', error);
    return requestOpenRouter(messages, false);
  }
}

function buildCurrentUserPrompt(userMessage, extraInstruction = '') {
  const basePrompt = buildUserPrompt(userMessage);

  if (!extraInstruction) {
    return basePrompt;
  }

  return `${basePrompt}

ДОПОЛНИТЕЛЬНОЕ ПРАВИЛО ДЛЯ ЭТОГО ОТВЕТА:
${extraInstruction}`;
}

function buildMessages(userMessage, history = [], options = {}) {
  const useHistory = options.useHistory ?? config.useHistory;
  const systemPrompt = options.extraSystemInstruction
    ? `${SYSTEM_PROMPT}\n\n${options.extraSystemInstruction}`
    : SYSTEM_PROMPT;
  const messages = [{ role: 'system', content: systemPrompt }];
  const historyMessages = useHistory ? normalizeHistory(history) : [];

  if (historyMessages.length > 0) {
    messages.push({
      role: 'system',
      content: 'Краткая история ниже дана только как справка. Текущий вопрос в последнем сообщении главный. Не копируй прошлые ответы.'
    });
    messages.push(...historyMessages);
  }

  messages.push({
    role: 'user',
    content: buildCurrentUserPrompt(userMessage, options.extraUserInstruction)
  });

  return messages;
}

function buildRepairPrompt(rawText, originalUserMessage) {
  return `Пользователь спросил:
"${String(originalUserMessage || '').trim()}"

Предыдущий ответ был невалидным, слишком общим или не соответствовал вопросу.

Сделай новый ответ именно на текущий вопрос пользователя.
Не копируй предыдущий ответ.
Верни строго JSON:
{
  "answer": "...",
  "content_topics": ["...", "...", "...", "...", "..."]
}

Невалидный ответ, который нельзя копировать:
${String(rawText || '').trim()}`;
}

function isUsableAIData(data) {
  return Boolean(
    data &&
      !isValidatorFallbackResponse(data) &&
      typeof data.answer === 'string' &&
      data.answer.trim() &&
      Array.isArray(data.content_topics) &&
      data.content_topics.length === 5 &&
      data.content_topics.every((topic) => typeof topic === 'string' && topic.trim())
  );
}

function hasPotentialStructuredContent(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return false;
  }

  return Boolean(
    Array.isArray(parsed.content_topics) ||
      Array.isArray(parsed.topics) ||
      Array.isArray(parsed.questions) ||
      Array.isArray(parsed.related_questions)
  );
}

function hasNumberedTopics(rawText) {
  return /^\s*(?:\d{1,2}(?:[).:]|-)\s+|[-*•]\s+)/mu.test(String(rawText || ''));
}

function detectQuestionIntent(question) {
  const text = normalizeForCompare(question);
  const facet = includesAny(text, MATERIAL_WORDS)
    ? 'material'
    : includesAny(text, COLOR_WORDS)
      ? 'color'
      : includesAny(text, BASE_WORDS)
        ? 'base'
        : 'general';

  if (text.includes('галстук')) {
    return { item: 'tie', facet };
  }

  if (text.includes('брюк') || text.includes('брюч')) {
    return {
      item: 'trousers',
      facet: text.includes('рубашк') ? 'shirt' : facet
    };
  }

  if (text.includes('джинс') || text.includes('скинни') || text.includes('скини')) {
    return { item: 'jeans', facet };
  }

  if (text.includes('пиджак')) {
    return { item: 'jacket', facet };
  }

  if (text.includes('худи') || text.includes('hoodie')) {
    return { item: 'hoodie', facet };
  }

  if (text.includes('пальто')) {
    return { item: 'coat', facet };
  }

  if (text.includes('рубашк')) {
    return { item: 'shirt', facet };
  }

  if (text.includes('обув') || text.includes('туфл') || text.includes('ботин') || text.includes('кроссов')) {
    return { item: 'shoes', facet };
  }

  if (text.includes('плать')) {
    return { item: 'dress', facet };
  }

  if (text.includes('образ') || text.includes('стиль') || text.includes('гардероб')) {
    return { item: 'outfit', facet };
  }

  return { item: 'general', facet };
}

function detectFallbackType(question) {
  const intent = detectQuestionIntent(question);

  if (intent.item === 'tie' && intent.facet === 'material') {
    return 'tie_material';
  }

  if (intent.item === 'tie' && intent.facet === 'color') {
    return 'tie_color';
  }

  if (intent.item === 'tie') {
    return 'tie_general';
  }

  if (intent.item === 'trousers' && intent.facet === 'color') {
    return 'trousers_color';
  }

  if (intent.item === 'trousers' && intent.facet === 'base') {
    return 'trousers_basic_wardrobe';
  }

  if (intent.item === 'trousers' && intent.facet === 'shirt') {
    return 'trousers_with_shirt';
  }

  if (intent.item === 'trousers') {
    return 'trousers_general';
  }

  if (intent.item === 'jeans') {
    return 'jeans';
  }

  if (intent.item === 'jacket' && intent.facet === 'material') {
    return 'jacket_material';
  }

  if (intent.item === 'jacket') {
    return 'jacket';
  }

  if (intent.item === 'hoodie') {
    return 'hoodie';
  }

  if (intent.item === 'coat') {
    return 'coat';
  }

  if (intent.item === 'shirt') {
    return 'shirt';
  }

  if (intent.item === 'shoes') {
    return 'shoes';
  }

  if (intent.item === 'dress') {
    return 'dress';
  }

  if (intent.item === 'outfit') {
    return 'outfit_style_wardrobe';
  }

  return 'general';
}

function isAnswerRelevantToQuestion(question, aiData) {
  if (!isUsableAIData(aiData)) {
    return false;
  }

  const intent = detectQuestionIntent(question);
  const answer = normalizeForCompare(aiData.answer);

  if (intent.item === 'general' || intent.item === 'outfit') {
    return true;
  }

  const itemChecks = {
    tie: ['галстук'],
    trousers: ['брюк', 'брюч'],
    jeans: ['джинс', 'скинни', 'скини'],
    jacket: ['пиджак'],
    hoodie: ['худи', 'hoodie'],
    coat: ['пальто'],
    shirt: ['рубашк'],
    shoes: ['обув', 'туфл', 'ботин', 'кроссов'],
    dress: ['плать']
  };

  if (!includesAny(answer, itemChecks[intent.item] || [])) {
    return false;
  }

  if (intent.facet === 'material' && !includesAny(answer, SPECIFIC_MATERIAL_WORDS)) {
    return false;
  }

  if (intent.facet === 'color' && !includesAny(answer, SPECIFIC_COLOR_WORDS)) {
    return false;
  }

  if (intent.facet === 'base' && intent.item === 'trousers' && !includesAny(answer, ['баз', 'универсальн', 'прям', 'посадк', 'ткан', 'длин'])) {
    return false;
  }

  if (intent.facet === 'shirt' && intent.item === 'trousers' && !answer.includes('рубашк')) {
    return false;
  }

  return true;
}

function wordSet(text) {
  return new Set(
    normalizeForCompare(text)
      .split(/\s+/)
      .filter((word) => word.length > 2)
  );
}

function jaccardSimilarity(left, right) {
  const leftWords = wordSet(left);
  const rightWords = wordSet(right);

  if (leftWords.size === 0 || rightWords.size === 0) {
    return 0;
  }

  let intersection = 0;

  for (const word of leftWords) {
    if (rightWords.has(word)) {
      intersection += 1;
    }
  }

  const union = leftWords.size + rightWords.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function areQuestionsDifferent(previousQuestion, currentQuestion) {
  const previous = normalizeForCompare(previousQuestion);
  const current = normalizeForCompare(currentQuestion);

  return Boolean(previous && current && previous !== current);
}

function areAnswersTooSimilar(previousAnswer, currentAnswer) {
  const previous = normalizeForCompare(previousAnswer);
  const current = normalizeForCompare(currentAnswer);

  if (!previous || !current) {
    return false;
  }

  if (previous === current) {
    return true;
  }

  const shorterLength = Math.min(previous.length, current.length);
  const longerLength = Math.max(previous.length, current.length);
  const lengthRatio = longerLength > 0 ? shorterLength / longerLength : 0;

  if (lengthRatio > 0.88 && (previous.includes(current) || current.includes(previous))) {
    return true;
  }

  return lengthRatio > 0.82 && jaccardSimilarity(previous, current) >= 0.88;
}

function shouldRetryForDuplicate(aiData, history, currentQuestion) {
  const previousQuestion = getPreviousQuestion(history);
  const previousAnswer = getPreviousAnswer(history);

  return Boolean(
    isUsableAIData(aiData) &&
      areQuestionsDifferent(previousQuestion, currentQuestion) &&
      areAnswersTooSimilar(previousAnswer, aiData.answer)
  );
}

function logAIRawResponse(rawText, source) {
  logInfo(`[AI_RAW_RESPONSE] source=${source} first 300 chars: ${preview(rawText, RAW_LOG_MAX_LENGTH)}`);
}

function logAINormalized(data) {
  logInfo(`[AI_NORMALIZED] answer first 150 chars: ${preview(data?.answer, NORMALIZED_LOG_MAX_LENGTH)} topics count: ${Array.isArray(data?.content_topics) ? data.content_topics.length : 0}`);
}

function logAIFallbackUsed(userId, question, reason) {
  logError(`[AI_FALLBACK_USED] userId=${String(userId || 'anonymous')} reason=${reason} question=${preview(question, 300)} fallbackType=${detectFallbackType(question)}`);
}

function logDuplicateDetected(history, currentQuestion) {
  logInfo(`[AI_DUPLICATE_DETECTED] previousQuestion=${preview(getPreviousQuestion(history), 300)} currentQuestion=${preview(currentQuestion, 300)}`);
}

async function requestAIData(messages, source) {
  const rawText = await requestOpenRouterWithFallback(messages);
  const parsed = safeParseAIJson(rawText);

  logAIRawResponse(rawText, source);

  if (!validateAIResponse(parsed)) {
    return { rawText, parsed, data: null };
  }

  const data = normalizeAIResponse(parsed, rawText);

  if (isUsableAIData(data)) {
    logAINormalized(data);
  }

  return { rawText, parsed, data };
}

async function repairAIResponse(rawText, originalUserMessage) {
  const repairMessages = [
    {
      role: 'system',
      content: 'Ты исправляешь ответы в строгий JSON. Текущий вопрос пользователя главный. Верни только JSON с ключами answer и content_topics.'
    },
    { role: 'user', content: buildRepairPrompt(rawText, originalUserMessage) }
  ];

  try {
    const { rawText: repairedRawText, data } = await requestAIData(repairMessages, 'repair');

    if (!isUsableAIData(data)) {
      logError(`AI repair response failed JSON validation. Preview: ${preview(repairedRawText, PREVIEW_MAX_LENGTH)}`);
      return null;
    }

    return data;
  } catch (error) {
    logError('AI repair request failed', error);
    return null;
  }
}

async function requestSimplifiedAIResponse(originalUserMessage, extraInstruction = '') {
  const retryMessages = buildMessages(originalUserMessage, [], {
    useHistory: false,
    extraSystemInstruction: 'Сгенерируй новый ответ без истории. Нельзя использовать старый ответ как основу.',
    extraUserInstruction: extraInstruction || 'Сделай конкретный ответ строго по текущему вопросу пользователя.'
  });

  try {
    const { rawText, data } = await requestAIData(retryMessages, 'retry_without_history');

    if (!isUsableAIData(data)) {
      logError(`AI simplified retry failed JSON validation. Preview: ${preview(rawText, PREVIEW_MAX_LENGTH)}`);
      return null;
    }

    return data;
  } catch (error) {
    logError('AI simplified retry request failed', error);
    return null;
  }
}

async function retryMetaAnswer(originalUserMessage) {
  return requestSimplifiedAIResponse(
    originalUserMessage,
    'Ты написал инструкцию вместо готового ответа. Перепиши и сразу выполни задачу пользователя. Если пользователь явно просит текст, сценарий, Reels, Shorts, пост, сторис, речь или объяснение другу — дай готовый материал со структурой "Хук:", "Текст:", "Финал:". Если пользователь просто задаёт вопрос, дай обычный полезный ответ без "Хук:", "Текст:", "Финал:". Не пиши мета-фразы вроде "лучше дать", "нужно объяснить", "важно показать", "хороший ответ должен", "для контента можно", "по текущему вопросу", "по этой теме лучше", "не общий совет".'
  );
}

async function replaceMetaAnswerIfNeeded(aiData, userId, userMessage) {
  if (!isUsableAIData(aiData)) {
    return aiData;
  }

  const reason = getBadAnswerReason(aiData, userMessage);

  if (!reason) {
    return aiData;
  }

  logError(`[AI_BAD_ANSWER_DETECTED] reason=${reason} userId=${String(userId || 'anonymous')} question=${preview(userMessage, 300)} answer=${preview(aiData.answer, 300)}`);

  let retryData = null;

  if (reason === 'style_guide_violation') {
    retryData = await requestSimplifiedAIResponse(
      userMessage,
      'Ты нарушил стилистические правила проекта. Перепиши ответ спокойнее, без рекламных формулировок, без приоритета чёрного цвета и без восхваления спорных вещей. Ответ должен быть конкретным по текущему запросу.'
    );
  } else if (reason === 'hoodie_violation') {
    retryData = await requestSimplifiedAIResponse(
      userMessage,
      'Не предлагай худи, если пользователь сам не спрашивал про худи. Перепиши ответ и темы без худи.'
    );
  } else if (reason === 'bad_answer_format') {
    retryData = await requestSimplifiedAIResponse(
      userMessage,
      'Ты вернул незаконченный сценарий или выбрал неверный формат. Если пользователь не просил сценарий, дай обычный полезный ответ. Если просил сценарий, заполни Хук, Текст и Финал полностью.'
    );
  } else {
    retryData = await retryMetaAnswer(userMessage);
  }

  if (isUsableAIData(retryData) && !getBadAnswerReason(retryData, userMessage)) {
    return retryData;
  }

  if (
    reason === 'hoodie_violation' &&
    isUsableAIData(retryData) &&
    !mentionsHoodie(retryData.answer) &&
    !userAskedAboutHoodie(userMessage)
  ) {
    const sanitizedData = replaceHoodieTopicsIfNeeded(retryData, userMessage);

    if (!getBadAnswerReason(sanitizedData, userMessage)) {
      return sanitizedData;
    }
  }

  logAIFallbackUsed(userId, userMessage, `${reason}_retry_failed`);
  return buildSmartFallbackResponse(userMessage);
}

function buildPoloReadyContentFallbackResponse() {
  return {
    answer: 'Хук:\nОбычная футболка — это база, но поло часто выглядит собраннее.\n\nТекст:\nФутболка может быть удобной, но она часто делает образ слишком простым. Поло отличается тем, что у него есть воротник, более аккуратная форма и ощущение, будто образ собран чуть внимательнее. Его можно носить с джинсами, брюками, шортами, кедами или лоферами, и оно не выглядит случайно. Главное — выбирать плотную ткань, спокойный цвет и нормальную посадку. Тогда поло остаётся удобным, но выглядит взрослее и аккуратнее обычной футболки.\n\nФинал:\nПоэтому поло — это вариант, когда хочется комфорта футболки, но более собранного вида.',
    content_topics: [
      'Почему поло выглядит собраннее обычной футболки?',
      'Как выбрать поло, которое не выглядит дешёво?',
      'С чем носить поло, чтобы образ был современным?',
      'Какие ошибки чаще всего делают с футболками поло?',
      'Что лучше для базы: футболка или поло?'
    ]
  };
}

function buildJeansScenarioFallbackResponse() {
  return {
    answer: 'Хук:\nДжинсы могут быть базой, а могут сразу испортить весь образ.\n\nТекст:\nКадр 1: покажи джинсы, которые слишком обтягивают ноги или собираются складками. Текст: "Первая ошибка — выбирать джинсы только по размеру, а не по посадке". Кадр 2: покажи слишком тонкую ткань. Текст: "Если ткань не держит форму, образ выглядит дешевле". Кадр 3: сравни неудачную длину и аккуратную длину у обуви. Текст: "Джинсы не должны бесконечно заламываться снизу". Кадр 4: покажи прямой, straight или relaxed fit. Текст: "Самый спокойный вариант для базы — силуэт без сильного облегания". Скинни лучше не подавать как универсальную базу: они часто перетягивают ноги и требуют очень точной стилизации.\n\nФинал:\nХорошие джинсы не спорят с образом, а собирают его.',
    content_topics: [
      'Какие ошибки чаще всего делают с джинсами?',
      'Как понять, что джинсы сидят плохо?',
      'Почему прямые джинсы часто выглядят актуальнее скинни?',
      'Какая длина джинсов лучше смотрится с обувью?',
      'Как выбрать джинсы, которые держат форму?'
    ]
  };
}

function buildSkinnyJeansFallbackResponse(message = '') {
  if (message.includes('вместо') || message.includes('замен')) {
    return {
      answer: 'Вместо скинни лучше смотреть на модели, которые дают форму без сильного облегания. Самая спокойная замена — slim straight: джинсы остаются аккуратными, но не перетягивают ногу. Если хочется более расслабленного силуэта, подойдут прямые джинсы, relaxed fit или wide straight из плотного денима. Такие модели легче сочетать с футболками, рубашками, пиджаками, свитерами и разной обувью. Скинни можно оставить для очень конкретной стилизации, но для базы альтернативы обычно выглядят современнее и мягче по пропорциям.',
      content_topics: [
        'Какие джинсы выбрать вместо слишком узких скинни?',
        'Чем slim straight отличается от обычных скинни?',
        'Почему прямые джинсы проще сочетать каждый день?',
        'Как relaxed fit меняет пропорции в образе?',
        'Какие ошибки делают при переходе со скинни на прямые джинсы?'
      ]
    };
  }

  if (message.includes('с чем') || message.includes('носить')) {
    return {
      answer: 'Скинни лучше носить так, чтобы они не выглядели слишком тесно и не перетягивали весь силуэт. Работает плотный деним, нормальная длина без лишних складок и верх, который даёт баланс: свободная рубашка, жакет, свитер, плотная футболка или верхняя одежда прямого кроя. Обувь лучше выбирать не слишком узкую, чтобы низ не выглядел хрупким и перегруженным одновременно. Слишком обтягивающий верх, блестящая ткань и низкая посадка обычно делают скинни устаревшими. Если хочется более спокойного результата, можно заменить их на slim straight или прямые джинсы.',
      content_topics: [
        'С чем носить скинни, чтобы они выглядели современно?',
        'Какая обувь лучше сочетается со скинни джинсами?',
        'Почему свободный верх помогает сбалансировать скинни?',
        'Какие ошибки чаще всего делают со скинни джинсами?',
        'Когда лучше заменить скинни на slim straight?'
      ]
    };
  }

  return {
    answer: 'Скинни — спорная модель, и её не стоит подавать как универсальную базу. Они могут работать, если ткань плотная, посадка не слишком обтягивающая, а верх помогает сбалансировать силуэт. Но слишком узкие и блестящие скинни часто выглядят устаревшими и могут портить пропорции. Более спокойная альтернатива — slim straight, прямые джинсы или relaxed fit. Если хочется носить скинни, лучше делать это осознанно: без лишнего обтягивания, с плотной тканью и современным верхом.',
    content_topics: [
      'Почему скинни джинсы часто выглядят устаревшими?',
      'Какие джинсы выбрать вместо слишком узких скинни?',
      'Как понять, что скинни портят пропорции?',
      'С чем носить скинни, если не хочется выглядеть старомодно?',
      'Какие ошибки чаще всего делают со скинни джинсами?'
    ]
  };
}

function buildSkinnyReadyContentFallbackResponse() {
  return {
    answer: 'Хук:\nСкинни джинсы лучше разбирать честно: это не универсальная база.\n\nТекст:\nСкинни могут работать, но только если они не перетягивают ногу, не блестят и не ломают пропорции. Проблема в том, что слишком узкая посадка часто делает силуэт тяжёлым снизу и выглядит устаревше, особенно с тесным верхом и тонкой тканью. Если человек всё же хочет носить скинни, лучше выбирать спокойный slim, плотный деним, нормальную длину и балансировать образ более свободной рубашкой, жакетом, свитером или верхней одеждой. А если нужна более современная база, проще смотреть в сторону прямых джинсов, slim straight, relaxed fit или wide straight.\n\nФинал:\nСкинни можно носить осознанно, но в базе чаще сильнее работают силуэты без лишнего обтягивания.',
    content_topics: [
      'Почему скинни джинсы часто выглядят устаревшими?',
      'Какие джинсы выбрать вместо слишком узких скинни?',
      'Как понять, что скинни портят пропорции?',
      'С чем носить скинни, если не хочется выглядеть старомодно?',
      'Какие ошибки чаще всего делают со скинни джинсами?'
    ]
  };
}

function buildHoodieFallbackResponse(isShort) {
  if (isShort) {
    return {
      answer: 'Короткое худи может работать в отдельных образах, но как база оно спорное. Главный риск в том, что короткая длина режет силуэт, визуально укорачивает корпус или делает пропорции менее собранными. Лучше выбирать худи нормальной длины, из плотной ткани, со спокойным цветом и посадкой, которая не выглядит случайно. Если всё же хочется короткое худи, его стоит сочетать с высокой посадкой низа и более чистыми линиями, чтобы образ не разваливался. Для универсального гардероба спокойнее работают худи средней длины без активных логотипов и тонкой ткани.',
      content_topics: [
        'Почему короткое худи часто режет силуэт?',
        'Как выбрать худи нормальной длины для базы?',
        'Какие худи выглядят аккуратнее в повседневных образах?',
        'С чем носить короткое худи, если оно уже есть?',
        'Какие ошибки чаще всего делают при выборе худи?'
      ]
    };
  }

  return {
    answer: 'Худи может быть уместным в расслабленных образах, но его не стоит подавать как главный элемент собранного мужского гардероба. Если всё же выбирать худи, лучше смотреть на нормальную длину, плотную ткань, спокойный цвет и посадку без лишнего обтягивания. Короткие модели, тонкий трикотаж и активные логотипы часто делают образ менее аккуратным. Для более взрослого и собранного впечатления чаще лучше работают свитер, кардиган, плотный лонгслив, overshirt, поло или рубашка. Худи стоит оставлять для ситуаций, где расслабленность действительно уместна.',
    content_topics: [
      'Как выбрать худи без ощущения случайности?',
      'Почему длина худи влияет на пропорции?',
      'Когда худи уместно в мужском гардеробе?',
      'Что выбрать вместо худи для собранного образа?',
      'Какие ошибки чаще всего делают с худи?'
    ]
  };
}

function buildHoodieReadyContentFallbackResponse(isShort) {
  if (isShort) {
    return {
      answer: 'Хук:\nКороткое худи — вещь не плохая, но с пропорциями оно часто спорит.\n\nТекст:\nПроблема короткого худи в том, что оно может резать силуэт и делать верх визуально случайным. Особенно если ткань тонкая, посадка узкая, а низ сидит низко. Если хочется носить короткое худи, лучше сочетать его с высокой посадкой, плотной тканью и более чистым низом, чтобы образ не выглядел обрезанным. Но для базы спокойнее работает худи нормальной длины: оно закрывает пояс, держит форму и проще сочетается с джинсами, брюками и верхней одеждой.\n\nФинал:\nКороткое худи можно стилизовать, но для универсального гардероба чаще сильнее обычная длина и плотная ткань.',
      content_topics: [
        'Почему короткое худи часто режет силуэт?',
        'Как выбрать худи нормальной длины для базы?',
        'Какие худи выглядят аккуратнее в повседневных образах?',
        'С чем носить короткое худи, если оно уже есть?',
        'Какие ошибки чаще всего делают при выборе худи?'
      ]
    };
  }

  return {
    answer: 'Хук:\nХуди может быть уместным, но не стоит делать его главным ответом на любой гардероб.\n\nТекст:\nЕсли всё же выбирать худи, смотри на нормальную длину, плотную ткань и спокойный цвет. Оно не должно резать силуэт, обтягивать корпус или выглядеть слишком спортивно. Короткие модели, тонкий трикотаж и активные логотипы быстро делают образ менее собранным. Если хочется выглядеть взрослее и аккуратнее, часто лучше работают свитер, кардиган, плотный лонгслив, overshirt, поло или рубашка. Худи оставляй для расслабленных комплектов, где такая подача действительно уместна.\n\nФинал:\nХуди может работать, но для собранного стиля часто сильнее выглядят более аккуратные альтернативы.',
    content_topics: [
      'Как выбрать худи без ощущения случайности?',
      'Почему длина худи влияет на пропорции?',
      'Когда худи уместно в мужском гардеробе?',
      'Что выбрать вместо худи для собранного образа?',
      'Какие ошибки чаще всего делают с худи?'
    ]
  };
}

function buildCoatFallbackResponse(isShort) {
  if (isShort) {
    return {
      answer: 'Короткое пальто может быть уместным, но как базовый вариант оно часто спорное. Такая длина иногда визуально режет рост, утяжеляет верх и хуже собирает образ, особенно если пальто заканчивается в неудачной точке бедра. Для базы чаще спокойнее смотрятся модели средней длины или ниже колена, если это подходит росту и пропорциям. Если всё же выбирать короткое пальто, важно смотреть на плотную ткань, чистую линию плеча и длину, которая не спорит с брюками и обувью. Главное — чтобы пальто собирало силуэт, а не делало его более дробным.',
      content_topics: [
        'Почему короткое пальто может резать рост?',
        'Какую длину пальто выбрать для базового гардероба?',
        'Чем пальто ниже колена отличается от короткого?',
        'Как понять, что пальто портит пропорции?',
        'Какие ошибки чаще всего делают при выборе пальто?'
      ]
    };
  }

  return {
    answer: 'Для базового гардероба лучше смотреть на пальто средней длины или ниже колена, если такая длина подходит росту и пропорциям. Оно обычно собирает силуэт лучше, чем слишком короткая модель, и легче сочетается с брюками, джинсами, платьями и обувью. Важны плотная ткань, аккуратная линия плеча и посадка без лишнего натяжения в груди. Цвет можно выбирать из спокойной палитры: графитовый, тёмно-синий, серый, бежевый, молочный, коричневый или хаки. Слишком короткое, мягкое или бесформенное пальто часто делает образ менее собранным.',
    content_topics: [
      'Какое пальто выбрать для базового гардероба?',
      'Почему длина пальто меняет пропорции?',
      'Какие цвета пальто легче сочетать каждый день?',
      'Как понять, что пальто сидит плохо?',
      'Какие ошибки чаще всего делают при покупке пальто?'
    ]
  };
}

function buildCoatReadyContentFallbackResponse(isShort) {
  if (isShort) {
    return {
      answer: 'Хук:\nКороткое пальто может выглядеть аккуратно, но для базы оно не всегда сильнее.\n\nТекст:\nГлавный риск короткого пальто — оно часто режет рост и дробит силуэт. Особенно если заканчивается в неудачной точке бедра, ткань мягкая, а плечо не держит форму. Для базового гардероба чаще спокойнее смотрятся пальто средней длины или ниже колена: они собирают силуэт, лучше работают с брюками, джинсами и обувью. Если всё же брать короткое пальто, важно следить за плотной тканью, чистой линией плеча и длиной, которая не спорит с пропорциями.\n\nФинал:\nКороткое пальто может работать, но базу чаще проще собрать с длиной, которая вытягивает силуэт.',
      content_topics: [
        'Почему короткое пальто может резать рост?',
        'Какую длину пальто выбрать для базового гардероба?',
        'Чем пальто ниже колена отличается от короткого?',
        'Как понять, что пальто портит пропорции?',
        'Какие ошибки чаще всего делают при выборе пальто?'
      ]
    };
  }

  return {
    answer: 'Хук:\nБазовое пальто должно не просто греть, а собирать силуэт.\n\nТекст:\nДля базы чаще всего лучше смотреть на пальто средней длины или ниже колена, если такая длина подходит росту. Оно легче сочетается с брюками, джинсами, платьями и обувью, потому что не дробит силуэт так сильно, как слишком короткая модель. Важны плотная ткань, аккуратная линия плеча и посадка без натяжения в груди. По цвету хорошо работают графитовый, тёмно-синий, серый, бежевый, молочный, коричневый или хаки. Слишком мягкое, короткое или бесформенное пальто часто делает комплект менее собранным.\n\nФинал:\nХорошее пальто держит форму и помогает образу выглядеть цельнее.',
    content_topics: [
      'Какое пальто выбрать для базового гардероба?',
      'Почему длина пальто меняет пропорции?',
      'Какие цвета пальто легче сочетать каждый день?',
      'Как понять, что пальто сидит плохо?',
      'Какие ошибки чаще всего делают при покупке пальто?'
    ]
  };
}

function buildShortSleeveShirtFallbackResponse(isComparison = false) {
  if (isComparison) {
    return {
      answer: 'Если выбирать между рубашкой с коротким и длинным рукавом, для большинства повседневных образов длинный рукав обычно выглядит собраннее. Его можно носить полностью, подвернуть, сочетать с пиджаком, брюками, джинсами и верхней одеждой. Короткий рукав тоже может работать, но он требовательнее к ткани, ширине рукава и посадке: тонкая ткань и торчащий рукав быстро делают вещь спорной. Для лета хорошая альтернатива — льняная рубашка с длинным рукавом, поло или современная рубашка короткого рукава из плотной ткани. Если нужна база, длинный рукав чаще даёт больше вариантов.',
      content_topics: [
        'Что выбрать: короткий или длинный рукав у рубашки?',
        'Почему длинный рукав часто выглядит собраннее?',
        'Как носить рубашку с подвернутыми рукавами?',
        'Когда рубашка с коротким рукавом выглядит современно?',
        'Какие летние альтернативы есть короткому рукаву?'
      ]
    };
  }

  return {
    answer: 'Рубашка с коротким рукавом может быть нормальной, но это не самая простая вещь для базы. Она часто выглядит спорно, если ткань тонкая, рукав торчит в сторону, длина неудачная или посадка слишком офисная. Если носить такую рубашку, лучше выбирать плотную ткань, свободнее посадку, спокойный цвет и современный крой без лишнего блеска. Более универсальные альтернативы — поло, льняная рубашка или рубашка с длинным рукавом, который можно аккуратно подвернуть. Для повседневного гардероба длинный рукав чаще выглядит собраннее и даёт больше вариантов стилизации.',
    content_topics: [
      'Почему рубашка с коротким рукавом часто выглядит спорно?',
      'Что выбрать вместо рубашки с коротким рукавом?',
      'Как носить короткий рукав, чтобы он выглядел современно?',
      'Какая ткань лучше подходит для летней рубашки?',
      'Чем поло отличается от рубашки с коротким рукавом?'
    ]
  };
}

function buildShortSleeveShirtReadyContentFallbackResponse() {
  return {
    answer: 'Хук:\nРубашка с коротким рукавом может работать, но у неё есть подвох.\n\nТекст:\nОна часто выглядит спорно не из-за самого короткого рукава, а из-за ткани, посадки и формы рукава. Если ткань тонкая, рукав торчит, а крой похож на офисную форму, образ быстро становится неаккуратным. Если использовать такую рубашку, лучше выбирать плотную ткань, свободнее посадку, спокойный цвет и современный крой. Но в большинстве повседневных образов проще взять поло, льняную рубашку или обычную рубашку с длинным рукавом и аккуратно подвернуть рукава.\n\nФинал:\nКороткий рукав не запрещён, но длинный рукав, поло или лен часто дают более собранный результат.',
    content_topics: [
      'Почему рубашка с коротким рукавом часто выглядит спорно?',
      'Что выбрать вместо рубашки с коротким рукавом?',
      'Как носить короткий рукав, чтобы он выглядел современно?',
      'Какая ткань лучше подходит для летней рубашки?',
      'Чем поло отличается от рубашки с коротким рукавом?'
    ]
  };
}

function buildJacketExplanationFallbackResponse() {
  return {
    answer: 'Хук:\nПиджак делает образ собраннее не потому, что он строгий, а потому что он держит форму.\n\nТекст:\nСмотри, футболка, лонгслив или тонкий свитер часто дают мягкий силуэт: плечо может быть расслабленным, линия корпуса не такая чёткая, и образ выглядит проще. А пиджак сразу добавляет структуру: подчёркивает плечи, собирает верх, делает пропорции аккуратнее и визуально показывает, что образ продуман. Его можно носить не только формально — с джинсами, футболкой, лоферами или кедами он тоже работает. Главное, чтобы пиджак хорошо сидел в плечах, не тянул в груди и был из ткани, которая держит форму.\n\nФинал:\nПоэтому пиджак — это быстрый способ выглядеть аккуратнее без лишней сложности.',
    content_topics: [
      'Почему пиджак делает образ собраннее?',
      'Как выбрать пиджак, который не выглядит офисно?',
      'С чем носить пиджак каждый день?',
      'Какие ошибки чаще всего делают с пиджаком?',
      'Как понять, что пиджак сидит плохо?'
    ]
  };
}

function buildMensStyleMistakesFallbackResponse() {
  return {
    answer: 'Мужчины часто ошибаются не из-за отсутствия модных вещей, а из-за посадки, состояния одежды и слабых сочетаний. Самая заметная ошибка — вещи не по фигуре: слишком узкие джинсы, длинные брюки с лишними складками или футболки, которые висят бесформенно. Ещё образ портят слишком тонкие ткани, активные логотипы, неаккуратная обувь и вещи, которые не подходят по ситуации. Отдельно стоит быть осторожнее с короткими пальто, рубашками с коротким рукавом и слишком обтягивающими джинсами: они часто делают образ менее собранным. Лучше начать с хорошей посадки, спокойной палитры, чистой обуви и вещей, которые легко сочетаются между собой.',
    content_topics: [
      'Какие ошибки чаще всего портят мужской стиль?',
      'Почему одежда может выглядеть дешево даже без логотипов?',
      'Как понять, что вещи плохо сидят?',
      'Какие детали делают мужской образ неаккуратным?',
      'Что исправить в гардеробе, чтобы выглядеть собраннее?'
    ]
  };
}

function buildMensStyleMistakesReadyContentFallbackResponse() {
  return {
    answer: 'Хук:\nМужской стиль чаще портят не тренды, а простые ошибки в посадке и деталях.\n\nТекст:\nПервая ошибка — выбирать вещи только по размеру на бирке. Джинсы могут быть слишком узкими, брюки — собираться складками, а футболка — висеть бесформенно. Вторая ошибка — слишком много чёрного без фактуры: образ становится плоским и тяжёлым. Третья — не следить за деталями: грязная обувь, растянутый трикотаж, катышки, активные логотипы и слишком тонкие ткани сразу делают комплект слабее. И ещё важный момент: вещь должна подходить по ситуации. Даже нормальная одежда может выглядеть неуместно, если она не совпадает с задачей образа.\n\nФинал:\nНачни с посадки, спокойной палитры и аккуратных деталей — это уже сильно собирает мужской гардероб.',
    content_topics: [
      'Какие ошибки чаще всего портят мужской стиль?',
      'Почему дорогие вещи могут выглядеть плохо?',
      'Как понять, что одежда плохо сидит?',
      'Какие детали сразу удешевляют мужской образ?',
      'Что исправить в гардеробе, чтобы выглядеть собраннее?'
    ]
  };
}

function buildTrousersReadyContentFallbackResponse() {
  return {
    answer: 'Хук:\nБазовые брюки должны не просто подходить по цвету, а собирать весь гардероб.\n\nТекст:\nДля базы лучше выбирать прямой или слегка свободный крой, который не тянет в бёдрах и не собирается лишними складками. Ткань должна держать форму, иначе брюки быстро выглядят домашними или случайными. По цветам удобнее начинать не с одного “главного” варианта, а с палитры: графитовый, тёмно-синий, серый, бежевый, молочный, коричневый или хаки. Чёрный тоже может работать, но он не всегда самый мягкий для повседневных комплектов. Хорошие базовые брюки легко сочетаются минимум с несколькими верхами, обувью и верхней одеждой.\n\nФинал:\nЕсли брюки хорошо сидят, держат форму и совпадают с палитрой гардероба, они становятся настоящей базой.',
    content_topics: [
      'Какие брюки выбрать для базового гардероба?',
      'Почему посадка брюк важнее тренда?',
      'Какие цвета брюк лучше работают в базе?',
      'Как понять, что брюки выглядят дешево?',
      'С чем сочетать базовые брюки каждый день?'
    ]
  };
}

function buildGenericReadyContentFallbackResponse(originalText) {
  const topic = originalText || 'эту тему';

  return {
    answer: `Хук:\n${topic} можно объяснить проще и живее, чем кажется.\n\nТекст:\nПредставь, что ты говоришь это другу: суть не в сложных терминах, а в том, чтобы сразу показать пользу. Начни с понятной проблемы, затем дай один главный аргумент и подкрепи его простым примером из гардероба. Если речь про вещь, объясни её через посадку, ткань, силуэт, цвет и то, с чем её реально носить. Если речь про ошибку, сначала покажи неудачный вариант, а потом сразу рядом — более удачную замену. Такой текст будет звучать естественно и подойдёт для короткого ролика или поста.\n\nФинал:\nГлавное — говорить не абстрактно, а так, чтобы зритель сразу понял, что ему сделать.`,
    content_topics: [
      'Как объяснить эту тему простыми словами?',
      'Какая ошибка чаще всего мешает образу выглядеть собранно?',
      'Как показать удачный и неудачный вариант в Reels?',
      'Как превратить совет по стилю в короткий текст?',
      'Как сделать тему полезной для зрителя?'
    ]
  };
}

function buildSmartFallbackResponse(originalUserMessage) {
  const originalText = String(originalUserMessage || '').trim();
  const message = normalizeForCompare(originalText);

  if (isReadyContentRequest(message)) {
    if (message.includes('ошиб') && message.includes('мужчин') && message.includes('стил')) {
      return buildMensStyleMistakesReadyContentFallbackResponse();
    }

    if (message.includes('поло') || message.includes('футболк')) {
      return buildPoloReadyContentFallbackResponse();
    }

    if (message.includes('скинни') || message.includes('скини')) {
      return buildSkinnyReadyContentFallbackResponse();
    }

    if (message.includes('джинс') || message.includes('скинни') || message.includes('скини')) {
      return buildJeansScenarioFallbackResponse();
    }

    if (message.includes('худи') || message.includes('hoodie')) {
      return buildHoodieReadyContentFallbackResponse(message.includes('корот'));
    }

    if (message.includes('пальто')) {
      return buildCoatReadyContentFallbackResponse(message.includes('корот'));
    }

    if (message.includes('рубашк') && message.includes('корот') && message.includes('рукав')) {
      return buildShortSleeveShirtReadyContentFallbackResponse();
    }

    if (message.includes('пиджак')) {
      return buildJacketExplanationFallbackResponse();
    }

    if (message.includes('брюк') || message.includes('брюч')) {
      return buildTrousersReadyContentFallbackResponse();
    }

    return buildGenericReadyContentFallbackResponse(originalText);
  }

  if (
    message.startsWith('привет') ||
    message.startsWith('здравствуй') ||
    message.startsWith('здравствуйте') ||
    message.startsWith('добрый день') ||
    message.startsWith('доброе утро') ||
    message.startsWith('добрый вечер')
  ) {
    return {
      answer: 'Приветствие можно превратить в мягкий вход в диалог с аудиторией: сразу обозначить, какую пользу человек получит дальше. Для блога о стиле лучше не начинать с абстрактного приветствия, а быстро перейти к конкретике: образ, вещь, ошибка или простой совет. Хороший первый кадр должен объяснять, зачем зрителю смотреть ролик. Можно использовать приветствие как короткую связку, а основную мысль строить вокруг понятной проблемы. Так контент будет выглядеть живым, но не пустым.',
      content_topics: [
        'Как начать видео о стиле без скучного вступления?',
        'Какие первые фразы удерживают зрителя в Reels?',
        'Как перейти от приветствия к полезному совету?',
        'Почему длинные вступления мешают ролику?',
        'Как сделать первый кадр видео более цепляющим?'
      ]
    };
  }

  if (/^\d+$/.test(message)) {
    return {
      answer: 'Числовой запрос слишком короткий, поэтому его лучше превратить в понятный контентный формат: список, чек-лист или подборку. Например, число может стать основой для ролика "5 ошибок", "3 признака" или "7 вещей для базы". Важно сразу связать цифру с конкретной пользой для зрителя, иначе сообщение выглядит случайным. Для темы стиля хорошо работают короткие списки с примерами и визуальным сравнением. Такой формат легко сохранить, если каждый пункт даёт понятный критерий выбора.',
      content_topics: [
        'Как сделать чек-лист по стилю из короткой идеи?',
        'Какие 5 ошибок чаще всего портят образ?',
        'Как оформить подборку вещей для базового гардероба?',
        'Почему списки хорошо работают в коротких видео?',
        'Как превратить число в понятный заголовок для Reels?'
      ]
    };
  }

  if (message.includes('ошиб') && message.includes('мужчин') && message.includes('стил')) {
    return buildMensStyleMistakesFallbackResponse();
  }

  if (message.includes('скинни') || message.includes('скини')) {
    return buildSkinnyJeansFallbackResponse(message);
  }

  if (message.includes('худи') || message.includes('hoodie')) {
    return buildHoodieFallbackResponse(message.includes('корот'));
  }

  if (message.includes('пальто')) {
    return buildCoatFallbackResponse(message.includes('корот'));
  }

  if (message.includes('рубашк') && message.includes('корот') && message.includes('рукав')) {
    return buildShortSleeveShirtFallbackResponse(message.includes('длинн') || message.includes('лучше'));
  }

  if (message.includes('галстук') && includesAny(message, MATERIAL_WORDS)) {
    if (message.includes('из какого') || message.includes('должен быть')) {
      return {
        answer: 'Если вопрос именно в том, из какого материала должен быть галстук, сначала смотри на ткань и то, как она держит узел. Самый надёжный вариант для классики — плотный шёлк без дешёвого блеска. Для менее формальных образов хорошо работают шерсть, хлопок и лён: они дают фактуру и выглядят спокойнее. Синтетический галстук стоит выбирать осторожно, потому что сильный блеск и рыхлая ткань быстро упрощают образ. Хороший материал должен держать форму, не заламываться и совпадать по настроению с пиджаком и рубашкой.',
        content_topics: [
          'Какой материал галстука выглядит дороже?',
          'Чем шёлковый галстук отличается от синтетического?',
          'Как выбрать галстук, который хорошо держит узел?',
          'Какие галстуки подходят для делового образа?',
          'Почему блестящий галстук может портить образ?'
        ]
      };
    }

    return {
      answer: 'Для хорошего галстука лучше всего подходят материалы, которые держат форму и не выглядят слишком блестящими. Самый универсальный вариант — шёлк: он подходит для классических и деловых образов, если ткань плотная и не выглядит дешёвой. Для более спокойных и фактурных комплектов подойдут шерсть, хлопок или лён, особенно в менее формальных образах. Синтетика часто смотрится хуже, если она сильно блестит или плохо держит узел. Главное — выбирать материал под ситуацию: гладкий шёлк для формальности, фактурные ткани для более расслабленного стиля.',
      content_topics: [
        'Какой материал галстука выглядит дороже?',
        'Чем шёлковый галстук отличается от синтетического?',
        'Как выбрать галстук, который хорошо держит узел?',
        'Какие галстуки подходят для делового образа?',
        'Почему блестящий галстук может портить образ?'
      ]
    };
  }

  if (message.includes('галстук') && includesAny(message, COLOR_WORDS)) {
    return {
      answer: 'Цвет галстука лучше выбирать под рубашку, пиджак и задачу образа. Для базового гардероба подойдут тёмно-синий, бордовый, графитовый, тёмно-зелёный и спокойные приглушённые оттенки. Слишком яркие цвета часто перетягивают внимание и делают комплект менее собранным. Если рубашка или пиджак уже с активным рисунком, галстук лучше брать спокойнее. Хороший цвет галстука должен дополнять образ, а не спорить с остальными вещами.',
      content_topics: [
        'Какой цвет галстука выбрать для базового гардероба?',
        'Какие цвета галстука выглядят дороже?',
        'Как сочетать галстук с рубашкой и пиджаком?',
        'Какие цвета галстуков чаще всего портят образ?',
        'Как выбрать галстук для делового образа?'
      ]
    };
  }

  if (message.includes('галстук')) {
    return {
      answer: 'Хороший галстук должен держать форму, подходить по ширине к лацканам пиджака и не выглядеть слишком блестящим. Для базового гардероба лучше выбирать спокойные оттенки, плотную ткань и аккуратный узор. Важно, чтобы галстук сочетался с рубашкой и пиджаком, а не спорил с ними. Слишком короткий, слишком узкий или слишком яркий галстук часто делает образ слабее. Хороший вариант выглядит уместно, аккуратно и не перетягивает всё внимание на себя.',
      content_topics: [
        'Как понять, что галстук выглядит дёшево?',
        'Как выбрать ширину галстука под пиджак?',
        'Какие галстуки подходят для базового гардероба?',
        'Какие ошибки чаще всего делают с галстуком?',
        'Как подобрать галстук, чтобы образ выглядел дороже?'
      ]
    };
  }

  if ((message.includes('брюк') || message.includes('брюч')) && includesAny(message, COLOR_WORDS)) {
    return {
      answer: 'Для базового гардероба лучше выбирать не один “главный” цвет, а несколько спокойных оттенков, которые подходят к вашим верхам и обуви. Самые универсальные варианты — графитовый, тёмно-синий, серый, бежевый, молочный, коричневый или хаки. Чёрные брюки тоже могут быть полезны, но они не всегда самые мягкие для повседневных образов и иногда выглядят слишком контрастно. Если гардероб спокойный и натуральный, лучше начать с серых, бежевых или коричневых оттенков. Главное — чтобы цвет брюк легко собирался минимум с 3–4 верхами из гардероба.',
      content_topics: [
        'Какие цвета брюк лучше всего работают в базе?',
        'Почему чёрные брюки не всегда самый универсальный вариант?',
        'Как выбрать цвет брюк под свой гардероб?',
        'Какие брюки выглядят дороже: серые, бежевые или тёмно-синие?',
        'С чем сочетать базовые брюки спокойных оттенков?'
      ]
    };
  }

  if ((message.includes('брюк') || message.includes('брюч')) && includesAny(message, BASE_WORDS)) {
    return {
      answer: 'В базовом гардеробе лучше всего работают брюки прямого или слегка свободного кроя, которые не обтягивают фигуру и держат форму. Самые универсальные варианты — классические прямые брюки, костюмные брюки без лишнего декора и спокойные повседневные модели из плотной ткани. Важно смотреть на посадку: брюки не должны тянуть в бёдрах, собираться лишними складками или быть слишком короткими. Для базы лучше выбирать модели, которые можно носить с рубашкой, футболкой, жакетом, свитером и разной обувью. Такие брюки помогают быстро собрать аккуратный образ без ощущения, что вещь слишком нарядная или слишком домашняя.',
      content_topics: [
        'Какие брюки выбрать для базового гардероба?',
        'Как понять, что брюки сидят плохо?',
        'Какие брюки выглядят дороже и аккуратнее?',
        'Почему прямые брюки легче сочетать в образах?',
        'Какие ошибки чаще всего делают при выборе брюк?'
      ]
    };
  }

  if ((message.includes('брюк') || message.includes('брюч')) && message.includes('рубашк')) {
    return {
      answer: 'К рубашке лучше всего подходят брюки, которые держат форму и не выглядят слишком спортивно. Самый простой вариант — прямые или слегка свободные брюки со средней или высокой посадкой. Для спокойного образа выбирай графитовые, серые, тёмно-синие, бежевые, молочные или коричневые брюки без лишнего декора; чёрный тоже возможен, если он подходит к остальным вещам. Если рубашка объёмная, брюки должны сохранять аккуратную линию силуэта, чтобы комплект не выглядел бесформенным. Хорошо работают костюмные, шерстяные, хлопковые или плотные смесовые ткани.',
      content_topics: [
        'Какие брюки носить с рубашкой каждый день?',
        'Как сочетать свободную рубашку и прямые брюки?',
        'Какие брюки делают образ с рубашкой дороже?',
        'Почему посадка брюк важна в образе с рубашкой?',
        'Какие цвета брюк лучше подходят к базовым рубашкам?'
      ]
    };
  }

  if (message.includes('брюк') || message.includes('брюч')) {
    return {
      answer: 'Хорошие брюки должны сидеть спокойно: не тянуть в бёдрах, не собираться лишними складками и сохранять линию силуэта. Самый универсальный крой — прямой или слегка свободный, потому что такие брюки легче сочетать с рубашкой, футболкой, жакетом и разной обувью. Ткань лучше выбирать достаточно плотную, чтобы брюки держали форму и не выглядели домашними. Длина должна быть аккуратной: без сильных заломов и ощущения, что вещь мала. Для базы особенно хорошо работают нейтральные цвета и минимум декора.',
      content_topics: [
        'Как понять, что брюки сидят плохо?',
        'Какие брюки выглядят дороже в повседневных образах?',
        'Почему прямые брюки легче сочетать?',
        'Как выбрать длину брюк под разную обувь?',
        'Какие ошибки чаще всего делают при покупке брюк?'
      ]
    };
  }

  if (message.includes('джинс') || message.includes('скинни') || message.includes('скини')) {
    return {
      answer: 'Джинсы лучше выбирать по посадке, плотности ткани и силуэту, а не только по названию модели. Самый универсальный вариант — прямые джинсы, straight fit или relaxed fit без сильного облегания. Скинни не стоит подавать как базу: они часто перетягивают ноги, подчёркивают каждую ошибку посадки и выглядят устаревше без очень точной стилизации. Слишком тонкая или блестящая ткань тоже упрощает образ. Хорошие джинсы должны спокойно сочетаться с жакетом, рубашкой, футболкой, свитером и разной обувью.',
      content_topics: [
        'Как понять, что джинсы сидят плохо?',
        'Какие джинсы выбрать вместо слишком узких моделей?',
        'Почему ткань джинсов влияет на весь образ?',
        'С чем носить прямые джинсы, чтобы выглядеть современно?',
        'Какие ошибки чаще всего делают при выборе джинсов?'
      ]
    };
  }

  if (message.includes('пиджак') && includesAny(message, MATERIAL_WORDS)) {
    return {
      answer: 'Для пиджака лучше выбирать материал, который держит форму и не выглядит рыхлым. Самый универсальный вариант — шерсть или качественная смесовая ткань с шерстью: такой пиджак подходит для базы и выглядит собранно. Для более лёгких образов можно смотреть на хлопок и лён, но они сильнее мнутся и выглядят расслабленнее. Синтетика допустима только в хорошем составе, если ткань не блестит и не создаёт дешёвую фактуру. Материал пиджака должен поддерживать плечи, посадку и общую форму силуэта.',
      content_topics: [
        'Какой материал пиджака выглядит дороже?',
        'Чем шерстяной пиджак лучше синтетического?',
        'Как выбрать пиджак, который держит форму?',
        'Когда уместен льняной пиджак?',
        'Какие ткани пиджака чаще всего портят образ?'
      ]
    };
  }

  if (message.includes('пиджак')) {
    return {
      answer: 'Хороший пиджак должен хорошо сидеть в плечах, не тянуть в груди и не собираться складками на спине. Линия плеча должна совпадать с естественным плечом, а рукав обычно заканчивается около запястья. Для базы лучше выбирать спокойный цвет и ткань, которая держит форму. Слишком короткий, узкий или мягкий пиджак может портить пропорции. Хороший пиджак собирает образ и делает силуэт аккуратнее.',
      content_topics: [
        'Как понять, что пиджак сидит плохо?',
        'Какой пиджак выбрать первым в гардероб?',
        'Какие ошибки чаще всего делают при покупке пиджака?',
        'Как пиджак должен сидеть в плечах?',
        'Как отличить хороший пиджак от неудачного?'
      ]
    };
  }

  if (message.includes('рубашк')) {
    return {
      answer: 'Хорошая рубашка должна аккуратно сидеть в плечах, не тянуть в груди и не создавать лишний объём на талии. Важно смотреть на воротник: он не должен давить или слишком свободно отходить от шеи. Ткань лучше выбирать плотную, чтобы рубашка держала форму и не выглядела слишком тонкой. Для базового гардероба подойдут белый, голубой, молочный или спокойные нейтральные оттенки. Хорошая рубашка должна легко сочетаться с джинсами, брюками, жакетом и верхней одеждой.',
      content_topics: [
        'Как понять, что рубашка сидит плохо?',
        'Какая рубашка нужна в базовом гардеробе?',
        'Какие ошибки делают образ с рубашкой неаккуратным?',
        'Как выбрать рубашку, которая держит форму?',
        'С чем носить рубашку, чтобы образ выглядел современно?'
      ]
    };
  }

  if (message.includes('обув') || message.includes('туфл') || message.includes('ботин') || message.includes('кроссов')) {
    return {
      answer: 'Обувь в базовом гардеробе должна быть аккуратной, удобной и совместимой с большинством вещей. По цветам лучше смотреть на коричневый, молочный, бежевый, тёмно-синий, графитовый или чёрный, если он реально подходит к палитре гардероба. Важно смотреть на форму носа, качество материала и состояние подошвы, потому что именно обувь часто выдаёт слабое место образа. Слишком массивная, блестящая или перегруженная деталями обувь сложнее сочетается. Хорошая пара должна поддерживать стиль комплекта, а не спорить с брюками, джинсами или платьем.',
      content_topics: [
        'Какая обувь нужна в базовом гардеробе?',
        'Как понять, что обувь портит образ?',
        'Какие цвета обуви легче всего сочетать?',
        'Почему форма носа обуви меняет впечатление?',
        'Как выбрать обувь, которая выглядит дороже?'
      ]
    };
  }

  if (message.includes('плать')) {
    return {
      answer: 'Платье лучше выбирать по посадке, ткани и тому, насколько легко его стилизовать. Для базы хорошо работают лаконичные модели без лишнего декора, которые можно носить с жакетом, кардиганом, пальто и разной обувью. Ткань должна держать форму и не подчёркивать каждую складку белья или тела. Цвет лучше выбирать из спокойной палитры, если платье должно часто работать в гардеробе. Хорошее платье выглядит уместно без большого количества дополнительных деталей.',
      content_topics: [
        'Какое платье выбрать для базового гардероба?',
        'Как понять, что платье сидит плохо?',
        'Какие ткани платья выглядят дороже?',
        'С чем носить базовое платье каждый день?',
        'Какие ошибки чаще всего делают при выборе платья?'
      ]
    };
  }

  if (message.includes('блог') || message.includes('снять') || message.includes('контент')) {
    return {
      answer: 'Для блога лучше выбирать темы, где зритель сразу понимает пользу: что купить, какую ошибку избежать или как сделать образ лучше. Хорошо работают короткие разборы, сравнения до/после, подборки вещей и объяснение частых ошибок. Важно начинать с понятного заголовка, а не с длинного вступления. Один ролик должен раскрывать одну мысль, чтобы его было легко досмотреть и сохранить. Чем конкретнее тема, тем выше шанс, что она сработает.',
      content_topics: [
        'Какие ошибки в образах чаще всего замечают зрители?',
        'Что снять для блога, если нет идей для контента?',
        'Как превратить совет по стилю в короткий Reels?',
        'Какие темы про гардероб чаще всего сохраняют?',
        'Как придумать заголовок для видео про стиль?'
      ]
    };
  }

  if (message.includes('ошиб') || message.includes('образ') || message.includes('стиль') || message.includes('гардероб')) {
    return {
      answer: 'Хороший образ строится на сочетании посадки, цвета, пропорций и уместности. Даже дорогая одежда может выглядеть слабо, если вещи плохо сидят или спорят между собой. Лучше начинать с понятной базы: спокойные цвета, качественные ткани и вещи, которые легко комбинировать. Потом можно добавлять акценты через аксессуары, обувь или фактуру. Главная задача образа — выглядеть собранно и подходить человеку, а не просто повторять тренд.',
      content_topics: [
        'Какие ошибки чаще всего портят образ?',
        'Как собрать стильный образ без дорогих брендов?',
        'Почему образ выглядит неаккуратно?',
        'Какие вещи делают гардероб более собранным?',
        'Как понять, что вещи плохо сочетаются между собой?'
      ]
    };
  }

  return {
    answer: originalText
      ? `По запросу "${originalText}" начни с самого прикладного критерия: что человек выбирает, с чем это будет носить и какой эффект хочет получить. Если речь про одежду, смотри на посадку, ткань, цвет, силуэт и уместность в реальном гардеробе. Сильный вариант легко сочетать минимум с тремя вещами, он не спорит с обувью и не требует сложной стилизации. Если вещь плохо держит форму, тянет в посадке или выглядит случайной, образ быстро теряет собранность. Выбирай вариант, который решает задачу понятно: делает комплект аккуратнее, удобнее и визуально цельнее.`
      : 'Начни с конкретной вещи или ситуации: что выбираешь, где это будет использоваться и какой эффект нужен в образе. Для одежды смотри на посадку, ткань, цвет, силуэт и сочетания с уже существующим гардеробом. Хороший вариант не требует сложной стилизации и легко работает с базовой обувью и верхом. Если вещь плохо держит форму или спорит с остальными элементами, образ выглядит менее собранным. Выбирай то, что делает комплект аккуратнее, удобнее и понятнее.',
    content_topics: [
      'Какие ошибки чаще всего делают в этой ситуации?',
      'Как понять, что выбран неудачный вариант?',
      'Что важно проверить перед выбором?',
      'Как объяснить этот запрос на простом примере?',
      'Как сделать из этого полезный разбор?'
    ]
  };
}

function buildFallbackResponse(userMessage) {
  return buildSmartFallbackResponse(userMessage);
}

async function askAI(userId, userMessage, history = []) {
  const messages = buildMessages(userMessage, history, { useHistory: config.useHistory });

  try {
    const { rawText, parsed, data } = await requestAIData(messages, 'main');
    let aiData = data;

    if (!isUsableAIData(aiData)) {
      logError(`AI response failed JSON validation. Preview: ${preview(rawText, PREVIEW_MAX_LENGTH)}`);
      aiData = await repairAIResponse(rawText, userMessage);
    }

    if (!isUsableAIData(aiData)) {
      aiData = await requestSimplifiedAIResponse(userMessage);
    }

    if (!isUsableAIData(aiData) && (hasPotentialStructuredContent(parsed) || hasNumberedTopics(rawText))) {
      const normalizedData = normalizeAIResponse(parsed, rawText);

      if (isUsableAIData(normalizedData)) {
        logAINormalized(normalizedData);
        aiData = normalizedData;
      }
    }

    if (isUsableAIData(aiData)) {
      aiData = await replaceMetaAnswerIfNeeded(aiData, userId, userMessage);
    }

    if (isUsableAIData(aiData) && !isAnswerRelevantToQuestion(userMessage, aiData)) {
      const retryData = await requestSimplifiedAIResponse(
        userMessage,
        'Предыдущий ответ был слишком общим или не соответствовал текущему вопросу. Сформируй новый ответ именно по словам текущего вопроса.'
      );

      if (isUsableAIData(retryData) && isAnswerRelevantToQuestion(userMessage, retryData)) {
        aiData = retryData;
      } else {
        logAIFallbackUsed(userId, userMessage, 'ai_answer_not_relevant_to_current_question');
        return buildSmartFallbackResponse(userMessage);
      }
    }

    if (isUsableAIData(aiData)) {
      aiData = await replaceMetaAnswerIfNeeded(aiData, userId, userMessage);
    }

    if (shouldRetryForDuplicate(aiData, history, userMessage)) {
      logDuplicateDetected(history, userMessage);

      const retryData = await requestSimplifiedAIResponse(
        userMessage,
        'Предыдущий ответ был слишком похож. Сгенерируй новый ответ именно по текущему вопросу. Не копируй старую структуру и формулировки.'
      );

      if (
        isUsableAIData(retryData) &&
        isAnswerRelevantToQuestion(userMessage, retryData) &&
        !shouldRetryForDuplicate(retryData, history, userMessage)
      ) {
        aiData = retryData;
      } else {
        logAIFallbackUsed(userId, userMessage, 'duplicate_retry_failed');
        return buildSmartFallbackResponse(userMessage);
      }
    }

    if (isUsableAIData(aiData)) {
      aiData = await replaceMetaAnswerIfNeeded(aiData, userId, userMessage);
    }

    if (isUsableAIData(aiData)) {
      return aiData;
    }

    logAIFallbackUsed(userId, userMessage, 'json_parse_repair_and_simplified_retry_failed');
    return buildSmartFallbackResponse(userMessage);
  } catch (error) {
    if (canUseLocalFallbackForAIError(error)) {
      logError('AI request failed with recoverable API response, using smart fallback', error);
      logAIFallbackUsed(userId, userMessage, `recoverable_api_response_${error.response?.status || 'unknown'}`);
      return buildSmartFallbackResponse(userMessage);
    }

    logError('AI request failed, using smart fallback', error);
    logAIFallbackUsed(userId, userMessage, 'unrecoverable_ai_request_failed');
    return buildSmartFallbackResponse(userMessage);
  }
}

module.exports = {
  askAI,
  buildSmartFallbackResponse,
  buildFallbackResponse
};
