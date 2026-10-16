"""Browser integration tests for the unpacked Dot Pet Dock extension.

The tests run against a local, deterministic ChatGPT-shaped fixture served at
``https://chatgpt.com``. No ChatGPT account, cookies, conversation content,
or network service is used. Chrome loads the repository as an unpacked MV3
extension, so content-script matching, extension storage, and the normal page
boundary are exercised together.

Requirements::

    python3 -m pip install -r requirements-dev.txt
    python3 -m playwright install chromium
    python3 tests/smoke_browser.py

Set ``CHROME_EXECUTABLE`` to use a locally installed Chrome/Chromium instead
of Playwright's bundled browser. ``--test NAME`` runs one case while
developing a change; without it every case runs.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import tempfile
import textwrap
import traceback
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import BrowserContext, Page, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
EXTENSION_ROOT = ROOT
INLINE_STYLE = (
    "position: relative; left: 3px; top: 4px; width: 120px; height: 120px; "
    "min-width: 2px; max-width: 140px; z-index: 7; margin: 5px; "
    "transform: translateX(2px); scale: .8;"
)


BASE_CSS = """
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body { background: #ececf4; color: #171525; font: 14px system-ui, sans-serif; }
  #app-shell { min-height: 100vh; display: grid; grid-template-columns: 240px 1fr; }
  #sidebar { padding: 24px 18px; background: #29263f; color: white; }
  #conversation { min-width: 0; padding: 32px; }
  #conversation-title { margin-top: 0; }
  .pet-zone { padding: 24px 0; }
  .pet-visual {
    width: 120px; height: 120px; display: grid; place-items: center;
    background: #a98dea; border-radius: 22px; color: white;
  }
  .pet-visual svg { width: 108px; height: 108px; overflow: visible; }
  .pet-inner { width: 108px; height: 108px; display: grid; place-items: center; }
  .pet-visual canvas { width: 108px; height: 108px; display: block; }
  .native-art { transform-origin: 50% 50%; animation: bob 480ms linear infinite; }
  @keyframes bob {
    from { transform: translateX(-4px) rotate(-3deg); }
    to { transform: translateX(4px) rotate(3deg); }
  }
  #transformed-clip {
    width: 170px; height: 170px; overflow: hidden; contain: paint;
    transform: translate(23px, 17px) scale(.72); transform-origin: top left;
    padding: 15px; border: 4px solid #574681;
  }
  #transformed-clip .pet-visual { border-radius: 4px; }
  #spa-nav { margin: 12px 0; }
  #spa-nav, #remount, #remove-pet, #replace-pet { padding: 7px 10px; }
  #bad-ui { width: 180px; height: 96px; display: flex; align-items: center; gap: 10px; padding: 10px; background: #fff; border: 2px solid #d65b5b; }
  #bad-ui svg { width: 56px; height: 56px; }
  #bad-ui button { padding: 5px 7px; }
  #pet.button-pet { border: 0; padding: 0; cursor: pointer; }
