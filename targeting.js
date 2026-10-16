/* Visual-only target identification. Never reads page text or stores asset URLs. */
(() => {
  'use strict';
  const MEDIA = 'svg,canvas,img,video,iframe';
  // These are conservative hints, not a claim about ChatGPT's private DOM.
  const HINTS = '[data-testid="dot-pet"],[data-testid="dot-pet-container"],'
    + '[aria-label="Dot pet"],[aria-label="ChatGPT pet"]';
  // Observed in the production Dots header. The same sprite also appears in
  // navigation icons, so recognize the whole avatar and its native overlay.
  const DOTS_AVATAR = 'div[class~="group/avatar"][class~="group/orbit-profile"]';
  const FORBIDDEN = 'main,aside,nav,header,footer,article,form,dialog,p,h1,h2,h3,h4,ul,ol,pre,code,'
    + 'button,a,select,option,label,[role="button"],[role="link"],[role="menu"],[role="menuitem"],'
    + '[role="main"],[role="navigation"],[role="log"],[role="dialog"],'
    + '[role="complementary"],[id="sidebar"],[id="thread"],[data-testid="sidebar"],'
    + '[contenteditable]:not([contenteditable="false"]),textarea,input,'
    + '[data-message-author-role],[data-testid^="conversation-turn"]';

  function dotsAvatar(element) {
    if (!(element instanceof HTMLElement) || !element.matches(DOTS_AVATAR)) return false;
    const controls = element.querySelectorAll(FORBIDDEN);
    if (controls.length !== 1) return false;
    const overlay = controls[0];
    if (overlay.parentElement !== element ||
        !overlay.matches('button.absolute.inset-0.touch-none')) return false;
    // Keep only the renderer kind; never retain its artwork URL.
    const sprites = [...element.querySelectorAll('div')].filter(node =>
      !node.childElementCount && getComputedStyle(node).backgroundImage.startsWith('url('));
    return sprites.length === 1;
  }

  function media(element) {
    const tags = element.matches(MEDIA) ? [element.localName] : [];
    for (const child of element.querySelectorAll(MEDIA)) {
      // SVG descendants cannot accidentally turn one drawing into many targets.
      if (!child.parentElement?.closest('svg')) tags.push(child.localName);
    }
    if (dotsAvatar(element)) tags.push('css-sprite');
    return tags.sort();
  }

  function safe(element, measure = true) {
    // A semantically identified pet may itself be a native clickable frame.
    // Keep that frame's listeners while still rejecting nested UI controls.
    const interactivePet = element instanceof HTMLElement && element.matches(HINTS) &&
      element.matches('button,a,[role="button"],[role="link"]') && media(element).length === 1;
    if (!(element instanceof HTMLElement) || !element.isConnected ||
        element === document.body || element === document.documentElement ||
        element.id === 'dot-pet-dock-root' || element.closest('#dot-pet-dock-root') ||
        (element.matches(FORBIDDEN) && !interactivePet) ||
        (element.querySelector(FORBIDDEN) && !dotsAvatar(element)) ||
        element.hasAttribute('popover') || element.closest('[data-message-author-role],[data-testid^="conversation-turn"]')) return false;
    const visuals = media(element);
    if (!visuals.length || visuals.length > 8) return false;
    if (measure) {
      const rect = element.getBoundingClientRect();
      if (rect.width < 16 || rect.height < 16 || rect.width > 640 || rect.height > 640 ||
          rect.width * rect.height > innerWidth * innerHeight * .55) return false;
    }
    return true;
  }

  function normalize(element) {
    if (!(element instanceof Element)) return null;
    const svg = element.closest('svg');
    if (svg) element = svg.parentElement;
    // Prefer an explicit pet frame, but do not infer a pet from arbitrary UI.
    const hint = element?.closest(HINTS);
    if (hint && safe(hint)) return hint;
    const avatar = element.closest(DOTS_AVATAR);
    if (avatar && safe(avatar)) return avatar;
    for (let current = element, hops = 0; current && hops < 5; current = current.parentElement, hops++) {
      if (safe(current)) return current;
      if (current.matches(FORBIDDEN)) break;
    }
    return null;
  }

  function roots() {
    const result = [document];
    for (let i = 0; i < result.length; i++) {
      for (const element of result[i].querySelectorAll('*')) {
        if (element.shadowRoot && element.id !== 'dot-pet-dock-root') result.push(element.shadowRoot);
      }
    }
    return result;
  }

  function uniqueSelector(element, root) {
    const quote = value => CSS.escape(value);
    const parts = [];
    for (let current = element; current instanceof Element; current = current.parentElement) {
      const testId = current.getAttribute('data-testid');
      const anchors = [];
      if (testId && testId.length < 120) anchors.push(`[data-testid="${quote(testId)}"]`);
      if (current.id && current.id.length < 120 && !/^(:|radix-|headlessui-)/i.test(current.id)) anchors.push(`#${quote(current.id)}`);
      for (const anchor of anchors) {
        if (root.querySelectorAll(anchor).length === 1) return [anchor, ...parts].join(' > ');
      }
      if (current === document.body || current === document.documentElement) break;
      let segment = current.localName;
      const siblings = current.parentElement && [...current.parentElement.children].filter(item => item.localName === segment);
      if (siblings?.length > 1) segment += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      parts.unshift(segment);
    }
    return parts.join(' > ');
  }

  function identify(element) {
    const paths = [];
    for (let current = element; current;) {
      const root = current.getRootNode();
      paths.unshift(uniqueSelector(current, root));
      current = root instanceof ShadowRoot ? root.host : null;
    }
    return { paths, tag: element.localName, media: media(element) };
  }

  function resolve(identity) {
    if (!identity || !Array.isArray(identity.paths) || !identity.paths.length || identity.paths.length > 8) return null;
    let root = document;
    let found;
    try {
      for (let i = 0; i < identity.paths.length; i++) {
        const path = identity.paths[i];
        if (typeof path !== 'string' || path.length > 2000) return null;
        const matches = root.querySelectorAll(path);
        if (matches.length !== 1) return null;
        found = matches[0];
        if (i < identity.paths.length - 1) {
          root = found.shadowRoot;
          if (!root) return null;
        }
      }
    } catch (_) { return null; }
    if (!safe(found) || found.localName !== identity.tag ||
        JSON.stringify(media(found)) !== JSON.stringify(identity.media)) return null;
    return found;
  }

  function automatic(searchRoots = roots()) {
    const candidates = [];
    for (const root of searchRoots) {
      for (const element of root.querySelectorAll(`${HINTS},${DOTS_AVATAR}`)) {
        if (safe(element) && !candidates.some(other => other.contains(element))) candidates.push(element);
      }
    }
    return candidates.length === 1 ? candidates[0] : null;
  }

  function matchesIdentity(element, identity) {
    return identity && element.localName === identity.tag &&
      JSON.stringify(media(element)) === JSON.stringify(identity.media);
  }

  globalThis.DotPetDockTargeting = { safe, normalize, identify, resolve, automatic, roots, matchesIdentity,
    dotsAvatar, HINTS: `${HINTS},${DOTS_AVATAR}` };
})();
