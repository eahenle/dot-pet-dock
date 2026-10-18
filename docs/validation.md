# Implementation and validation

## Prototype audit and changes

The v0.1 smoke test passed against a simple simulated SVG page. Additional
probes reproduced a failure with transformed, clipped ancestors: a point
inside the scaled pet's bounding rectangle hit the page background rather
than the pet. Viewport coordinates were also distorted by ancestor scaling.

The v0.2 implementation keeps the original pet node under its original DOM
parent and promotes a small HTML visual container into Chrome's nonmodal
popover top layer. It does not clone or reparent React artwork. An inert
sibling reserves in-flow space. If React removes that sibling while retaining
the pet, the slot is repaired. Reset and unmount remove the slot.

CSS `zoom` composes with the renderer's native `transform`, individual `scale`,
`translate`, and `rotate`; the old implementation replaced individual scale.
Promotion accounts for the effective source size: a transformed fixture
measured 86.400 px before selection and 86.391 px at the dock's 100% setting.
Low-specificity appearance defaults neutralize popover UA styles while letting
native classes and inline styles continue to update. Native style and popover
attribute changes are retained on Reset. No backing canvas dimensions or
renderer assets are modified.

Target selection rejects broad page/content/editor containers and requires a
small visual target. Generic automatic hints use exact semantic test IDs/labels. The production
CSS-sprite adapter additionally validates the observed avatar structure below.
Recovery validates the saved tag,
visual media kinds, and unique selector path, including accessible Shadow DOM
boundaries. An unambiguous semantic marker can recover a changed wrapper;
otherwise a stale or unsafe match waits for manual selection.

Settings are shared across conversations in local extension storage. A valid
v0.1 selection can migrate from the current route. Reset persists an opt-out
so it stays reset after reload. Final writes are sent before document unload;
an immediate-reset/reload regression caught and verified this requirement.

The document observer watches child lists, not animation styles. The selected
node's owned styles are observed; v0.3.1 also observes sprite attributes during
one-shot previews to detect atlas replacement. Geometry tracking stops when
locked or the browser tab is hidden. Missing targets use debounced recovery without a perpetual
400 ms document/layout loop. A three-second runtime validity check provides
best-effort cleanup after extension invalidation. A real Chrome extension
manager disable test verifies restoration; reloading the tab remains the
reliable recovery instruction after extension updates/uninstallation.

## Automated evidence

The v0.3.0 baseline was validated on macOS ARM64 with Python 3.10, Playwright
1.64.0, and bundled Chromium 156.0.8078.4. The suite loads the repository as an **actual unpacked
Manifest V3 extension** into temporary browser profiles. All fixture ChatGPT
requests are fulfilled locally; no authenticated profile, cookie export,
conversation content, or production pet assets are used.

`python tests/smoke_browser.py` exercises 32 unpacked-extension browser cases
plus one controlled storage-latency case:

- Automatic detection and manual SVG/container selection, parent promotion,
  rejection of sidebar/conversation and interactive UI wrappers, and invalid
  saved selectors.
- Semantically marked native button pets retain their click handlers through
  automatic/manual selection and Reset; unrelated controls remain rejected.
- A sanitized production-shaped CSS sprite and native overlay button support
  automatic/manual selection, native clicks and animation, scaling, locking,
  reload, late mounting, and cloned-frame remount recovery. Ordinary CSS avatars
  and frames containing additional controls remain rejected.
- Popover overflow preserves the original visible overflow instead of adding
  scrollbars. At 50%, 300%, and 500%, sprite nametag dimensions remain unchanged,
  the frame fits the artwork plus the unscaled label, and Reset removes the
  compensation without changing the label's inline styles.
- Pointer dragging, keyboard resizing at 50%/500%, clipped/transformed source
  containers, reachable controls, and recovery from off-screen positions.
- Preserved layout space, native CSS animation and transform updates,
  native appearance/attribute ownership, and hidden ancestor behavior.
- Lock, Reset, exact original inline style restoration, retained later native
  styles, Reset opt-out after immediate reload, and extension-disable cleanup.
- Actual extension local-storage persistence through immediate reload,
  React-style unmount/remount, SPA conversation changes, stale-identity
  recovery, reset after clones lose dock attributes, absence of a pet, and
  canvas backing-store preservation.
- The real popup document, real `tabs.sendMessage`, real extension storage,
  lock/unlock/reset, and size controls. The test adapts only tab enumeration:
  opening a popup as a normal tab changes Chrome's active tab, unlike an action
  popup. It does not replace the message transport or content script.
- Popup closure while an earlier reply is delayed preserves the latest size.
  Slider input dispatches each native message immediately; stale replies cannot
  repaint an older size. Content-side storage writes remain debounced.

