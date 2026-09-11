const DEFAULT_SETTINGS = {
  includeHidden: false,
  prettyFormat: false
};

const MCP_DEFAULTS = {
  mcpEnabled: false,
  bridgeToken: '',
  bridgePort: 8765,
  bottomConfirmationPasses: 2,
  bottomConfirmationMaxMs: 2600
};

const MCP_PERMISSION_ORIGINS = [
  'http://*/*',
  'https://*/*'
];

const AGENT_TAB_CLOSE_ALARM = 'savage_mcp_agent_tab_close';
const BRIDGE_RECONNECT_ALARM = 'savage_mcp_bridge_reconnect';
const DEFAULT_AGENT_TAB_CLOSE_SECONDS = 90;
const RECONNECT_DELAY_MS = 5000;
const KEEPALIVE_MS = 20000;
const INITIAL_SETTLE_MIN_MS = 400;
const INITIAL_SETTLE_QUIET_MS = 500;
const INITIAL_SETTLE_MAX_MS = 3000;
const SCROLL_SETTLE_MIN_MS = 200;
const SCROLL_SETTLE_QUIET_MS = 350;
const SCROLL_SETTLE_MAX_MS = 1200;
const BOTTOM_SETTLE_MIN_MS = 350;
const BOTTOM_SETTLE_QUIET_MS = 500;
const SCROLL_RETURN_MAX_MS = 3000;
const SCROLL_STEP_VIEWPORTS = 1.7;
const SCROLL_MAX_STEPS = 40;
const SCROLL_MAX_MS = 18000;
const MAX_DOCUMENT_RETRIES = 3;
const AGENT_OPERATION_MAX_MS = 60000;

let socket = null;
let socketAuthenticated = false;
let keepaliveTimer = null;
let reconnectTimer = null;
let handshake = null;
let allowedHosts = [];
let allowedPaths = {};
let agentTabCloseSeconds = DEFAULT_AGENT_TAB_CLOSE_SECONDS;
let closeAfterScrape = false;
let agentOperationQueue = Promise.resolve();
let agentOperationActive = false;

class UnavailablePageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnavailablePageError';
  }
}

class TransientDocumentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TransientDocumentError';
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isTransientDocumentError(error) {
  if (error instanceof TransientDocumentError) {
    return true;
  }

  const text = (error instanceof Error ? error.message : String(error)).toLowerCase();

  return [
    'frame with id 0 was removed',
    'frame 0 was removed',
    'frame was removed',
    'the frame was removed',
    'document was unloaded',
    'no document with id',
    'no frame with id 0',
    'document was discarded'
  ].some(fragment => text.includes(fragment));
}

function remainingOperationMs(deadlineAt) {
  const remaining = deadlineAt - Date.now();

  if (remaining <= 0) {
    throw new Error('Savage MCP browser operation exceeded the 60 second retry deadline.');
  }

  return remaining;
}

function enqueueAgentOperation(operation) {
  const run = async () => {
    agentOperationActive = true;
    await chrome.alarms.clear(AGENT_TAB_CLOSE_ALARM);

    try {
      return await operation();
    } finally {
      agentOperationActive = false;
    }
  };

  const result = agentOperationQueue.then(run, run);
  agentOperationQueue = result.catch(() => {});
  return result;
}

function normalizedBridgePort(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 1024 && numeric <= 65535
    ? numeric
    : MCP_DEFAULTS.bridgePort;
}

function normalizedBottomConfirmationPasses(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 5
    ? numeric
    : MCP_DEFAULTS.bottomConfirmationPasses;
}

function normalizedBottomConfirmationMaxMs(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 500 && numeric <= 10000
    ? numeric
    : MCP_DEFAULTS.bottomConfirmationMaxMs;
}

function normalizedCloseSeconds(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 30 && numeric <= 3600
    ? numeric
    : DEFAULT_AGENT_TAB_CLOSE_SECONDS;
}

