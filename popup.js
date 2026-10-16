'use strict';

const MESSAGE_NAMESPACE = 'DOT_PET_DOCK';
const MIN_SCALE_PERCENT = 50;
const MAX_SCALE_PERCENT = 500;

const $ = (id) => document.getElementById(id);
const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

let activeTabId = null;
let tabSupported = false;
let connected = false;
let state = {
  ok: true,
  selected: false,
  saved: false,
  locked: false,
  scale: 1,
  picking: false
};
let busy = { find: false, pick: false, lock: false, reset: false, animation: false };
let animationPollTimer = 0;
let messageEpoch = 0;
let lastRequestedScale = null;

class DockMessageError extends Error {
  constructor(message, transport = false) {
    super(message);
    this.name = 'DockMessageError';
    this.transport = transport;
  }
}

function isSupportedUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'chatgpt.com';
  } catch (_) {
    return false;
  }
}

function errorText(error) {
  const message = String(error?.message || error || '').trim();
  if (!message || message === 'undefined') {
    return 'Dot Pet Dock could not reach this ChatGPT tab. Reload the tab and try again.';
  }
  if (/receiving end does not exist|could not establish connection/i.test(message)) {
    return 'Reload this ChatGPT tab to reconnect Dot Pet Dock.';
  }
  return message;
}

function scaleValue(value) {
  const numeric = Number(value);
  const percent = Number.isFinite(numeric)
    ? clamp(Math.round(numeric * 100), MIN_SCALE_PERCENT, MAX_SCALE_PERCENT)
    : 100;
  return percent / 100;
}

function normalizeState(value) {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    ok: raw.ok !== false,
    selected: !!raw.selected,
    saved: !!raw.saved,
    locked: !!raw.locked,
    scale: scaleValue(raw.scale),
    picking: !!raw.picking,
    animationAvailable: !!raw.animationAvailable,
    playing: Object.hasOwn(globalThis.DotPetDockAnimations.clips, raw.playing) ? raw.playing : null,
    error: raw.error ? String(raw.error) : '',
    notice: raw.notice ? String(raw.notice) : ''
  };
}

function setStatus(message, kind = 'ready') {
  const status = $('status');
  status.textContent = message;
  status.dataset.kind = kind;
}

function statusForState() {
  if (!tabSupported) {
    return { message: 'This tab is not a supported ChatGPT page.', kind: 'unsupported' };
  }
  if (!connected) {
    return { message: 'Reload this ChatGPT tab to connect Dot Pet Dock.', kind: 'error' };
  }
  if (state.error) return { message: state.error, kind: 'error' };
  if (state.notice) return { message: state.notice, kind: 'ready' };
  if (state.picking) {
    return { message: 'Click the pet on the page to select it. Press Esc to cancel.', kind: 'ready' };
  }
  if (state.selected) {
    return {
      message: state.locked
        ? 'Pet docked. Uncheck Lock below to edit the handles.'
        : 'Pet selected. Drag the Move handle to reposition it.',
      kind: 'ready'
    };
  }
  if (state.saved) {
    return {
      message: 'Saved settings are waiting for this pet. Navigate to a conversation where it appears or pick it again.',
      kind: 'waiting'
    };
  }
  return { message: 'No pet selected yet. Find it automatically or pick it on the page.', kind: 'ready' };
}

function renderControls() {
  const canMessage = tabSupported && connected;
  const percent = Math.round(state.scale * 100);
  const find = $('find');
  const pick = $('pick');
  const scale = $('scale');
  const lock = $('lock');
  const reset = $('reset');

  find.disabled = !canMessage || state.picking || busy.find;
  pick.disabled = !canMessage || state.picking || busy.pick;
  find.textContent = busy.find ? 'Looking for pet…' : 'Find pet automatically';
  pick.textContent = busy.pick ? 'Opening picker…' : 'Pick pet on page';

  scale.disabled = !canMessage || !state.selected;
  scale.value = String(percent);
  scale.setAttribute('aria-valuenow', String(percent));
  $('scale-output').value = `${percent}%`;

  lock.disabled = !canMessage || !state.selected || busy.lock;
  lock.checked = state.locked;
  reset.disabled = !canMessage || !state.saved || busy.reset;
  reset.textContent = busy.reset ? 'Restoring…' : 'Restore original display';
  renderAnimations();
}

function renderAnimations() {
  const available = tabSupported && connected && state.selected && state.animationAvailable && !state.picking;
  $('animation-clip').disabled = !available || busy.animation;
  $('animation-play').disabled = !available || busy.animation;
  $('animation-stop').disabled = !available || !state.playing || busy.animation;
  const label = globalThis.DotPetDockAnimations.clips[state.playing]?.label;
  $('animation-status').textContent = !available ? 'Select a supported pet to play animations.'
    : label ? `Playing ${label}…` : 'Plays once, then returns to live activity.';
  clearTimeout(animationPollTimer);
  if (state.playing) {
    animationPollTimer = setTimeout(async () => {
      const epoch = messageEpoch;
      try {
        const response = await send('STATE');
        if (epoch !== messageEpoch) return;
        state.playing = response.playing;
        state.animationAvailable = !!response.animationAvailable;
        renderAnimations();
      } catch (_) {
        if (epoch !== messageEpoch) return;
        state.playing = null; renderAnimations();
      }
    }, 150);
  }
}

