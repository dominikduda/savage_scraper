# Savage Scraper Privacy Policy

Effective date: August 30, 2026

Savage Scraper is a Chrome extension that converts the rendered content of the active page into a simplified HTML representation and copies the result to the user's clipboard.

## Data processed

When the user activates Savage Scraper, the extension may process data that is present on the active page, including:

- rendered website text and semantic page structure;
- the current page URL and title;
- useful element attributes such as links, labels and selected ARIA information;
- current values and state of ordinary form controls;
- xterm.js terminal content when it is accessible to the page and the extension;
- hidden or collapsed page content when the user explicitly enables the **Include hidden content** setting.

Password input values are never included. `<input type="hidden">` controls are excluded entirely, including when **Include hidden content** is enabled.

Because website content can contain personal or sensitive information, Savage Scraper may process such information when it is part of a page the user explicitly chooses to scrape. The extension does not attempt to classify the sensitivity of page content.

## How data is used

Page data is used only to provide Savage Scraper's single purpose: generating a simplified representation of the active page and copying that representation to the user's clipboard.

Savage Scraper does not use page data for advertising, profiling, analytics, tracking, creditworthiness, or any unrelated purpose.

## Data transmission and sharing

Savage Scraper does not send scraped page content, page URLs, form values, terminal output, or extension usage data to the developer or to third parties.

The extension does not contain analytics, advertising, telemetry, remotely hosted code, or a developer-operated backend service. Scraping is performed locally in the user's browser.

The generated result is written to the user's local system clipboard. After that, clipboard contents are controlled by the user's operating system and any applications into which the user chooses to paste them.

## Data storage and retention

Scraped page content is processed in memory and is not persistently stored by Savage Scraper.

The extension stores only its user-configurable preferences in `chrome.storage.local`, currently including:

- whether hidden/collapsed content should be included;
- whether generated HTML should be pretty-formatted;
- the popup auto-close delay.

These preferences remain on the user's device until the user changes them, clears extension storage, or removes the extension.

## Chrome permissions

Savage Scraper uses the following Chrome extension permissions:

- `activeTab` — to access the current tab after the user explicitly invokes the extension;
- `scripting` — to run the packaged scraper code on the active page;
- `storage` — to save extension preferences locally;
- `clipboardWrite` — to copy the generated output to the user's clipboard.

Savage Scraper does not request broad persistent host permissions.

## Chrome Web Store Limited Use

Savage Scraper's use of information received through Chrome APIs complies with the Chrome Web Store User Data Policy, including the Limited Use requirements. User data is accessed and used only as necessary to provide the extension's disclosed single purpose.

## Changes to this policy

This policy may be updated if Savage Scraper's functionality or data practices change. The current version will remain available in this repository, and material changes to data practices will be disclosed as required by the Chrome Web Store policies.

## Contact

Questions or privacy concerns can be submitted through the Savage Scraper GitHub repository:

https://github.com/dominikduda/savage_scraper/issues
