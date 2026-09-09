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

const bridgePort = document.getElementById('bridgePort');
const bridgeToken = document.getElementById('bridgeToken');
const bottomConfirmationPasses = document.getElementById('bottomConfirmationPasses');
const bottomConfirmationMaxMs = document.getElementById('bottomConfirmationMaxMs');
const saveButton = document.getElementById('saveButton');
const enableButton = document.getElementById('enableButton');
const disableButton = document.getElementById('disableButton');
const message = document.getElementById('message');
const statusEnabled = document.getElementById('statusEnabled');
const statusPermission = document.getElementById('statusPermission');
const statusBridge = document.getElementById('statusBridge');
const statusTab = document.getElementById('statusTab');

function normalizedPort() {
  const value = Number(bridgePort.value);

  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    throw new Error('Bridge port must be between 1024 and 65535.');
  }

  return value;
}

function normalizedToken() {
  const value = bridgeToken.value.trim();

  if (value.length < 32) {
    throw new Error('Bridge token must contain at least 32 characters.');
  }

  return value;
}

function normalizedBottomConfirmationPasses() {
  const value = Number(bottomConfirmationPasses.value);

  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error('Bottom confirmation passes must be between 1 and 5.');
  }

  return value;
}

function normalizedBottomConfirmationMaxMs() {
  const value = Number(bottomConfirmationMaxMs.value);

  if (!Number.isInteger(value) || value < 500 || value > 10000) {
    throw new Error('Bottom confirmation maximum wait must be between 500 and 10000 ms.');
  }

  return value;
}

function setMessage(text, isError = false) {
  message.textContent = text;
  message.style.color = isError ? 'crimson' : '';
}

async function saveMcpSettings() {
  await chrome.storage.local.set({
    bridgePort: normalizedPort(),
    bridgeToken: normalizedToken(),
    bottomConfirmationPasses: normalizedBottomConfirmationPasses(),
    bottomConfirmationMaxMs: normalizedBottomConfirmationMaxMs()
  });
}

async function refreshStatus() {
  const stored = await chrome.storage.local.get(MCP_DEFAULTS);
  const permissionGranted = await chrome.permissions.contains({
    origins: MCP_PERMISSION_ORIGINS
  });

  let runtimeStatus = null;

  try {
    runtimeStatus = await chrome.runtime.sendMessage({
      type: 'SAVAGE_MCP_OPTIONS_STATUS'
    });
  } catch {
    // The service worker may be restarting; local settings still render below.
  }

  statusEnabled.textContent = stored.mcpEnabled ? 'Yes' : 'No';
  statusPermission.textContent = permissionGranted ? 'Yes' : 'No';
  statusBridge.textContent = runtimeStatus?.bridgeAuthenticated ? 'Yes' : 'No';
  statusTab.textContent = runtimeStatus?.agentTab?.url || 'None';
}

async function initialize() {
  const stored = await chrome.storage.local.get(MCP_DEFAULTS);
  bridgePort.value = String(stored.bridgePort || MCP_DEFAULTS.bridgePort);
  bridgeToken.value = stored.bridgeToken || '';
  bottomConfirmationPasses.value = String(
    stored.bottomConfirmationPasses ?? MCP_DEFAULTS.bottomConfirmationPasses
  );
  bottomConfirmationMaxMs.value = String(
    stored.bottomConfirmationMaxMs ?? MCP_DEFAULTS.bottomConfirmationMaxMs
  );
  await refreshStatus();
}

saveButton.addEventListener('click', async () => {
  try {
    await saveMcpSettings();
    setMessage('MCP settings saved.');
    await refreshStatus();
  } catch (error) {
    setMessage(error.message, true);
  }
});

enableButton.addEventListener('click', async () => {
  try {
    await saveMcpSettings();

    const granted = await chrome.permissions.request({
      origins: MCP_PERMISSION_ORIGINS
    });

    if (!granted) {
      throw new Error('Chrome website access was not granted.');
    }

    await chrome.storage.local.set({ mcpEnabled: true });
    setMessage('MCP integration enabled. Start savage_mcp if it is not already running.');
    await refreshStatus();
  } catch (error) {
    setMessage(error.message, true);
  }
});

disableButton.addEventListener('click', async () => {
  try {
    await chrome.storage.local.set({ mcpEnabled: false });
    await chrome.permissions.remove({
      origins: MCP_PERMISSION_ORIGINS
    });
    setMessage('MCP integration disabled. Manual Savage Scraper behavior is unchanged.');
    await refreshStatus();
  } catch (error) {
    setMessage(error.message, true);
  }
});

void initialize();