"""


def svg_art(identifier: str = "pet-art") -> str:
    return f"""
      <svg id="{identifier}" viewBox="0 0 100 100" aria-label="fixture pet artwork">
        <g class="native-art">
          <circle cx="50" cy="50" r="43" fill="#6944a5"/>
          <circle cx="35" cy="43" r="6" fill="white"/>
          <circle cx="65" cy="43" r="6" fill="white"/>
          <path d="M30 67 Q50 83 70 67" fill="none" stroke="white" stroke-width="5"/>
        </g>
      </svg>
    """


def canvas_art(identifier: str = "pet-canvas") -> str:
    return f'<canvas id="{identifier}" width="120" height="120" aria-label="fixture canvas pet"></canvas>'


def fixture_html(scene: str) -> str:
    """Return a tiny ChatGPT-shaped page for one isolated browser case."""

    if scene == "auto":
        pet = '<div id="pet" class="pet-visual" data-testid="dot-pet">' + svg_art() + "</div>"
        controls = ""
    elif scene == "manual":
        pet = '<div id="pet" class="pet-visual"><div id="pet-inner" class="pet-inner" style="transform: translateX(4px) rotate(3deg)">' + svg_art() + "</div></div>"
        controls = ""
    elif scene == "inline":
        pet = (
            '<div id="pet" class="pet-visual" data-testid="dot-pet" '
            f'style="{INLINE_STYLE}">'
            + svg_art()
            + "</div>"
        )
        controls = ""
    elif scene == "clipped":
        pet = '<div id="transformed-clip"><div id="pet" class="pet-visual">' + svg_art() + "</div></div>"
        controls = ""
    elif scene == "canvas":
        pet = '<div id="pet" class="pet-visual" data-testid="dot-pet">' + canvas_art() + "</div>"
        controls = "<script>window.addEventListener('DOMContentLoaded',()=>{const c=document.querySelector('#pet-canvas');const x=c.getContext('2d');x.fillStyle='#6944a5';x.fillRect(4,4,112,112);x.fillStyle='white';x.beginPath();x.arc(42,44,7,0,Math.PI*2);x.arc(78,44,7,0,Math.PI*2);x.fill();});</script>"
    elif scene == "mutation":
        pet = '<div id="pet" class="pet-visual" style="transform: translateX(4px) rotate(3deg)">' + svg_art() + "</div>"
        controls = """
          <button id="mutate-transform" type="button">Animate native root</button>
          <script>
            document.querySelector('#mutate-transform').onclick = () => {
              document.querySelector('#pet').style.transform = 'translateX(28px) rotate(13deg)';
            };
          </script>
        """
    elif scene == "hidden":
        pet = '<div id="pet" class="pet-visual">' + svg_art() + "</div>"
        controls = """
          <button id="hide-pet" type="button">Hide pet region</button>
          <button id="show-pet" type="button">Show pet region</button>
          <script>
            document.querySelector('#hide-pet').onclick = () => document.querySelector('.pet-zone').hidden = true;
            document.querySelector('#show-pet').onclick = () => document.querySelector('.pet-zone').hidden = false;
          </script>
        """
    elif scene == "safety":
        pet = '<div id="bad-ui"><svg id="bad-art" viewBox="0 0 100 100" aria-label="decorative icon"><circle cx="50" cy="50" r="44" fill="#c34d4d"/></svg><button id="delete-conversation" type="button">Delete conversation</button></div>'
        controls = ""
    elif scene == "button-pet":
        pet = '<button id="pet" class="pet-visual button-pet" data-testid="dot-pet" type="button">' + svg_art() + "</button>"
        controls = """
          <output id="pet-click-count" aria-label="Pet click count">0</output>
          <script>
            window.addEventListener('DOMContentLoaded', () => {
              document.querySelector('#pet').addEventListener('click', () => {
                const count = Number(document.querySelector('#pet').dataset.clicks || '0') + 1;
                document.querySelector('#pet').dataset.clicks = String(count);
                document.querySelector('#pet-click-count').value = String(count);
                document.querySelector('#pet-click-count').textContent = String(count);
              });
            });
          </script>
        """
    elif scene == "spa":
        pet = '<div id="pet" class="pet-visual">' + svg_art() + "</div>"
        controls = """
          <button id="spa-nav" type="button">Open another conversation</button>
          <button id="remount" type="button">React remount pet</button>
          <button id="remove-pet" type="button">Remove pet</button>
          <script>
            function clonePet() {
              const oldPet = document.querySelector('#pet');
              if (!oldPet) return;
              const replacement = oldPet.cloneNode(true);
              replacement.removeAttribute('data-dot-pet-dock-target');
              replacement.removeAttribute('popover');
              oldPet.replaceWith(replacement);
            }
            document.querySelector('#remount').onclick = clonePet;
            document.querySelector('#remove-pet').onclick = () => document.querySelector('#pet')?.remove();
            document.querySelector('#spa-nav').onclick = () => {
              history.pushState({}, '', '/c/second-conversation?scene=spa');
              clonePet();
              document.querySelector('#conversation-title').textContent = 'Second fixture conversation';
            };
          </script>
        """
    elif scene == "absence":
        pet = '<div id="empty-state">No Dot is displayed in this fixture.</div>'
        controls = ""
    elif scene == "stale":
        pet = '<div id="pet" class="pet-visual">' + svg_art() + "</div>"
        controls = f"""
          <button id="replace-pet" type="button">Replace with new pet identity</button>
          <script>
            document.querySelector('#replace-pet').onclick = () => {{
              document.querySelector('#pet')?.remove();
              const replacement = document.createElement('div');
              replacement.id = 'pet-recreated';
              replacement.className = 'pet-visual';
              replacement.dataset.testid = 'dot-pet';
              replacement.innerHTML = {svg_art('pet-art-recreated')!r};
              document.querySelector('.pet-zone').append(replacement);
            }};
          </script>
        """
    else:
        raise ValueError(f"unknown fixture scene: {scene}")

    return textwrap.dedent(
        f"""\
        <!doctype html>
        <html lang="en">
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ChatGPT fixture</title><style>{BASE_CSS}</style></head>
        <body>
          <div id="app-shell">
            <aside id="sidebar"><strong>ChatGPT</strong><p>Fixture sidebar</p></aside>
            <main id="conversation">
              <h1 id="conversation-title">Fixture conversation</h1>
              {controls}
              <section class="pet-zone" aria-label="Dot pet fixture">{pet}<div id="after-pet">Following fixture content</div></section>
            </main>
          </div>
        </body>
        </html>
        """
    )


class Harness:
    """One isolated persistent Chrome profile with the unpacked extension."""

    def __init__(self, playwright: Any, scene: str, viewport: dict[str, int] | None = None) -> None:
        self.playwright = playwright
        self.scene = scene
        self.viewport = viewport or {"width": 1100, "height": 800}
        self.profile = tempfile.TemporaryDirectory(prefix="dot-pet-dock-")
        executable = os.getenv("CHROME_EXECUTABLE")
        kwargs: dict[str, Any] = {
            "user_data_dir": self.profile.name,
            "headless": True,
            "args": [
                "--no-sandbox",
                f"--disable-extensions-except={EXTENSION_ROOT}",
                f"--load-extension={EXTENSION_ROOT}",
            ],
            "viewport": self.viewport,
        }
        if executable:
            kwargs["executable_path"] = executable
            # Chrome disables unpacked extensions in its legacy headless mode.
            # Explicitly select the modern mode when a system binary is used.
            kwargs["args"].append("--headless=new")
        else:
            # Playwright's default headless shell does not load extensions.
            # The full Chromium channel does, and is installed by the setup
            # command documented above.
            kwargs["channel"] = "chromium"
        self.context: BrowserContext = playwright.chromium.launch_persistent_context(**kwargs)
        self.context.route("https://chatgpt.com/**", self._route)
        self.page: Page = self.context.new_page()
        self.errors: list[str] = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))

    def _route(self, route: Any) -> None:
        request = route.request
        parsed = urlparse(request.url)
        query = parse_qs(parsed.query)
        scene = query.get("scene", [self.scene])[0]
        if parsed.hostname == "chatgpt.com":
            route.fulfill(
                status=200,
                content_type="text/html",
                headers={"cache-control": "no-store"},
                body=fixture_html(scene),
            )
        else:
            route.continue_()

    def open(self, path: str = "/c/fixture") -> Page:
        self.page.goto(f"https://chatgpt.com{path}?scene={self.scene}", wait_until="domcontentloaded")
        self.page.wait_for_selector("#dot-pet-dock-root", state="attached", timeout=5000)
        return self.page

    def close(self) -> None:
        self.context.close()
        self.profile.cleanup()


@contextmanager
def harness(playwright: Any, scene: str, viewport: dict[str, int] | None = None) -> Iterator[Harness]:
    instance = Harness(playwright, scene, viewport)
    try:
        yield instance
    finally:
        instance.close()


def centre(box: dict[str, float]) -> tuple[float, float]:
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


def assert_near(actual: float, expected: float, tolerance: float = 5) -> None:
    assert abs(actual - expected) <= tolerance, f"{actual=} {expected=} {tolerance=}"


def root(page: Page) -> Any:
    return page.locator("#dot-pet-dock-root")


def target(page: Page) -> Any:
    return page.locator("[data-dot-pet-dock-target]")


def wait_for_target(page: Page, count: int = 1, timeout: int = 2500) -> Any:
    locator = target(page)
    if count:
        locator.first.wait_for(state="attached", timeout=timeout)
    else:
        locator.first.wait_for(state="detached", timeout=timeout)
    assert locator.count() == count, f"expected {count} target(s), got {locator.count()}"
    return locator


def start_picker(page: Page) -> None:
    page.keyboard.press("Alt+Shift+P")
    root(page).locator("#picker").wait_for(state="visible", timeout=2000)


def select_at(page: Page, selector: str) -> Any:
    start_picker(page)
    box = page.locator(selector).bounding_box()
    assert box and box["width"] > 0 and box["height"] > 0, f"fixture element is not visible: {selector}"
    page.mouse.click(*centre(box))
    return wait_for_target(page)


def set_scale_with_keyboard(page: Page, key: str, presses: int) -> None:
    resize = root(page).locator("#resize")
    resize.focus()
    for _ in range(presses):
        page.keyboard.press(key)


def state_text(page: Page) -> str:
    return root(page).locator("#scale-readout").text_content() or ""


def unpacked_extension_id() -> str:
    """Return Chrome's deterministic ID for this unpacked extension path."""

    digest = hashlib.sha256(str(EXTENSION_ROOT.resolve()).encode()).hexdigest()[:32]
    return digest.translate(str.maketrans("0123456789abcdef", "abcdefghijklmnop"))


