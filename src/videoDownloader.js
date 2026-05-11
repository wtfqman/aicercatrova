const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const config = require('./config');

const SUPPORTED_VIDEO_URL_PATTERN = /https?:\/\/(?:www\.)?(?:tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com|instagram\.com|www\.instagram\.com)\/[^\s<>"']+/i;
const TIKTOK_URL_PATTERN = /https?:\/\/(?:www\.)?(?:tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com)\//i;
const DEFAULT_YT_DLP_COMMAND = 'yt-dlp';
const DEFAULT_FFMPEG_COMMAND = 'ffmpeg';
const DEFAULT_BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const DEFAULT_FETCH_TIMEOUT_MS = 45000;
const DEFAULT_FETCH_RETRIES = 3;

function optionalRequire(moduleName) {
  try {
    return require(moduleName);
  } catch (error) {
    return null;
  }
}

function resolveYtDlpCommand() {
  const constants = optionalRequire('yt-dlp-exec/src/constants');
  return constants?.YOUTUBE_DL_PATH || DEFAULT_YT_DLP_COMMAND;
}

function resolveFfmpegCommand() {
  return optionalRequire('ffmpeg-static') || DEFAULT_FFMPEG_COMMAND;
}

const YT_DLP_COMMAND = resolveYtDlpCommand();
const FFMPEG_COMMAND = resolveFfmpegCommand();

function getYtDlpFfmpegArgs() {
  return FFMPEG_COMMAND === DEFAULT_FFMPEG_COMMAND
    ? []
    : ['--ffmpeg-location', FFMPEG_COMMAND];
}

function getYtDlpCookieArgs() {
  if (config.video.ytDlpCookiesFile) {
    if (!fsSync.existsSync(config.video.ytDlpCookiesFile)) {
      throw new Error(`YT_DLP_COOKIES_FILE does not exist: ${config.video.ytDlpCookiesFile}`);
    }

    return ['--cookies', config.video.ytDlpCookiesFile];
  }

  if (config.video.ytDlpCookiesFromBrowser) {
    return ['--cookies-from-browser', config.video.ytDlpCookiesFromBrowser];
  }

  return [];
}

function isTikTokUrl(url) {
  return TIKTOK_URL_PATTERN.test(String(url || ''));
}

function getYtDlpNetworkArgs(url) {
  const args = [
    '--socket-timeout',
    String(config.video.ytDlpSocketTimeoutSec),
    '--retries',
    String(config.video.ytDlpRetries),
    '--fragment-retries',
    String(config.video.ytDlpRetries),
    '--extractor-retries',
    String(config.video.ytDlpExtractorRetries),
    '--force-ipv4',
    '--user-agent',
    DEFAULT_BROWSER_USER_AGENT
  ];

  if (config.video.ytDlpProxy) {
    args.push('--proxy', config.video.ytDlpProxy);
  }

  if (isTikTokUrl(url)) {
    args.push('--referer', 'https://www.tiktok.com/');

    if (config.video.tiktokAppInfo || config.video.tiktokApiHostname) {
      const extractorArgs = [
        config.video.tiktokAppInfo ? `app_info=${config.video.tiktokAppInfo}` : '',
        config.video.tiktokApiHostname ? `api_hostname=${config.video.tiktokApiHostname}` : ''
      ].filter(Boolean).join(';');

      if (extractorArgs) {
        args.push('--extractor-args', `tiktok:${extractorArgs}`);
      }
    }
  }

  return args;
}

function extractSupportedVideoUrl(text) {
  const match = String(text || '').match(SUPPORTED_VIDEO_URL_PATTERN);
  return match?.[0] || '';
}

function isSupportedVideoUrl(text) {
  return Boolean(extractSupportedVideoUrl(text));
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`${command} timed out.`));
    }, config.video.jobTimeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`${command} exited with code ${code}: ${stderr || stdout}`));
    });
  });
}