An additional controlled browser case delays the storage API response, then
fires an early `pageshow`. Recovery must wait for saved settings and preserve
a stored Reset opt-out. The pre-fix script attached a pet both before and after
the opt-out loaded; the fixed script attaches none. This one latency test uses
the same scripts with a controlled storage API rather than loading an extension.

JavaScript syntax, Python compilation, and whitespace checks also run. The
GitHub Actions workflow repeats syntax and browser checks on Ubuntu. Fixture
screenshots are explicitly labeled; they do not demonstrate production
compatibility.

## Production evidence and limits

Live production Dots was checked on October 16, 2026 in Chrome 155.0.8059.85
on macOS using the actual unpacked extension from this checkout. Only renderer
and container metadata and observed behavior were recorded; no chats, artwork
URLs, cookies, credentials, or personal browser profile were copied.

The original implementation failed both automatic and manual selection. The
visible pet uses a CSS background sprite inside a small avatar frame, with a
sibling button overlay for the native profile action. The old media-only rules
rejected this structure. The adapter recognizes the observed `group/avatar`
and `group/orbit-profile` class tokens, requires one sprite and one direct
`button.absolute.inset-0.touch-none` overlay, and moves the whole native frame.
It does not depend on the renderer's generated CSS class names or the pet's name.

Live checks verified automatic selection, 300%/500% enlargement, native button
hit testing, movement, locking/unlocking, and continuing native sprite frames.
Clicking the enlarged pet opened its native profile, which closed normally.
The saved 300% size, position, and lock state survived reload.

Two presentation issues discovered in live use were reproduced in regressions:
Chrome's popover UA overflow introduced scrollbars, and scaling the whole frame
enlarged the nametag. The dock now preserves the original overflow, compensates
the nametag's zoom and width, and fits the frame to the enlarged artwork plus
the original label height. Live geometry checks confirmed unchanged label
width/height and visible overflow at 50%, 300%, and 500%, including a reload at
50%. Reset was observed to restore the native 56 × 82 frame with no owned inline
styles, popover attribute, or placeholder.

This validates one production layout, not every account, pet, or future DOM.
Automated fixtures cover SPA/remount recovery; a live navigation attempt was
inconclusive and is not counted as production SPA evidence. Raster artwork
remains limited by its native resolution. Closed Shadow DOM and renderers that
pause outside their original layout context may need additional adapters.

## v0.3 animation controls

The runtime recognizes the existing standard eight-column atlases with nine
(v1) or eleven (v2) rows. Both share animation rows 0–8: idle, running-right,
running-left, waving, jumping, failed, waiting, running/work, and review. The
frame counts and timing follow the installed Work Pets sprite contract.

Playback uses a one-shot Web Animation on the original sprite's background
position. It never copies artwork or overwrites the site's inline frame state.
Finishing or canceling removes only the extension's effect and reveals the
latest live frame. New clips replace previous clips. Reset, target removal,
page hiding, and extension cleanup cancel playback. Unknown grids and important
native frame-position declarations are rejected.

Wave/Jump shortcuts appear on the editable dock. The popup provides an SVG icon
button for each of the nine clips while locked or unlocked. Each click plays
immediately and the active icon is highlighted; hover titles and accessible
names identify each animation. Animation previews are transient and do not
change or persist task/activity state. No new permissions are needed.

Browser regressions exercise native frame progression, return to a state changed
during playback, clip replacement and Reset cleanup, narrow-toolbar layout,
locked-popup messaging, rejected clip IDs, v1 coordinates, and unsupported grids.
A controlled delayed polling failure also verifies that an older transport error
cannot clear the active icon/status for a newer animation.

Live playback of Wave, Jump, and Work on the production 8×11 sprite reached
rows 3, 4, and 7, respectively, and advanced through their native frames.
One-shot completion returned to native idle frames. The nametag remained 20 px high, overflow remained visible, and the
saved 250% scale and locked state were unchanged.

## References

