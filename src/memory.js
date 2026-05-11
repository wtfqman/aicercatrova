const config = require('./config');

const historyStore = new Map();
const videoContextStore = new Map();
const LAST_VIDEO_TRANSCRIPT_MAX_LENGTH = 12000;

function normalizeUserId(userId) {
  return String(userId || 'anonymous');
}

function shouldSkipHistory(role, text) {
  if (text.includes('Секунду, подбираю ответ')) {
    return true;
  }

  if (/<\/?[a-z][\s\S]*>/i.test(text)) {
    return true;
  }

  return false;
}

function extractAssistantAnswer(text) {
  try {
    const parsed = JSON.parse(text);

    if (typeof parsed?.answer === 'string' && parsed.answer.trim()) {
      return parsed.answer.trim();
    }
  } catch (error) {
    // History must stay lightweight; non-JSON assistant text is stored as-is.
  }

  return text;
}

function normalizeHistoryContent(role, content) {
  const text = String(content || '').trim();

  if (role !== 'assistant') {
    return text;
  }

  return extractAssistantAnswer(text)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function addToHistory(userId, role, content) {
  if (!['user', 'assistant'].includes(role)) {
    return;
  }

  const text = normalizeHistoryContent(role, content);

  if (!text || shouldSkipHistory(role, text)) {
    return;
  }

  const key = normalizeUserId(userId);
  const currentHistory = historyStore.get(key) || [];
  const nextHistory = [...currentHistory, { role, content: text }].slice(-config.historyLimit);

  historyStore.set(key, nextHistory);
}

function getHistory(userId) {
  const key = normalizeUserId(userId);
  const currentHistory = historyStore.get(key) || [];

  return currentHistory.map((item) => ({ ...item }));
}

function clearHistory(userId) {
  const key = normalizeUserId(userId);
  historyStore.delete(key);
  videoContextStore.delete(key);
}

function setLastVideoTranscript(userId, transcript, sourceUrl = '') {
  const text = String(transcript || '').trim();

  if (!text) {
    return;
  }

  videoContextStore.set(normalizeUserId(userId), {
    transcript: text.slice(0, LAST_VIDEO_TRANSCRIPT_MAX_LENGTH),
    sourceUrl: String(sourceUrl || '').trim(),
    createdAt: Date.now()
  });
}

function getLastVideoTranscript(userId) {
  const context = videoContextStore.get(normalizeUserId(userId));

  if (!context?.transcript) {
    return null;
  }

  return { ...context };
}

module.exports = {
  addToHistory,
  getHistory,
  clearHistory,
  getLastVideoTranscript,
  setLastVideoTranscript
};
