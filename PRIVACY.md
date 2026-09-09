# Savage Scraper Privacy Policy

Effective date: September 9, 2026

Savage Scraper is a Chrome extension that converts rendered web-page content into a simplified HTML representation for two closely related user-facing workflows:

1. manual capture, where the user invokes Savage Scraper and the generated representation is copied to the user's local clipboard; and
2. optional local MCP integration, where the user explicitly enables MCP website access and Savage Scraper returns the generated representation to the user's locally running `savage_mcp` process.

Savage Scraper does not operate a developer-controlled backend service.

## Data processed

When Savage Scraper captures a page, the extension may process data present on that page, including:

- rendered website text and semantic page structure;
- the current page URL and title;
- useful element attributes such as links, labels and selected ARIA information;
- current values and state of ordinary form controls;
- xterm.js terminal content when it is accessible to the page and the extension;
- hidden or collapsed page content when the user explicitly enables the **Include hidden content** setting; and
- in MCP mode, transient page-settling signals such as relevant DOM mutations, document-height changes and whether browser resource entries report a `fetch` or XHR completion.

The MCP page-settling logic does not read request or response bodies for this purpose and does not persist or return the observed settling signals.

Password input values are never included. `<input type="hidden">` controls are excluded entirely, including when **Include hidden content** is enabled.

Because arbitrary website content may contain personal or sensitive information, Savage Scraper may process such information when it is part of a page the user manually captures or a page accessed through the user's explicitly enabled, locally configured MCP workflow. Savage Scraper does not attempt to classify the sensitivity of page content.

## Manual mode

In manual mode, the user explicitly invokes Savage Scraper on the active tab. The extension generates the simplified page representation locally and writes it to the user's local system clipboard.

Manual mode uses Chrome's temporary `activeTab` access and does not require the optional broad HTTP/HTTPS host permission used by MCP mode.

## Optional MCP mode

MCP mode is disabled by default.

To enable it, the user must:

- install and run the separate `savage_mcp` program on the same computer;
- configure `savage_mcp` with an explicit `allowed_hosts` whitelist;
- configure the matching local bridge token/port in Savage Scraper's options page; and
- explicitly approve Chrome's optional HTTP/HTTPS host-access permission.

When MCP mode is enabled, Savage Scraper can open and scrape only HTTP/HTTPS URLs permitted by the `allowed_hosts` configuration received from the authenticated local `savage_mcp` process. Savage Scraper validates the whitelist again on the extension side before opening or scraping a page.

Before an MCP capture, Savage Scraper waits briefly after Chrome reports the normal page load complete and during its main-page lazy-load scroll pass. It uses bounded quiet windows based on relevant DOM mutations, document-height changes and `fetch`/XHR resource completions so dynamically rendered content has an opportunity to appear. Savage Scraper then restores the initial main-page scroll position before running the normal scraper. Nested scroll containers are not traversed.

Savage Scraper maintains at most one dedicated MCP agent tab. By default it closes that tab after the inactivity timeout supplied by `savage_mcp`. If the user enables `close_after_scrape` in the local `savage_mcp` configuration, Savage Scraper instead closes the dedicated tab immediately after a successful MCP scrape result has been captured; the inactivity timeout remains a safety fallback for failed operations.

## How data is used

Page data is used only to provide Savage Scraper's disclosed single purpose: generating a simplified representation of rendered web-page content for the user's manual clipboard workflow or explicitly enabled local MCP workflow.

Savage Scraper does not use page data for advertising, profiling, analytics, tracking, creditworthiness or unrelated purposes.

## Data transmission and sharing

Savage Scraper does not send scraped page content, page URLs, form values, terminal output or extension usage data to the developer or to a developer-operated service.

The extension contains no analytics, advertising, telemetry or remotely hosted executable code.

In manual mode, the generated result is written to the user's local system clipboard. After that, clipboard contents are controlled by the user's operating system and applications into which the user chooses to paste them.

In MCP mode, the generated result is sent over a WebSocket connection bound to the loopback interface (`127.0.0.1`) to the user's locally running `savage_mcp` process on the same computer. The bridge uses a shared secret for mutual authentication. The bridge token itself is not sent over the WebSocket.

`savage_mcp` returns the result to the user's chosen MCP host. That MCP host, and any model provider configured by the user in that host, may process the returned page content according to their own configuration, privacy policy and data practices. Savage Scraper does not control those third-party or user-configured services.

## Data storage and retention

Scraped page content is processed in memory and is not persistently stored by Savage Scraper.

Savage Scraper stores user-configurable settings in `chrome.storage.local`, including:

- whether hidden/collapsed content should be included;
- whether generated HTML should be pretty-formatted;
- the popup auto-close delay;
- whether MCP integration is enabled;
- the local MCP bridge port;
- the local MCP bridge authentication token;
- the MCP bottom-confirmation pass count; and
- the MCP bottom-confirmation maximum wait.

The dedicated MCP agent-tab identifier is stored only in `chrome.storage.session` so the Manifest V3 service worker can continue managing that tab while the browser session is active.

These settings remain on the user's device until the user changes them, clears extension storage or removes the extension.

## Chrome permissions

Savage Scraper uses the following required Chrome extension permissions:

- `activeTab` — temporary access to the current tab after the user explicitly invokes manual scraping;
- `scripting` — to run the packaged scraper and MCP page-settling/lazy-load scroll code on a page the extension is authorized to access;
- `storage` — to store extension preferences, local MCP bridge settings and the session-scoped MCP tab identifier;
- `clipboardWrite` — to copy manual capture output to the user's clipboard;
- `alarms` — to reliably close the dedicated MCP agent tab after inactivity and to maintain/recover the explicitly enabled local MCP bridge across Manifest V3 service-worker suspension.

Savage Scraper also declares optional HTTP/HTTPS host permissions. These permissions are **not requested at installation**. Chrome asks for them only after the user opens Savage Scraper's options and explicitly chooses **Enable MCP website access**. They are necessary for autonomous MCP-triggered scraping because there is no per-page toolbar click that would create a temporary `activeTab` grant.

The extension's MCP logic separately restricts actual navigation and scraping to the user's `allowed_hosts` whitelist supplied by the authenticated local `savage_mcp` process.

## Local bridge security

The optional MCP bridge connects only to `ws://127.0.0.1:<configured-port>`.

The bridge uses challenge-response HMAC authentication based on a shared local token. The token remains in local configuration/storage and is not transmitted directly. Savage Scraper accepts MCP commands only after successful authentication and only supports the fixed actions implemented by the packaged extension code. It does not execute arbitrary JavaScript or remotely supplied executable code.

## Chrome Web Store Limited Use

Savage Scraper's use of information received through Chrome APIs is limited to its disclosed single purpose and user-facing features. Scraped data is not used or transferred for advertising, profiling or unrelated purposes, and the developer does not permit humans to read user data except where required by applicable law or expressly requested by a user for support in a manner allowed by Chrome Web Store policy.

## Changes to this policy

This policy may be updated if Savage Scraper's functionality or data practices change. The current version will remain available in this repository, and material changes to data practices will be disclosed as required by Chrome Web Store policies.

## Contact

Questions or privacy concerns can be submitted through the Savage Scraper GitHub repository:

https://github.com/dominikduda/savage_scraper/issues