def seed_extension_storage(harness_instance: Harness, value: dict[str, Any]) -> None:
    """Seed v2 storage through the real extension storage API before a load."""

    extension = harness_instance.context.new_page()
    try:
        extension.goto(f"chrome-extension://{unpacked_extension_id()}/popup.html")
        extension.evaluate(
            "async value => { await chrome.storage.local.set({'dot-pet-dock:v2': value}); }",
            value,
        )
    finally:
        extension.close()


def test_auto_detect_and_svg_parent(playwright: Any) -> None:
    with harness(playwright, "auto") as h:
        page = h.open()
        selected = wait_for_target(page)
        assert selected.get_attribute("id") == "pet", "semantic SVG pet should resolve to its HTML visual parent"
        assert selected.evaluate("el => el.tagName.toLowerCase()") == "div"
        assert page.locator("#pet-art").count() == 1


def test_interactive_marked_button_pet_auto_manual_and_reset(playwright: Any) -> None:
    """An explicitly marked button pet keeps its page click handler intact."""

    with harness(playwright, "button-pet") as h:
        page = h.open()
        selected = wait_for_target(page)
        assert selected.get_attribute("id") == "pet"
        assert selected.evaluate("el => el.tagName.toLowerCase()") == "button"

        selected.click()
        assert page.locator("#pet-click-count").text_content() == "1"
        # The exact marker may have auto-attached before this assertion, so the
        # fixture's no-style declaration is the stable pre-extension baseline.
        baseline_style = None

        root(page).locator("#reset").click()
        target(page).first.wait_for(state="detached", timeout=2500)
        assert page.locator("#pet").get_attribute("style") == baseline_style
        assert page.locator("#pet").get_attribute("popover") is None
        assert page.locator("#pet").get_attribute("data-dot-pet-dock-target") is None

        # Reset opts out of automatic attachment. A fresh picker action must
        # still be able to select the exact marked button explicitly.
        start_picker(page)
        box = page.locator("#pet").bounding_box()
        assert box
        page.mouse.click(*centre(box))
        selected = wait_for_target(page)
        assert selected.get_attribute("id") == "pet"
        selected.click()
        assert page.locator("#pet-click-count").text_content() == "2"

        root(page).locator("#reset").click()
        target(page).first.wait_for(state="detached", timeout=2500)
        assert page.locator("#pet").get_attribute("style") == baseline_style
        assert page.locator("#pet").get_attribute("popover") is None
        assert not h.errors, h.errors


