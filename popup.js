const DEFAULTS = {
  includeHidden: false,
  prettyFormat: false,
  closeAfterSeconds: 5
};

const SCRAPPED_HOLD_MS = 1100;
const FADE_MS = 180;
const MIN_CLOSE_SECONDS = Math.ceil(
  (SCRAPPED_HOLD_MS + FADE_MS) / 1000
);

const includeHidden = document.getElementById('includeHidden');
const prettyFormat = document.getElementById('prettyFormat');
const closeAfter = document.getElementById('closeAfter');
const closeAfterValue = document.getElementById('closeAfterValue');
const closeButton = document.getElementById('closeButton');
const runButton = document.getElementById('runButton');
const message = document.getElementById('message');
const closeProgress = document.getElementById('closeProgress');
const closeProgressFill = document.getElementById('closeProgressFill');

let autoCloseTimer = null;
let transitionToken = 0;
let isRunning = false;

class UnavailablePageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnavailablePageError';
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function closeWithFade() {
  document.body.classList.add('is-closing');

  setTimeout(() => {
    window.close();
  }, FADE_MS);
}

function currentSettings() {
  return {
    includeHidden: includeHidden.checked,
    prettyFormat: prettyFormat.checked,
    closeAfterSeconds: Number(closeAfter.value)
  };
}

function setMessage(text = '', isError = false) {
  message.textContent = text;
  message.classList.toggle('is-error', isError);

  message.classList.remove('is-changing');

  if (text) {
    // Force layout so repeated message updates restart the animation.
    void message.offsetWidth;
    message.classList.add('is-changing');
  }
}

function normalizedCloseSeconds(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return DEFAULTS.closeAfterSeconds;
  }

  return Math.min(15, Math.max(MIN_CLOSE_SECONDS, numeric));
}

function updateSliderText() {
  closeAfterValue.textContent = `${closeAfter.value}s`;
}

async function saveSettings() {
  await chrome.storage.local.set(currentSettings());
}

function resetProgressBar() {
  closeProgress.classList.add('is-paused');
  closeProgressFill.style.transitionDuration = '0ms';
  closeProgressFill.style.transform = 'scaleX(1)';
  closeProgress.setAttribute('aria-valuenow', '100');
}

function startProgressBar(durationMs) {
  resetProgressBar();
  closeProgress.classList.remove('is-paused');

  // Force layout so the reset to 100% is committed before the
  // linear countdown animation begins.
  void closeProgressFill.offsetWidth;

  closeProgressFill.style.transitionDuration = `${durationMs}ms`;
  closeProgressFill.style.transform = 'scaleX(0)';
  closeProgress.setAttribute('aria-valuenow', '0');
}

function clearAutoClose() {
  if (autoCloseTimer !== null) {
    clearTimeout(autoCloseTimer);
    autoCloseTimer = null;
  }

  resetProgressBar();
}

function armAutoClose() {
  clearAutoClose();

  if (isRunning) {
    return;
  }

  const seconds = normalizedCloseSeconds(closeAfter.value);
  const durationMs = seconds * 1000;

  startProgressBar(durationMs);

  autoCloseTimer = setTimeout(() => {
    closeWithFade();
  }, durationMs);
}

function markRunning() {
  transitionToken += 1;

  runButton.disabled = true;
  runButton.textContent = 'SCRAPING…';
  runButton.className = 'run-button is-running';
}

function showUnavailable(reason) {
  transitionToken += 1;

  runButton.disabled = true;
  runButton.textContent = 'UNAVAILABLE';
  runButton.className = 'run-button is-unavailable';

  setMessage(reason);
}

function markScrapped() {
  transitionToken += 1;

  runButton.disabled = true;
  runButton.textContent = 'SCRAPPED';

  // Re-assigning the class restarts the left-to-right success sweep
  // every time a scrape succeeds.
  runButton.className = 'run-button';
  void runButton.offsetWidth;
  runButton.className = 'run-button is-scrapped';
}

async function fadeToRun() {
  const myToken = ++transitionToken;

  await sleep(SCRAPPED_HOLD_MS);

  if (myToken !== transitionToken) {
    return;
  }

  runButton.classList.add('is-fading');
  await sleep(FADE_MS);

  if (myToken !== transitionToken) {
    return;
  }

  runButton.textContent = 'RUN';
  runButton.disabled = false;
  runButton.className = 'run-button is-ready is-fading';

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (myToken === transitionToken) {
        runButton.classList.remove('is-fading');
      }
    });
  });
}