function normalizeHostPattern(pattern) {
  const normalized = String(pattern || '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');

  if (!normalized || normalized.includes('://') || normalized.includes('/') || normalized.includes(':')) {
    throw new Error(`Invalid host pattern: ${pattern}`);
  }

  if (normalized === '*' || normalized === '*.*') {
    throw new Error('Global wildcard host patterns are not allowed.');
  }

  const wildcard = normalized.startsWith('*.');
  const hostname = wildcard ? normalized.slice(2) : normalized;

  if (!hostname || hostname.includes('*')) {
    throw new Error(`Invalid host wildcard pattern: ${pattern}`);
  }

  return wildcard ? `*.${hostname}` : hostname;
}

function normalizeHostPatterns(patterns) {
  if (!Array.isArray(patterns)) {
    throw new Error('allowedHosts must be an array.');
  }

  return [...new Set(patterns.map(normalizeHostPattern))];
}

function hostPatternMatches(hostname, pattern) {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2);
    return hostname !== suffix && hostname.endsWith(`.${suffix}`);
  }

  return hostname === pattern;
}

function matchingHostPattern(hostname) {
  const normalizedHostname = String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');

  if (!normalizedHostname) {
    return null;
  }

  const matches = allowedHosts.filter(pattern =>
    hostPatternMatches(normalizedHostname, pattern)
  );

  matches.sort((a, b) => {
    const aExact = a.startsWith('*.') ? 0 : 1;
    const bExact = b.startsWith('*.') ? 0 : 1;

    if (aExact !== bExact) {
      return bExact - aExact;
    }

    return b.length - a.length;
  });

  return matches[0] ?? null;
}

function isHostnameAllowed(hostname) {
  return matchingHostPattern(hostname) !== null;
}

function normalizePathPattern(pattern) {
  if (typeof pattern !== 'string') {
    throw new Error('Path patterns must be strings.');
  }

  const normalized = pattern.trim();

  if (!normalized || !normalized.startsWith('/')) {
    throw new Error(`Path pattern must start with "/": ${pattern}`);
  }

  if (normalized.includes('?') || normalized.includes('#')) {
    throw new Error(`Path pattern must not contain a query or fragment: ${pattern}`);
  }

  if (normalized.endsWith('/**')) {
    const base = normalized.slice(0, -3);

    if (base.includes('*')) {
      throw new Error(`Only a trailing /** wildcard is supported in path patterns: ${pattern}`);
    }
  } else if (normalized.includes('*')) {
    throw new Error(`Only a trailing /** wildcard is supported in path patterns: ${pattern}`);
  }

  return normalized;
}

function normalizeAllowedPaths(value, hostPatterns) {
  if (value == null) {
    return {};
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('allowedPaths must be an object keyed by allowed host pattern.');
  }

  const hostSet = new Set(hostPatterns);
  const entries = [];

  for (const [rawHostPattern, pathPatterns] of Object.entries(value)) {
    const hostPattern = normalizeHostPattern(rawHostPattern);

    if (!hostSet.has(hostPattern)) {
      throw new Error(`allowedPaths key must also appear in allowedHosts: ${hostPattern}`);
    }

    if (!Array.isArray(pathPatterns)) {
      throw new Error(`allowedPaths[${JSON.stringify(hostPattern)}] must be an array.`);
    }

    entries.push([
      hostPattern,
      [...new Set(pathPatterns.map(normalizePathPattern))]
    ]);
  }

  return Object.fromEntries(entries);
}

function isPathAllowed(pathname, pathPatterns) {
  if (!Array.isArray(pathPatterns) || pathPatterns.length === 0) {
    return true;
  }

  return pathPatterns.some(pattern => {
    if (!pattern.endsWith('/**')) {
      return pathname === pattern;
    }

    const base = pattern.slice(0, -3);
    return !base || pathname === base || pathname.startsWith(`${base}/`);
  });
}

