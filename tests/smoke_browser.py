"""Optional Chromium smoke test for the DOM adapter; not a live Dots integration test.

Requires: pip install playwright, and a Chromium executable available in PATH
(or set CHROME_EXECUTABLE). Does not make network requests.

Run: python tests/smoke_browser.py
"""
from pathlib import Path
import os
import shutil
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
CHROME = os.getenv('CHROME_EXECUTABLE') or shutil.which('chromium') or shutil.which('google-chrome')
HTML = '''<!doctype html><html><head><style>
body { margin: 0; background: #ebebf3; font: 14px system-ui; }
#sidebar { background: #25223c; color: white; width: 250px; height: 100vh; padding: 20px; box-sizing: border-box; }
#pet { background: #a98dea; width: 100px; height: 100px; display: grid; place-items: center; }
#pet svg { width: 90px; height: 90px; }
</style></head><body><aside id="sidebar">
Dots <div id="pet" data-testid="dot-pet"><svg viewBox="0 0 100 100">
<circle cx="50" cy="50" r="45" fill="rebeccapurple"/>
<circle cx="35" cy="43" r="6" fill="white"/><circle cx="65" cy="43" r="6" fill="white"/>
</svg></div></aside><main>Example chat</main></body></html>'''

MOCK_CHROME = '''(initial) => {
  window.__store = { ...initial };
  window.chrome.storage = {local: {
    get: async key => ({ [key]: window.__store[key] }),
    set: async item => Object.assign(window.__store, item),
    remove: async key => { delete window.__store[key]; }
  }};
  window.chrome.runtime = {onMessage: {addListener: callback => {window.__handler = callback;}}};
}'''


def center(box):
    return box['x'] + box['width'] / 2, box['y'] + box['height'] / 2


def assert_near(actual, expected, tolerance=3):
    assert abs(actual - expected) < tolerance, (actual, expected)


def run():
    if not CHROME:
        raise RuntimeError('Chromium not found; set CHROME_EXECUTABLE.')
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 1100, 'height': 800})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_content(HTML)
        page.evaluate(MOCK_CHROME, {})
        page.add_script_tag(path=str(ROOT / 'content.js'))
        page.keyboard.press('Alt+Shift+P')
        assert page.evaluate("document.querySelector('#dot-pet-dock-root').shadowRoot.querySelector('#picker').style.display") == 'block'
        page.mouse.click(*center(page.locator('#pet svg').bounding_box()))
        selected = page.locator('[data-dot-pet-dock-target]')
        assert selected.count() == 1
        assert selected.evaluate('(el) => el.tagName.toLowerCase()') == 'svg'
        original = selected.bounding_box()
        grab = page.locator('#dot-pet-dock-root').locator('#move')
        x, y = center(grab.bounding_box())
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + 150, y + 130, steps=7)
        page.mouse.up()
        moved = selected.bounding_box()
        assert_near(moved['x'], original['x'] + 150)
        assert_near(moved['y'], original['y'] + 130)
        resize = page.locator('#dot-pet-dock-root').locator('#resize')
        x, y = center(resize.bounding_box())
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + 70, y + 70, steps=7)
        page.mouse.up()
        grown = selected.bounding_box()
        assert grown['width'] > moved['width'] * 1.5
        assert_near(grown['x'], moved['x'])
        saved_config = page.evaluate('window.__store')
        # Simulate React unmount/remount, even carrying over injected inline CSS.
        page.evaluate('''() => {
          const node = document.querySelector('#pet');
          node.outerHTML = node.outerHTML.replace('data-dot-pet-dock-target=""', '');
        }''')
        page.wait_for_timeout(700)
        assert selected.count() == 1
        assert_near(selected.bounding_box()['x'], grown['x'])
        page.locator('#dot-pet-dock-root').locator('#reset').click()
        assert selected.count() == 0
        assert page.locator('#pet svg').get_attribute('style') == ''
        assert page.evaluate('Object.keys(window.__store).length') == 0
        assert not errors, errors

        # Simulate a reload using a new document and preserved extension storage.
        other = browser.new_page(viewport={'width': 1100, 'height': 800})
        other_errors = []
        other.on('pageerror', lambda error: other_errors.append(str(error)))
        other.set_content(HTML)
        other.evaluate(MOCK_CHROME, saved_config)
        other.add_script_tag(path=str(ROOT / 'content.js'))
        other.wait_for_timeout(350)
        restored = other.locator('[data-dot-pet-dock-target]')
        assert restored.count() == 1
        assert_near(restored.bounding_box()['x'], grown['x'])
        assert restored.bounding_box()['width'] > original['width'] * 1.5
        assert not other_errors, other_errors

        # Popup state and slider support with a mocked extension tab channel.
        popup = browser.new_page()
        popup.set_content((ROOT / 'popup.html').read_text())
        popup.add_style_tag(path=str(ROOT / 'popup.css'))
        popup.evaluate('''() => {
          window.chrome.tabs = {
            query: async () => [{ id: 3, url: 'https://chatgpt.com/c/test' }],
            sendMessage: async (_, message) => {
              if (message.action === 'STATE') return { ok: true, saved: true, selected: true, scale: 1.6, locked: false };
              return { ok: true, saved: true, selected: true, scale: message.scale || 1.6, locked: !!message.locked };
            }
          };
        }''')
        popup.add_script_tag(path=str(ROOT / 'popup.js'))
        popup.wait_for_function("document.querySelector('#status').textContent.includes('Pet selected')")
        assert popup.locator('#scale').input_value() == '160'
        assert popup.locator('#reset').is_enabled()
        assert not errors, errors
        browser.close()
    print('PASS: select, drag, resize, React remount, reset, persisted reload, popup.')


if __name__ == '__main__':
    run()
