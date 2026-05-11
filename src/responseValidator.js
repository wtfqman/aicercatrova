const FALLBACK_RESPONSE = {
  answer: 'Ответ не удалось восстановить из ответа AI.',
  content_topics: [
    'Какие ошибки чаще всего делают в такой ситуации?',
    'Как понять, что выбран неудачный вариант?',
    'Что важно проверить перед выбором?',
    'Как показать удачный и неудачный вариант?',
    'Какие признаки помогут принять решение?'
  ]
};
const ANSWER_MAX_LENGTH = 1600;

const TOPIC_KEYS = [
  'content_topics',
  'topics',
  'questions',
  'related_questions'
];

const FORBIDDEN_BLOCK_TITLE_PATTERN = /(?:^|\n)\s*(?:❓\s*)?(?:Вопросы по теме|Популярные вопросы|Дополнительные вопросы|Темы|Идеи|🔥\s*Популярные темы для контента)\s*:?\s*(?:\n|$)/iu;
const INLINE_BLOCK_TITLE_PATTERN = /^\s*(?:❓\s*)?(?:Вопросы по теме|Популярные вопросы|Дополнительные вопросы|Темы|Идеи|🔥\s*Популярные темы для контента)\s*:?\s*/iu;

function stripCodeFences(text) {
  return String(text || '')
    .replace(/```\s*json/gi, '')
    .replace(/```/g, '')
    .trim();
}

function stripAnswerTitle(text) {
  return String(text || '')
    .replace(/^\s*(?:💬\s*)?(?:Ответ|answer)\s*:?\s*/iu, '')
    .trim();
}

function stripBlockTitle(text) {
  return String(text || '')
    .replace(INLINE_BLOCK_TITLE_PATTERN, '')
    .trim();
}

function splitAnswerAndTopicBlock(text) {
  const normalized = stripCodeFences(text);
  const match = normalized.match(FORBIDDEN_BLOCK_TITLE_PATTERN);

  if (!match || typeof match.index !== 'number') {
    const numberedListMatch = normalized.match(/(?:^|\n)\s*(?:1(?:[).:]|-)\s+|[-*•]\s+)/u);

    if (numberedListMatch && typeof numberedListMatch.index === 'number') {
      return {
        answerText: normalized.slice(0, numberedListMatch.index).trim(),
        topicBlock: normalized.slice(numberedListMatch.index).trim()
      };
    }

    return {
      answerText: normalized,
      topicBlock: normalized
    };
  }

  return {
    answerText: normalized.slice(0, match.index).trim(),
    topicBlock: normalized.slice(match.index + match[0].length).trim()
  };
}

function extractNumberedItems(text) {
  const lines = String(text || '').split(/\r?\n/);
  const items = [];

  for (const line of lines) {
    const match = line.match(/^\s*(?:\d{1,2}(?:[).:]|-)\s+|[-*•]\s+)(.+?)\s*$/u);

    if (!match) {
      continue;
    }

    const item = stripBlockTitle(match[1])
      .replace(/\s+/g, ' ')
      .trim();

    if (item) {
      items.push(item);
    }
  }

  return items;
}

function parseRawAIText(rawText) {
  const text = stripCodeFences(rawText);

  if (!text) {
    return null;
  }

  const { answerText, topicBlock } = splitAnswerAndTopicBlock(text);
  const contentTopics = extractNumberedItems(topicBlock);

  if (contentTopics.length === 0) {
    return null;
  }

  return {
    answer: stripAnswerTitle(answerText),
    content_topics: contentTopics
  };
}

function safeParseAIJson(rawText) {
  const text = stripCodeFences(rawText);

  if (!text) {
    return null;
  }

  const startIndex = text.indexOf('{');
  const endIndex = text.lastIndexOf('}');

  if (startIndex < 0 || endIndex <= startIndex) {
    return parseRawAIText(text);
  }

  const jsonText = text.slice(startIndex, endIndex + 1);

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    return parseRawAIText(text);
  }
}

function getContentTopics(parsed) {
  for (const key of TOPIC_KEYS) {
    const value = parsed?.[key];

    if (Array.isArray(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim()) {
      return extractNumberedItems(value);
    }
  }

  return [];
}

function validateAIResponse(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return false;
  }

  if (typeof parsed.answer !== 'string' || !parsed.answer.trim()) {
    return false;
  }

  const topics = getContentTopics(parsed);

  if (topics.length !== 5) {
    return false;
  }

  return topics.every((topic) => typeof topic === 'string' && topic.trim().length > 0);
}

function truncateText(text, maxLength) {
  const normalized = String(text || '').trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trim()}...`;
}

function removeEmbeddedTopicBlock(answer) {
  const { answerText } = splitAnswerAndTopicBlock(answer);
  return stripAnswerTitle(answerText);
}

function normalizeTopic(topic) {
  return stripBlockTitle(topic)
    .replace(/^\s*\d{1,2}(?:[).:]|-)\s*/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getFallbackResponse() {
  return {
    answer: FALLBACK_RESPONSE.answer,
    content_topics: [...FALLBACK_RESPONSE.content_topics]
  };
}

function normalizeAIResponse(parsed, rawText = '') {
  const rawTextData = parseRawAIText(rawText);
  const source = parsed && typeof parsed === 'object' ? parsed : rawTextData;

  if (!source || typeof source !== 'object') {
    return getFallbackResponse();
  }

  const rawAnswer = typeof source.answer === 'string' && source.answer.trim()
    ? source.answer
    : rawTextData?.answer;

  const answer = removeEmbeddedTopicBlock(rawAnswer);

  const rawTopics = [
    ...getContentTopics(source),
    ...getContentTopics(rawTextData)
  ];

  const contentTopics = [];

  for (const topic of rawTopics) {
    if (typeof topic !== 'string' || !topic.trim()) {
      continue;
    }

    const normalizedTopic = truncateText(normalizeTopic(topic), 90);

    if (normalizedTopic && !contentTopics.includes(normalizedTopic)) {
      contentTopics.push(normalizedTopic);
    }
  }

  for (const fallbackTopic of FALLBACK_RESPONSE.content_topics) {
    if (contentTopics.length >= 5) {
      break;
    }

    if (!contentTopics.includes(fallbackTopic)) {
      contentTopics.push(fallbackTopic);
    }
  }

  if (!answer || contentTopics.length < 5) {
    return getFallbackResponse();
  }

  return {
    answer: truncateText(answer, ANSWER_MAX_LENGTH),
    content_topics: contentTopics.slice(0, 5)
  };
}

function isValidatorFallbackResponse(data) {
  return data?.answer === FALLBACK_RESPONSE.answer;
}

module.exports = {
  safeParseAIJson,
  validateAIResponse,
  normalizeAIResponse,
  isValidatorFallbackResponse
};