function assertAllowedUrl(rawUrl) {
  let url;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only http:// and https:// URLs are supported by Savage MCP.');
  }

  const hostPattern = matchingHostPattern(url.hostname);

  if (!hostPattern) {
    throw new Error(`Host is not allowed by Savage MCP: ${url.hostname}`);
  }

  if (!isPathAllowed(url.pathname, allowedPaths[hostPattern])) {
    throw new Error(`Path is not allowed by Savage MCP for ${hostPattern}: ${url.pathname}`);
  }

  return url;
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

  if (protectedPrefixes.some(prefix => normalizedUrl.startsWith(prefix))) {
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
  const text = error instanceof Error ? error.message : String(error);

  return [
    'Cannot access a chrome:// URL',
    'Cannot access a chrome-extension:// URL',
    'Cannot access contents of url',
    'The extensions gallery cannot be scripted',
    'Missing host permission for the tab'
  ].some(fragment => text.includes(fragment));
}

async function hasMcpHostPermission() {
  return await chrome.permissions.contains({
    origins: MCP_PERMISSION_ORIGINS
  });
}

async function getMcpSettings() {
  const stored = await chrome.storage.local.get(MCP_DEFAULTS);

  return {
    mcpEnabled: Boolean(stored.mcpEnabled),
    bridgeToken: String(stored.bridgeToken || '').trim(),
    bridgePort: normalizedBridgePort(stored.bridgePort)
  };
}

async function getMcpScrollSettings() {
  const stored = await chrome.storage.local.get(MCP_DEFAULTS);

  return {
    bottomConfirmationPasses: normalizedBottomConfirmationPasses(
      stored.bottomConfirmationPasses
    ),
    bottomConfirmationMaxMs: normalizedBottomConfirmationMaxMs(
      stored.bottomConfirmationMaxMs
    )
  };
}

async function getMainDocumentIdentity(tabId) {
  const injectionResults = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.location.href
  });

  const mainResult = injectionResults?.[0];

  if (!mainResult?.documentId) {
    throw new TransientDocumentError('Could not identify the current main document.');
  }

  return {
    documentId: mainResult.documentId,
    url: String(mainResult.result || '')
  };
}

async function assertAgentTabAllowed(rawUrl) {
  try {
    return assertAllowedUrl(rawUrl);
  } catch (error) {
    await closeAgentTab();
    throw error;
  }
}

async function executeScraper(tab, settings, documentId) {
  const protectedReason = protectedPageReason(tab.url);

  if (protectedReason) {
    throw new UnavailablePageError(protectedReason);
  }

  try {
    await chrome.scripting.executeScript({
      target: {
        tabId: tab.id,
        documentIds: [documentId]
      },
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
      target: {
        tabId: tab.id,
        documentIds: [documentId]
      },
      world: 'MAIN',
      files: ['scraper-main.js']
    });

    const output = injectionResults?.[0]?.result;

    if (typeof output !== 'string') {
      throw new Error('Scraper returned no text.');
    }

    return output;
  } catch (error) {
    if (isTransientDocumentError(error)) {
      throw error;
    }

    if (isInjectionAccessError(error)) {
      throw new UnavailablePageError('Chrome does not allow Savage Scraper to access this page.');
    }

    throw error;
  }
}

