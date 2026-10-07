const PREVIEW_STORAGE_PREFIX = 'savagePreview:';

const pageTitle =
  document.getElementById('pageTitle');

const sourceUrl =
  document.getElementById('sourceUrl');

const previewFrame =
  document.getElementById('previewFrame');

const errorPanel =
  document.getElementById('errorPanel');

const errorMessage =
  document.getElementById('errorMessage');


const PREVIEW_DOCUMENT_STYLE = `
  :root {
    color-scheme: light dark;
    font-family:
      ui-sans-serif,
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      sans-serif;
  }

  * {
    box-sizing: border-box;
  }

  html {
    background: Canvas;
    color: CanvasText;
  }

  body {
    max-width: 1200px;
    margin: 0 auto;
    padding: 28px;
    font-size: 15px;
    line-height: 1.5;
  }

  body > :first-child {
    margin-top: 0;
  }

  body > :last-child {
    margin-bottom: 0;
  }

  table {
    max-width: 100%;
    border-collapse: collapse;
    empty-cells: show;
  }

  th,
  td {
    min-width: 1.5em;
    padding: 5px 8px;
    border: 1px solid color-mix(
      in srgb,
      CanvasText 24%,
      transparent
    );
    vertical-align: top;
  }

  th {
    font-weight: 700;
    background: color-mix(
      in srgb,
      CanvasText 6%,
      Canvas
    );
  }

  pre,
  code,
  terminal {
    font-family:
      ui-monospace,
      SFMono-Regular,
      Menlo,
      Monaco,
      Consolas,
      "Liberation Mono",
      monospace;
  }

  pre {
    overflow: auto;
    padding: 10px 12px;
    border: 1px solid color-mix(
      in srgb,
      CanvasText 12%,
      transparent
    );
    border-radius: 6px;
    white-space: pre;
  }

  terminal {
    display: block;
    overflow: auto;
    margin: 16px 0;
    padding: 12px;
    border: 1px solid color-mix(
      in srgb,
      CanvasText 18%,
      transparent
    );
    border-radius: 7px;
    background: color-mix(
      in srgb,
      CanvasText 7%,
      Canvas
    );
    font-size: 13px;
    line-height: 1.4;
    tab-size: 8;
    white-space: pre;
  }

  terminal::before {
    display: block;
    margin: -4px 0 10px;
    padding-bottom: 7px;
    border-bottom: 1px solid color-mix(
      in srgb,
      CanvasText 12%,
      transparent
    );
    font-family:
      ui-sans-serif,
      system-ui,
      sans-serif;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.06em;
    opacity: 0.58;
    white-space: normal;
    content: "TERMINAL SNAPSHOT";
  }

  terminal[extraction]::before {
    content:
      "TERMINAL SNAPSHOT · "
      attr(extraction);
  }

  iframe-content {
    display: block;
    margin: 18px 0;
    padding: 12px;
    border: 1px dashed color-mix(
      in srgb,
      CanvasText 28%,
      transparent
    );
    border-radius: 7px;
  }

  iframe-content::before {
    display: block;
    margin-bottom: 10px;
    padding-bottom: 7px;
    border-bottom: 1px dashed color-mix(
      in srgb,
      CanvasText 18%,
      transparent
    );
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.05em;
    opacity: 0.58;
    overflow-wrap: anywhere;
    content: "EMBEDDED FRAME";
  }

  iframe-content[title]::before {
    content:
      "EMBEDDED FRAME · "
      attr(title);
  }

  iframe-content[src]::before {
    content:
      "EMBEDDED FRAME · "
      attr(src);
  }

  iframe-content[title][src]::before {
    content:
      "EMBEDDED FRAME · "
      attr(title)
      " · "
      attr(src);
  }

  dialog,
  [role="dialog"],
  [role="alertdialog"] {
    display: block !important;
    position: static !important;
    inset: auto !important;
    width: auto;
    max-width: none;
    margin: 16px 0;
    padding: 14px;
    border: 1px solid color-mix(
      in srgb,
      CanvasText 22%,
      transparent
    );
    border-radius: 7px;
    background: Canvas;
    color: CanvasText;
  }

  details:not([open]) > :not(summary) {
    display: block !important;
  }

  a[data-savage-href] {
    color: LinkText;
    text-decoration: underline;
    cursor: default;
  }

  a[data-savage-href]::after {
    content: " ↗";
    font-size: 0.72em;
    opacity: 0.45;
  }

  img {
    max-width: 100%;
  }

  input,
  select,
  textarea,
  button {
    font: inherit;
  }

  blockquote {
    margin-left: 0;
    padding-left: 14px;
    border-left: 3px solid color-mix(
      in srgb,
      CanvasText 20%,
      transparent
    );
  }

  hr {
    border: 0;
    border-top: 1px solid color-mix(
      in srgb,
      CanvasText 18%,
      transparent
    );
  }
`;


