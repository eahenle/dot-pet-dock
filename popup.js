'use strict';

const $ = (id) => document.getElementById(id);
let activeTabId = null;
let selected = false;

async function send(action, extra = {}) {
  if (!activeTabId) throw new Error('No active ChatGPT tab.');
  return chrome.tabs.sendMessage(activeTabId, {
    namespace: 'DOT_PET_DOCK',
    action,
    ...extra
  });
}

function draw(state) {
  selected = !!state.saved;
  $('scale').disabled = !selected;
  $('lock').disabled = !selected;
  $('reset').disabled = !selected;
  $('lock').checked = !!state.locked;
  $('scale').value = Math.round((state.scale ?? 1) * 100);
  $('scale-output').value = `${$('scale').value}%`;
  $('status').textContent = state.picking
    ? 'Click the pet on the page to select it.'
    : state.selected
      ? state.locked ? 'Pet docked. Unlock to edit.' : 'Pet selected. Drag the Move handle to reposition.'
      : state.saved
        ? 'Saved pet not visible. Navigate to its page or pick again.'
        : 'No pet selected yet.';
}

async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.startsWith('https://chatgpt.com/')) {
      throw new Error('Open ChatGPT in this Chrome window first.');
    }
    activeTabId = tab.id;
    draw(await send('STATE'));
  } catch (error) {
    $('status').textContent = error.message || 'Reload ChatGPT and try again.';
    $('pick').disabled = true;
  }
}

$('pick').addEventListener('click', async () => {
  try { await send('PICK'); window.close(); }
  catch (error) { $('status').textContent = error.message; }
});

$('scale').addEventListener('input', async (event) => {
  $('scale-output').value = `${event.target.value}%`;
  try { await send('SET_SCALE', { scale: Number(event.target.value) / 100 }); }
  catch (error) { $('status').textContent = error.message; }
});

$('lock').addEventListener('change', async (event) => {
  try { draw(await send('LOCK', { locked: event.target.checked })); }
  catch (error) { $('status').textContent = error.message; }
});

$('reset').addEventListener('click', async () => {
  try { draw(await send('RESET')); }
  catch (error) { $('status').textContent = error.message; }
});

init();