async function lazyLoadMainPage(tabId, documentId, operationMaxMs, scrollSettings) {
  await chrome.scripting.executeScript({
    target: {
      tabId,
      documentIds: [documentId]
    },
    world: 'MAIN',
    func: async ({
      initialMinMs,
      initialQuietMs,
      initialMaxMs,
      scrollMinMs,
      scrollQuietMs,
      scrollMaxWaitMs,
      bottomMinMs,
      bottomQuietMs,
      bottomMaxMs,
      bottomPasses,
      returnMaxMs,
      stepViewports,
      maxSteps,
      scrollMaxMs,
      operationMaxMs
    }) => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
      const operationStartedAt = performance.now();
      let lastActivityAt = operationStartedAt;
      let lastHeight = document.documentElement.scrollHeight;
      let initialX = null;
      let initialY = null;

      function markActivity() {
        lastActivityAt = performance.now();
      }

      const mutationObserver = new MutationObserver(markActivity);
      mutationObserver.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: [
          'class',
          'style',
          'hidden',
          'aria-hidden',
          'aria-busy',
          'open'
        ]
      });

      let resourceObserver = null;

      try {
        resourceObserver = new PerformanceObserver(list => {
          if (list.getEntries().some(entry =>
            entry.initiatorType === 'fetch' ||
            entry.initiatorType === 'xmlhttprequest'
          )) {
            markActivity();
          }
        });
        resourceObserver.observe({
          type: 'resource',
          buffered: false
        });
      } catch {
        // Resource Timing observation is an enhancement; DOM/height settling still works.
      }

      async function waitForQuiet(minMs, quietMs, maxWaitMs) {
        const startedAt = performance.now();
        const boundedMaxMs = Math.max(0, maxWaitMs);

        if (boundedMaxMs === 0) {
          return;
        }

        lastActivityAt = startedAt;
        lastHeight = document.documentElement.scrollHeight;

        while (true) {
          const now = performance.now();
          const currentHeight = document.documentElement.scrollHeight;

          if (Math.abs(currentHeight - lastHeight) > 1) {
            lastHeight = currentHeight;
            lastActivityAt = now;
          }

          const elapsed = now - startedAt;

          if (
            elapsed >= minMs &&
            now - lastActivityAt >= quietMs
          ) {
            return;
          }

          if (elapsed >= boundedMaxMs) {
            return;
          }

          await wait(Math.min(
            50,
            Math.max(1, boundedMaxMs - elapsed)
          ));
        }
      }

      async function restoreScrollPosition(targetX, targetY) {
        const restoreStartedAt = performance.now();

        window.scrollTo({
          top: targetY,
          left: targetX,
          behavior: 'instant'
        });

        while (
          Math.abs(window.scrollY - targetY) > 2 &&
          performance.now() - restoreStartedAt < returnMaxMs
        ) {
          await nextFrame();
        }

        window.scrollTo({
          top: targetY,
          left: targetX,
          behavior: 'instant'
        });
        await nextFrame();
      }

      try {
        const initialBudgetMs = Math.min(
          initialMaxMs,
          Math.max(0, operationMaxMs)
        );

        await waitForQuiet(
          initialMinMs,
          initialQuietMs,
          initialBudgetMs
        );

        initialX = window.scrollX;
        initialY = window.scrollY;

        const elapsedBeforeScroll = performance.now() - operationStartedAt;
        const scrollBudgetMs = Math.min(
          scrollMaxMs,
          Math.max(0, operationMaxMs - elapsedBeforeScroll)
        );
        const scrollStartedAt = performance.now();
        const step = Math.max(
          600,
          Math.floor(window.innerHeight * stepViewports)
        );
        let previousHeight = document.documentElement.scrollHeight;
        let stableBottomPasses = 0;

        for (
          let i = 0;
          i < maxSteps && performance.now() - scrollStartedAt < scrollBudgetMs;
          i += 1
        ) {
          const beforeHeight = document.documentElement.scrollHeight;
          const maxY = Math.max(0, beforeHeight - window.innerHeight);
          const nextY = Math.min(maxY, window.scrollY + step);
          const apparentBottom = nextY >= maxY - 2;

          window.scrollTo({
            top: nextY,
            left: initialX,
            behavior: 'instant'
          });

          const remainingScrollMs = Math.max(
            0,
            scrollBudgetMs - (performance.now() - scrollStartedAt)
          );

          if (apparentBottom) {
            await waitForQuiet(
              bottomMinMs,
              bottomQuietMs,
              Math.min(bottomMaxMs, remainingScrollMs)
            );
          } else {
            await waitForQuiet(
              scrollMinMs,
              scrollQuietMs,
              Math.min(scrollMaxWaitMs, remainingScrollMs)
            );
          }

          const afterHeight = document.documentElement.scrollHeight;
          const atBottom = window.scrollY + window.innerHeight >= afterHeight - 4;

          if (atBottom && afterHeight <= previousHeight + 1) {
            stableBottomPasses += 1;
          } else {
            stableBottomPasses = 0;
          }

          previousHeight = Math.max(beforeHeight, afterHeight);

          if (stableBottomPasses >= bottomPasses) {
            break;
          }
        }
      } finally {
        mutationObserver.disconnect();
        resourceObserver?.disconnect();

        if (initialX !== null && initialY !== null) {
          await restoreScrollPosition(initialX, initialY);
        }
      }
    },
    args: [{
      initialMinMs: INITIAL_SETTLE_MIN_MS,
      initialQuietMs: INITIAL_SETTLE_QUIET_MS,
      initialMaxMs: INITIAL_SETTLE_MAX_MS,
      scrollMinMs: SCROLL_SETTLE_MIN_MS,
      scrollQuietMs: SCROLL_SETTLE_QUIET_MS,
      scrollMaxWaitMs: SCROLL_SETTLE_MAX_MS,
      bottomMinMs: BOTTOM_SETTLE_MIN_MS,
      bottomQuietMs: BOTTOM_SETTLE_QUIET_MS,
      bottomMaxMs: scrollSettings.bottomConfirmationMaxMs,
      bottomPasses: scrollSettings.bottomConfirmationPasses,
      returnMaxMs: SCROLL_RETURN_MAX_MS,
      stepViewports: SCROLL_STEP_VIEWPORTS,
      maxSteps: SCROLL_MAX_STEPS,
      scrollMaxMs: SCROLL_MAX_MS,
      operationMaxMs
    }]
  });
}

