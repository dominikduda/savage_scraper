<img src="https://raw.githubusercontent.com/dominikduda/savage_scraper/refs/heads/main/savage_scrapper_logo.png" width="500" />

# savage_scraper

Chrome extension that turns the current page into a simplified, LLM-friendly HTML representation and copies it directly to your clipboard.

##### Why should you use it?

* One click immediately scrapes the active page and copies the result
* Extracts rendered page content instead of dumping raw source HTML
* Keeps useful semantic structure while removing a lot of framework/CSS noise
* Can include or exclude hidden/collapsed content
* Supports compact and pretty-formatted output
* Extracts xterm.js terminal content when accessible

Savage Scraper is useful when `Ctrl + A`, `Ctrl + C`, `Ctrl + V` is too clumsy and copying raw page HTML is too noisy.

Instead of dumping everything, it keeps useful structure and removes a lot of implementation detail, so the result is smaller, cleaner and better suited for pasting into an LLM.

##### Most importantly, it tries to preserve the information that matters while producing much less noise than copying the page source.

Savage Scraper walks the rendered DOM, keeps useful semantic elements and attributes, filters generated/utility classes, removes hidden content when configured to do so and serializes the result into simplified HTML.

The result is **not** intended to be a 1:1 copy of the original page HTML. It is intended to be a compact representation that is easier to paste into an LLM, issue, note or other text-based workflow.

## Installation

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

## Quick start

Open the page you want to capture and click the **Savage Scraper** toolbar icon.

The extension immediately runs the scraper, copies the generated output to the clipboard and shows a small popup with the result state and settings.

After a successful scrape the button changes to **SCRAPED**, then fades back to **RUN** so you can capture the page again without reopening the popup.

The popup closes automatically after the configured delay. A progress bar shows how much time remains before it closes.

## Customization (values written here are defaults)

#### Include hidden content:

Disabled by default.

When enabled, hidden and collapsed DOM content may also be included in the generated output.

```
Include hidden content: off
```

#### Pretty-format HTML:

Disabled by default.

Compact mode produces smaller output. Pretty mode produces indented, multiline HTML that is easier to read manually.

```
Pretty-format HTML: off
```

#### Popup auto-close:

The popup automatically closes after 5 seconds by default.

```
Auto-close: 5 seconds
Range: 2-15 seconds
```

Changing a setting resets the close timer. Settings are persisted locally using `chrome.storage.local`.

## What gets extracted

Savage Scraper keeps useful page structure such as:

* headings, paragraphs and text formatting
* lists
* tables
* links and their `href` values
* forms and useful form-control state
* image `alt` text
* semantic sections such as `main`, `article`, `nav`, `section` and `aside`
* useful IDs, roles and selected ARIA labels
* xterm.js terminal output when accessible

Generated and utility-style CSS classes are filtered heuristically. At most 5 useful classes are retained per element.

Password input values are never copied.

## xterm.js terminals

Normal DOM scraping is often not enough for xterm.js because terminal contents may be rendered through canvas or maintained in JavaScript objects.

Savage Scraper tries several extraction methods, in order:

* xterm buffer objects
* xterm accessibility tree
* older DOM row rendering

When the real xterm buffer is accessible, scrollback is included and wrapped terminal lines are joined.

This is also why the scraper runs in Chrome's `MAIN` JavaScript world: it needs access to JavaScript objects owned by the page itself.

## Output metadata

Each capture includes basic page context before the simplified HTML:

```html
<!-- SAVAGE_SCRAPER: simplified rendered page representation; NOT 1:1 source HTML. ... -->
<!-- PAGE_URL: https://example.com/... -->
<!-- PAGE_TITLE: Example page -->
<!-- CAPTURED_AT: 2026-08-29T12:00:00.000Z -->
<!-- VIEWPORT: 1920x1080 -->
```

## Limitations

* The output is intentionally simplified and is not source HTML
* `iframe` contents are skipped
* SVG content is skipped
* Canvas content is skipped, except for supported xterm.js extraction paths
* Shadow DOM contents are not explicitly traversed
* Visibility detection is heuristic and may not perfectly match every complex layout
* Access to internal xterm.js objects depends on how the page exposes and stores its terminal instance
* xterm.js object discovery may be relatively expensive on very large JavaScript applications
* Chrome-protected pages such as `chrome://extensions` cannot be scraped by normal extensions

<br>
<br>
<p float="left">
  <img src="https://raw.githubusercontent.com/dominikduda/config_files/master/dd_logo_blue_bg.png" width="300" />
</p>
<p>Extension by Dominik Duda</p>

