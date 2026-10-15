/* Dot Pet Dock v0.1.0
 * Only operates in the current user's chatgpt.com tab.
 * Does not scrape, transmit, or inspect conversation text.
 */
(() => {
  'use strict';

  if (window !== window.top || document.getElementById('dot-pet-dock-root')) return;

  const MESSAGE_NAMESPACE = 'DOT_PET_DOCK';
  const MIN_SCALE = 0.5;
  const MAX_SCALE = 5;
  const STYLE_PROPS = [
    'position', 'left', 'top', 'right', 'bottom', 'width', 'height',
    'min-width', 'min-height', 'max-width', 'max-height', 'z-index',
    'scale', 'margin'
  ];

  const host = document.createElement('div');
  host.id = 'dot-pet-dock-root';
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host {
        all: initial !important;
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        pointer-events: none !important;
        z-index: 2147483646 !important;
        font-family: system-ui, -apple-system, sans-serif;
        color-scheme: dark;
      }
      *, *::before, *::after { box-sizing: border-box; }
      #picker {
        display: none; position: fixed; inset: 0;
        pointer-events: auto; cursor: crosshair;
        touch-action: none;
      }
      #hover {
        display: none; position: fixed;
        border: 2px solid #f6cc65; border-radius: 8px;
        background: rgba(246,204,101,.10);
        box-shadow: 0 0 0 1px rgba(20,20,25,.7);
        pointer-events: none;
      }
      #instruction {
        display: none; position: fixed; left: 50%; top: 18px;
        transform: translateX(-50%);
        padding: 11px 15px; border-radius: 12px;
        background: #201a32; color: #fff;
        font-size: 13px; line-height: 1.5; font-weight: 550;
        box-shadow: 0 8px 28px rgba(0,0,0,.3);
        white-space: nowrap; pointer-events: none;
      }
      #frame {
        display: none; position: fixed;
        border: 2px dashed #ac92fa; border-radius: 8px;
        box-shadow: 0 0 0 1px rgba(20,15,45,.35);
        pointer-events: none;
      }
      #toolbar {
        display: flex; align-items: center; gap: 3px;
        position: absolute; left: -2px; top: -35px;
        height: 30px; padding: 3px;
        border: 1px solid #7763b8; border-radius: 9px;
        background: #251f38; color: #f6f3ff;
        box-shadow: 0 4px 15px rgba(0,0,0,.28);
        white-space: nowrap;
      }
      #frame.below #toolbar { top: 7px; }
      button {
        all: unset; box-sizing: border-box;
        display: inline-flex; align-items: center; justify-content: center;
        height: 22px; min-width: 24px; padding: 0 5px;
        border-radius: 5px; font: 600 12px system-ui, sans-serif;
        color: #f7f4ff; background: transparent;
        cursor: pointer; pointer-events: auto;
        user-select: none; -webkit-user-select: none;
      }
      button:hover { background: #554477; }
      button:focus-visible { outline: 2px solid #f6cc65; outline-offset: 2px; }
      #move { cursor: grab; background: #58418e; touch-action: none; }
      #move:active { cursor: grabbing; }
      #resize {
        position: absolute; right: -8px; bottom: -8px;
        width: 18px; height: 18px; border: 2px solid white;
        border-radius: 5px; background: #8b6aea;
        box-shadow: 0 2px 9px rgba(0,0,0,.4);
        pointer-events: auto; cursor: nwse-resize;
        touch-action: none;
      }
      #resize::before {
        content: ''; position: absolute; inset: 4px;
        border-right: 2px solid #fff; border-bottom: 2px solid #fff;
      }
      #scale-readout {
        position: absolute; bottom: -26px; right: -2px;
        background: #251f38; color: white; border-radius: 5px;
        padding: 3px 6px; font: 600 11px system-ui, sans-serif;
        white-space: nowrap;
      }
    </style>
    <div id="picker" aria-label="Choose a pet on the page"></div>
    <div id="hover"></div>
    <div id="instruction">Click the pet or its frame to select it. Press Esc to cancel.</div>
    <div id="frame">
      <div id="toolbar" role="toolbar" aria-label="Pet display controls">
        <button id="move" title="Drag to move the pet">✥ Move</button>
        <button id="parent" title="Target the selected element's parent container">↑ Parent</button>
        <button id="lock" title="Hide the editing handles">Lock</button>
        <button id="reset" title="Restore the page's original pet display">Reset</button>
      </div>
      <div id="resize" role="button" tabindex="0" aria-label="Resize pet display"></div>
      <div id="scale-readout"></div>
    </div>
  `;

  // A constructed stylesheet keeps the controls styled even on sites with a
  // strict policy against inline <style> nodes. Leave the node as a fallback.
  try {
    const styleNode = shadow.querySelector('style');
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(styleNode.textContent);
    shadow.adoptedStyleSheets = [sheet];
    styleNode.remove();
  } catch (_) { /* Older Chromium: use the embedded stylesheet. */ }

  const $ = (id) => shadow.getElementById(id);
  const picker = $('picker');
  const hover = $('hover');
  const instruction = $('instruction');
  const frame = $('frame');
  const moveHandle = $('move');
  const resizeHandle = $('resize');
  const parentButton = $('parent');
  const lockButton = $('lock');
  const resetButton = $('reset');
  const scaleReadout = $('scale-readout');

  let currentKey = null;
  let routeEpoch = 0;
  let saved = null;
  let target = null;
  let originalStyles = null;
  let picking = false;
  let highlighted = null;
  let candidateOnDown = null;
  let gesture = null;
  let reconnectQueued = false;

  const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), hi);
  const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const storageKey = () => `dot-pet-dock:v1:${location.origin}${location.pathname}`;

  function validSaved(value) {
    if (!value || typeof value !== 'object' || typeof value.selector !== 'string' ||
        !value.selector || value.selector.length > 2000) return null;
    return {
      selector: value.selector,
      x: clamp(finite(value.x, 60), -10000, 10000),
      y: clamp(finite(value.y, 60), -10000, 10000),
      width: clamp(finite(value.width, 120), 16, 5000),
      height: clamp(finite(value.height, 120), 16, 5000),
      scale: clamp(finite(value.scale, 1), MIN_SCALE, MAX_SCALE),
      locked: !!value.locked
    };
  }

  function saveConfig() {
    if (!currentKey || !saved) return;
    chrome.storage.local.set({ [currentKey]: { ...saved } });
  }

  function backupInline(element) {
    const snapshot = {};
    for (const property of STYLE_PROPS) {
      const value = element.style.getPropertyValue(property);
      snapshot[property] = {
        value: value === '' ? null : value,
        priority: element.style.getPropertyPriority(property)
      };
    }
    return snapshot;
  }

  function restoreTarget() {
    if (target && originalStyles) {
      for (const [property, entry] of Object.entries(originalStyles)) {
        if (entry.value === null) target.style.removeProperty(property);
        else target.style.setProperty(property, entry.value, entry.priority);
      }
      target.removeAttribute('data-dot-pet-dock-target');
    }
    target = null;
    originalStyles = null;
    frame.style.display = 'none';
  }

  function important(property, value) {
    target.style.setProperty(property, String(value), 'important');
  }

  function placeTarget() {
    if (!target?.isConnected || !saved) return;

    important('position', 'fixed');
    important('right', 'auto');
    important('bottom', 'auto');
    important('margin', '0px');
    important('min-width', '0px');
    important('min-height', '0px');
    important('max-width', 'none');
    important('max-height', 'none');
    important('width', `${saved.width}px`);
    important('height', `${saved.height}px`);
    important('z-index', '2147483640');
    // Individual CSS scale preserves the site's animated `transform` property.
    important('scale', `${saved.scale}`);
    let left = saved.x;
    let top = saved.y;
    important('left', `${left}px`);
    important('top', `${top}px`);

    // Compensate for any existing transforms, margins, or fixed-position
    // containing blocks to anchor the pet's *visible* upper-left corner.
    for (let i = 0; i < 3; i++) {
      const rect = target.getBoundingClientRect();
      const dx = saved.x - rect.left;
      const dy = saved.y - rect.top;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 0.5) break;
      left += dx;
      top += dy;
      important('left', `${left}px`);
      important('top', `${top}px`);
    }
    renderFrame();
  }

  function renderFrame() {
    if (!target?.isConnected || !saved || saved.locked || picking) {
      frame.style.display = 'none';
      return;
    }
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      frame.style.display = 'none';
      return;
    }
    frame.style.display = 'block';
    frame.style.left = `${rect.left}px`;
    frame.style.top = `${rect.top}px`;
    frame.style.width = `${rect.width}px`;
    frame.style.height = `${rect.height}px`;
    frame.classList.toggle('below', rect.top < 40);
    scaleReadout.textContent = `${Math.round(saved.scale * 100)}%`;
    const parent = target.parentElement;
    parentButton.style.display = parent && parent !== document.body &&
      parent !== document.documentElement && parent !== host ? '' : 'none';
  }

  function isOurElement(el) {
    return !el || el === host || el === document.body ||
      el === document.documentElement || host.contains(el);
  }

  function normalizeCandidate(el) {
    if (!el || !(el instanceof Element) || isOurElement(el)) return null;
    // A click on an SVG path should select the whole drawing, not one limb.
    const svg = el.closest('svg');
    if (svg && !isOurElement(svg)) return svg;
    for (let cur = el, hops = 0; cur && hops < 5; cur = cur.parentElement, hops++) {
      if (isOurElement(cur)) break;
      const bounds = cur.getBoundingClientRect();
      if (bounds.width >= 24 && bounds.height >= 24) return cur;
    }
    return el;
  }

  function beneathPicker(x, y) {
    for (const element of document.elementsFromPoint(x, y)) {
      if (isOurElement(element)) continue;
      return normalizeCandidate(element);
    }
    return null;
  }

  function showHover(el) {
    highlighted = el;
    if (!el) { hover.style.display = 'none'; return; }
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) { hover.style.display = 'none'; return; }
    hover.style.display = 'block';
    hover.style.left = `${rect.left}px`;
    hover.style.top = `${rect.top}px`;
    hover.style.width = `${rect.width}px`;
    hover.style.height = `${rect.height}px`;
  }

  function startPicking() {
    if (picking) return;
    picking = true;
    candidateOnDown = null;
    showHover(null);
    picker.style.display = 'block';
    instruction.style.display = 'block';
    frame.style.display = 'none';
  }

  function stopPicking() {
    picking = false;
    highlighted = null;
    candidateOnDown = null;
    picker.style.display = 'none';
    hover.style.display = 'none';
    instruction.style.display = 'none';
    renderFrame();
  }

  function cssSelector(el) {
    const parts = [];
    for (let cur = el, depth = 0;
      cur && cur !== document.documentElement && depth < 35;
      cur = cur.parentElement, depth++) {
      let piece = cur.localName;
      // Use an unambiguous ID when available; otherwise capture the hierarchy.
      if (cur.id && !/^radix-|^headlessui-/i.test(cur.id) &&
          document.querySelectorAll(`#${CSS.escape(cur.id)}`).length === 1) {
        parts.unshift(`#${CSS.escape(cur.id)}`);
        break;
      }
      if (cur.getAttribute('data-testid')) {
        const id = cur.getAttribute('data-testid');
        const byTestId = `[data-testid="${CSS.escape(id)}"]`;
        if (document.querySelectorAll(byTestId).length === 1) {
          parts.unshift(byTestId);
          break;
        }
      }
      if (cur.parentElement) {
        const siblings = Array.from(cur.parentElement.children)
          .filter((sibling) => sibling.localName === cur.localName);
        if (siblings.length > 1) piece += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
      }
      parts.unshift(piece);
    }
    return parts.join(' > ');
  }

  function selectElement(element) {
    if (!element || isOurElement(element)) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < 16 || rect.height < 16) return false;

    restoreTarget();
    target = element;
    originalStyles = backupInline(target);
    target.setAttribute('data-dot-pet-dock-target', '');
    saved = {
      selector: cssSelector(target),
      x: rect.left,
      y: rect.top,
      width: clamp(target.offsetWidth || rect.width, 16, 5000),
      height: clamp(target.offsetHeight || rect.height, 16, 5000),
      scale: 1,
      locked: false
    };
    placeTarget();
    saveConfig();
    return true;
  }

  function reconnect() {
    reconnectQueued = false;
    if (!saved || target?.isConnected) return;
    let found = null;
    try { found = document.querySelector(saved.selector); } catch (_) { /* stale selector */ }
    if (!found || isOurElement(found)) return;
    const rect = found.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return;
    // Some UI frameworks clone a DOM node, including our injected inline CSS.
    // In that case retain its predecessor's *real* original style for Reset.
    const inheritedDockStyle = found.hasAttribute('data-dot-pet-dock-target') ||
      (found.style.getPropertyValue('position') === 'fixed' &&
       found.style.getPropertyValue('z-index') === '2147483640');
    const previousOriginal = originalStyles;
    restoreTarget();
    target = found;
    originalStyles = inheritedDockStyle && previousOriginal
      ? previousOriginal : backupInline(found);
    target.setAttribute('data-dot-pet-dock-target', '');
    placeTarget();
  }

  function queueReconnect() {
    if (reconnectQueued) return;
    reconnectQueued = true;
    setTimeout(reconnect, 120);
  }

  async function loadRoute() {
    const epoch = ++routeEpoch;
    const key = storageKey();
    currentKey = key;
    saved = null;
    let value;
    try { value = (await chrome.storage.local.get(key))[key]; }
    catch (_) { value = null; }
    if (epoch !== routeEpoch || key !== storageKey()) return;
    saved = validSaved(value);
    queueReconnect();
  }

  function handleRouteChange() {
    if (storageKey() === currentKey) return;
    stopPicking();
    restoreTarget();
    loadRoute();
  }

  function reset() {
    stopPicking();
    restoreTarget();
    saved = null;
    if (currentKey) chrome.storage.local.remove(currentKey);
  }

  function toggleLock(lockValue) {
    if (!saved) return;
    saved.locked = typeof lockValue === 'boolean' ? lockValue : !saved.locked;
    saveConfig();
    renderFrame();
  }

  function setScale(value) {
    if (!saved) return;
    saved.scale = clamp(finite(value, 1), MIN_SCALE, MAX_SCALE);
    placeTarget();
    saveConfig();
  }

  function boundPosition(x, y, scale = saved?.scale ?? 1) {
    if (!saved) return { x, y };
    const width = saved.width * scale;
    const height = saved.height * scale;
    const margin = 40; // Always leave at least a grab-sized piece on screen.
    return {
      x: clamp(x, margin - width, window.innerWidth - margin),
      y: clamp(y, margin - height, window.innerHeight - margin)
    };
  }

  picker.addEventListener('pointermove', (event) => {
    if (!picking) return;
    showHover(beneathPicker(event.clientX, event.clientY));
  });
  picker.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    candidateOnDown = beneathPicker(event.clientX, event.clientY);
  });
  picker.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!picking) return;
    // Prefer the element from pointerdown so moving the mouse doesn't retarget.
    const chosen = candidateOnDown || beneathPicker(event.clientX, event.clientY);
    if (chosen && selectElement(chosen)) stopPicking();
    candidateOnDown = null;
  });
  picker.addEventListener('contextmenu', (event) => event.preventDefault());

  function gestureStart(event, mode) {
    if (!saved || !target || saved.locked || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = target.getBoundingClientRect();
    gesture = {
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: saved.x,
      y: saved.y,
      scale: saved.scale,
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height)
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  moveHandle.addEventListener('pointerdown', (event) => gestureStart(event, 'move'));
  resizeHandle.addEventListener('pointerdown', (event) => gestureStart(event, 'resize'));

  function gestureMove(event) {
    if (!gesture || event.pointerId !== gesture.pointerId || !saved) return;
    event.preventDefault();
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (gesture.mode === 'move') {
      const pos = boundPosition(gesture.x + dx, gesture.y + dy);
      saved.x = pos.x;
      saved.y = pos.y;
    } else {
      const fractionalDelta = Math.abs(dx) > Math.abs(dy)
        ? dx / gesture.width : dy / gesture.height;
      saved.scale = clamp(gesture.scale * (1 + fractionalDelta), MIN_SCALE, MAX_SCALE);
    }
    placeTarget();
  }

  function gestureEnd(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gesture = null;
    saveConfig();
  }

  for (const handle of [moveHandle, resizeHandle]) {
    handle.addEventListener('pointermove', gestureMove);
    handle.addEventListener('pointerup', gestureEnd);
    handle.addEventListener('pointercancel', gestureEnd);
  }

  // Keyboard accessibility for resizing, one 10% step per arrow key.
  resizeHandle.addEventListener('keydown', (event) => {
    if (!saved || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const positive = ['ArrowUp', 'ArrowRight'].includes(event.key);
    setScale(saved.scale + (positive ? 0.1 : -0.1));
  });

  parentButton.addEventListener('click', () => {
    const parent = target?.parentElement;
    if (!parent || isOurElement(parent)) return;
    const bounds = parent.getBoundingClientRect();
    // Avoid accidentally floating the entire conversation or sidebar.
    if (bounds.width > window.innerWidth * 0.9 ||
        bounds.height > window.innerHeight * 0.9) return;
    restoreTarget();
    selectElement(parent);
  });
  lockButton.addEventListener('click', () => toggleLock(true));
  resetButton.addEventListener('click', reset);

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && picking) {
      event.preventDefault();
      stopPicking();
    }
    if (event.altKey && event.shiftKey && event.code === 'KeyP') {
      event.preventDefault();
      if (picking) stopPicking(); else startPicking();
    }
  }, true);

  window.addEventListener('resize', renderFrame);
  window.addEventListener('scroll', renderFrame, true);
  new MutationObserver(() => {
    handleRouteChange();
    if (saved && !target?.isConnected) queueReconnect();
    // The app may have changed the inline style during a React update.
    if (target?.isConnected && target.style.getPropertyValue('position') !== 'fixed') {
      placeTarget();
    }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });

  setInterval(() => {
    handleRouteChange();
    if (saved && !target?.isConnected) queueReconnect();
    if (target && !picking) renderFrame();
  }, 400);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.namespace !== MESSAGE_NAMESPACE) return;
    handleRouteChange();
    switch (message.action) {
      case 'STATE': break;
      case 'PICK': startPicking(); break;
      case 'LOCK': toggleLock(!!message.locked); break;
      case 'SET_SCALE': setScale(message.scale); break;
      case 'RESET': reset(); break;
      default: sendResponse({ ok: false, error: 'Unknown action' }); return;
    }
    sendResponse({
      ok: true,
      selected: !!target?.isConnected,
      saved: !!saved,
      locked: !!saved?.locked,
      scale: saved?.scale ?? 1,
      picking
    });
  });

  loadRoute();
})();