async function getStoredAgentTabId() {
  const stored = await chrome.storage.session.get({ agentTabId: null });
  return Number.isInteger(stored.agentTabId) ? stored.agentTabId : null;
}

async function setStoredAgentTabId(tabId) {
  await chrome.storage.session.set({ agentTabId: tabId });
}

async function clearStoredAgentTabId() {
  await chrome.storage.session.remove('agentTabId');
  await chrome.alarms.clear(AGENT_TAB_CLOSE_ALARM);
}

async function getAgentTab() {
  const tabId = await getStoredAgentTabId();

  if (!tabId) {
    return null;
  }

  try {
    return await chrome.tabs.get(tabId);
  } catch {
    await clearStoredAgentTabId();
    return null;
  }
}

async function closeAgentTab() {
  const tab = await getAgentTab();

  if (!tab?.id) {
    return;
  }

  try {
    await chrome.tabs.remove(tab.id);
  } catch {
    // The tab may already be closed.
  }

  await clearStoredAgentTabId();
}

async function armAgentTabClose() {
  const tab = await getAgentTab();

  if (!tab?.id) {
    return;
  }

  await chrome.alarms.create(AGENT_TAB_CLOSE_ALARM, {
    when: Date.now() + normalizedCloseSeconds(agentTabCloseSeconds) * 1000
  });
}

async function finishAgentTabAfterScrape(succeeded) {
  if (succeeded && closeAfterScrape) {
    await closeAgentTab();
    return;
  }

  await armAgentTabClose();
}

