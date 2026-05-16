# Cerca Trova Creator Bot

Telegram-бот AI-помощник для креаторов. Пользователь пишет вопрос, бот даёт полезный ответ и предлагает 5 популярных тем для контента, которые можно использовать для видео, Reels, Shorts, постов или заголовков.

## Возможности

- Отвечает на текстовые вопросы креаторов.
- Помогает с темами про стиль, одежду, гардероб, визуальную подачу и контент.
- Предлагает ровно 5 популярных тем/запросов по теме вопроса.
- Добавляет к темам кнопки для быстрого копирования текста.
- Показывает аккуратное стартовое меню с inline-кнопками.
- Поддерживает команды `/start`, `/help`, `/reset`.
- Хранит короткую in-memory историю диалога без базы данных.
- Обрабатывает ошибки AI-провайдера, пустые ответы AI и неподдерживаемые типы сообщений.

## Стек

- Node.js
- Telegraf
- dotenv
- axios
- OpenRouter API для обычных ответов
- xAI/Grok API для обработки TikTok/Reels и расшифровки аудио

## Структура проекта

```text
package.json
.gitignore
.env
.env.example
README.md
src/
  index.js
  config.js
  ai.js
  prompts.js
  keyboards.js
  memory.js
  utils/
    logger.js
    escapeHtml.js
```

## Установка

```bash
npm install
cp .env.example .env
```

На Windows вместо `cp` можно просто создать копию `.env.example` с именем `.env`.

## Настройка `.env`

Заполните `.env` реальными токенами:

```env
BOT_TOKEN=
OPENROUTER_API_KEY=
OPENROUTER_MODEL=openai/gpt-4o-mini
OPENROUTER_VIDEO_MODEL=openai/gpt-4o-mini
OPENROUTER_TRANSCRIBE_MODEL=openai/whisper-large-v3
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_APP_NAME=Cerca Trova Creator Bot
OPENROUTER_APP_URL=https://example.com
AI_TIMEOUT_MS=45000
HISTORY_LIMIT=4
USE_HISTORY=false

# Optional: Grok/xAI for TikTok/Reels processing, not for normal bot answers.
XAI_API_KEY=
XAI_MODEL=grok-4.3
XAI_BASE_URL=https://api.x.ai/v1

# Optional fallback/replacement for OpenRouter/xAI video processing.
OPENAI_API_KEY=
OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
OPENAI_CHAT_MODEL=gpt-4.1-mini
OPENAI_BASE_URL=https://api.openai.com/v1
# auto tries OpenRouter first, then OpenAI, then xAI.
VIDEO_AI_PROVIDER=auto

VIDEO_MAX_DURATION_SEC=600
VIDEO_JOB_TIMEOUT_MS=180000

# Optional: Instagram often requires authenticated cookies for Reels downloads.
# Prefer a cookies.txt file on production servers.
YT_DLP_COOKIES_FILE=
# Local desktop alternative, for example: chrome, edge, firefox
YT_DLP_COOKIES_FROM_BROWSER=
```

Переменные:

- `BOT_TOKEN` — токен Telegram-бота от BotFather.
- `OPENROUTER_API_KEY` — старый API-ключ для обычных AI-ответов бота.
- `OPENROUTER_MODEL` — модель для обычных AI-ответов.
- `OPENROUTER_VIDEO_MODEL` — модель OpenRouter для анализа расшифровки видео.
- `OPENROUTER_TRANSCRIBE_MODEL` — STT-модель OpenRouter для расшифровки аудио.
- `OPENROUTER_BASE_URL` — базовый URL OpenRouter API.
- `OPENROUTER_APP_NAME` — название приложения для заголовка `X-Title`.
- `OPENROUTER_APP_URL` — URL приложения для заголовка `HTTP-Referer`.
- `AI_TIMEOUT_MS` — таймаут AI-запроса.
- `HISTORY_LIMIT` — лимит сообщений в in-memory истории.
- `USE_HISTORY` — включать ли историю в AI-запрос. По умолчанию `false`.
- `XAI_API_KEY` — API-ключ Grok/xAI только для обработки TikTok/Reels.
- `XAI_MODEL` — модель Grok для анализа расшифровки.
- `XAI_BASE_URL` — базовый URL xAI API.
- `OPENAI_API_KEY` — альтернативный API-ключ для расшифровки и анализа видео, если xAI недоступен.
- `OPENAI_TRANSCRIBE_MODEL` — модель OpenAI для Speech-to-Text.
- `OPENAI_CHAT_MODEL` — модель OpenAI для анализа расшифровки.
- `VIDEO_AI_PROVIDER` — `auto`, `openrouter`, `openai` или `xai`. В режиме `auto` сначала используется OpenRouter.
- `VIDEO_MAX_DURATION_SEC` — максимальная длина скачиваемого ролика.
- `VIDEO_JOB_TIMEOUT_MS` — таймаут скачивания, сжатия и обработки ролика.
- `YT_DLP_COOKIES_FILE` — путь к `cookies.txt` для Instagram, если Reels требуют авторизацию.
- `YT_DLP_COOKIES_FROM_BROWSER` — локальная альтернатива для разработки: `chrome`, `edge` или `firefox`.

## Запуск

```bash
npm start
```

Для разработки:

```bash
npm run dev
```

## Команды бота

- `/start` — главное меню.
- `/help` — как работает бот.
- `/reset` — очистить историю.

## Как работает AI

Для обычных текстовых вопросов бот передаёт в OpenRouter:

1. Жёсткий system prompt из `src/prompts.js`.
2. Текущий вопрос пользователя.
3. Короткую историю только если `USE_HISTORY=true`.

AI должен вернуть ответ в формате:

```text
💬 Ответ:
[короткий полезный ответ]

🔥 Популярные темы для контента:
1. ...
2. ...
3. ...
4. ...
5. ...
```

Если формат ответа сломан, бот нормализует его перед отправкой пользователю и добавляет fallback-темы, если AI не дал 5 пунктов.

## Как работает обработка TikTok/Reels

Если пользователь отправляет ссылку на TikTok или Instagram Reels, бот:

1. Скачивает аудио через `yt-dlp`.
2. Сжимает аудио через `ffmpeg`.
3. Отправляет аудио в OpenAI Speech-to-Text или xAI Speech-to-Text.
4. Отправляет расшифровку в AI и получает нормальный русский перевод/смысл, краткий разбор, заголовки, хуки, план поста и CTA.
5. Возвращает результат в Telegram.

`yt-dlp` и `ffmpeg` ставятся через npm-зависимости проекта. Для Instagram Reels может понадобиться авторизация через cookies: укажите `YT_DLP_COOKIES_FILE` или `YT_DLP_COOKIES_FROM_BROWSER` в `.env`.

## Безопасность

- Никогда не загружайте `.env` и реальные токены в GitHub.
- `.env` добавлен в `.gitignore`.
- `.env.example` не содержит реальных токенов.
- Бот не выводит токены в консоль.
- Бот не отправляет токены пользователям в Telegram.