async function createVideoWorkspace() {
  const jobId = crypto.randomUUID();
  const workspace = path.join(config.video.tempDir, jobId);
  await fs.mkdir(workspace, { recursive: true });
  return workspace;
}

async function cleanupWorkspace(workspace) {
  if (!workspace) {
    return;
  }

  try {
    await fs.rm(workspace, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 250
    });
  } catch (error) {
    // Temporary media files can stay locked briefly on Windows/OneDrive.
  }
}

async function findDownloadedFile(workspace) {
  const files = await fs.readdir(workspace);
  const rawFile = files.find((fileName) => fileName.startsWith('raw.'));

  if (!rawFile) {
    throw new Error('yt-dlp did not create an audio file.');
  }

  return path.join(workspace, rawFile);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithRetry(url, options = {}) {
  const retries = options.retries || DEFAULT_FETCH_RETRIES;
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await fetchWithTimeout(url, options);
    } catch (error) {
      lastError = error;

      if (attempt < retries) {
        await sleep(500 * attempt);
      }
    }
  }

  throw lastError;
}

async function resolveTikTokUrl(url) {
  let currentUrl = url;

  for (let redirectCount = 0; redirectCount < 5; redirectCount += 1) {
    const response = await fetchWithRetry(currentUrl, {
      redirect: 'manual',
      headers: {
        'User-Agent': DEFAULT_BROWSER_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response.url || currentUrl;
    }

    const location = response.headers.get('location');

    if (!location) {
      return currentUrl;
    }

    currentUrl = new URL(location, currentUrl).toString();
  }

  return currentUrl;
}

function extractUniversalDataFromTikTokHtml(html) {
  const match = String(html || '').match(/<script[^>]+id=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>(.*?)<\/script>/su);

  if (!match?.[1]) {
    throw new Error('TikTok webpage fallback failed: universal data was not found.');
  }

  return JSON.parse(match[1]);
}

function getTikTokItemFromUniversalData(data) {
  const item = data?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;

  if (!item) {
    throw new Error('TikTok webpage fallback failed: video metadata was not found.');
  }

  return item;
}

function getTikTokUrlList(value) {
  if (!value) {
    return [];
  }

  if (typeof value === 'string') {
    return [value];
  }

  if (Array.isArray(value?.UrlList)) {
    return value.UrlList.filter(Boolean);
  }

  return [];
}

function getTikTokMediaCandidates(item) {
  const video = item?.video || {};
  const music = item?.music || {};
  const bitrateUrls = [...(video.bitrateInfo || [])]
    .sort((left, right) => (left?.Bitrate || 0) - (right?.Bitrate || 0))
    .flatMap((entry) => getTikTokUrlList(entry?.PlayAddr));

  return [
    ...bitrateUrls,
    ...getTikTokUrlList(video.PlayAddrStruct),
    ...getTikTokUrlList(video.playAddr),
    ...getTikTokUrlList(video.downloadAddr),
    ...getTikTokUrlList(music.playUrl)
  ].filter((url, index, list) => url && list.indexOf(url) === index);
}

function getCookieHeaderFromResponse(response) {
  const cookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [];

  return cookies
    .map((cookie) => cookie.split(';')[0])
    .filter(Boolean)
    .join('; ');
}

function isMediaContentType(contentType) {
  if (!contentType) {
    return true;
  }

  return /(?:video|audio|mp4|mpeg|octet-stream)/i.test(contentType);
}

async function downloadUrlToFile(url, filePath, referer, cookieHeader = '') {
  const response = await fetchWithRetry(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': DEFAULT_BROWSER_USER_AGENT,
      Accept: '*/*',
      Referer: referer,
      ...(cookieHeader ? { Cookie: cookieHeader } : {})
    },
    timeoutMs: config.video.jobTimeoutMs
  });

  if (!response.ok || !response.body) {
    throw new Error(`Media download failed with status ${response.status}.`);
  }

  const contentType = response.headers.get('content-type') || '';

  if (!isMediaContentType(contentType)) {
    throw new Error(`Media URL returned non-media content-type: ${contentType || 'unknown'}.`);
  }

  await pipeline(Readable.fromWeb(response.body), fsSync.createWriteStream(filePath));

  const stats = await fs.stat(filePath);

  if (!stats.size) {
    throw new Error('Downloaded media file is empty.');
  }
}