async function waitForTabComplete(tabId, timeoutMs = 30000) {
  const initial = await chrome.tabs.get(tabId);

  if (initial.status === 'complete') {
    return;
  }

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Timed out waiting for the Chrome tab to finish loading.'));
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function withAgentTabSelected(tab, operation) {
  const [previousActiveTab] = await chrome.tabs.query({
    active: true,
    windowId: tab.windowId
  });

  if (previousActiveTab?.id !== tab.id) {
    await chrome.tabs.update(tab.id, { active: true });
  }

  try {
    return await operation();
  } finally {
    if (previousActiveTab?.id && previousActiveTab.id !== tab.id) {
      try {
        await chrome.tabs.update(previousActiveTab.id, { active: true });
      } catch {
        // The user's previous tab may have been closed while the scrape ran.
      }
    }
  }
}

async function ensureAgentTab(url, deadlineAt) {
  let tab = await getAgentTab();

  if (tab?.id) {
    tab = await chrome.tabs.update(tab.id, { url });
  } else {
    tab = await chrome.tabs.create({
      url,
      active: false
    });
    await setStoredAgentTabId(tab.id);
  }

  await waitForTabComplete(
    tab.id,
    Math.min(30000, remainingOperationMs(deadlineAt))
  );
  return await chrome.tabs.get(tab.id);
}

async function performAgentScrape(tab, deadlineAt) {
  if (!(await hasMcpHostPermission())) {
    throw new Error('MCP website access is not enabled in Savage Scraper options.');
  }

  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  const scrollSettings = await getMcpScrollSettings();

  for (let retry = 0; retry <= MAX_DOCUMENT_RETRIES; retry += 1) {
    remainingOperationMs(deadlineAt);

    let currentTab = await chrome.tabs.get(tab.id);
    await assertAgentTabAllowed(currentTab.url);

    try {
      await waitForTabComplete(
        currentTab.id,
        Math.min(30000, remainingOperationMs(deadlineAt))
      );

      currentTab = await chrome.tabs.get(currentTab.id);
      await assertAgentTabAllowed(currentTab.url);

      const identity = await getMainDocumentIdentity(currentTab.id);
      await assertAgentTabAllowed(identity.url);

      return await withAgentTabSelected(currentTab, async () => {
        await lazyLoadMainPage(
          currentTab.id,
          identity.documentId,
          remainingOperationMs(deadlineAt),
          scrollSettings
        );

        remainingOperationMs(deadlineAt);

        const afterScrollIdentity = await getMainDocumentIdentity(currentTab.id);

        if (afterScrollIdentity.documentId !== identity.documentId) {
          throw new TransientDocumentError(
            'The main document changed during Savage Scraper processing.'
          );
        }

        await assertAgentTabAllowed(afterScrollIdentity.url);

        return await executeScraper(
          {
            ...currentTab,
            url: afterScrollIdentity.url
          },
          settings,
          identity.documentId
        );
      });
    } catch (error) {
      if (!isTransientDocumentError(error) || retry >= MAX_DOCUMENT_RETRIES) {
        throw error;
      }

      await waitForTabComplete(
        tab.id,
        Math.min(30000, remainingOperationMs(deadlineAt))
      );
    }
  }

  throw new Error('Savage Scraper exhausted its document retry budget.');
}

async function handleOpen(url) {
  if (!(await hasMcpHostPermission())) {
    throw new Error('MCP website access is not enabled in Savage Scraper options.');
  }

  const parsedUrl = assertAllowedUrl(url);
  const deadlineAt = Date.now() + AGENT_OPERATION_MAX_MS;
  let scrapeSucceeded = false;

  try {
    const tab = await ensureAgentTab(parsedUrl.href, deadlineAt);
    const output = await performAgentScrape(tab, deadlineAt);
    const finalTab = await chrome.tabs.get(tab.id);

    const result = {
      content: output,
      url: finalTab.url || parsedUrl.href,
      title: finalTab.title || ''
    };

    scrapeSucceeded = true;
    return result;
  } finally {
    await finishAgentTabAfterScrape(scrapeSucceeded);
  }
}

async function handleScrape() {
  const tab = await getAgentTab();

  if (!tab?.id) {
    throw new Error('No Savage MCP agent tab exists. Call savage_open first.');
  }

  const deadlineAt = Date.now() + AGENT_OPERATION_MAX_MS;
  let scrapeSucceeded = false;

  try {
    const output = await performAgentScrape(tab, deadlineAt);
    const finalTab = await chrome.tabs.get(tab.id);

    const result = {
      content: output,
      url: finalTab.url || '',
      title: finalTab.title || ''
    };

    scrapeSucceeded = true;
    return result;
  } finally {
    await finishAgentTabAfterScrape(scrapeSucceeded);
  }
}

async function handleStatus() {
  const settings = await getMcpSettings();
  const agentTab = await getAgentTab();
  const permissionGranted = await hasMcpHostPermission();

  return {
    mcpEnabled: settings.mcpEnabled,
    permissionGranted,
    bridgeAuthenticated: socketAuthenticated,
    bridgePort: settings.bridgePort,
    allowedHosts,
    allowedPaths,
    closeAfterScrape,
    agentTab: agentTab?.id
      ? {
          id: agentTab.id,
          url: agentTab.url || null,
          title: agentTab.title || null
        }
      : null
  };
}

function hexFromBytes(bytes) {
  return [...new Uint8Array(bytes)]
    .map(value => value.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacHex(token, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(token),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return hexFromBytes(signature);
}

function constantTimeStringEqual(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;

  for (let i = 0; i < length; i += 1) {
    difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }

  return difference === 0;
}

function stopKeepalive() {
  if (keepaliveTimer !== null) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
}

function startKeepalive() {
  stopKeepalive();

  keepaliveTimer = setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'keepalive',
        at: Date.now()
      }));
    }
  }, KEEPALIVE_MS);
}