def test_manual_select_drag_resize_and_clipped_transform(playwright: Any) -> None:
    with harness(playwright, "clipped") as h:
        page = h.open()
        selected = select_at(page, "#pet-art")
        assert selected.get_attribute("id") == "pet"

        original = selected.bounding_box()
        assert original
        move = root(page).locator("#move")
        move_box = move.bounding_box()
        assert move_box
        start_x, start_y = centre(move_box)
        page.mouse.move(start_x, start_y)
        page.mouse.down()
        page.mouse.move(start_x + 130, start_y + 95, steps=5)
        page.mouse.up()
        moved = selected.bounding_box()
        assert moved
        assert_near(moved["x"], original["x"] + 130, 8)
        assert_near(moved["y"], original["y"] + 95, 8)

        set_scale_with_keyboard(page, "ArrowUp", 40)
        assert state_text(page) == "500%"
        grown = selected.bounding_box()
        assert grown and grown["width"] > original["width"] * 3
        hit = page.evaluate(
            """() => {
              const pet = document.querySelector('#pet');
              const r = pet.getBoundingClientRect();
              const element = document.elementFromPoint(r.left + r.width * .8, r.top + r.height * .8);
              return !!element && (element === pet || pet.contains(element));
            }"""
        )
        assert hit, "scaled pet became unreachable through a clipped/transformed ancestor"


def test_in_flow_layout_slot_does_not_shift_following_content(playwright: Any) -> None:
    with harness(playwright, "clipped") as h:
        page = h.open()
        before = page.locator("#after-pet").bounding_box()
        assert before
        select_at(page, "#pet-art")
        set_scale_with_keyboard(page, "ArrowUp", 40)
        after = page.locator("#after-pet").bounding_box()
        assert after
        assert_near(after["x"], before["x"], 2)
        assert_near(after["y"], before["y"], 2)


def test_viewport_resize_and_saved_position_recovery(playwright: Any) -> None:
    with harness(playwright, "clipped", {"width": 430, "height": 320}) as h:
        page = h.open()
        selected = select_at(page, "#pet-art")
        move = root(page).locator("#move")
        move_box = move.bounding_box()
        assert move_box
        start_x, start_y = centre(move_box)
        page.mouse.move(start_x, start_y)
        page.mouse.down()
        page.mouse.move(start_x - 1200, start_y - 1200, steps=5)
        page.mouse.up()
        clipped = selected.bounding_box()
        assert clipped
        assert clipped["x"] + clipped["width"] >= 0
        assert clipped["y"] + clipped["height"] >= 0
        page.set_viewport_size({"width": 1000, "height": 700})
        page.wait_for_timeout(150)
        resized = selected.bounding_box()
        assert resized
        assert resized["x"] + resized["width"] >= 0
        assert resized["y"] + resized["height"] >= 0


def test_resize_lower_bound_and_native_animation_transform(playwright: Any) -> None:
    with harness(playwright, "manual") as h:
        page = h.open()
        selected = select_at(page, "#pet-art")
        assert selected.get_attribute("id") == "pet-inner"
        root(page).locator("#parent").click()
        selected = wait_for_target(page)
        assert selected.get_attribute("id") == "pet", "Parent should promote the visual wrapper"
        inner = page.locator("#pet-art .native-art")
        native_style = page.locator("#pet-inner").get_attribute("style")
        assert native_style and "transform" in native_style
        before = inner.evaluate("el => getComputedStyle(el).transform")
        animation_samples = [before]
        page.wait_for_timeout(140)
        animation_samples.append(inner.evaluate("el => getComputedStyle(el).transform"))
        assert len(set(animation_samples)) > 1, "fixture animation did not advance before resizing"
        set_scale_with_keyboard(page, "ArrowDown", 30)
        assert state_text(page) == "50%"
        set_scale_with_keyboard(page, "ArrowUp", 5)
        assert state_text(page) == "100%"
        after = inner.evaluate("el => getComputedStyle(el).transform")
        assert page.locator("#pet-inner").get_attribute("style") == native_style
        assert before != "none" and after != "none", "native animation transform was removed"
        assert selected.evaluate("el => el.querySelector('.native-art') !== null")


