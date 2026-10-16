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
  for (const button of $('animation-buttons').querySelectorAll('button')) {
    button.disabled = !available || busy.animation;
    button.dataset.playing = String(button.dataset.clip === state.playing);
  }
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

const animationIcons = {
  idle: '<path d="M4 12c2-4 4 4 6 0s4 4 6 0 3 0 4 0"/><path d="M7 5h.01M17 5h.01M9 19h6"/>',
  'running-right': '<path d="M4 8h6l-2 6 5 2 2 5M9 14l-5 6M10 8l5 4h5M16 5h4m-2-2 2 2-2 2"/><circle cx="12" cy="4" r="2"/>',
  'running-left': '<g transform="translate(24 0) scale(-1 1)"><path d="M4 8h6l-2 6 5 2 2 5M9 14l-5 6M10 8l5 4h5M16 5h4m-2-2 2 2-2 2"/><circle cx="12" cy="4" r="2"/></g>',
  waving: '<path d="m7 12-2-5a1.5 1.5 0 0 1 3-1l2 5-1-7a1.5 1.5 0 0 1 3 0l1 7 1-6a1.5 1.5 0 0 1 3 .5l-1 7 2-3a1.5 1.5 0 0 1 2 2l-4 7a6 6 0 0 1-10 0l-3-4a1.5 1.5 0 0 1 2-2l3 3M20 3l1-1M3 3 2 2"/>',
  jumping: '<path d="M12 16V3m-4 4 4-4 4 4M5 17l-2 3h18l-2-3"/>',
  failed: '<circle cx="12" cy="12" r="9"/><path d="M8 9h.01M16 9h.01M8 17c2-3 6-3 8 0"/>',
  waiting: '<path d="M6 3h12M6 21h12M7 3v4l10 10v4M17 3v4L7 17v4M9 18h6"/>',
  running: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="m7 8 3 3-3 3M13 14h4M8 21h8M12 17v4"/>',
  review: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M7 10l2 2 4-4"/>'
};
for (const [id, clip] of Object.entries(globalThis.DotPetDockAnimations.clips)) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'secondary'; button.dataset.clip = id;
  button.title = clip.label; button.setAttribute('aria-label', `Play ${clip.label}`);
  button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${animationIcons[id]}</svg>`;
  button.addEventListener('click', async () => {
    busy.animation = true; renderControls();
    await request('ANIMATE', { clip: id });
    busy.animation = false; renderControls();
  });
  $('animation-buttons').append(button);
}

draw(state);
void init();
