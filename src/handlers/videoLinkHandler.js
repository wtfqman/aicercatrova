const { analyzeTranscriptWithGrok, transcribeAudio } = require('../xaiVideoAI');
const { cleanupWorkspace, downloadAudioFromVideo } = require('../videoDownloader');
const { setLastVideoTranscript } = require('../memory');
const { formatTranscriptChunks, formatTranslationChunks, formatVideoAnalysis } = require('../responseVideoFormatter');
const { translateTextToRussian } = require('../translator');
const { logError, logInfo } = require('../utils/logger');

const HTML_OPTIONS = { parse_mode: 'HTML' };

const LOADING_MESSAGE = '⏳ <b>Скачиваю видео и готовлю расшифровку...</b>';
const VIDEO_AI_NOT_CONFIGURED_MESSAGE = `⚠️ Для обработки TikTok/Reels нужен OPENROUTER_API_KEY, OPENAI_API_KEY или XAI_API_KEY в .env.`;
const VIDEO_AI_ACCESS_ERROR_MESSAGE = `⚠️ AI-сервис не дал обработать видео.
Проверь credits/billing: OpenRouter должен иметь баланс для STT/чат-модели, xAI — credits/licenses в xAI Console.`;
const INSTAGRAM_AUTH_ERROR_MESSAGE = `⚠️ Instagram не дал скачать Reel без авторизации.
Администратору нужно добавить cookies для yt-dlp в .env и перезапустить бота.`;
const COOKIES_FILE_MISSING_MESSAGE = `⚠️ Файл cookies для Instagram не найден.
Положи cookies.txt по пути из YT_DLP_COOKIES_FILE в .env и перезапусти бота.`;
const BROWSER_COOKIES_DECRYPT_ERROR_MESSAGE = `⚠️ Не получилось прочитать cookies из браузера.
Windows/Edge заблокировал расшифровку cookies через DPAPI. Экспортируй cookies Instagram в файл cookies.txt и укажи его в YT_DLP_COOKIES_FILE.`;
const DOWNLOAD_ERROR_MESSAGE = `⚠️ Не получилось скачать аудио по ссылке.
TikTok/Reels иногда закрывают доступ. Можно попробовать другую ссылку или загрузить видео файлом позже.`;
const TIKTOK_NETWORK_ERROR_MESSAGE = `⚠️ TikTok не дал скачать видео с этого сервера.
Чаще всего это DNS/провайдер/блокировка CDN TikTok. Попробуй полную ссылку вида tiktok.com/@.../video/..., включи VPN/прокси на сервере или укажи YT_DLP_PROXY в .env. Самый надёжный запасной вариант — загрузить видео файлом.`;
const PROCESSING_ERROR_MESSAGE = `⚠️ Не получилось обработать видео.
Проверь, что установлены yt-dlp и ffmpeg, а ключ OpenRouter/xAI активен.`;

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

function isMissingCommandError(error) {
  return error?.code === 'ENOENT' || /spawn\s+(yt-dlp|ffmpeg)\s+ENOENT/i.test(String(error?.message || ''));
}

function isDownloadError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('yt-dlp') || message.includes('duration') || message.includes('download');
}

function isTikTokNetworkError(error) {
  const message = String(error?.message || '').toLowerCase();

  return message.includes('tiktok') && (
    message.includes('could not resolve') ||
    message.includes('resolving timed out') ||
    message.includes('getaddrinfo') ||
    message.includes('curl: (6)') ||
    message.includes('curl: (28)') ||
    message.includes('connect timeout') ||
    message.includes('fetch failed') ||
    message.includes('access denied') ||
    message.includes('webpage fallback') ||
    message.includes('non-media content-type')
  );
}

function isInstagramAuthError(error) {
  const message = String(error?.message || '').toLowerCase();

  return message.includes('login required')
    || message.includes('rate-limit reached')
    || message.includes('--cookies-from-browser')
    || message.includes('--cookies for the authentication');
}

