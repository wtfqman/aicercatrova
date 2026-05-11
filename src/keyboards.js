const { Markup } = require('telegraf');

const CALLBACKS = {
  JACKET_EXAMPLE: 'example_jacket',
  OUTFIT_IDEAS: 'example_outfit',
  VIDEO_TOPICS: 'example_video_topics',
  HOW_IT_WORKS: 'how_it_works'
};

function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🧥 Пример про пиджак', CALLBACKS.JACKET_EXAMPLE),
      Markup.button.callback('👕 Идеи для образа', CALLBACKS.OUTFIT_IDEAS)
    ],
    [
      Markup.button.callback('🎬 Темы для видео', CALLBACKS.VIDEO_TOPICS),
      Markup.button.callback('ℹ️ Как это работает', CALLBACKS.HOW_IT_WORKS)
    ]
  ]);
}

module.exports = {
  CALLBACKS,
  mainMenuKeyboard
};
