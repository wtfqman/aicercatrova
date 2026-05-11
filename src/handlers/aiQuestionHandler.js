const { askAI } = require('../ai');
const { addToHistory, getHistory, getLastVideoTranscript } = require('../memory');
const { formatCreatorResponse } = require('../responseFormatter');
const { translateTextToRussian } = require('../translator');
const escapeHtml = require('../utils/escapeHtml');
const { logError, logInfo } = require('../utils/logger');

const HTML_OPTIONS = { parse_mode: 'HTML' };

const LOADING_MESSAGE = '⏳ <b>Секунду, подбираю ответ...</b>';
const EMPTY_TEXT_MESSAGE = 'Напиши вопрос текстом 🙂';
const LONG_TEXT_MESSAGE = 'Сообщение слишком длинное. Сократи вопрос до 3000 символов 🙂';
const NO_TRANSLATION_SOURCE_MESSAGE = `⚠️ Не вижу текст для перевода.
Пришли текст сообщением или сначала отправь ссылку на Reels/TikTok, чтобы я сделал расшифровку.`;
const AI_ERROR_MESSAGE = `⚠️ Не получилось подготовить ответ.
Попробуй ещё раз чуть позже или переформулируй вопрос.`;
const TRANSLATION_ERROR_MESSAGE = `⚠️ Не получилось перевести текст.
Проверь баланс OpenRouter и попробуй ещё раз.`;

async function safeReply(ctx, text, extra = {}) {
  try {
    return await ctx.reply(text, extra);
  } catch (error) {
    logError('Failed to send Telegram message', error);
    return null;
  }
}

async function safeEditOrReply(ctx, messageToEdit, text, extra = {}) {
  const chatId = messageToEdit?.chat?.id;
  const messageId = messageToEdit?.message_id;

  if (chatId && messageId && ctx.telegram?.editMessageText) {
    try {
      await ctx.telegram.editMessageText(chatId, messageId, undefined, text, extra);
      return true;
    } catch (error) {
      logError('Failed to edit Telegram message, sending a new reply instead', error);
    }
  }

  return Boolean(await safeReply(ctx, text, extra));
}

function normalizeQuestion(question) {
  return String(question || '').trim();
}

function isTranslationRequest(text) {
  const normalized = String(text || '').toLowerCase().replace(/ё/g, 'е');
  return /(переведи|перевести|перевод|translate|translation)/i.test(normalized);
}

function extractQuotedText(text) {
  const value = String(text || '');
  const quoted = value.match(/[«"]([^«»"]{8,})[»"]/u);
  return quoted?.[1]?.trim() || '';
}

function extractInlineTranslationText(text) {
  const value = String(text || '').trim();
  const quotedText = extractQuotedText(value);

  if (quotedText) {
    return quotedText;
  }

  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  if (lines.length > 1) {
    return lines.slice(1).join('\n').trim();
  }

  const match = value.match(/(?:переведи|перевести|перевод|translate)\s*(?:текст|это|его|ее|её|на русский|на рус)?\s*[:\-]?\s*(.+)$/iu);
  const candidate = match?.[1]?.trim() || '';
  const normalizedCandidate = candidate.toLowerCase().replace(/ё/g, 'е');
  const emptyReferences = new Set(['', 'текст', 'это', 'его', 'ее', 'её', 'расшифровку', 'субтитры']);

  if (emptyReferences.has(normalizedCandidate)) {
    return '';
  }

  return candidate.length >= 8 ? candidate : '';
}

function splitForTelegram(text, maxLength = 3500) {
  const value = String(text || '').trim();
  const chunks = [];

  for (let index = 0; index < value.length; index += maxLength) {
    chunks.push(value.slice(index, index + maxLength));
  }

  return chunks.length > 0 ? chunks : [''];
}

async function handleTranslationRequest(ctx, userId, question, loadingMessage) {
  const inlineText = extractInlineTranslationText(question);
  const lastVideoContext = getLastVideoTranscript(userId);
  const sourceText = inlineText || lastVideoContext?.transcript || '';

  if (!sourceText) {
    await safeEditOrReply(ctx, loadingMessage, NO_TRANSLATION_SOURCE_MESSAGE);
    return true;
  }

  try {
    const translation = await translateTextToRussian(sourceText);
    const chunks = splitForTelegram(translation);
    const firstChunk = `<b>🌐 Перевод:</b>\n\n${escapeHtml(chunks[0])}`;

    await safeEditOrReply(ctx, loadingMessage, firstChunk, HTML_OPTIONS);

    for (const chunk of chunks.slice(1)) {
      await safeReply(ctx, escapeHtml(chunk), HTML_OPTIONS);
    }

    addToHistory(userId, 'user', question);
    addToHistory(userId, 'assistant', translation);
    return true;
  } catch (error) {
    logError('Failed to translate text', error);
    await safeEditOrReply(ctx, loadingMessage, TRANSLATION_ERROR_MESSAGE);
    return true;
  }
}

async function handleAIQuestion(ctx, question) {
  const userId = ctx.from?.id || ctx.chat?.id;
  const normalizedQuestion = normalizeQuestion(question);
  let loadingMessage = null;

  try {
    if (!normalizedQuestion) {
      await safeReply(ctx, EMPTY_TEXT_MESSAGE);
      return;
    }

    if (normalizedQuestion.length > 3000) {
      await safeReply(ctx, LONG_TEXT_MESSAGE);
      return;
    }

    logInfo(`[AI_QUESTION] userId=${String(userId || 'anonymous')} question=${normalizedQuestion.slice(0, 500)}`);

    loadingMessage = await safeReply(ctx, LOADING_MESSAGE, HTML_OPTIONS);

    if (isTranslationRequest(normalizedQuestion)) {
      await handleTranslationRequest(ctx, userId, normalizedQuestion, loadingMessage);
      return;
    }

    const history = getHistory(userId);
    const aiData = await askAI(userId, normalizedQuestion, history);
    const formattedMessage = formatCreatorResponse(aiData);

    const answerSent = await safeEditOrReply(ctx, loadingMessage, formattedMessage, HTML_OPTIONS);

    if (answerSent) {
      addToHistory(userId, 'user', normalizedQuestion);
      addToHistory(userId, 'assistant', aiData.answer);
    }
  } catch (error) {
    logError('Failed to handle AI question', error);
    await safeEditOrReply(ctx, loadingMessage, AI_ERROR_MESSAGE);
  }
}

module.exports = {
  handleAIQuestion
};