def test_native_root_transform_mutation_survives_docking(playwright: Any) -> None:
    with harness(playwright, "mutation") as h:
        page = h.open()
        select_at(page, "#pet-art")
        before = page.locator("#pet").get_attribute("style")
        assert before and "translateX(4px)" in before
        # Move the dock away from the fixture control so the normal page
        # pointer path remains testable while the dock is in its top layer.
        move = root(page).locator("#move")
        move.focus()
        for _ in range(10):
            page.keyboard.press("ArrowDown")
        page.locator("#mutate-transform").click()
        page.wait_for_timeout(250)
        mutated = page.locator("#pet").get_attribute("style")
        assert mutated and "translateX(28px)" in mutated and "rotate(13deg)" in mutated
        set_scale_with_keyboard(page, "ArrowUp", 5)
        after_scale = page.locator("#pet").get_attribute("style")
        assert after_scale and "translateX(28px)" in after_scale and "rotate(13deg)" in after_scale


def test_native_lifecycle_keeps_slot_and_live_appearance(playwright: Any) -> None:
    with harness(playwright, "auto") as h:
        page = h.open()
        wait_for_target(page)
        placeholder = page.locator("[data-dot-pet-dock-placeholder]")
        assert placeholder.count() == 1
        page.evaluate("document.querySelector('[data-dot-pet-dock-placeholder]')?.remove()")
        placeholder.wait_for(state="attached", timeout=2000)

        page.add_style_tag(
            content=".native-state { background-color: rgb(1, 22, 33) !important; color: rgb(4, 5, 6) !important; padding: 5px !important; }"
        )
        page.locator("#pet").evaluate("el => el.classList.add('native-state')")
        page.wait_for_timeout(150)
        appearance = page.locator("#pet").evaluate(
            "el => { const cs = getComputedStyle(el); return [cs.backgroundColor, cs.color, cs.padding]; }"
        )
        assert appearance == ["rgb(1, 22, 33)", "rgb(4, 5, 6)", "5px"]

        page.locator("#pet").evaluate("el => el.setAttribute('popover', 'auto')")
        page.wait_for_timeout(100)
        root(page).locator("#reset").click()
        page.wait_for_timeout(150)
        assert target(page).count() == 0
        assert page.locator("#pet").get_attribute("popover") == "auto"


def test_hidden_ancestor_hides_and_reconnects_saved_pet(playwright: Any) -> None:
    with harness(playwright, "hidden") as h:
        page = h.open()
        selected = select_at(page, "#pet-art")
        original = selected.bounding_box()
        assert original
        page.locator("#hide-pet").click()
        page.wait_for_timeout(250)
        assert not page.locator("#pet").is_visible()
        assert root(page).locator("#frame").is_hidden()
        page.locator("#show-pet").click()
        page.locator("#pet").wait_for(state="visible", timeout=2500)
        page.wait_for_timeout(250)
        assert target(page).count() == 1
        reconnected = page.locator("#pet").bounding_box()
        assert reconnected and reconnected["width"] > 0
        assert_near(reconnected["x"], original["x"], 10)


def test_disabling_extension_cleans_page_mutations(playwright: Any) -> None:
    with harness(playwright, "inline") as h:
        page = h.open()
        wait_for_target(page)
        extensions = h.context.new_page()
        extensions.goto("chrome://extensions/", wait_until="domcontentloaded")
        extensions.wait_for_selector("extensions-item", state="attached", timeout=5000)
        item = extensions.locator(f"extensions-item#{unpacked_extension_id()}")
        assert item.count() == 1, "loaded extension is missing from chrome://extensions"
        toggle = item.locator("#enableToggle")
        assert toggle.is_checked()
        toggle.click()
        for _ in range(25):
            if not toggle.is_checked():
                break
            extensions.wait_for_timeout(100)
        assert not toggle.is_checked()
        page.bring_to_front()
        page.locator("#dot-pet-dock-root").wait_for(state="detached", timeout=8000)
        assert target(page).count() == 0
        assert page.locator("#pet").get_attribute("style") == INLINE_STYLE
        extensions.close()


def test_unsafe_saved_identity_is_ignored_and_page_chrome_is_not_selectable(playwright: Any) -> None:
    with harness(playwright, "manual") as h:
        seed_extension_storage(
            h,
            {
                "identity": {"paths": ["[broken"], "tag": "main", "media": ["svg"]},
                "x": 120,
                "y": 90,
                "scale": 2,
                "locked": False,
            },
        )
        page = h.open()
        page.wait_for_timeout(500)
        assert target(page).count() == 0
        assert not h.errors, h.errors

        start_picker(page)
        sidebar = page.locator("#sidebar").bounding_box()
        assert sidebar
        page.mouse.click(*centre(sidebar))
        assert target(page).count() == 0
        root(page).locator("#picker").wait_for(state="visible")
        page.keyboard.press("Escape")
        root(page).locator("#picker").wait_for(state="hidden")


def test_small_destructive_ui_wrapper_is_not_a_pet(playwright: Any) -> None:
    with harness(playwright, "safety") as h:
        page = h.open()
        for selector in ("#bad-art", "#delete-conversation"):
            start_picker(page)
            box = page.locator(selector).bounding_box()
            assert box
            page.mouse.click(*centre(box))
            page.wait_for_timeout(100)
            assert target(page).count() == 0, f"picker selected destructive wrapper via {selector}"
            root(page).locator("#picker").wait_for(state="visible")
            page.keyboard.press("Escape")
            root(page).locator("#picker").wait_for(state="hidden")
        assert not h.errors, h.errors