async function downloadTikTokViaWebpage(url, workspace) {
  const pageUrl = await resolveTikTokUrl(url);
  const response = await fetchWithRetry(pageUrl, {
    redirect: 'follow',
    headers: {
      'User-Agent': DEFAULT_BROWSER_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Referer: 'https://www.tiktok.com/'
    }
  });

  if (!response.ok) {
    throw new Error(`TikTok webpage fallback failed with status ${response.status}.`);
  }

  const cookieHeader = getCookieHeaderFromResponse(response);
  const html = await response.text();
  const item = getTikTokItemFromUniversalData(extractUniversalDataFromTikTokHtml(html));
  const duration = Number.parseInt(item?.video?.duration, 10);

  if (Number.isFinite(duration) && duration > config.video.maxDurationSec) {
    throw new Error(`duration ${duration} exceeds limit ${config.video.maxDurationSec}`);
  }

  const candidates = getTikTokMediaCandidates(item);
  let lastError = null;

  if (candidates.length === 0) {
    throw new Error('TikTok webpage fallback failed: no media URLs were found.');
  }

  for (let index = 0; index < candidates.length; index += 1) {
    const rawPath = path.join(workspace, `raw.tiktok-${index}.mp4`);

    try {
      await downloadUrlToFile(candidates[index], rawPath, pageUrl, cookieHeader);
      return rawPath;
    } catch (error) {
      lastError = error;
      await fs.rm(rawPath, { force: true }).catch(() => {});
    }
  }

  throw new Error(`TikTok webpage fallback failed: ${lastError?.message || 'all media URLs failed.'}`);
}

async function downloadAudioFromVideo(url) {
  const workspace = await createVideoWorkspace();

  try {
    const rawTemplate = path.join(workspace, 'raw.%(ext)s');
    const outputAudioPath = path.join(workspace, 'audio.mp3');
    const runYtDlpDownload = () => runCommand(YT_DLP_COMMAND, [
      '--no-playlist',
      ...getYtDlpNetworkArgs(url),
      ...getYtDlpFfmpegArgs(),
      ...getYtDlpCookieArgs(),
      '--match-filter',
      `duration <= ${config.video.maxDurationSec}`,
      '-x',
      '--audio-format',
      'mp3',
      '--audio-quality',
      '5',
      '-o',
      rawTemplate,
      url
    ]);

    if (isTikTokUrl(url)) {
      try {
        await downloadTikTokViaWebpage(url, workspace);
      } catch (webpageError) {
        if (!config.video.ytDlpProxy && !config.video.tiktokTryYtDlpFallback) {
          throw new Error(`TikTok download failed. Web fallback: ${webpageError.message}`);
        }

        try {
          await runYtDlpDownload();
        } catch (ytDlpError) {
          throw new Error(`TikTok download failed. Web fallback: ${webpageError.message}. yt-dlp: ${ytDlpError.message}`);
        }
      }
    } else {
      await runYtDlpDownload();
    }

    const downloadedPath = await findDownloadedFile(workspace);

    await runCommand(FFMPEG_COMMAND, [
      '-y',
      '-i',
      downloadedPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-b:a',
      '48k',
      outputAudioPath
    ]);

    return {
      audioPath: outputAudioPath,
      workspace
    };
  } catch (error) {
    await cleanupWorkspace(workspace);
    throw error;
  }
}

module.exports = {
  cleanupWorkspace,
  downloadAudioFromVideo,
  extractSupportedVideoUrl,
  isSupportedVideoUrl
};
