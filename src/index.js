const { Telegraf } = require('telegraf');
const { message } = require('telegraf/filters');
const { logError, logInfo } = require('./utils/logger');

let config;

try {
  config = require('./config');
} catch (error) {
  logError('Configuration error', error);
  process.exit(1);
}

const { handleAIQuestion } = require('./handlers/aiQuestionHandler');
const { handleVideoLink } = require('./handlers/videoLinkHandler');
const { mainMenuKeyboard, CALLBACKS } = require('./keyboards');
const { clearHistory } = require('./memory');
const { extractSupportedVideoUrl } = require('./videoDownloader');

const bot = new Telegraf(config.botToken, {
  handlerTimeout: config.telegramHandlerTimeoutMs
});

const HTML_OPTIONS = { parse_mode: 'HTML' };

const START_MESSAGE = `<b>👋 Привет! Я AI-помощник для креаторов</b>

Я помогаю быстро превращать вопросы в понятные ответы и идеи для контента.

<b>Что можно спросить:</b>
— как подобрать вещь;
— как объяснить тему подписчикам;
— как придумать заголовок;
— какие запросы популярны по теме;
— как сделать тему понятной и интересной.

Напиши вопрос текстом или выбери пример ниже 👇`;

const HOW_IT_WORKS_MESSAGE = `<b>ℹ️ Как это работает</b>

Ты пишешь вопрос или тему, например:
<i>«Как правильно подобрать пиджак?»</i>

Бот делает две вещи:

1. Даёт понятный и полезный ответ по теме.
2. Предлагает 5 популярных тем для контента.

Эти 5 пунктов — это не вопросы к тебе, а готовые идеи для видео, постов или заголовков.`;

const ONLY_TEXT_MESSAGE = 'Пока я работаю только с текстом. Напиши вопрос сообщением 🙂';
const RESET_MESSAGE = `✅ История диалога очищена.
Можешь задать новый вопрос.`;
const AI_ERROR_MESSAGE = `⚠️ Не получилось подготовить ответ.
Попробуй ещё раз чуть позже или переформулируй вопрос.`;

const SAMPLE_QUESTIONS = {
  jacket: 'Как правильно подобрать пиджак?',
  outfit: 'Как собрать стильный образ на каждый день?',
  videoTopics: 'Предложи идеи для видео про стиль и гардероб'
};

function getUserId(ctx) {
  return ctx.from?.id || ctx.chat?.id;
}

function isHandledCommand(text) {
  const command = String(text || '').trim().split(/\s+/)[0].split('@')[0];
  return ['/start', '/help', '/reset'].includes(command);
}

function withErrorBoundary(handlerName, handler) {
  return async (ctx, next) => {
    try {
      await handler(ctx, next);
    } catch (error) {
      logError(`${handlerName} handler failed`, error);

      try {
        await ctx.reply(AI_ERROR_MESSAGE);
      } catch (replyError) {
        logError('Failed to send fallback error message', replyError);
      }
    }
  };
}

async function replyHtml(ctx, text, extra = {}) {
  return ctx.reply(text, { ...HTML_OPTIONS, ...extra });
}

async function safeAnswerCallback(ctx) {
  try {
    await ctx.answerCbQuery();
  } catch (error) {
    logError('Failed to answer callback query', error);
  }
}

bot.start(withErrorBoundary('start', async (ctx) => {
  await replyHtml(ctx, START_MESSAGE, mainMenuKeyboard());
}));

bot.help(withErrorBoundary('help', async (ctx) => {
  await replyHtml(ctx, HOW_IT_WORKS_MESSAGE);
}));

bot.command('reset', withErrorBoundary('reset', async (ctx) => {
  clearHistory(getUserId(ctx));
  await ctx.reply(RESET_MESSAGE);
}));

bot.action(CALLBACKS.JACKET_EXAMPLE, withErrorBoundary('example_jacket', async (ctx) => {
  await safeAnswerCallback(ctx);
  await handleAIQuestion(ctx, SAMPLE_QUESTIONS.jacket);
}));

bot.action(CALLBACKS.OUTFIT_IDEAS, withErrorBoundary('example_outfit', async (ctx) => {
  await safeAnswerCallback(ctx);
  await handleAIQuestion(ctx, SAMPLE_QUESTIONS.outfit);
}));

bot.action(CALLBACKS.VIDEO_TOPICS, withErrorBoundary('example_video_topics', async (ctx) => {
  await safeAnswerCallback(ctx);
  await handleAIQuestion(ctx, SAMPLE_QUESTIONS.videoTopics);
}));

bot.action(CALLBACKS.HOW_IT_WORKS, withErrorBoundary('how_it_works', async (ctx) => {
  await safeAnswerCallback(ctx);
  await replyHtml(ctx, HOW_IT_WORKS_MESSAGE);
}));

bot.on('callback_query', withErrorBoundary('callback_query', async (ctx) => {
  await safeAnswerCallback(ctx);
}));

bot.on(message('text'), withErrorBoundary('text', async (ctx) => {
  if (isHandledCommand(ctx.message.text)) {
    return;
  }

  const videoUrl = extractSupportedVideoUrl(ctx.message.text);

  if (videoUrl) {
    await handleVideoLink(ctx, videoUrl);
    return;
  }

  await handleAIQuestion(ctx, ctx.message.text);
}));

bot.on('message', withErrorBoundary('message', async (ctx) => {
  await ctx.reply(ONLY_TEXT_MESSAGE);
}));

bot.catch((error) => {
  logError('Unhandled bot error', error);
});

async function startBot() {
  logInfo('Starting Telegram bot');
  await bot.launch();
  logInfo('Telegram bot started');
}

startBot().catch((error) => {
  logError('Failed to start Telegram bot', error);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
