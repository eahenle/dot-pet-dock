/* One-shot playback of the pet's existing v1/v2 sprite rows. */
(() => {
  'use strict';
  // Eight columns; standard rows 0–8 are shared by both supported atlases.
  const clips = {
    idle: { label: 'Idle', row: 0, durations: [280, 110, 110, 140, 140, 320] },
    'running-right': { label: 'Run right', row: 1, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
    'running-left': { label: 'Run left', row: 2, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
    waving: { label: 'Wave', row: 3, durations: [140, 140, 140, 280] },
    jumping: { label: 'Jump', row: 4, durations: [140, 140, 140, 140, 280] },
    failed: { label: 'Oops', row: 5, durations: [140, 140, 140, 140, 140, 140, 140, 240] },
    waiting: { label: 'Wait', row: 6, durations: [150, 150, 150, 150, 150, 260] },
    running: { label: 'Work', row: 7, durations: [120, 120, 120, 120, 120, 220] },
    review: { label: 'Review', row: 8, durations: [150, 150, 150, 150, 150, 280] }
  };
  let active = null;
  const spriteObserver = new MutationObserver(() => {
    if (active) reconcile(active.target);
  });

  function renderer(target) {
    if (!target?.isConnected || !globalThis.DotPetDockTargeting?.dotsAvatar(target)) return null;
    for (const sprite of target.querySelectorAll('div')) {
      if (sprite.childElementCount) continue;
      const style = getComputedStyle(sprite);
      if (!style.backgroundImage.startsWith('url(')) continue;
      const grid = /^800% (900|1100)%$/.exec(style.backgroundSize);
      if (!grid || ['background-position', 'background-position-x', 'background-position-y']
        .some(property => sprite.style.getPropertyPriority(property) === 'important')) return null;
      return { sprite, rows: Number(grid[1]) / 100, image: style.backgroundImage };
    }
    return null;
  }

  function stop() {
    const previous = active;
    active = null;
    spriteObserver.disconnect();
    previous?.animation.cancel();
  }

  function reconcile(target) {
    if (!active) return;
    const found = renderer(target);
    if (!found || found.sprite !== active.sprite || found.rows !== active.rows || found.image !== active.image) stop();
  }

  function play(target, name) {
    if (!Object.hasOwn(clips, name)) throw new Error('Choose an available animation.');
    const found = renderer(target);
    if (!found) throw new Error('Animation controls are unavailable for this pet.');
    stop();
    const clip = clips[name];
    const duration = clip.durations.reduce((sum, value) => sum + value, 0);
    let elapsed = 0;
    const frames = clip.durations.map((hold, column) => {
      const frame = { backgroundPosition: `${column * 100 / 7}% ${clip.row * 100 / (found.rows - 1)}%`,
        offset: elapsed / duration, easing: 'steps(1, end)' };
      elapsed += hold;
      return frame;
    });
    frames.push({ ...frames.at(-1), offset: 1 });
    // Web Animations overrides the displayed frames without overwriting the
    // site's inline styles. Cancel/finish reveals its latest native state.
    const animation = found.sprite.animate(frames, { duration, iterations: 1, fill: 'none' });
    animation.id = 'dot-pet-dock-clip';
    // The atlas identity lives only for this preview; never persist asset URLs.
    const run = { ...found, target, animation, name };
    active = run;
    // Native frame-position writes are allowed to continue. Only an atlas or
    // compatibility change cancels the preview, even with the dock locked.
    spriteObserver.observe(found.sprite, { attributes: true, attributeFilter: ['style', 'class'] });
    animation.onfinish = () => { if (active === run) stop(); };
    animation.oncancel = () => { if (active === run) stop(); };
  }

  function state(target) {
    reconcile(target);
    return { animationAvailable: !!renderer(target), playing: active?.name ?? null };
  }

  globalThis.DotPetDockAnimations = { clips, play, stop, state, reconcile };
})();
