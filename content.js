/* Dot Pet Dock v0.3.0: local-only visual display controls. */
(() => {
  'use strict';
  if (window !== window.top || document.getElementById('dot-pet-dock-root')) return;
  const MESSAGE_NAMESPACE = 'DOT_PET_DOCK';
  const host = document.createElement('div');
  host.id = 'dot-pet-dock-root';
  document.documentElement.appendChild(host);
  host.setAttribute('popover', 'manual');
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
        max-width: calc(100vw - 16px); text-align: center; pointer-events: none;
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
        min-height: 30px; height: auto; padding: 3px;
        max-width: calc(100vw - 16px); flex-wrap: wrap;
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
        <button id="move" title="Drag to move the pet; arrow keys move 10 pixels">✥ Move</button>
        <button id="parent" title="Target the selected element's parent container">↑ Parent</button>
        <button id="wave" title="Play the pet's wave animation once">Wave</button>
        <button id="jump" title="Play the pet's jump animation once">Jump</button>
        <button id="animation-stop" title="Return to live activity">Stop</button>
        <button id="lock" title="Hide the editing handles">Lock</button>
        <button id="reset" title="Restore the page's original pet display">Reset</button>
      </div>
      <button id="resize" aria-label="Resize pet display" title="Drag to resize; arrow keys adjust size"></button>
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

  const $ = id => shadow.getElementById(id);
  const picker = $('picker');
  const hover = $('hover');
  const instruction = $('instruction');
  const frame = $('frame');
  const moveHandle = $('move');
  const resizeHandle = $('resize');
  const parentButton = $('parent');
  const scaleReadout = $('scale-readout');
  const targeting = globalThis.DotPetDockTargeting;
  const animations = globalThis.DotPetDockAnimations;
  const KEY = 'dot-pet-dock:v2';
  const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), hi);
  const finite = (value, fallback) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  let saved = null;
  let target = null;
  let lease = null;
  let placeholder = null;
  let presentationSheet = null;
  let presentationRoot = null;
  let previousLease = null;
  let picking = false;
  let candidateOnDown = null;
  let gesture = null;
  let notice = '';
  let disposed = false;
  let enabled = true;
  let initialized = false;
  let frameRequest = 0;
  let reconnectTimer = 0;
  let saveTimer = 0;
  let toastTimer = 0;
  let storageWrites = Promise.resolve();
  let storageEpoch = 0;
  let route = location.pathname;
  const events = new AbortController();

  // Popover promotion retains DOM ownership and escapes ancestor clipping and
  // transformed containing blocks. Never clone/reparent React-managed artwork.
  const backdropSheet = new CSSStyleSheet();
  backdropSheet.replaceSync(`
    [data-dot-pet-dock-target]::backdrop, #dot-pet-dock-root::backdrop {
      background: transparent !important; pointer-events: none !important;
    }
  `);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, backdropSheet];

  function listen(element, type, handler, options = {}) {
    element.addEventListener(type, handler, { ...options, signal: events.signal });
  }

  function showHost() {
    if (!host.isConnected) document.documentElement.appendChild(host);
    if (!host.matches(':popover-open')) host.showPopover();
  }

  function toast(message) {
    notice = message;
    instruction.textContent = message;
    instruction.style.display = 'block';
    showHost();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (!picking) instruction.style.display = 'none';
      renderFrame();
    }, 4500);
  }

  function writeStorage(value, flush = false) {
    // Snapshot before awaiting; serialize writes so Reset always wins over an
    // earlier slider/gesture write, including when storage is slow.
    const snapshot = structuredClone(value);
    const reportFailure = () => { if (!disposed) toast('Settings could not be saved. Check extension storage and try again.'); };
    if (flush) {
      // Send final state to Chrome now, before a possible document unload.
      // Earlier API calls are already ordered on the storage channel; invalidate
      // callbacks that have not sent their older snapshots yet.
      storageEpoch++;
      try { storageWrites = chrome.storage.local.set({ [KEY]: snapshot }).catch(reportFailure); }
      catch (_) { reportFailure(); storageWrites = Promise.resolve(); }
    } else {
      const epoch = storageEpoch;
      storageWrites = storageWrites.then(() => {
        if (epoch === storageEpoch) return chrome.storage.local.set({ [KEY]: snapshot });
      }).catch(reportFailure);
    }
    return storageWrites;
  }

  function saveConfig(immediate = false) {
    clearTimeout(saveTimer);
    if (!saved || disposed) return;
    if (immediate) return writeStorage(saved, true);
    saveTimer = setTimeout(() => { if (saved) writeStorage(saved); }, 100);
  }

  // Only restore properties still owned by the dock. A native update made
  // while docking becomes the new baseline rather than being erased by Reset.
  function styleLease(element) {
    const entries = new Map();
    const hadStyle = element.hasAttribute('style');
    const originalStyle = element.getAttribute('style');
    const originalDeclaration = document.createElement('span').style;
    originalDeclaration.cssText = originalStyle || '';
    let originalPopover = element.getAttribute('popover');
    let appliedPopover = originalPopover;
    return {
      entries,
      originalPopover,
      hadStyle,
      setPopover() {
        const current = element.getAttribute('popover');
        if (current !== appliedPopover) originalPopover = current;
        if (current !== 'manual') element.setAttribute('popover', 'manual');
        appliedPopover = 'manual';
      },
      set(property, value) {
        const before = element.style.getPropertyValue(property);
        const priority = element.style.getPropertyPriority(property);
        let entry = entries.get(property);
        if (!entry) entry = { value: before, priority };
        else if (before !== entry.applied || priority !== 'important') {
          entry.value = before;
          entry.priority = priority;
        }
        const next = String(value);
        if (before !== next || priority !== 'important') element.style.setProperty(property, next, 'important');
        entry.applied = element.style.getPropertyValue(property);
        entries.set(property, entry);
      },
      restore(node = element) {
        try { if (node.matches(':popover-open')) node.hidePopover(); } catch (_) { /* unmounted */ }
        if (node.getAttribute('popover') === appliedPopover) {
          if (originalPopover === null) node.removeAttribute('popover');
          else node.setAttribute('popover', originalPopover);
        }
        for (const [property, entry] of entries) {
          if (node.style.getPropertyValue(property) !== entry.applied ||
              node.style.getPropertyPriority(property) !== 'important') continue;
          if (entry.value) node.style.setProperty(property, entry.value, entry.priority);
          else node.style.removeProperty(property);
        }
        node.removeAttribute('data-dot-pet-dock-target');
        const unchanged = node.style.length === originalDeclaration.length && [...originalDeclaration].every(property =>
          node.style.getPropertyValue(property) === originalDeclaration.getPropertyValue(property) &&
          node.style.getPropertyPriority(property) === originalDeclaration.getPropertyPriority(property));
        if (unchanged && hadStyle) node.setAttribute('style', originalStyle);
        else if (!hadStyle && !node.getAttribute('style')) node.removeAttribute('style');
      }
    };
  }

  let natural = null;
  const resizeObserver = new ResizeObserver(() => {
    if (target && !gesture) queueFrame();
  });
  const targetObserver = new MutationObserver(() => {
    if (!target?.isConnected || !saved || !lease) return;
    // Observe the selected node only. Disconnect around owned writes to avoid
    // feedback loops; animated descendants never trigger this observer.
    const changed = [...lease.entries].some(([property, entry]) =>
      target.style.getPropertyValue(property) !== entry.applied || target.style.getPropertyPriority(property) !== 'important');
    if (changed || target.getAttribute('popover') !== 'manual') placeTarget();
    else queueFrame();
  });

  function restoreTarget() {
    animations.stop();
    endGesture();
    targetObserver.disconnect();
    resizeObserver.disconnect();
    cancelAnimationFrame(frameRequest);
    frameRequest = 0;
    if (lease) {
      previousLease = lease;
      lease.restore();
    }
    placeholder?.remove();
    placeholder = null;
    if (presentationRoot && presentationSheet) {
      presentationRoot.adoptedStyleSheets = presentationRoot.adoptedStyleSheets.filter(sheet => sheet !== presentationSheet);
    }
    presentationRoot = null; presentationSheet = null;
    target = null;
    lease = null;
    natural = null;
    frame.style.display = 'none';
  }

  function bounds(rect, x = saved.x, y = saved.y) {
    const margin = 8;
    const maxX = innerWidth - rect.width - margin;
    const maxY = innerHeight - rect.height - margin;
    return {
      x: clamp(x, Math.min(margin, maxX), Math.max(margin, maxX)),
      y: clamp(y, Math.min(margin, maxY), Math.max(margin, maxY))
    };
  }

  function placeTarget() {
    if (!target?.isConnected || !saved || !lease || !natural) return;
    targetObserver.disconnect();
    const set = (property, value) => lease.set(property, value);
    set('--dot-pet-dock-owned', '1');
    set('--dot-pet-dock-scale', saved.scale);
    set('position', 'fixed');
    set('right', 'auto'); set('bottom', 'auto');
    set('margin-top', '0px'); set('margin-right', '0px');
    set('margin-bottom', '0px'); set('margin-left', '0px');
    set('width', natural.width);
    set('height', natural.nametagHeight
      ? `${parseFloat(natural.height) - natural.nametagHeight + natural.nametagHeight / saved.scale}px`
      : natural.height);
    set('min-width', '0px'); set('min-height', '0px');
    set('max-width', 'none'); set('max-height', 'none');
    set('box-sizing', natural.boxSizing);
    // zoom composes with the site's transform AND individual scale/translate/
    // rotate. SVG is rerasterized by Chrome; canvas backing pixels are untouched.
    const zoom = natural.zoom * saved.scale;
    set('zoom', zoom);
    let left = saved.x / zoom;
    let top = saved.y / zoom;
    set('left', `${left}px`); set('top', `${top}px`);
    lease.setPopover();
    try { if (!target.matches(':popover-open')) target.showPopover(); }
    catch (_) {
      restoreTarget();
      toast('This display cannot enter the top layer. Pick a small enclosing pet frame.');
      return;
    }
    // A top-layer element's containing block is the viewport. Account for its
    // native transform/origin and preexisting zoom without replacing animation.
    let rect = target.getBoundingClientRect();
    const pos = bounds(rect);
    saved.x = pos.x; saved.y = pos.y;
    for (let i = 0; i < 2; i++) {
      left += (saved.x - rect.left) / zoom;
      top += (saved.y - rect.top) / zoom;
      set('left', `${left}px`); set('top', `${top}px`);
      rect = target.getBoundingClientRect();
    }
    targetObserver.observe(target, { attributes: true, attributeFilter: ['style', 'popover'] });
    renderFrame();
  }

  function attach(element, config) {
    const originalRect = element.getBoundingClientRect();
    const requestedPosition = { x: config.x, y: config.y };
    const cs = getComputedStyle(element);
    const appearance = {};
    for (const property of ['background-color', 'color', 'overflow-x', 'overflow-y',
      'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
      ...['top', 'right', 'bottom', 'left'].flatMap(side => [`border-${side}-width`, `border-${side}-style`, `border-${side}-color`])]) {
      appearance[property] = cs.getPropertyValue(property);
    }
    const nametagSelector = ':scope > div.pointer-events-none > div.relative.isolate';
    const nametag = targeting.dotsAvatar(element) ? element.querySelector(nametagSelector) : null;
    const originalNametagHeight = nametag?.getBoundingClientRect().height || 0;
    const base = { width: cs.width, height: cs.height, display: cs.display, boxSizing: cs.boxSizing,
      zoom: parseFloat(cs.zoom) || 1, appearance,
      nametagHeight: originalNametagHeight * parseFloat(cs.height) / originalRect.height };
    // Low-specificity author defaults neutralize the popover UA appearance.
    // Native classes/inline styles continue to win, including later theme or
    // animation state changes. Never freeze live appearance with !important.
    presentationRoot = element.getRootNode();
    presentationSheet = new CSSStyleSheet();
    presentationSheet.replaceSync(`:where([data-dot-pet-dock-target]) {
      ${Object.entries(appearance).filter(([property]) => property !== 'color').map(([property, value]) => `${property}:${value};`).join('')}
      color:inherit; display:${base.display};
    }
    [data-dot-pet-dock-target]::backdrop { background:transparent !important; pointer-events:none !important; }
    ${nametag ? `:where([data-dot-pet-dock-target] > div.pointer-events-none > div.relative.isolate) {
      zoom:calc(1 / var(--dot-pet-dock-scale, 1));
      width:max-content; max-width:${base.width} !important; flex-shrink:0;
    }` : ''}`);
    presentationRoot.adoptedStyleSheets = [...presentationRoot.adoptedStyleSheets, presentationSheet];
    if (!['fixed', 'absolute'].includes(cs.position)) {
      // Reserve the original flow slot without moving or cloning the pet.
      placeholder = document.createElement('span');
      placeholder.setAttribute('data-dot-pet-dock-placeholder', '');
      placeholder.setAttribute('aria-hidden', 'true');
      placeholder.inert = true;
      const style = placeholder.style;
      style.setProperty('display', cs.display === 'inline' ? 'inline-block' : cs.display, 'important');
      style.setProperty('box-sizing', 'border-box', 'important');
      style.setProperty('width', `${element.offsetWidth}px`, 'important');
      style.setProperty('height', `${element.offsetHeight}px`, 'important');
      style.setProperty('visibility', 'hidden', 'important');
      style.setProperty('pointer-events', 'none', 'important');
      for (const property of ['margin-top', 'margin-right', 'margin-bottom', 'margin-left',
        'flex-grow', 'flex-shrink', 'flex-basis', 'align-self', 'order', 'grid-area']) {
        style.setProperty(property, cs.getPropertyValue(property), 'important');
      }
      element.before(placeholder);
    }
    target = element;
    saved = config;
    natural = base;
    lease = styleLease(target);
    target.setAttribute('data-dot-pet-dock-target', '');
    placeTarget();
    if (target) {
      const promoted = target.getBoundingClientRect();
      const desiredHeight = (originalRect.height - originalNametagHeight) * saved.scale + originalNametagHeight;
      const correction = Math.min(originalRect.width * saved.scale / promoted.width,
        desiredHeight / promoted.height);
      if (Number.isFinite(correction) && correction > 0 && Math.abs(correction - 1) > .001) {
        natural.zoom *= correction;
        saved.x = requestedPosition.x; saved.y = requestedPosition.y;
        placeTarget();
      }
    }
    if (target) resizeObserver.observe(target);
    queueFrame();
  }

  function renderFrame() {
    if (!target?.isConnected || !saved || saved.locked || picking || document.hidden) {
      frame.style.display = 'none';
      if (!picking && instruction.style.display !== 'block' && host.matches(':popover-open')) host.hidePopover();
      return;
    }
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) { frame.style.display = 'none'; return; }
    showHost();
    frame.style.display = 'block';
    frame.style.left = `${rect.left}px`; frame.style.top = `${rect.top}px`;
    frame.style.width = `${rect.width}px`; frame.style.height = `${rect.height}px`;
    const toolbar = $('toolbar');
    const animationState = animations.state(target);
    $('wave').style.display = $('jump').style.display = animationState.animationAvailable ? '' : 'none';
    $('animation-stop').style.display = animationState.playing ? '' : 'none';
    // Toolbar and resize handle are independently clamped, even for a pet that
    // is larger than the viewport. Native pet pointer events stay unobstructed.
    toolbar.style.position = 'fixed';
    toolbar.style.left = `${clamp(rect.left, 8, Math.max(8, innerWidth - toolbar.offsetWidth - 8))}px`;
    toolbar.style.top = `${clamp(rect.top - toolbar.offsetHeight - 5, 8, Math.max(8, innerHeight - toolbar.offsetHeight - 8))}px`;
    resizeHandle.style.position = 'fixed';
    resizeHandle.style.left = `${clamp(rect.right - 9, 8, Math.max(8, innerWidth - 26))}px`;
    resizeHandle.style.top = `${clamp(rect.bottom - 9, 45, Math.max(45, innerHeight - 26))}px`;
    scaleReadout.textContent = `${Math.round(saved.scale * 100)}%`;
    scaleReadout.style.position = 'fixed';
    scaleReadout.style.left = `${clamp(rect.right - 52, 8, Math.max(8, innerWidth - 60))}px`;
    scaleReadout.style.top = `${clamp(rect.bottom + 10, 8, Math.max(8, innerHeight - 28))}px`;
    scaleReadout.style.right = 'auto'; scaleReadout.style.bottom = 'auto';
    const parent = target.parentElement;
    parentButton.disabled = !parent || parent === document.body || parent === document.documentElement ||
      parent.matches('main,aside,nav,article,form,[role="main"],[role="navigation"]');
  }

  function queueFrame() {
    if (frameRequest || disposed || document.hidden || saved?.locked || !target) return;
    frameRequest = requestAnimationFrame(() => {
      frameRequest = 0;
      renderFrame();
      // Only editing tracks animation geometry. A locked pet does no frame work.
      if (target?.isConnected && !saved?.locked && !picking) queueFrame();
    });
  }

  function selectElement(element, position = null) {
    if (element && element === target) { toggleLock(false); return true; }
    if (!targeting.safe(element)) return false;
    restoreTarget();
    const identity = targeting.identify(element);
    const rect = element.getBoundingClientRect();
    enabled = true;
    notice = '';
    attach(element, { identity, x: position?.x ?? rect.left, y: position?.y ?? rect.top,
      scale: position?.scale ?? 1, locked: false });
    saveConfig(true);
    return !!target;
  }

  function beneathPicker(x, y) {
    for (let element of document.elementsFromPoint(x, y)) {
      if (element === host || element === document.body || element === document.documentElement) continue;
      // Hit-test through accessible shadow roots without reading their content.
      while (element.shadowRoot) {
        const child = element.shadowRoot.elementFromPoint(x, y);
        if (!child || child === element) break;
        element = child;
      }
      if (target && (element === target || target.contains(element))) return target;
      return targeting.normalize(element);
    }
    return null;
  }

  function showHover(element) {
    if (!element) { hover.style.display = 'none'; return; }
    const rect = element.getBoundingClientRect();
    hover.style.display = 'block'; hover.style.left = `${rect.left}px`; hover.style.top = `${rect.top}px`;
    hover.style.width = `${rect.width}px`; hover.style.height = `${rect.height}px`;
  }

  function startPicking() {
    if (!initialized) { void ready.then(startPicking); return; }
    endGesture(); animations.stop();
    picking = true; candidateOnDown = null; notice = '';
    clearTimeout(toastTimer);
    instruction.textContent = 'Click the pet or its small visual frame. Esc cancels.';
    picker.style.display = 'block'; instruction.style.display = 'block';
    frame.style.display = 'none'; showHost();
  }

  function stopPicking() {
    picking = false; candidateOnDown = null;
    picker.style.display = 'none'; hover.style.display = 'none'; instruction.style.display = 'none';
    renderFrame(); queueFrame();
  }

  let searchRoots = [document];
  let discoverRoots = false;
  const treeObserver = new MutationObserver(records => {
    if (disposed) return;
    animations.reconcile(target);
    if (location.pathname !== route) { route = location.pathname; stopPicking(); }
    // Child-list changes only; ignore our controls and all animation attributes.
    if (records.every(record => record.target === host || host.contains(record.target))) return;
    if (target?.isConnected && placeholder && (!placeholder.isConnected || placeholder.parentNode !== target.parentNode)) {
      target.before(placeholder);
    }
    if (!target?.isConnected && records.some(record => [...record.addedNodes].some(node =>
      node instanceof Element && (node.shadowRoot || [...node.querySelectorAll('*')].some(child => child.shadowRoot))))) discoverRoots = true;
    if (target && !target.isConnected) queueReconnect();
    else if (!target && saved) queueReconnect();
    else if (!target && enabled && records.some(record => [...record.addedNodes].some(node =>
      node instanceof Element && (node.matches(targeting.HINTS) || node.querySelector(targeting.HINTS) || node.shadowRoot)))) queueReconnect();
  });

  function watchRoots() {
    // Drop observations of removed shadow trees instead of retaining every
    // renderer encountered during a long SPA session.
    treeObserver.disconnect();
    searchRoots = targeting.roots();
    discoverRoots = false;
    for (const root of searchRoots) {
      treeObserver.observe(root === document ? document.documentElement : root, { childList: true, subtree: true });
    }
  }

  function reconnect() {
    reconnectTimer = 0;
    if (!initialized || disposed || document.hidden) return;
    if (target?.isConnected) return;
    if (target) { restoreTarget(); discoverRoots = true; }
    if (discoverRoots) watchRoots();
    // A framework may clone inline styles. Remove our inherited presentation
    // before measuring/validating the replacement, retaining the real baseline.
    if (previousLease) {
      for (const root of searchRoots) {
        for (const clone of root.querySelectorAll('[data-dot-pet-dock-placeholder]')) clone.remove();
        for (const clone of root.querySelectorAll('[data-dot-pet-dock-target],[style*="--dot-pet-dock-owned"]')) {
          if (clone.hasAttribute('data-dot-pet-dock-target') || clone.style.getPropertyValue('--dot-pet-dock-owned') === '1') previousLease.restore(clone);
        }
      }
    }
    if (saved) {
      let found = targeting.resolve(saved.identity);
      if (!found && Array.isArray(saved.identity?.paths) && saved.identity.paths.length && Array.isArray(saved.identity.media)) {
        const automatic = targeting.automatic(searchRoots);
        if (automatic && targeting.matchesIdentity(automatic, saved.identity)) {
          found = automatic;
          saved.identity = targeting.identify(found);
          saveConfig();
        }
      }
      if (found) attach(found, saved);
    } else if (enabled) {
      const found = targeting.automatic(searchRoots);
      if (found) selectElement(found);
    }
  }

  function queueReconnect() {
    if (!reconnectTimer && !disposed) reconnectTimer = setTimeout(reconnect, 80);
  }

  function reset() {
    clearTimeout(saveTimer); clearTimeout(toastTimer); clearTimeout(reconnectTimer); reconnectTimer = 0;
    stopPicking(); restoreTarget(); saved = null; enabled = false; notice = '';
    instruction.style.display = 'none';
    if (host.matches(':popover-open')) host.hidePopover();
    return writeStorage({ disabled: true }, true);
  }

  function setScale(value) {
    if (!saved) return;
    saved.scale = clamp(finite(value, saved.scale), .5, 5);
    notice = ''; placeTarget(); saveConfig();
  }

  function toggleLock(locked) {
    if (!saved) return;
    endGesture(); saved.locked = !!locked;
    if (locked) { cancelAnimationFrame(frameRequest); frameRequest = 0; }
    renderFrame(); queueFrame(); saveConfig(true);
  }

  function gestureStart(event, mode) {
    if (!saved || !target || saved.locked || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const rect = target.getBoundingClientRect();
    gesture = { mode, pointerId: event.pointerId, handle: event.currentTarget,
      startX: event.clientX, startY: event.clientY, x: saved.x, y: saved.y,
      scale: saved.scale, width: rect.width, height: rect.height };
    event.currentTarget.setPointerCapture(event.pointerId);
    picker.style.cursor = mode === 'move' ? 'grabbing' : 'nwse-resize';
    picker.style.display = 'block';
    showHost();
  }

  function endGesture() {
    if (!gesture) return;
    const ending = gesture; gesture = null;
    try { ending.handle.releasePointerCapture(ending.pointerId); } catch (_) { /* canceled */ }
    picker.style.cursor = 'crosshair'; picker.style.display = picking ? 'block' : 'none';
    saveConfig(true);
  }

  function gestureMove(event) {
      if (!gesture || event.pointerId !== gesture.pointerId || !saved) return;
      event.preventDefault(); event.stopPropagation();
      const dx = event.clientX - gesture.startX, dy = event.clientY - gesture.startY;
      if (gesture.mode === 'move') { saved.x = gesture.x + dx; saved.y = gesture.y + dy; }
      else {
        const delta = Math.abs(dx) > Math.abs(dy) ? dx / gesture.width : dy / gesture.height;
        saved.scale = clamp(gesture.scale * (1 + delta), .5, 5);
      }
      placeTarget();
  }

  for (const [handle, mode] of [[moveHandle, 'move'], [resizeHandle, 'resize']]) {
    listen(handle, 'pointerdown', event => gestureStart(event, mode));
    listen(handle, 'pointermove', gestureMove);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(handle, type, endGesture);
    listen(handle, 'click', event => { event.preventDefault(); event.stopPropagation(); });
  }

  listen(resizeHandle, 'keydown', event => {
    if (!saved || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    setScale(saved.scale + (['ArrowUp', 'ArrowRight'].includes(event.key) ? .1 : -.1));
  });
  listen(moveHandle, 'keydown', event => {
    const delta = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[event.key];
    if (!saved || !delta) return;
    event.preventDefault(); event.stopPropagation();
    saved.x += delta[0]; saved.y += delta[1]; placeTarget(); saveConfig();
  });

  listen(parentButton, 'click', () => {
    const old = target, config = saved, parent = target?.parentElement;
    if (!old || !parent) return;
    restoreTarget();
    if (!selectElement(parent, config)) {
      attach(old, config);
      toast('That parent includes page UI or is too large. Pick the small pet frame.');
    }
  });
  listen($('lock'), 'click', () => toggleLock(true));
  listen($('reset'), 'click', reset);
  for (const [id, clip] of [['wave', 'waving'], ['jump', 'jumping']]) {
    listen($(id), 'click', () => {
      try { animations.play(target, clip); renderFrame(); }
      catch (error) { toast(error.message); }
    });
  }
  listen($('animation-stop'), 'click', () => { animations.stop(); renderFrame(); });

  listen(picker, 'pointermove', event => { if (picking) showHover(beneathPicker(event.clientX, event.clientY)); });
  listen(picker, 'pointerdown', event => {
    event.preventDefault(); event.stopPropagation();
    if (picking && event.button === 0) candidateOnDown = beneathPicker(event.clientX, event.clientY);
  });
  listen(picker, 'click', event => {
    event.preventDefault(); event.stopPropagation();
    if (!picking) return;
    const chosen = candidateOnDown || beneathPicker(event.clientX, event.clientY);
    if (chosen && selectElement(chosen)) stopPicking();
    else { instruction.textContent = 'Choose just the pet artwork or its small frame. Esc cancels.'; }
    candidateOnDown = null;
  });
  listen(picker, 'contextmenu', event => event.preventDefault());
  // Capture picker/gesture events at window so underlying delegated React
  // handlers never receive them, including wheel/trackpad scroll during picking.
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel',
    'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel']) {
    listen(window, type, event => {
      if ((!picking && !gesture) || !event.composedPath().includes(host)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (gesture) {
        if (type === 'pointermove') gestureMove(event);
        if (type === 'pointerup' || type === 'pointercancel') endGesture();
      } else if (picking) {
        if (type === 'pointermove') showHover(beneathPicker(event.clientX, event.clientY));
        if (type === 'pointerdown' && event.button === 0) candidateOnDown = beneathPicker(event.clientX, event.clientY);
        if (type === 'click') {
          const chosen = candidateOnDown || beneathPicker(event.clientX, event.clientY);
          if (chosen && selectElement(chosen)) stopPicking();
          else instruction.textContent = 'Choose just the pet artwork or its small frame. Esc cancels.';
          candidateOnDown = null;
        }
      }
    }, { capture: true, passive: false });
  }

  listen(window, 'keydown', event => {
    if (event.key === 'Escape' && (picking || gesture)) {
      event.preventDefault(); event.stopImmediatePropagation(); endGesture(); stopPicking();
    }
    if (event.altKey && event.shiftKey && event.code === 'KeyP') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (picking) stopPicking(); else startPicking();
    }
  }, { capture: true });
  listen(window, 'blur', endGesture);
  listen(window, 'resize', () => { placeTarget(); if (saved) saveConfig(); });
  listen(document, 'visibilitychange', () => {
    if (document.hidden) { animations.stop(); endGesture(); cancelAnimationFrame(frameRequest); frameRequest = 0; }
    else { queueReconnect(); placeTarget(); queueFrame(); }
  });
  listen(window, 'popstate', () => { route = location.pathname; stopPicking(); queueReconnect(); });
  listen(window, 'hashchange', () => { stopPicking(); queueReconnect(); });
  if (window.navigation) listen(window.navigation, 'navigatesuccess', () => {
    route = location.pathname; stopPicking(); queueReconnect();
  });
  listen(window, 'pagehide', () => {
    if (saved) saveConfig(true);
    restoreTarget();
    if (host.matches(':popover-open')) host.hidePopover();
  });
  listen(window, 'pageshow', queueReconnect);

  function dispose() {
    if (disposed) return;
    disposed = true;
    restoreTarget(); events.abort(); treeObserver.disconnect();
    clearTimeout(reconnectTimer); clearTimeout(saveTimer); clearTimeout(toastTimer); clearInterval(validityTimer);
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(sheet => sheet !== backdropSheet);
    host.remove();
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch (_) { /* invalidated */ }
  }
  // Chrome does not dispatch an unload event to existing content scripts when
  // an extension is disabled/reloaded. A low-frequency validity check performs
  // best-effort cleanup without polling layout or scanning the document.
  const validityTimer = setInterval(() => {
    try { if (!chrome.runtime.id) dispose(); else chrome.runtime.getManifest(); }
    catch (_) { dispose(); }
  }, 3000);

  async function initialize() {
    let value;
    let migrated = false;
    try {
      const legacyKey = `dot-pet-dock:v1:${location.origin}${location.pathname}`;
      const stored = await chrome.storage.local.get([KEY, legacyKey]);
      value = stored[KEY];
      // Migrate only a unique, safe legacy visual target on this route. Never
      // replay an arbitrary old selector as permission to float page content.
      if (!value && stored[legacyKey]?.selector) {
        try {
          const matches = document.querySelectorAll(stored[legacyKey].selector);
          const found = matches.length === 1 && targeting.normalize(matches[0]);
          if (found) { value = { ...stored[legacyKey], identity: targeting.identify(found) }; migrated = true; }
        } catch (_) { /* invalid legacy selector */ }
      }
    } catch (_) { notice = 'Saved settings could not be loaded. You can still pick the pet.'; }
    enabled = value?.disabled !== true;
    if (value?.identity && typeof value.identity === 'object') {
      saved = { identity: value.identity, x: finite(value.x, 60), y: finite(value.y, 60),
        scale: clamp(finite(value.scale, 1), .5, 5), locked: !!value.locked };
    }
    if (migrated && saved) await writeStorage(saved);
    watchRoots(); initialized = true; reconnect();
  }
  const ready = initialize();

  function state() {
    return { ok: true, selected: !!target?.isConnected, saved: !!saved, scale: saved?.scale ?? 1,
      locked: !!saved?.locked, picking, notice, ...animations.state(target) };
  }

  function onMessage(message, _sender, sendResponse) {
    if (message?.namespace !== MESSAGE_NAMESPACE || disposed) return;
    void ready.then(async () => {
      let error = '';
      switch (message.action) {
        case 'STATE': break;
        case 'PICK': startPicking(); break;
        case 'FIND': {
          if (target?.isConnected) break;
          const found = targeting.automatic();
          if (!found) error = 'No unambiguous pet frame found. Use Pick pet on page.';
          else if (saved) {
            restoreTarget();
            saved.identity = targeting.identify(found);
            attach(found, saved); saveConfig(true);
          } else if (!selectElement(found)) error = 'Pick a small pet frame on the page.';
          break;
        }
        case 'SET_SCALE': setScale(message.scale); break;
        case 'LOCK': toggleLock(message.locked); break;
        case 'RESET': await reset(); break;
        case 'ANIMATE':
          try { animations.play(target, message.clip); renderFrame(); }
          catch (failure) { error = failure.message; }
          break;
        case 'STOP_ANIMATION': animations.stop(); renderFrame(); break;
        default: error = 'Unknown action.';
      }
      sendResponse({ ...state(), ok: !error, ...(error ? { error } : {}) });
    }).catch(() => sendResponse({ ...state(), ok: false, error: 'The display changed. Reload ChatGPT and pick the pet again.' }));
    return true;
  }
  chrome.runtime.onMessage.addListener(onMessage);
})();