def test_remounted_clone_styles_are_cleaned_by_reset(playwright: Any) -> None:
    with harness(playwright, "spa") as h:
        page = h.open()
        baseline = page.locator("#pet").get_attribute("style")
        assert baseline in (None, "")
        select_at(page, "#pet-art")
        page.locator("#remount").click()
        page.wait_for_timeout(500)
        remounted = wait_for_target(page)
        inherited_style = remounted.get_attribute("style") or ""
        assert "--dot-pet-dock-owned" in inherited_style or "position: fixed" in inherited_style
        assert remounted.get_attribute("popover") == "manual"

        page.evaluate(
            """() => {
              const host = document.querySelector('#dot-pet-dock-root');
              host.shadowRoot.querySelector('#reset').click();
            }"""
        )
        target(page).first.wait_for(state="detached", timeout=2500)
        assert target(page).count() == 0
        assert page.locator("#pet").get_attribute("style") in (None, "")
        assert page.locator("#pet").get_attribute("popover") is None

        start_picker(page)
        conversation = page.locator("#conversation").bounding_box()
        assert conversation
        page.mouse.click(*centre(conversation))
        assert target(page).count() == 0
        root(page).locator("#picker").wait_for(state="visible")
        page.keyboard.press("Escape")
        root(page).locator("#picker").wait_for(state="hidden")


def test_lock_reset_and_inline_style_restoration(playwright: Any) -> None:
    with harness(playwright, "inline") as h:
        page = h.open()
        # The semantic marker may auto-attach before the page settles. Keep
        # the fixture declaration as the authoritative pre-extension baseline
        # instead of racing the content script's first storage read.
        before = INLINE_STYLE
        wait_for_target(page)
        root(page).locator("#lock").click()
        assert target(page).count() == 1
        assert root(page).locator("#frame").is_hidden()
        assert page.locator("#pet").is_visible()

        page.evaluate(
            """() => {
              const host = document.querySelector('#dot-pet-dock-root');
              host.shadowRoot.querySelector('#reset').click();
            }"""
        )
        target(page).first.wait_for(state="detached", timeout=2000)
        assert target(page).count() == 0
        assert page.locator("#pet").get_attribute("style") == before
        page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(700)
        assert target(page).count() == 0, "reset opt-out was not honored after reload"
        assert page.locator("#pet").get_attribute("style") == before
        assert not h.errors, h.errors


def test_persist_reload_and_spa_reconnect(playwright: Any) -> None:
    with harness(playwright, "spa") as h:
        page = h.open()
        selected = select_at(page, "#pet-art")
        move = root(page).locator("#move")
        move_box = move.bounding_box()
        assert move_box
        start_x, start_y = centre(move_box)
        page.mouse.move(start_x, start_y)
        page.mouse.down()
        page.mouse.move(start_x + 90, start_y + 70, steps=4)
        page.mouse.up()
        set_scale_with_keyboard(page, "ArrowUp", 10)
        expected = selected.bounding_box()
        assert expected
        root(page).locator("#lock").click()

        # Reload immediately after the final keyboard input. This catches a
        # debounced storage write that is lost during a real browser reload.
        page.reload(wait_until="domcontentloaded")
        restored_immediately = wait_for_target(page)
        restored_box = restored_immediately.bounding_box()
        assert restored_box
        assert restored_box["width"] > 120
        assert_near(restored_box["x"], expected["x"], 10)
        assert root(page).locator("#frame").is_hidden(), "locked state was not persisted across reload"

        page.locator("#remount").click()
        page.wait_for_timeout(400)
        remounted = wait_for_target(page)
        assert remounted.get_attribute("id") == "pet"
        remounted_box = remounted.bounding_box()
        assert remounted_box
        assert_near(remounted_box["x"], expected["x"], 8)
        assert_near(remounted_box["y"], expected["y"], 8)
        assert remounted_box["width"] > 120

        page.locator("#spa-nav").click()
        page.wait_for_timeout(500)
        assert page.url.startswith("https://chatgpt.com/c/second-conversation")
        navigated = wait_for_target(page)
        assert navigated.get_attribute("id") == "pet"
        page.reload(wait_until="domcontentloaded")
        restored = wait_for_target(page)
        restored_box = restored.bounding_box()
        assert restored_box
        assert restored_box["width"] > 120
        assert_near(restored_box["x"], expected["x"], 10)


def test_stale_identity_recovery_and_absence(playwright: Any) -> None:
    with harness(playwright, "stale") as h:
        page = h.open()
        select_at(page, "#pet-art")
        page.locator("#replace-pet").click()
        page.wait_for_timeout(600)
        recreated = wait_for_target(page)
        assert recreated.get_attribute("id") == "pet-recreated"
        assert not h.errors, h.errors

    with harness(playwright, "absence") as h:
        page = h.open()
        page.wait_for_timeout(700)
        assert target(page).count() == 0
        assert root(page).count() == 1
        assert not h.errors, h.errors