function clearReconnectTimer() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

async function scheduleReconnectAlarm(enabled) {
  if (enabled) {
    await chrome.alarms.create(BRIDGE_RECONNECT_ALARM, {
      delayInMinutes: 0.5,
      periodInMinutes: 0.5
    });
  } else {
    await chrome.alarms.clear(BRIDGE_RECONNECT_ALARM);
  }
}

function scheduleReconnect() {
  clearReconnectTimer();

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    await chrome.runtime.getPlatformInfo();
    await refreshBridgeConnection();
  }, RECONNECT_DELAY_MS);
}

function closeBridgeSocket() {
  clearReconnectTimer();
  stopKeepalive();
  socketAuthenticated = false;
  handshake = null;

  if (socket) {
    try {
      socket.close(1000, 'MCP disabled or settings changed');
    } catch {
      // Ignore close failures.
    }
    socket = null;
  }
}

async function handleSocketMessage(event, settings) {
  let message;

  try {
    message = JSON.parse(event.data);
  } catch {
    socket?.close(4002, 'Invalid JSON');
    return;
  }

  if (message.type === 'hello_request') {
    const clientNonce = String(message.clientNonce || '');

    if (!clientNonce) {
      socket?.close(4003, 'Invalid handshake');
      return;
    }

    handshake = {
      clientNonce,
      serverNonce: null
    };

    socket.send(JSON.stringify({
      type: 'hello',
      clientNonce,
      extensionId: chrome.runtime.id,
      extensionVersion: chrome.runtime.getManifest().version
    }));
    return;
  }

  if (message.type === 'challenge') {
    if (!handshake || message.clientNonce !== handshake.clientNonce) {
      socket?.close(4003, 'Invalid handshake');
      return;
    }

    const serverNonce = String(message.serverNonce || '');
    const expectedProof = await hmacHex(
      settings.bridgeToken,
      `server:${handshake.clientNonce}:${serverNonce}`
    );

    if (!constantTimeStringEqual(expectedProof, message.proof)) {
      socket?.close(4004, 'Bridge authentication failed');
      return;
    }

    handshake.serverNonce = serverNonce;

    socket.send(JSON.stringify({
      type: 'auth',
      proof: await hmacHex(
        settings.bridgeToken,
        `client:${handshake.clientNonce}:${serverNonce}`
      )
    }));
    return;
  }

  if (message.type === 'authenticated') {
    socketAuthenticated = true;
    startKeepalive();
    return;
  }

  if (message.type === 'config') {
    if (!socketAuthenticated) {
      return;
    }

    const nextAllowedHosts = normalizeHostPatterns(message.allowedHosts || []);
    const nextAllowedPaths = normalizeAllowedPaths(message.allowedPaths || {}, nextAllowedHosts);

    allowedHosts = nextAllowedHosts;
    allowedPaths = nextAllowedPaths;
    agentTabCloseSeconds = normalizedCloseSeconds(message.agentTabCloseSeconds);
    closeAfterScrape = message.closeAfterScrape === true;

    if (!agentOperationActive) {
      await armAgentTabClose();
    }

    return;
  }

  if (message.type === 'request') {
    if (!socketAuthenticated || typeof message.id !== 'string') {
      return;
    }

    try {
      let result;

      switch (message.action) {
        case 'open':
          result = await enqueueAgentOperation(
            () => handleOpen(message.payload?.url)
          );
          break;
        case 'scrape':
          result = await enqueueAgentOperation(
            () => handleScrape()
          );
          break;
        case 'status':
          result = await handleStatus();
          break;
        default:
          throw new Error(`Unsupported Savage MCP action: ${message.action}`);
      }

      socket.send(JSON.stringify({
        type: 'response',
        id: message.id,
        ok: true,
        result
      }));
    } catch (error) {
      socket.send(JSON.stringify({
        type: 'response',
        id: message.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }
}

async function refreshBridgeConnection() {
  const settings = await getMcpSettings();
  const permissionGranted = await hasMcpHostPermission();
  const shouldConnect =
    settings.mcpEnabled &&
    permissionGranted &&
    settings.bridgeToken.length >= 32;

  await scheduleReconnectAlarm(shouldConnect);

  if (!shouldConnect) {
    allowedHosts = [];
    allowedPaths = {};
    closeBridgeSocket();
    await closeAgentTab();
    return;
  }

  if (
    socket &&
    [WebSocket.CONNECTING, WebSocket.OPEN].includes(socket.readyState)
  ) {
    return;
  }

  closeBridgeSocket();

  const nextSocket = new WebSocket(
    `ws://127.0.0.1:${settings.bridgePort}`
  );
  socket = nextSocket;

  nextSocket.onopen = () => {
    socketAuthenticated = false;
    handshake = null;
  };

  nextSocket.onmessage = event => {
    void handleSocketMessage(event, settings).catch(error => {
      console.error('[Savage Scraper MCP]', error);
      nextSocket.close(4000, 'Protocol error');
    });
  };

  nextSocket.onerror = () => {
    // onclose handles retry scheduling.
  };

  nextSocket.onclose = () => {
    if (socket === nextSocket) {
      socket = null;
      socketAuthenticated = false;
      handshake = null;
      allowedHosts = [];
      stopKeepalive();
      scheduleReconnect();
    }
  };
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === AGENT_TAB_CLOSE_ALARM && !agentOperationActive) {
    void closeAgentTab();
  }

  if (alarm.name === BRIDGE_RECONNECT_ALARM && !socketAuthenticated) {
    void refreshBridgeConnection();
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  void getStoredAgentTabId().then(agentTabId => {
    if (tabId === agentTabId) {
      void clearStoredAgentTabId();
    }
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === 'local' &&
    ['mcpEnabled', 'bridgeToken', 'bridgePort'].some(key => key in changes)
  ) {
    closeBridgeSocket();
    void refreshBridgeConnection();
  }
});

chrome.permissions.onRemoved.addListener(() => {
  void refreshBridgeConnection();
});

chrome.permissions.onAdded.addListener(() => {
  void refreshBridgeConnection();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'SAVAGE_MCP_OPTIONS_STATUS') {
    return undefined;
  }

  void handleStatus()
    .then(sendResponse)
    .catch(error => sendResponse({
      error: error instanceof Error ? error.message : String(error)
    }));

  return true;
});

chrome.runtime.onStartup.addListener(() => {
  void refreshBridgeConnection();
});

chrome.runtime.onInstalled.addListener(() => {
  void refreshBridgeConnection();
});

void refreshBridgeConnection();
