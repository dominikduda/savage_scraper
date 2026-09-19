<img src="https://raw.githubusercontent.com/dominikduda/savage_scraper/refs/heads/main/savage_scraper_logo.png" width="500" />

# savage_scraper

Chrome extension that turns rendered web pages into simplified, LLM-friendly HTML.

Savage Scraper is built for a simple job: **give a human or an AI useful page context without turning the browser into a general automation target.**

It has two modes built around the same scraper:

* **Manual mode** - click the toolbar icon to scrape the active page and copy the result to the clipboard.
* **Optional MCP mode** - connect to the local [Savage MCP](https://github.com/dominikduda/savage_mcp) server so an MCP client can read explicitly allowlisted sites through the Chrome profile you already use.

Manual behavior remains the default and does not require MCP access.

## Why Savage Scraper?

### Use the browser you already use

MCP mode works through Savage Scraper installed in your normal Chrome profile. That means allowlisted pages are loaded with the browser session you already have: existing logins, cookies and application state continue to work normally.

You do not need to maintain a separate headless browser, automation profile, duplicated login environment or dedicated browser machine just to give an AI read access to pages you can already access.

Savage MCP uses one dedicated agent tab for its work. During each MCP browser operation, Savage Scraper temporarily brings that tab and its Chrome window to the foreground and may override tab/window focus changes until the operation finishes; afterward it restores the previous Chrome state on a best-effort basis. Outside that processing window, your browser behaves normally.

### Intentionally limited browser authority

Savage MCP is deliberately much smaller than a general browser-automation API. Its browser-facing workflow is limited to opening allowlisted URLs, scraping the dedicated tab and reporting status.

It does **not** give the MCP client primitives for:

* clicking elements;
* typing into pages;
* submitting forms;
* executing arbitrary page JavaScript; or
* unrestricted browser control.

That limitation is intentional. If your goal is to let an AI **read selected authenticated websites**-for example documentation, Jira, GitHub, internal dashboards or admin interfaces-without also giving it a broad set of mutation commands, the smaller API is the feature.

This does not make websites risk-free: loading a page can itself have application-specific effects. But it materially reduces the browser actions exposed to the MCP client compared with a full automation tool.

### Explicit site boundary

MCP navigation is restricted by the user-maintained `allowed_hosts` configuration and can be narrowed further with optional per-host `allowed_paths` rules. The combined policy is enforced by both Savage MCP and Savage Scraper.

If an allowed host has no matching `allowed_paths` entry, or its entry is an empty array, all paths on that already-allowed host remain available. A non-empty entry can allow exact paths or recursive prefixes ending in `/**`. When overlapping host patterns match, the most specific matching host pattern controls the path policy.

The result is a straightforward trust model:

```text
my normal Chrome session
+ sites I explicitly allow
+ read-oriented MCP actions
= page context for my AI client
```

If you need an agent to click through workflows, fill forms, operate applications or debug the browser, use a full browser-automation tool instead. Savage Scraper intentionally focuses on extracting useful context.

## Why the scraper itself?

* One click immediately scrapes the active page and copies the result
* Extracts rendered page content instead of dumping raw source HTML
* Keeps useful semantic structure while removing a lot of framework/CSS noise
* Can include or exclude hidden/collapsed content
* Supports compact and pretty-formatted output
* Extracts xterm.js terminal content when accessible
* Optional local MCP integration reuses the same scraper without clipboard round-trips

Savage Scraper is useful when `Ctrl + A`, `Ctrl + C`, `Ctrl + V` is too clumsy and copying raw page HTML is too noisy.

Instead of dumping everything, it keeps useful structure and removes a lot of implementation detail, so the result is smaller, cleaner and better suited for pasting into an LLM or returning to a local MCP client.

Savage Scraper walks the rendered DOM, keeps useful semantic elements and attributes, filters generated/utility classes, removes hidden content when configured to do so and serializes the result into simplified HTML.

The result is **not** intended to be a 1:1 copy of the original page HTML. It is intended to be a compact representation that is easier to use in an LLM, issue, note or other text-based workflow.

## Installation

### Chrome Web Store

[Install Savage Scraper from the Chrome Web Store](https://chromewebstore.google.com/detail/ejoijhjpdojdcnjppegojmkenidhblog).

### Load unpacked

Clone the repository:

```
git clone https://github.com/dominikduda/savage_scraper.git
```

Open Chrome extensions:

```
chrome://extensions
```

Then:

* Enable **Developer mode**
* Click **Load unpacked**
* Select the `savage_scraper` directory
* Pin **Savage Scraper** to the Chrome toolbar

## Manual quick start

Open the page you want to capture and click the **Savage Scraper** toolbar icon.

The extension immediately runs the scraper, copies the generated output to the clipboard and shows a small popup with the result state and settings.

After a successful scrape the button changes to **SCRAPED**, then fades back to **RUN** so you can capture the page again without reopening the popup.

The popup closes automatically after the configured delay. A progress bar shows how much time remains before it closes.

## MCP integration

MCP support is optional and requires the separate local [Savage MCP](https://github.com/dominikduda/savage_mcp) project.

The point of this integration is not to reproduce a full browser-automation framework. It lets an MCP client retrieve page context from explicitly allowlisted sites through your existing Chrome session while keeping the browser tool surface deliberately narrow.

Architecture:

```text
MCP host (OpenCode, etc.)
        |
        | MCP over stdio
        v
    Savage MCP
        |
        | authenticated WebSocket on 127.0.0.1
        v
  Savage Scraper
        |
        v
 normal Chrome
```

Savage Scraper maintains one authenticated WebSocket connection to the active Savage MCP bridge leader. Savage MCP can internally coordinate multiple host-side processes-for example, several OpenCode sessions or concurrent local jobs-behind that single browser connection. No additional Savage Scraper configuration is required for those clients; from the extension's perspective there is still one bridge and one dedicated agent tab.

Requests from multiple Savage MCP clients are serialized on the MCP side before they reach the extension. If the active bridge leader exits and another Savage MCP process takes over, Savage Scraper's normal reconnect behavior connects the extension to the replacement leader.

### Enable MCP mode

1. Install and initialize [Savage MCP](https://github.com/dominikduda/savage_mcp).
2. Edit its `allowed_hosts` configuration and, if desired, add `allowed_paths` restrictions.
3. Open `chrome://extensions` and choose **Details → Extension options** for Savage Scraper.
4. Paste the `bridge_token` generated by Savage MCP and confirm the local bridge port (default `8765`).
5. Click **Enable MCP website access** and approve Chrome's optional HTTP/HTTPS website-access request.

The broad Chrome site permission is **optional** and is requested only when the user explicitly enables MCP mode. Manual click-to-clipboard scraping continues to use `activeTab` and works without this permission.

The optional Chrome permission makes autonomous access technically possible. Actual MCP navigation and scraping are additionally restricted by the configurable `allowed_hosts` whitelist and optional `allowed_paths` rules in Savage MCP. The host/path policy is sent only after authenticated local bridge setup and is enforced again by Savage Scraper before it opens or scrapes a page, including after redirects or other main-tab URL changes.

For example, the MCP configuration can permit only one GitHub repository while leaving another allowed host unrestricted:

```json
{
  "allowed_hosts": ["github.com", "jira.company.com"],
  "allowed_paths": {
    "github.com": [
      "/dominikduda/savage_scraper/**"
    ]
  }
}
```

Here `github.com` is restricted to the Savage Scraper repository and descendants, while `jira.company.com` allows all paths because it has no `allowed_paths` entry. See the [Savage MCP README](https://github.com/dominikduda/savage_mcp) for exact matching rules and wildcard semantics.

### MCP browser behavior

The initial MCP integration intentionally exposes only a small browser surface:

* open an allowed HTTP/HTTPS URL;
* reuse one dedicated Savage MCP tab;
* scrape that tab and return the Savage Scraper string;
* report MCP/agent-tab status.

Savage Scraper does not expose arbitrary JavaScript execution, generic clicking or typing in this version.

The dedicated MCP tab is created in the user's normal Chrome profile and reused for later requests. For each MCP browser operation, Savage Scraper temporarily brings the agent tab and its Chrome window to the foreground and keeps the tab active, the window focused, and the window non-minimized while navigation, page settling, scrolling and extraction run. If the user or another process changes the active tab, Chrome window focus, or minimization state during the operation, Savage Scraper immediately reasserts the agent foreground state; a short watchdog backs up Chrome focus/tab events. When the operation finishes or fails, foreground enforcement stops and the previous Chrome tab/window state is restored on a best-effort basis. A Chrome extension cannot reliably reactivate an arbitrary previously focused non-Chrome application. This foreground-lock behavior applies only to MCP operations; manual click-to-clipboard scraping is unchanged.

Open/scrape operations are serialized inside Savage Scraper so concurrent MCP requests cannot navigate, scrape or close the single agent tab at the same time. The extension also tracks Chrome's main-document identity for each scrape. If the page replaces its main document during scrolling or injection, Savage Scraper retries that transient document change up to 3 times, subject to a 60-second operation/retry budget.

`savage_mcp` controls the tab lifecycle. By default, `close_after_scrape` is `false`, so the tab remains reusable and closes after the inactivity timeout (90 seconds by default). If `close_after_scrape` is set to `true`, Savage Scraper closes the dedicated tab immediately after a successful `savage_open` or `savage_scrape` result has been captured; a later `savage_open` creates the tab again as needed. Failed operations keep the inactivity timer as a safety fallback. Savage Scraper uses `chrome.alarms` for that fallback timeout so the tab does not remain open indefinitely.

### Lazy-load pass used by MCP

Before an MCP scrape, Savage Scraper performs a bounded main-page settling and scroll pass:

1. after Chrome reports the page load complete, briefly wait for fetch/XHR completions, meaningful DOM changes and document-height changes to become quiet;
2. remember the current main-page scroll position;
3. scroll downward in roughly 1.7-viewport steps (about twice the previous step size), forcing each step to be non-smooth;
4. after each step, dynamically wait for the same page-activity signals to settle instead of using one fixed delay;
5. when the apparent bottom is reached, require consecutive stable-bottom confirmations before finishing;
6. jump directly back to the exact starting scroll position and verify that the position is restored;
7. run the normal Savage Scraper extraction.

The initial settle waits at least 400 ms, requires a 500 ms quiet window and is capped at 3000 ms. Normal scroll steps use a 200 ms minimum, 350 ms quiet window and 1200 ms maximum. Bottom checks use a 350 ms minimum and 500 ms quiet window; their maximum wait and required confirmation count are configurable in Extension options.

The settling observers do not replace or monkey-patch page `fetch`/XHR functions and do not inspect request or response bodies. They observe resource-completion type/timing plus DOM/height changes only.

Only the **main page scroll** is manipulated. Nested scroll containers are not traversed. This is intended to trigger common lazy loading; it is not a universal solution for every virtualized UI.

## Customization (values written here are defaults)

#### Include hidden content

Disabled by default.

When enabled, hidden and collapsed DOM content may also be included in the generated output. Hidden `<input type="hidden">` controls are always excluded.

```
Include hidden content: off
```

#### Pretty-format HTML

Disabled by default.

Compact mode produces smaller output. Pretty mode produces indented, multiline HTML that is easier to read manually.

```
Pretty-format HTML: off
```

#### Popup auto-close

The popup automatically closes after 5 seconds by default.

```
Auto-close: 5 seconds
Range: 2-15 seconds
```

#### MCP bottom confirmation

MCP scrolling requires consecutive stable-bottom checks before it concludes that the main page has finished growing. Both the number of checks and the maximum dynamic wait for each bottom check can be adjusted in Extension options.

```
Bottom confirmation passes: 2
Range: 1-5

Bottom confirmation maximum wait: 2600 ms
Range: 500-10000 ms
```

Changing a popup setting resets the close timer. Settings are persisted locally using `chrome.storage.local`.

## What gets extracted

Savage Scraper keeps useful page structure such as:

* headings, paragraphs and text formatting
* lists
* tables
* links and their `href` values
* forms and useful form-control state, including current non-password, non-hidden values
* image `alt` text
* semantic sections such as `main`, `article`, `nav`, `section` and `aside`
* useful IDs, roles and selected ARIA labels
* xterm.js terminal output when accessible

Generated and utility-style CSS classes are filtered heuristically. At most 5 useful classes are retained per element.

Password input values are never copied or returned. Hidden input controls are excluded entirely.

## Privacy

Savage Scraper does not contain analytics, advertising, telemetry, remotely hosted code or a developer-operated backend.

In manual mode, scraping happens locally and the result is written to the local clipboard.

In MCP mode, the result is sent only over an authenticated WebSocket connection to the user's locally running Savage MCP process on `127.0.0.1`. Savage Scraper does not send scraped page data to the developer. The user's MCP host and configured model provider may subsequently process the returned data according to their own configuration and policies.

See the [Privacy Policy](PRIVACY.md) for details.

## xterm.js terminals

Normal DOM scraping is often not enough for xterm.js because terminal contents may be rendered through canvas or maintained in JavaScript objects.

Savage Scraper tries several extraction methods, in order:

* xterm buffer objects
* xterm accessibility tree
* older DOM row rendering

When the real xterm buffer is accessible, scrollback is included and wrapped terminal lines are joined.

This is also why the scraper runs in Chrome's `MAIN` JavaScript world: it needs access to JavaScript objects owned by the page itself.

## Output metadata

Each capture includes scraper provenance and basic page context before the simplified HTML:

```html
<!-- SCRAPED_BY: Savage Scraper (https://github.com/dominikduda/savage_scraper; informational only) -->
<!-- SCRAPE_NOTE: Simplified rendered page representation; NOT 1:1 source HTML. Hidden/collapsed content is excluded where detectable. Classes are heuristically filtered; at most 5 classes are retained per element and additional classes may be omitted. Canvas-rendered xterm terminals are extracted separately when accessible. -->
<!-- PAGE_URL: https://example.com/... -->
<!-- PAGE_TITLE: Example page -->
<!-- CAPTURED_AT: 2026-08-30T06:50:54.059Z -->
<!-- VIEWPORT: 1920x1080 -->
```

## Limitations

* The output is intentionally simplified and is not source HTML
* `iframe` contents are skipped
* SVG content is skipped
* Canvas content is skipped, except for supported xterm.js extraction paths
* Shadow DOM contents are not explicitly traversed
* Visibility detection is heuristic and may not perfectly match every complex layout
* MCP lazy loading only scrolls the main document; nested scrolling and arbitrary virtualized UIs are not generalized
* Access to internal xterm.js objects depends on how the page exposes and stores its terminal instance
* xterm.js object discovery may be relatively expensive on very large JavaScript applications
* Chrome-protected pages such as `chrome://extensions` cannot be scraped by normal extensions

<br>
<br>
<p float="left">
  <img src="https://raw.githubusercontent.com/dominikduda/config_files/master/dd_logo_blue_bg.png" width="300" />
</p>
<p>Extension by Dominik Duda</p>