def test_canvas_auto_detection(playwright: Any) -> None:
    with harness(playwright, "canvas") as h:
        page = h.open()
        selected = wait_for_target(page)
        assert selected.get_attribute("id") == "pet"
        assert page.locator("#pet-canvas").count() == 1
        assert page.locator("#pet-canvas").evaluate("el => el.width") == 120
        assert not h.errors, h.errors


def test_saved_opt_out_wins_over_early_page_lifecycle(playwright: Any) -> None:
    """Control storage-read latency to exercise the initialization race.

    The other cases load the unpacked extension. This one runs the same scripts
    in a fixture with a delayed storage API so pageshow precedes saved state.
    """
    options = {"headless": True, "channel": "chromium"}
    if os.getenv("CHROME_EXECUTABLE"):
        options["executable_path"] = os.environ["CHROME_EXECUTABLE"]
    browser = playwright.chromium.launch(**options)
    try:
        page = browser.new_page()
        page.set_content(fixture_html("auto"))
        page.evaluate(
            """() => {
              chrome.runtime = {id:'fixture', getManifest:()=>({}),
                onMessage:{addListener(){},removeListener(){}}};
              chrome.storage = {local:{
                get:async()=>{
                  await new Promise(resolve=>setTimeout(resolve, 1000));
                  window.fixtureStorageLoaded = true;
                  return {'dot-pet-dock:v2':{disabled:true}};
                },
                set:async()=>{}
              }};
            }"""
        )
        page.add_script_tag(path=str(ROOT / "targeting.js"))
        page.add_script_tag(path=str(ROOT / "content.js"))
        page.evaluate("dispatchEvent(new PageTransitionEvent('pageshow'))")
        page.wait_for_timeout(150)
        assert target(page).count() == 0, "pet attached before saved settings loaded"
        page.wait_for_function("() => window.fixtureStorageLoaded === true")
        page.wait_for_timeout(100)
        assert target(page).count() == 0, "saved Reset opt-out was overridden by early recovery"
        assert page.locator("#pet").get_attribute("style") is None
    finally:
        browser.close()


def test_popup_controls_render_against_extension_page(playwright: Any) -> None:
    """Exercise the real popup page and its message path to the real tab.

    Opening popup.html as a normal tab makes it the active extension tab, so
    Chrome's native active-tab query would select the popup itself. The init
    hook only adapts tab enumeration to the fixture tab; ``tabs.sendMessage``
    remains Chrome's real API and reaches the content script under test.
    """

    with harness(playwright, "auto") as h:
        page = h.open()
        for other in list(h.context.pages):
            if other is not page and other.url == "about:blank":
                other.close()
        extension_id = unpacked_extension_id()
        popup = h.context.new_page()
        popup.add_init_script(
            """
            (() => {
              const getWindows = chrome.windows.getAll.bind(chrome.windows);
              chrome.tabs.query = async () => {
                const windows = await getWindows({populate: true});
                return windows.flatMap(window => window.tabs || [])
                  .filter(tab => !String(tab.url || '').startsWith('chrome-extension://'))
                  .map(tab => ({...tab, url: 'https://chatgpt.com/c/fixture'}));
              };
            })();
            """
        )
        popup.goto(f"chrome-extension://{extension_id}/popup.html", wait_until="domcontentloaded")
        popup.locator("#status", has_text="Pet selected").wait_for(state="visible", timeout=3000)
        assert popup.locator("#scale").input_value() == "100"
        assert popup.locator("#reset").is_enabled()
        assert popup.locator("#lock").is_enabled()
        popup.locator("#scale").evaluate(
            """el => {
              for (const value of [150, 290, 240]) {
                el.value = String(value);
                el.dispatchEvent(new Event('input', {bubbles:true}));
              }
              el.dispatchEvent(new Event('change', {bubbles:true}));
            }"""
        )
        page.wait_for_function("() => getComputedStyle(document.querySelector('#pet')).zoom === '2.4'")
        assert popup.locator("#scale").input_value() == "240", "rapid slider input lost the final value"
        popup.locator("#lock").check()
        assert "Pet docked" in (popup.locator("#status").text_content() or "")
        page.bring_to_front()
        assert root(page).locator("#frame").is_hidden()
        popup.bring_to_front()
        popup.wait_for_timeout(150)
        assert popup.locator("#lock").is_checked()
        popup.locator("#lock").click()
        popup.wait_for_timeout(150)
        assert not popup.locator("#lock").is_checked()
        assert "Pet selected" in (popup.locator("#status").text_content() or "")
        page.bring_to_front()
        assert not root(page).locator("#frame").is_hidden()
        popup.bring_to_front()
        popup.locator("#reset").click()
        page.bring_to_front()
        target(page).first.wait_for(state="detached", timeout=2000)
        popup.close()


