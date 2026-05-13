const { Markup } = require('telegraf');

const CALLBACKS = {
  JACKET_EXAMPLE: 'example_jacket',
  OUTFIT_IDEAS: 'example_outfit',
  VIDEO_TOPICS: 'example_video_topics',
  HOW_IT_WORKS: 'how_it_works'
};

const COPY_BUTTON_LABEL_MAX_LENGTH = 52;
const COPY_TEXT_MAX_LENGTH = 256;

function trimForButton(text, maxLength) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trim()}…`;
}

function trimForCopy(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();

  if (value.length <= COPY_TEXT_MAX_LENGTH) {
    return value;
  }

  return value.slice(0, COPY_TEXT_MAX_LENGTH).trim();
}

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

function contentTopicsCopyKeyboard(topics) {
  const buttons = (Array.isArray(topics) ? topics : [])
    .map((topic) => String(topic || '').trim())
    .filter(Boolean)
    .slice(0, 5)
    .map((topic, index) => {
      const prefix = `📋 ${index + 1}. `;
      const label = `${prefix}${trimForButton(topic, COPY_BUTTON_LABEL_MAX_LENGTH - prefix.length)}`;

      return [{
        text: label,
        copy_text: {
          text: trimForCopy(topic)
        }
      }];
    });

  if (buttons.length === 0) {
    return {};
  }

  return {
    reply_markup: {
      inline_keyboard: buttons
    }
  };
}

module.exports = {
  CALLBACKS,
  contentTopicsCopyKeyboard,
  mainMenuKeyboard
};
