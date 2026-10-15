# Dot Pet Dock

A small, local-only Chrome extension to resize and move the pet displayed in **Dots on the ChatGPT website**. No build step, account, external server, or API key.

**Status:** v0.1 prototype. The live Dots DOM has not been inspected. The click-to-select mechanism makes it usable without assuming ChatGPT's internal class names. It has been tested against a local simulated ChatGPT page, not against a logged-in Dots page.

## Install in Chrome

1. On GitHub, choose **Code → Download ZIP**, then extract it somewhere permanent. Alternatively, clone the repository.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and choose the extracted repository folder (the one containing `manifest.json`).
5. Reload your `chatgpt.com` tab.

## Use

1. Open the Dots conversation with your pet visible.
2. Click the **Dot Pet Dock** extension icon (pin it to Chrome's toolbar if you like).
3. Click **Pick pet on page**, then click the pet or its visual frame. The yellow outline shows what you are selecting.
4. Drag the **✥ Move** handle to relocate it. Pull the purple lower-right corner to resize it. Use **↑ Parent** if the selected element is just one piece of the pet rather than the full container.
5. Use the popup's **Lock in place** checkbox to hide the handles once it's positioned. Reopen the popup and uncheck it to edit again. **Restore original display** reverses the changes.

Keyboard: **Alt + Shift + P** activates the picker; **Esc** cancels it. The popup size slider ranges from 50% to 500%.

## How it works

- A Chrome Manifest V3 content script runs on `https://chatgpt.com/*` only.
- You choose the element. The extension changes its CSS positioning and uses the separate CSS `scale` property so animated `transform` effects can continue to work.
- The selected CSS path, position, size and locked state are saved in Chrome's local extension storage, **scoped to the current page path**. They are restored on reload and after many React re-renders.
- No page text or pet artwork is read or transmitted to any service. There are no network requests, tracking, injected remote scripts, or dependencies.
- Removing/disabling the extension or pressing **Restore original display** restores the website's normal behavior. If the UI gets stuck, reload the page after disabling the extension.

## Limitations / next iteration

- Only Chrome's **web version** is affected. It cannot modify the separate native ChatGPT desktop app's floating Pet window.
- A pet inside a cross-origin iframe can only be selected by its **iframe boundary**, not by elements inside that frame.
- A CSS enlargement doesn't create new raster image pixels. If the animation was rendered to a low-resolution bitmap/canvas, it may look blurry. True high-resolution rerendering would require inspecting the actual pet implementation.
- Some Dots layouts may use a transformed or clipped ancestor that prevents the selected element escaping its original region. Selection and styling may need tailoring for the actual DOM.
- The selection path may break if ChatGPT changes its component hierarchy. Re-pick the pet in that case.
- Preferences are currently per URL path, not synchronized across all Dot conversations.

If picking fails, inspect the site element in Chrome DevTools and capture the *non-sensitive* HTML around the pet container (or share a screenshot with the selected element outlined); that is enough to target the correct wrapper more precisely.

## Files

- `manifest.json`: MV3 permissions, site scope and extension UI
- `content.js`: selection overlay, drag/resize, storage, restoration
- `popup.html`, `popup.css`, `popup.js`: toolbar popup
- `icons/`: generated local extension icon sizes

## Run the optional smoke test

With Python, Playwright, and Chromium installed:

```bash
pip install -r requirements-dev.txt
python tests/smoke_browser.py
```

This uses a simulated pet page, not ChatGPT production.
