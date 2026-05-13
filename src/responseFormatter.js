const escapeHtml = require('./utils/escapeHtml');

const FALLBACK_ANSWER = 'Ответ не удалось восстановить из ответа AI.';
const FALLBACK_TOPIC = 'Какие признаки помогут принять решение?';
const TOPIC_KEYS = [
  'content_topics',
  'topics',
  'questions',
  'related_questions'
];

const FORBIDDEN_BLOCK_TITLE_PATTERN = /(?:^|\n)\s*(?:❓\s*)?(?:Вопросы по теме|Популярные вопросы|Дополнительные вопросы|Темы|Идеи|🔥\s*Популярные темы для контента)\s*:?\s*(?:\n|$)/iu;
const INLINE_BLOCK_TITLE_PATTERN = /^\s*(?:❓\s*)?(?:Вопросы по теме|Популярные вопросы|Дополнительные вопросы|Темы|Идеи|🔥\s*Популярные темы для контента)\s*:?\s*/iu;

function sanitizeAnswer(answer) {
  const text = String(answer || '').trim();
  const match = text.match(FORBIDDEN_BLOCK_TITLE_PATTERN);
  const answerOnly = match && typeof match.index === 'number'
    ? text.slice(0, match.index).trim()
    : text;

  return answerOnly
    .replace(/^\s*(?:💬\s*)?(?:Ответ|answer)\s*:?\s*/iu, '')
    .trim();
}

function sanitizeTopic(topic) {
  return String(topic || '')
    .replace(INLINE_BLOCK_TITLE_PATTERN, '')
    .replace(/^\s*\d{1,2}(?:[).:]|-)\s*/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTopics(aiData) {
  for (const key of TOPIC_KEYS) {
    if (Array.isArray(aiData?.[key])) {
      return aiData[key];
    }
  }

  return [];
}

function getCreatorResponseTopics(aiData) {
  const topics = getTopics(aiData);
  const safeTopics = topics
    .filter((topic) => typeof topic === 'string' && topic.trim())
    .map(sanitizeTopic)
    .filter(Boolean)
    .slice(0, 5);

  while (safeTopics.length < 5) {
    safeTopics.push(FALLBACK_TOPIC);
  }

  return safeTopics;
}

function formatCreatorResponse(aiData) {
  const answer = escapeHtml(sanitizeAnswer(aiData?.answer) || FALLBACK_ANSWER);
  const safeTopics = getCreatorResponseTopics(aiData);
  const topicLines = safeTopics
    .map((topic, index) => `${index + 1}. ${escapeHtml(topic)}`)
    .join('\n');

  return `💬 <b>Ответ:</b>\n\n${answer}\n\n🔥 <b>Популярные темы для контента:</b>\n${topicLines}`;
}

module.exports = {
  formatCreatorResponse,
  getCreatorResponseTopics
};