async function showError(error) {
  const myToken = ++transitionToken;

  runButton.disabled = true;
  runButton.textContent = 'ERROR';
  runButton.className = 'run-button is-error';

  setMessage(
    error instanceof Error ? error.message : String(error),
    true
  );

  await sleep(1600);

  if (myToken !== transitionToken) {
    return;
  }

  runButton.classList.add('is-fading');
  await sleep(FADE_MS);

  if (myToken !== transitionToken) {
    return;
  }

  runButton.textContent = 'RUN';
  runButton.disabled = false;
  runButton.className = 'run-button is-ready is-fading';

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (myToken === transitionToken) {
        runButton.classList.remove('is-fading');
      }
    });
  });
}

function protectedPageReason(url = '') {
  const normalizedUrl = String(url).toLowerCase();

  const protectedPrefixes = [
    'chrome://',
    'chrome-extension://',
    'chrome-search://',
    'chrome-untrusted://',
    'devtools://',
    'view-source:',
    'about:',
    'edge://'
  ];

  if (
    protectedPrefixes.some(prefix =>
      normalizedUrl.startsWith(prefix)
    )
  ) {
    return 'Chrome-protected page';
  }

  if (
    normalizedUrl.startsWith('https://chromewebstore.google.com/') ||
    normalizedUrl.startsWith('https://chrome.google.com/webstore')
  ) {
    return 'Chrome Web Store page';
  }

  return null;
}

function isInjectionAccessError(error) {
  const text =
    error instanceof Error
      ? error.message
      : String(error);

  return [
    'Cannot access a chrome:// URL',
    'Cannot access a chrome-extension:// URL',
    'Cannot access contents of url',
    'The extensions gallery cannot be scripted',
    'Missing host permission for the tab'
  ].some(fragment => text.includes(fragment));
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab?.id) {
    throw new Error('No active tab.');
  }

  return tab;
}

async function executeScraper(tab, settings) {
  const protectedReason = protectedPageReason(tab.url);

  if (protectedReason) {
    throw new UnavailablePageError(protectedReason);
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: pageSettings => {
        window.__SAVAGE_SCRAPER_EXTENSION_SETTINGS = pageSettings;
      },
      args: [{
        includeHidden: settings.includeHidden,
        prettyFormat: settings.prettyFormat
      }]
    });

    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      files: ['scraper-main.js']
    });

    const output = injectionResults?.[0]?.result;

    if (typeof output !== 'string') {
      throw new Error('Scraper returned no text.');
    }

    return output;
  } catch (error) {
    if (isInjectionAccessError(error)) {
      const reason =
        String(tab.url || '').startsWith('file://')
          ? 'Enable “Allow access to file URLs” for this extension'
          : 'Chrome does not allow extensions to access this page';

      throw new UnavailablePageError(reason);
    }

    throw error;
  }
}

async function copyOutput(output) {
  await navigator.clipboard.writeText(output);
}

async function runScrape() {
  if (isRunning) {
    return;
  }

  isRunning = true;
  clearAutoClose();
  markRunning();
  setMessage('');

  try {
    const settings = currentSettings();
    const tab = await getActiveTab();
    const output = await executeScraper(tab, settings);

    await copyOutput(output);

    setMessage(
      `${output.length.toLocaleString()} chars copied`
    );

    isRunning = false;
    markScrapped();
    void fadeToRun();
    armAutoClose();
  } catch (error) {
    isRunning = false;

    if (error instanceof UnavailablePageError) {
      console.info('[Savage Scraper]', error.message);
      showUnavailable(error.message);
    } else {
      console.error(error);
      void showError(error);
    }

    armAutoClose();
  }
}

async function initialize() {
  closeAfter.min = String(MIN_CLOSE_SECONDS);

  const stored = await chrome.storage.local.get(DEFAULTS);

  includeHidden.checked = Boolean(stored.includeHidden);
  prettyFormat.checked = Boolean(stored.prettyFormat);

  closeAfter.value = String(
    normalizedCloseSeconds(stored.closeAfterSeconds)
  );

  updateSliderText();
  resetProgressBar();

  await runScrape();
}

includeHidden.addEventListener('change', async () => {
  await saveSettings();
  armAutoClose();
});

prettyFormat.addEventListener('change', async () => {
  await saveSettings();
  armAutoClose();
});

closeAfter.addEventListener('input', () => {
  closeAfter.value = String(
    normalizedCloseSeconds(closeAfter.value)
  );
  updateSliderText();
  armAutoClose();
});

closeAfter.addEventListener('change', async () => {
  await saveSettings();
  armAutoClose();
});

closeButton.addEventListener('click', () => {
  closeWithFade();
});

runButton.addEventListener('click', async () => {
  if (runButton.disabled || isRunning) {
    return;
  }

  await runScrape();
});

for (const eventName of ['pointerdown', 'keydown']) {
  document.addEventListener(eventName, event => {
    if (
      event.target !== closeButton &&
      !closeButton.contains(event.target)
    ) {
      armAutoClose();
    }
  });
}

void initialize();