def test_popup_scale_survives_close_with_delayed_replies(playwright: Any) -> None:
    """Each slider input must reach the tab before the popup disappears.

    The wrapper invokes Chrome's native sendMessage immediately, but delays
    resolving its Promise. Closing the popup while the first reply is pending
    therefore models a real slow content-script response without allowing a
    synthetic timer to stand in for the IPC call itself.
    """

    with harness(playwright, "auto") as h:
        page = h.open()
        for other in list(h.context.pages):
            if other is not page and other.url == "about:blank":
                other.close()
        popup = h.context.new_page()
        popup.add_init_script(
            """
            (() => {
              const getWindows = chrome.windows.getAll.bind(chrome.windows);
              chrome.tabs.query = async () => {
                const windows = await getWindows({populate: true});
                return windows.flatMap(window => window.tabs || [])
                  .filter(tab => !String(tab.url || '').startsWith('chrome-extension://'))
                  .map(tab => ({...tab, url: 'https://chatgpt.com/c/fixture'}));
              };
              const nativeSendMessage = chrome.tabs.sendMessage.bind(chrome.tabs);
              window.__dockScaleCalls = [];
              chrome.tabs.sendMessage = (...args) => {
                const message = args[1] || {};
                if (message.action === 'SET_SCALE') window.__dockScaleCalls.push(message.scale);
                let reply;
                try {
                  // Invoke the real extension API before adding latency to the
                  // response. A popup close cannot cancel this IPC request.
                  reply = nativeSendMessage(...args);
                } catch (error) {
                  return Promise.reject(error);
                }
                return Promise.resolve(reply).then(value => new Promise(resolve => {
                  window.setTimeout(() => resolve(value), 100);
                }));
              };
            })();
            """
        )
        try:
            popup.goto(f"chrome-extension://{unpacked_extension_id()}/popup.html", wait_until="domcontentloaded")
            popup.locator("#status", has_text="Pet selected").wait_for(state="visible", timeout=3000)

            popup.locator("#scale").evaluate(
                """el => {
                  el.value = '150';
                  el.dispatchEvent(new Event('input', {bubbles:true}));
                }"""
            )
            # Let the first zero-delay send task run, leaving its reply pending
            # under the wrapper above before later values are dispatched.
            popup.wait_for_timeout(0)
            assert popup.evaluate("() => window.__dockScaleCalls") == [1.5]
            popup.locator("#scale").evaluate(
                """el => {
                  for (const value of ['290', '240']) {
                    el.value = value;
                    el.dispatchEvent(new Event('input', {bubbles:true}));
                  }
                }"""
            )
            # Close immediately. The content script must already have received
            # both later native requests; delayed popup replies are irrelevant.
            popup.close()

            page.wait_for_function("() => getComputedStyle(document.querySelector('#pet')).zoom === '2.4'", timeout=3000)
            page.reload(wait_until="domcontentloaded")
            wait_for_target(page)
            page.wait_for_function("() => getComputedStyle(document.querySelector('#pet')).zoom === '2.4'", timeout=3000)
        finally:
            if not popup.is_closed():
                popup.close()


TESTS: dict[str, Callable[[Any], None]] = {
    "auto": test_auto_detect_and_svg_parent,
    "button-pet": test_interactive_marked_button_pet_auto_manual_and_reset,
    "clipped": test_manual_select_drag_resize_and_clipped_transform,
    "layout": test_in_flow_layout_slot_does_not_shift_following_content,
    "viewport": test_viewport_resize_and_saved_position_recovery,
    "scale": test_resize_lower_bound_and_native_animation_transform,
    "mutation": test_native_root_transform_mutation_survives_docking,
    "lifecycle": test_native_lifecycle_keeps_slot_and_live_appearance,
    "hidden": test_hidden_ancestor_hides_and_reconnects_saved_pet,
    "disable": test_disabling_extension_cleans_page_mutations,
    "safety": test_unsafe_saved_identity_is_ignored_and_page_chrome_is_not_selectable,
    "bad-ui": test_small_destructive_ui_wrapper_is_not_a_pet,
    "clone-reset": test_remounted_clone_styles_are_cleaned_by_reset,
    "reset": test_lock_reset_and_inline_style_restoration,
    "persistence": test_persist_reload_and_spa_reconnect,
    "stale": test_stale_identity_recovery_and_absence,
    "canvas": test_canvas_auto_detection,
    "popup": test_popup_controls_render_against_extension_page,
    "popup-close": test_popup_scale_survives_close_with_delayed_replies,
    "startup-latency": test_saved_opt_out_wins_over_early_page_lifecycle,
}


def run(selected: str | None = None) -> int:
    names = [selected] if selected else list(TESTS)
    unknown = [name for name in names if name not in TESTS]
    if unknown:
        raise SystemExit(f"Unknown test name(s): {', '.join(unknown)}. Choose from: {', '.join(TESTS)}")

    failures: list[tuple[str, BaseException]] = []
    with sync_playwright() as playwright:
        for name in names:
            try:
                TESTS[name](playwright)
                print(f"PASS {name}")
            except BaseException as error:  # keep remaining cases useful
                failures.append((name, error))
                print(f"FAIL {name}: {error}")
                traceback.print_exc()
    if failures:
        print(f"{len(failures)} of {len(names)} browser integration test(s) failed.")
        return 1
    print(f"PASS: {len(names)} browser tests (startup-latency uses a controlled storage API)")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--test", choices=sorted(TESTS), help="run one browser case")
    raise SystemExit(run(parser.parse_args().test))
