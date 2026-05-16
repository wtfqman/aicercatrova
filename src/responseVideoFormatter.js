const escapeHtml = require('./utils/escapeHtml');

const TRANSCRIPT_PREVIEW_LENGTH = 1200;
const TRANSLATION_PREVIEW_LENGTH = 1800;

function listLines(items) {
  return items
    .slice(0, 5)
    .map((item, index) => `${index + 1}. ${escapeHtml(item)}`)
    .join('\n');
}

function previewText(text, maxLength) {
  const value = String(text || '').trim();

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3).trim()}...`;
}

function formatVideoAnalysis(data) {
  const summary = escapeHtml(data.summary);
  const titles = listLines(data.titles || []);
  const hooks = listLines(data.hooks || []);
  const plan = listLines(data.post_plan || []);
  const cta = escapeHtml(data.cta);
  const translationText = previewText(data.translation, TRANSLATION_PREVIEW_LENGTH);
  const translation = translationText ? escapeHtml(translationText) : '';
  const transcriptText = previewText(data.transcript, TRANSCRIPT_PREVIEW_LENGTH);
  const transcript = escapeHtml(transcriptText);
  const translationBlock = translation
    ? `\n\n<b>🌐 Нормальный перевод / смысл:</b>\n${translation}`
    : '';
  const transcriptBlock = transcript
    ? `\n\n<b>📝 Черновая расшифровка:</b>\n${transcript}`
    : '';

  return `<b>✅ Видео разобрано</b>

<b>Что в ролике:</b>
${summary}${translationBlock}

<b>🔥 Заголовки:</b>
${titles}

<b>⚡ Хуки:</b>
${hooks}

<b>🧩 План поста:</b>
${plan}

<b>CTA:</b>
${cta}${transcriptBlock}`;
}

function formatTranscriptChunks(transcript) {
  const text = String(transcript || '').trim();
  const chunks = [];
  const chunkSize = 3000;

  for (let index = TRANSCRIPT_PREVIEW_LENGTH; index < text.length; index += chunkSize) {
    chunks.push(text.slice(index, index + chunkSize));
  }

  return chunks.map((chunk, index) => `<b>📝 Черновая расшифровка, продолжение ${index + 2}:</b>\n${escapeHtml(chunk)}`);
}

function formatTranslationChunks(translation) {
  const text = String(translation || '').trim();
  const chunks = [];
  const chunkSize = 3000;

  for (let index = TRANSLATION_PREVIEW_LENGTH; index < text.length; index += chunkSize) {
    chunks.push(text.slice(index, index + chunkSize));
  }

  return chunks.map((chunk, index) => `<b>🌐 Нормальный перевод / смысл, продолжение ${index + 2}:</b>\n${escapeHtml(chunk)}`);
}

module.exports = {
  formatTranscriptChunks,
  formatTranslationChunks,
  formatVideoAnalysis
};