- [Using the Popover API](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API/Using)
- [Chrome extension end-to-end testing](https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing)
- [Navigation success events](https://developer.mozilla.org/en-US/docs/Web/API/Navigation/navigatesuccess_event)

## Numeric display size

The popup uses a numeric percentage field with a percent suffix and native 1%
keyboard increments. Valid whole percentages apply immediately. Incomplete or
out-of-range drafts stay editable without changing the pet; Enter or leaving
the field rounds and clamps to 50–500%. An empty or invalid draft restores the
last applied percentage. Focused drafts survive asynchronous replies and redraws.
Browser coverage includes multi-digit typing, keyboard stepping, empty entries,
range clamping, rapid updates, and closing the popup before delayed replies.

## v0.3.1 stability investigation

The October 17 report described Kira v2 jitter and irregular behavior without
a reproducible sequence. The October 18 investigation kept the native renderer
and artwork intact and compared undocked and docked fixtures to isolate
extension defects. The origin of the reported live jitter remains unconfirmed.
The extension release is **0.3.1**; "v2.1 polish"
describes the requested pet work, not a replacement renderer or new asset.

### Ownership and frame updates

- The native renderer owns sprite frames and activity state. The dock scales
  and positions the existing frame with CSS `zoom` and a nonmodal popover.
- The editing `requestAnimationFrame` loop reads geometry and renders handles;
  it does not write the pet's position on every sprite frame. Locking stops
  that loop. The selected-node observer checks owned positioning properties,
  disconnects around dock writes, and does not observe animated descendants.
- Placement corrections run on attachment, user movement/scaling, relevant
  selected-node changes, viewport resize, and return to a visible tab.
  `ResizeObserver` normally refreshes handles. It now also retries a placement
  explicitly deferred because the selected pet had no layout box.
- Animation previews use a transient Web Animations effect on supported 8×9
  and 8×11 atlases. Native state updates continue beneath the effect. Cancelling
  it reveals the current native frame rather than restoring a stale snapshot.
  No frame timings, clip mappings, native interactions, or settings schema changed.

### Reproduced extension defects

1. **Hidden resize accumulated coordinates.** Hide an ancestor with
   `display: none`, resize the viewport, and show it again. The undocked control
   remained stable. In the docked fixture, two corrective passes treated the
   missing rectangle `(0, 0, 0, 0)` as an actual position: a pet at
   `(272, 128.75)` returned at `(816, 386.25)`. The fix defers rectangle-based
   correction until a layout box exists. The pet then returns at the same
   coordinates, locked or unlocked. When a smaller viewport requires clamping,
   the corrected position is also saved after the deferred retry. The review
   regression reproduced storage retaining x=272 after the displayed frame
   clamped to x=192; the successful retry now schedules the existing save path.
2. **An active preview survived replacement of its atlas on the same node.**
   Reconciliation previously checked connectivity and containment only, so an
   old preview could keep writing coordinates for a different grid or pet.
   Playback now records the source and grid identity for its lifetime and
   cancels on incompatibility or replacement. A sprite-only attribute observer
   covers this transition while locked; ordinary native frame-position writes
   do not cancel playback. The observer disconnects on finish, cancellation,
   replacement, Reset, and disposal. The source identity stays in memory only
   during playback and is never persisted or logged.

### Regression evidence and limits

Four focused cases supplement the original 29 browser tests:

- Native versus docked sprite frame order and geometry at each sampled time,
  at 50%, 137%, 250%, and 500%, both locked and unlocked.
- Native and docked hide/resize/show, including locked recovery.
- Deferred viewport clamping after Lock flushes settings while hidden, checking
  the actual extension storage for coordinates, size, and lock state without a
  pending save timer or another viewport resize masking the result.
- Grid and same-grid source changes during a paused preview, plus continuing
  ordinary native frame writes. Pausing prevents natural completion from
  disguising a missing cancellation.

The [initial regression run](https://github.com/eahenle/dot-pet-dock/actions/runs/39100836237)
reproduced the two defects while the original 29 tests and native-versus-docked
frame comparison passed. The [first fix run](https://github.com/eahenle/dot-pet-dock/actions/runs/39100981522)
passed all 32 then-present cases. Review added per-frame geometry sampling and
a [confirmed failing storage regression](https://github.com/eahenle/dot-pet-dock/actions/runs/39101794702)
before the persistence follow-up. Storage polling explicitly awaits and asserts
resolved values rather than passing an async predicate to `wait_for_function`.

The current suite contains 33 browser cases (32 unpacked-extension cases and one
controlled storage-latency case). Final Ubuntu CI results for the complete
v0.3.1 tree are available in [PR #4 checks](https://github.com/eahenle/dot-pet-dock/pull/4/checks).
The workflow runs all four JavaScript syntax checks and
`python tests/smoke_browser.py`; Python compilation and `git diff --check` also
pass locally.

These fixtures isolate extension behavior; they do not reproduce every native
Dots transition or establish that the reported live jitter is gone. The current
available pet was named Kira v2.1, so its sheet cannot be assumed to be the
reported v2 asset. Static inspection found aligned idle-frame baselines but
cannot establish runtime stability. No pet asset or account data was copied
into this repository, and no pet was edited or activated.

The connected browser was unavailable and the fallback browser was signed out,
so an authenticated native-versus-docked comparison could not be completed.
Local Chromium could not launch under the execution environment's socket
restriction; the repository's GitHub Actions browser workflow provides the
executable regression evidence. The October 16 production checks above are
historical evidence for v0.3.0, not new live validation of this change.

Remaining live check: use the same pet, page, and activity sequence with docking
reset and then enabled at the saved size/position. Compare idle, directional
looks, activity changes, and one-shot completion; repeat hidden-region resize
and pet replacement while locked. Record whether movement occurs within the
sprite, in the outer frame, or in both. Native-only jitter requires a native
renderer or asset fix and is not resolved by these extension guards.