function draw(nextState = state) {
  state = normalizeState(nextState);
  renderControls();
  const status = statusForState();
  setStatus(status.message, status.kind);
}

function showError(error) {
  setStatus(errorText(error), 'error');
}

async function send(action, extra = {}) {
  if (activeTabId == null) {
    throw new DockMessageError('No supported ChatGPT tab is active.', true);
  }

  let response;
  try {
    response = await chrome.tabs.sendMessage(activeTabId, {
      namespace: MESSAGE_NAMESPACE,
      action,
      ...extra
    });
  } catch (error) {
    throw new DockMessageError(errorText(error), true);
  }

  if (!response || response.ok === false) {
    throw new DockMessageError(response?.error || 'Dot Pet Dock could not complete that action.');
  }
  return response;
}

async function request(action, extra = {}) {
  const requestEpoch = ++messageEpoch;
  try {
    const response = await send(action, extra);
    if (requestEpoch !== messageEpoch) return null;
    connected = true;
    draw(response);
    return response;
  } catch (error) {
    if (requestEpoch !== messageEpoch) return null;
    if (error.transport) connected = false;
    renderControls();
    showError(error);
    return null;
  }
}

async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab?.id ?? null;
    tabSupported = isSupportedUrl(tab?.url);
    connected = false;
    draw(state);
    if (!tabSupported) return;

    const response = await send('STATE');
    connected = true;
    draw(response);
    lastRequestedScale = state.scale;
  } catch (error) {
    if (error.transport) connected = false;
    renderControls();
    showError(error);
  }
}

$('find').addEventListener('click', async () => {
  busy.find = true;
  renderControls();
  const response = await request('FIND');
  busy.find = false;
  if (response) draw(response);
  else renderControls();
});

$('pick').addEventListener('click', async () => {
  busy.pick = true;
  renderControls();
  const response = await request('PICK');
  busy.pick = false;
  if (response) {
    draw(response);
    window.close();
  } else {
    renderControls();
  }
});

function sendScale(nextScale) {
  lastRequestedScale = nextScale;
  const requestEpoch = ++messageEpoch;
  // `send` calls chrome.tabs.sendMessage before its first await, so every
  // slider input is dispatched immediately. The epoch prevents an older
  // response or error from replacing the latest optimistic value.
  const pending = send('SET_SCALE', { scale: nextScale });
  void pending.then((response) => {
    if (requestEpoch !== messageEpoch) return;
    connected = true;
    draw(response);
  }).catch((error) => {
    if (requestEpoch !== messageEpoch) return;
    if (error.transport) connected = false;
    renderControls();
    showError(error);
  });
}

function readScaleInput(event) {
  const percent = clamp(Math.round(Number(event.target.value)), MIN_SCALE_PERCENT, MAX_SCALE_PERCENT);
  event.target.value = String(percent);
  return percent / 100;
}

$('scale').addEventListener('input', (event) => {
  const nextScale = readScaleInput(event);
  state = { ...state, scale: nextScale, error: '', notice: '' };
  draw(state);
  sendScale(nextScale);
});

$('scale').addEventListener('change', (event) => {
  const nextScale = readScaleInput(event);
  if (nextScale === lastRequestedScale) return;
  state = { ...state, scale: nextScale, error: '', notice: '' };
  draw(state);
  sendScale(nextScale);
});

$('lock').addEventListener('change', async (event) => {
  const locked = event.target.checked;
  busy.lock = true;
  renderControls();
  const response = await request('LOCK', { locked });
  busy.lock = false;
  if (response) draw(response);
  else renderControls();
});

$('reset').addEventListener('click', async () => {
  // Reset intentionally stays available whenever `saved` is true, even if the
  // pet is currently waiting for a route or DOM node to reappear.
  lastRequestedScale = null;
  busy.reset = true;
  renderControls();
  const response = await request('RESET');
  busy.reset = false;
  if (response) {
    lastRequestedScale = state.scale;
    renderControls();
  }
  else renderControls();
});

draw(state);
for (const [id, clip] of Object.entries(globalThis.DotPetDockAnimations.clips)) {
  const option = document.createElement('option');
  option.value = id; option.textContent = clip.label;
  $('animation-clip').append(option);
}
$('animation-clip').value = 'waving';
for (const [id, action] of [['animation-play', 'ANIMATE'], ['animation-stop', 'STOP_ANIMATION']]) {
  $(id).addEventListener('click', async () => {
    busy.animation = true; renderControls();
    await request(action, { clip: $('animation-clip').value });
    busy.animation = false; renderControls();
  });
}

void init();
