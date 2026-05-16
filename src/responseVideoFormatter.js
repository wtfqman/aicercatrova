const escapeHtml = require('./utils/escapeHtml');

const TRANSLATION_PREVIEW_LENGTH = 1200;

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
  const summary = escapeHtml(data.summary || 'Не получилось уверенно определить смысл ролика.');
  const qualityNote = data.quality_note ? escapeHtml(data.quality_note) : '';
  const translationText = previewText(data.translation, TRANSLATION_PREVIEW_LENGTH);
  const translation = translationText
    ? escapeHtml(translationText)
    : 'Расшифровка не даёт достаточно ясного текста для нормального перевода.';
  const ideas = listLines(data.content_ideas || []);
  const takeaway = data.key_takeaway ? escapeHtml(data.key_takeaway) : '';
  const optionalBlocks = data.optional_blocks || {};
  const qualityBlock = qualityNote
    ? `\n\n<b>⚠️ Важно:</b>\n${qualityNote}`
    : '';
  const translationBlock = translation
    ? `\n\n<b>🌐 Перевод / смысл:</b>\n${translation}`
    : '';
  const ideasBlock = ideas
    ? `\n\n<b>💡 Что можно взять для контента:</b>\n${ideas}`
    : '';
  const takeawayBlock = takeaway
    ? `\n\n<b>🎯 Интересная мысль / приём:</b>\n${takeaway}`
    : '';
  const titlesBlock = optionalBlocks.titles?.length
    ? `\n\n<b>🔥 Заголовки:</b>\n${listLines(optionalBlocks.titles)}`
    : '';
  const hooksBlock = optionalBlocks.hooks?.length
    ? `\n\n<b>⚡ Хуки:</b>\n${listLines(optionalBlocks.hooks)}`
    : '';
  const planBlock = optionalBlocks.post_plan?.length
    ? `\n\n<b>🧩 План поста:</b>\n${listLines(optionalBlocks.post_plan)}`
    : '';
  const ctaBlock = optionalBlocks.cta
    ? `\n\n<b>CTA:</b>\n${escapeHtml(optionalBlocks.cta)}`
    : '';

  return `<b>✅ Кратко о ролике:</b>
${summary}${qualityBlock}${translationBlock}${ideasBlock}${takeawayBlock}${titlesBlock}${hooksBlock}${planBlock}${ctaBlock}`;
}

function formatTranscriptChunks(transcript) {
  return [];
}

function formatTranslationChunks(translation) {
  return [];
}

module.exports = {
  formatTranscriptChunks,
  formatTranslationChunks,
  formatVideoAnalysis
};