function normalizePrettyTerminal(
  terminal
) {
  let lines =
    (terminal.textContent || '')
      .split('\n');

  if (
    lines.length &&
    lines[0] === ''
  ) {
    lines.shift();
  }

  if (
    lines.length &&
    /^[ ]*$/.test(
      lines[lines.length - 1]
    )
  ) {
    const closingIndent =
      lines.pop().length;

    const childPrefix =
      ' '.repeat(
        closingIndent + 2
      );

    lines = lines.map(line =>
      line.startsWith(childPrefix)
        ? line.slice(
            childPrefix.length
          )
        : line
    );
  }

  terminal.textContent =
    lines.join('\n');
}


function prepareCapturedBody(
  output,
  prettyFormat
) {
  const parsed =
    new DOMParser().parseFromString(
      output,
      'text/html'
    );

  // Defense in depth: the scraper itself already excludes these,
  // but the preview should never turn captured markup into active
  // page code or live embedded resources.
  parsed
    .querySelectorAll(
      'script, style, link, iframe, object, embed'
    )
    .forEach(node => node.remove());

  for (
    const element
    of parsed.body.querySelectorAll('*')
  ) {
    for (
      const attr
      of [...element.attributes]
    ) {
      if (
        attr.name
          .toLowerCase()
          .startsWith('on')
      ) {
        element.removeAttribute(
          attr.name
        );
      }
    }

    if (
      element.tagName !==
      'IFRAME-CONTENT'
    ) {
      for (
        const attr
        of [
          'src',
          'srcset',
          'poster',
          'background'
        ]
      ) {
        element.removeAttribute(attr);
      }
    }
  }

  parsed
    .querySelectorAll('a[href]')
    .forEach(anchor => {
      const href =
        anchor.getAttribute('href');

      if (href) {
        anchor.setAttribute(
          'data-savage-href',
          href
        );

        anchor.setAttribute(
          'title',
          href
        );
      }

      anchor.removeAttribute('href');
    });

  parsed
    .querySelectorAll('form')
    .forEach(form => {
      form.removeAttribute('action');
      form.removeAttribute('method');
    });

  if (prettyFormat) {
    parsed
      .querySelectorAll('terminal')
      .forEach(
        normalizePrettyTerminal
      );
  }

  return parsed.body.innerHTML;
}


function buildPreviewDocument(
  output,
  prettyFormat
) {
  const body =
    prepareCapturedBody(
      output,
      prettyFormat
    );

  return (
    '<!doctype html>' +
    '<html><head>' +
    '<meta charset="utf-8">' +
    '<meta name="viewport" ' +
      'content="width=device-width,initial-scale=1">' +
    `<style>${PREVIEW_DOCUMENT_STYLE}</style>` +
    '</head><body>' +
    body +
    '</body></html>'
  );
}


function showError(error) {
  const text =
    error instanceof Error
      ? error.message
      : String(error);

  errorMessage.textContent = text;
  errorPanel.hidden = false;
  previewFrame.hidden = true;
}


async function loadPreview() {
  const token =
    decodeURIComponent(
      window.location.hash.slice(1)
    );

  if (!token) {
    throw new Error(
      'Missing preview handoff token.'
    );
  }

  const storageKey =
    `${PREVIEW_STORAGE_PREFIX}${token}`;

  const stored =
    await chrome.storage.session.get(
      storageKey
    );

  const payload =
    stored[storageKey];

  if (
    !payload ||
    typeof payload.output !== 'string'
  ) {
    throw new Error(
      'This preview is no longer available. Run Savage Scraper again and click PREVIEW.'
    );
  }

  // Keep the capture only in this tab's memory after the handoff.
  await chrome.storage.session.remove(
    storageKey
  );

  const title =
    payload.sourceTitle?.trim() ||
    'Captured page';

  pageTitle.textContent = title;
  sourceUrl.textContent =
    payload.sourceUrl || '';

  document.title =
    `${title} — Savage Scraper preview`;

  previewFrame.srcdoc =
    buildPreviewDocument(
      payload.output,
      Boolean(payload.prettyFormat)
    );
}


void loadPreview().catch(showError);