function isCookiesFileMissingError(error) {
  return String(error?.message || '').includes('YT_DLP_COOKIES_FILE does not exist');
}

function isBrowserCookiesDecryptError(error) {
  const message = String(error?.message || '').toLowerCase();

  return message.includes('failed to decrypt with dpapi');
}

function isXAIAccessError(error) {
  const status = error?.response?.status;
  const data = JSON.stringify(error?.response?.data || {}).toLowerCase();
  const message = String(error?.response?.data?.error || error?.message || '').toLowerCase();
  const combined = `${data} ${message}`;

  return [401, 402, 403, 429].includes(status) ||
    combined.includes('credits') ||
    combined.includes('license') ||
    combined.includes('quota') ||
    combined.includes('billing') ||
    combined.includes('permission');
}

async function handleVideoLink(ctx, url) {
  const userId = ctx.from?.id || ctx.chat?.id;
  let loadingMessage = null;
  let workspace = null;

  try {
    logInfo(`[VIDEO_LINK] userId=${String(userId || 'anonymous')} url=${url}`);
    loadingMessage = await safeReply(ctx, LOADING_MESSAGE, HTML_OPTIONS);

    const downloaded = await downloadAudioFromVideo(url);
    workspace = downloaded.workspace;

    const transcript = await transcribeAudio(downloaded.audioPath);
    const translation = await translateTextToRussian(transcript);
    const analysis = await analyzeTranscriptWithGrok(transcript, url);
    analysis.translation = translation;
    const formattedMessage = formatVideoAnalysis(analysis);

    setLastVideoTranscript(userId, transcript, url);

    await safeEditOrReply(ctx, loadingMessage, formattedMessage, HTML_OPTIONS);

    for (const transcriptChunk of formatTranscriptChunks(analysis.transcript)) {
      await safeReply(ctx, transcriptChunk, HTML_OPTIONS);
    }

    for (const translationChunk of formatTranslationChunks(analysis.translation)) {
      await safeReply(ctx, translationChunk, HTML_OPTIONS);
    }
  } catch (error) {
    logError('Failed to process video link', error);

    if (/OPENROUTER_API_KEY|OPENAI_API_KEY|XAI_API_KEY/.test(String(error?.message || ''))) {
      await safeEditOrReply(ctx, loadingMessage, VIDEO_AI_NOT_CONFIGURED_MESSAGE, HTML_OPTIONS);
    } else if (isXAIAccessError(error)) {
      await safeEditOrReply(ctx, loadingMessage, VIDEO_AI_ACCESS_ERROR_MESSAGE, HTML_OPTIONS);
    } else if (isCookiesFileMissingError(error)) {
      await safeEditOrReply(ctx, loadingMessage, COOKIES_FILE_MISSING_MESSAGE, HTML_OPTIONS);
    } else if (isBrowserCookiesDecryptError(error)) {
      await safeEditOrReply(ctx, loadingMessage, BROWSER_COOKIES_DECRYPT_ERROR_MESSAGE, HTML_OPTIONS);
    } else if (isInstagramAuthError(error)) {
      await safeEditOrReply(ctx, loadingMessage, INSTAGRAM_AUTH_ERROR_MESSAGE, HTML_OPTIONS);
    } else if (isMissingCommandError(error)) {
      await safeEditOrReply(ctx, loadingMessage, PROCESSING_ERROR_MESSAGE, HTML_OPTIONS);
    } else if (isTikTokNetworkError(error)) {
      await safeEditOrReply(ctx, loadingMessage, TIKTOK_NETWORK_ERROR_MESSAGE, HTML_OPTIONS);
    } else if (isDownloadError(error)) {
      await safeEditOrReply(ctx, loadingMessage, DOWNLOAD_ERROR_MESSAGE, HTML_OPTIONS);
    } else {
      await safeEditOrReply(ctx, loadingMessage, PROCESSING_ERROR_MESSAGE, HTML_OPTIONS);
    }
  } finally {
    await cleanupWorkspace(workspace);
  }
}

module.exports = {
  handleVideoLink
};
