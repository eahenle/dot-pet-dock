# v0.2 implementation and validation

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
small visual target. Automatic hints are exact semantic test IDs/labels,
**not observed production selectors**. Recovery validates the saved tag,
visual media kinds, and unique selector path, including accessible Shadow DOM
boundaries. An unambiguous semantic marker can recover a changed wrapper;
otherwise a stale or unsafe match waits for manual selection.

Settings are shared across conversations in local extension storage. A valid
v0.1 selection can migrate from the current route. Reset persists an opt-out
so it stays reset after reload. Final writes are sent before document unload;
an immediate-reset/reload regression caught and verified this requirement.

The document observer watches child lists, not animation styles. Only the
selected node's owned styles are observed. Geometry tracking stops when
locked or the browser tab is hidden. Missing targets use debounced recovery without a perpetual
400 ms document/layout loop. A three-second runtime validity check provides
best-effort cleanup after extension invalidation. A real Chrome extension
manager disable test verifies restoration; reloading the tab remains the
reliable recovery instruction after extension updates/uninstallation.

## Automated evidence

Validated on macOS ARM64 with Python 3.10, Playwright 1.64.0, and bundled
Chromium 156.0.8078.4. The suite loads the repository as an **actual unpacked
Manifest V3 extension** into temporary browser profiles. All fixture ChatGPT
requests are fulfilled locally; no authenticated profile, cookie export,
conversation content, or production pet assets are used.

`python tests/smoke_browser.py` exercises 17 browser cases:

- Automatic detection and manual SVG/container selection, parent promotion,
  rejection of sidebar/conversation and interactive UI wrappers, and invalid
  saved selectors.
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

JavaScript syntax, Python compilation, and whitespace checks also run. The
GitHub Actions workflow repeats syntax and browser checks on Ubuntu. Fixture
screenshots are explicitly labeled; they do not demonstrate production
compatibility.

## Production evidence and remaining dependency

**Authenticated production Dots was not tested.** Safe browser-session
classification found zero windows in Chrome and Vivaldi, and no reachable
local browser debugging endpoint. A native ChatGPT process is not an
inspectable browser Dots session. No actual production renderer, element
hierarchy, animation boundary, clipping ancestry, iframe, or Shadow DOM
behavior is claimed.

The remaining live check is to identify the actual visual container, enlarge
and move it, verify animation and native interactions, use ordinary ChatGPT
controls, navigate/reload, then unlock and restore the default layout. If the
renderer pauses outside its original intersection/layout context, or uses a
closed Shadow DOM boundary with no safe HTML frame, a production-specific
adapter may be necessary. Raster/canvas/WebGL blur cannot be judged from the
SVG fixture and cannot be repaired by CSS creating extra image detail.

No credentials, authentication state, production chats, or personal browser
profiles belong in this repository.

## References

- [Using the Popover API](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API/Using)
- [Chrome extension end-to-end testing](https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing)
- [Navigation success events](https://developer.mozilla.org/en-US/docs/Web/API/Navigation/navigatesuccess_event)
