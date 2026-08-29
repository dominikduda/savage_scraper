(async () => {
  // ============================================================
  // CONFIG
  // ============================================================

  // false = only rendered/visible content
  // true  = also include hidden/collapsed DOM content
  const __EXTENSION_SETTINGS =
    window.__SAVAGE_SCRAPER_EXTENSION_SETTINGS || {};

  delete window.__SAVAGE_SCRAPER_EXTENSION_SETTINGS;

  const INCLUDE_HIDDEN =
    Boolean(__EXTENSION_SETTINGS.includeHidden);

  // false = compact HTML
  // true  = nicely indented/multiline HTML
  const PRETTY_FORMAT =
    Boolean(__EXTENSION_SETTINGS.prettyFormat);


  // ============================================================
  // INTERNAL SETTINGS
  // ============================================================

  const MAX_CLASSES_PER_ELEMENT = 5;

  const XTERM_INCLUDE_SCROLLBACK = true;
  const XTERM_JOIN_WRAPPED_LINES = true;

  const XTERM_SEARCH_MAX_DEPTH = 6;
  const XTERM_SEARCH_MAX_OBJECTS = 25000;


  // ============================================================
  // OUTPUT METADATA
  // ============================================================

  const METADATA_NOTE =
    `<!-- SAVAGE_SCRAPER: simplified rendered page representation; ` +
    `NOT 1:1 source HTML. ` +
    `${INCLUDE_HIDDEN
      ? 'Hidden/collapsed content may be included. '
      : 'Hidden/collapsed content is excluded where detectable. '
    }` +
    `Classes are heuristically filtered; at most ` +
    `${MAX_CLASSES_PER_ELEMENT} classes are retained per element ` +
    `and additional classes may be omitted. ` +
    `Canvas-rendered xterm terminals are extracted separately when accessible. -->`;

  // ============================================================
  // PAGE CONTEXT
  // ============================================================

  const PAGE_CONTEXT = [
    `<!-- PAGE_URL: ${window.location.href} -->`,
    `<!-- PAGE_TITLE: ${document.title} -->`,
    `<!-- CAPTURED_AT: ${new Date().toISOString()} -->`,
    `<!-- VIEWPORT: ${window.innerWidth}x${window.innerHeight} -->`
  ].join('\n');

  // ============================================================
  // TAG POLICIES
  // ============================================================

  const SKIP_TAGS = new Set([
    'SCRIPT',
    'STYLE',
    'NOSCRIPT',
    'META',
    'LINK',
    'HEAD',
    'TEMPLATE',
    'SVG',
    'PATH',
    'CANVAS',
    'IFRAME'
  ]);


  // Generic tags are transparent unless they prove useful.
  const GENERIC_TAGS = new Set([
    'DIV',
    'SPAN'
  ]);


  // These give useful structure to an LLM.
  const SEMANTIC_TAGS = new Set([
    'MAIN',
    'ARTICLE',
    'SECTION',
    'NAV',
    'ASIDE',
    'HEADER',
    'FOOTER',

    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',

    'P',
    'BLOCKQUOTE',
    'PRE',
    'CODE',
    'STRONG',
    'EM',
    'B',
    'I',
    'MARK',
    'SMALL',
    'SUB',
    'SUP',

    'UL',
    'OL',
    'LI',
    'DL',
    'DT',
    'DD',

    'TABLE',
    'THEAD',
    'TBODY',
    'TFOOT',
    'TR',
    'TH',
    'TD',
    'CAPTION',

    'A',
    'BUTTON',

    'FORM',
    'FIELDSET',
    'LEGEND',
    'LABEL',

    'INPUT',
    'TEXTAREA',
    'SELECT',
    'OPTION',

    'DETAILS',
    'SUMMARY',

    'FIGURE',
    'FIGCAPTION',

    'TIME',
    'ADDRESS',

    'IMG',
    'BR',
    'HR'
  ]);


  const VOID_TAGS = new Set([
    'AREA',
    'BASE',
    'BR',
    'COL',
    'EMBED',
    'HR',
    'IMG',
    'INPUT',
    'LINK',
    'META',
    'PARAM',
    'SOURCE',
    'TRACK',
    'WBR'
  ]);


  const BLOCK_TAGS = new Set([
    'ADDRESS',
    'ARTICLE',
    'ASIDE',
    'BLOCKQUOTE',
    'BODY',
    'DIV',
    'DL',
    'DT',
    'DD',
    'FIELDSET',
    'FIGCAPTION',
    'FIGURE',
    'FOOTER',
    'FORM',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'HEADER',
    'HR',
    'LI',
    'MAIN',
    'NAV',
    'OL',
    'P',
    'PRE',
    'SECTION',
    'TABLE',
    'TBODY',
    'TD',
    'TFOOT',
    'TH',
    'THEAD',
    'TR',
    'UL',
    'TERMINAL'
  ]);


  const USEFUL_GENERIC_ROLES = new Set([
    'main',
    'navigation',
    'region',
    'article',
    'complementary',
    'form',
    'search',

    'list',
    'listitem',

    'table',
    'row',
    'cell',
    'columnheader',
    'rowheader',

    'group',
    'status',
    'alert',
    'dialog'
  ]);


  // ============================================================
  // BASIC HELPERS
  // ============================================================

  function isObject(value) {
    return (
      value !== null &&
      (
        typeof value === 'object' ||
        typeof value === 'function'
      )
    );
  }


  function safeGet(obj, key) {
    try {
      return obj?.[key];
    } catch {
      return undefined;
    }
  }


  function normalizeText(text) {
    return text.replace(/\s+/g, ' ');
  }


  function hasMeaningfulText(text) {
    return text.trim().length > 0;
  }


  function textFromNodes(nodes) {
    return nodes
      .map(node => node.textContent || '')
      .join('');
  }


  function countElementNodes(nodes) {
    return nodes.filter(
      node => node.nodeType === Node.ELEMENT_NODE
    ).length;
  }


  // ============================================================
  // VISIBILITY
  // ============================================================

  function subtreeIsHidden(el) {
    if (INCLUDE_HIDDEN) {
      return false;
    }

    // Check ancestors because opacity/display on a parent hides
    // the entire subtree.
    for (
      let current = el;
      current instanceof Element;
      current = current.parentElement
    ) {
      let style;

      try {
        style = getComputedStyle(current);
      } catch {
        continue;
      }

      if (
        style.display === 'none' ||
        style.contentVisibility === 'hidden' ||
        Number(style.opacity) === 0
      ) {
        return true;
      }
    }


    // Closed <details> hides everything except its <summary>.
    const closedDetails =
      el.closest?.('details:not([open])');

    if (closedDetails) {
      const summary =
        closedDetails.querySelector(':scope > summary');

      const inSummary =
        summary &&
        (
          el === summary ||
          summary.contains(el)
        );

      if (!inSummary) {
        return true;
      }
    }


    return false;
  }


  function textNodeIsVisible(textNode) {
    if (INCLUDE_HIDDEN) {
      return true;
    }

    const parent = textNode.parentElement;

    if (!parent) {
      return false;
    }

    if (subtreeIsHidden(parent)) {
      return false;
    }


    let style;

    try {
      style = getComputedStyle(parent);
    } catch {
      style = null;
    }


    if (
      style &&
      (
        style.visibility === 'hidden' ||
        style.visibility === 'collapse'
      )
    ) {
      return false;
    }


    // A Range gives us a useful approximation of whether this
    // text actually participates in rendered layout.
    try {
      const range = document.createRange();

      range.selectNodeContents(textNode);

      const rects = [
        ...range.getClientRects()
      ];

      range.detach?.();

      if (
        rects.some(
          rect =>
            rect.width > 0 &&
            rect.height > 0
        )
      ) {
        return true;
      }
    } catch {
      // Fall through.
    }


    return false;
  }


  function xtermRootIsVisible(root) {
    if (INCLUDE_HIDDEN) {
      return true;
    }

    if (subtreeIsHidden(root)) {
      return false;
    }

    try {
      const style =
        getComputedStyle(root);

      return !(
        style.visibility === 'hidden' ||
        style.visibility === 'collapse'
      );
    } catch {
      return true;
    }
  }


  // ============================================================
  // CLASS FILTERING
  // ============================================================

  function looksGeneratedOrUtilityClass(name) {
    if (!name) {
      return true;
    }

    if (name.length > 64) {
      return true;
    }


    // Atlassian/Jira-generated classes.
    if (name.startsWith('_')) {
      return true;
    }


    // Common CSS-in-JS/generated formats.
    if (
      /^css-[a-z0-9_-]+$/i.test(name) ||
      /^jsx-\d+$/i.test(name) ||
      /^sc-[a-z0-9_-]+$/i.test(name) ||
      /^emotion-[a-z0-9_-]+$/i.test(name)
    ) {
      return true;
    }


    // Hash-like names.
    if (
      /^[a-f0-9]{8,}$/i.test(name) ||
      /^_[a-f0-9]+$/i.test(name)
    ) {
      return true;
    }


    // CSS modules such as:
    // Product_title__Xk29a
    if (
      /__[a-z0-9]{5,}$/i.test(name)
    ) {
      return true;
    }


    // Too many digits usually means generated.
    const digits =
      (name.match(/\d/g) || []).length;

    if (
      digits > 0 &&
      digits / name.length > 0.25
    ) {
      return true;
    }


    // Tailwind/state variants.
    if (
      /^(?:sm|md|lg|xl|2xl|hover|focus|active|disabled|visited|first|last|odd|even|group-|peer-).+[:]/.test(name)
    ) {
      return true;
    }


    // Tailwind arbitrary values.
    if (
      name.includes('[') &&
      name.includes(']')
    ) {
      return true;
    }


    // Common standalone layout utilities.
    if (
      /^(?:flex|inline-flex|grid|inline-grid|block|inline-block|inline|hidden|contents|table|relative|absolute|fixed|sticky|static)$/i.test(name)
    ) {
      return true;
    }


    // Common utility-class prefixes.
    if (
      /^!?-?(?:m|mx|my|mt|mr|mb|ml|p|px|py|pt|pr|pb|pl|gap|space-x|space-y|w|h|min-w|max-w|min-h|max-h|top|right|bottom|left|inset|z)-/.test(name)
    ) {
      return true;
    }


    if (
      /^(?:items|justify|content|self|place-items|place-content|place-self|grid-cols|grid-rows|col-span|row-span|order|basis|grow|shrink)-/.test(name)
    ) {
      return true;
    }


    if (
      /^(?:bg|border|rounded|shadow|ring|outline|opacity|font|tracking|leading|decoration|transition|duration|delay|ease|animate|translate|rotate|scale|skew|origin|overflow|object|cursor|select|pointer-events)-/.test(name)
    ) {
      return true;
    }


    return false;
  }


  function looksSemanticClass(name) {
    if (
      looksGeneratedOrUtilityClass(name)
    ) {
      return false;
    }


    // Require at least some readable alphabetic content.
    const letters =
      (name.match(/[a-z]/gi) || []).length;

    if (letters < 3) {
      return false;
    }


    return true;
  }


  function getUsefulClasses(el) {
    return [...el.classList]
      .filter(looksSemanticClass)
      .slice(0, MAX_CLASSES_PER_ELEMENT);
  }


  // ============================================================
  // ID FILTERING
  // ============================================================

  function looksUsefulId(id) {
    if (
      typeof id !== 'string' ||
      !id
    ) {
      return false;
    }

    if (
      id.startsWith('_') ||
      id.length > 80
    ) {
      return false;
    }


    if (
      /^[a-f0-9-]{24,}$/i.test(id)
    ) {
      return false;
    }


    const digits =
      (id.match(/\d/g) || []).length;

    if (
      digits > 0 &&
      digits / id.length > 0.3
    ) {
      return false;
    }


    const letters =
      (id.match(/[a-z]/gi) || []).length;

    return letters >= 3;
  }


  // ============================================================
  // ATTRIBUTE HANDLING
  // ============================================================

  function copyUsefulAttributes(
    source,
    target,
    visibleText
  ) {
    // ----------------------------------------------------------
    // ID
    // ----------------------------------------------------------

    const sourceId =
      source.getAttribute('id');

    if (
      sourceId &&
      looksUsefulId(sourceId)
    ) {
      target.setAttribute(
        'id',
        sourceId
      );
    }

    // ----------------------------------------------------------
    // Classes
    // ----------------------------------------------------------

    const classes =
      getUsefulClasses(source);

    if (classes.length) {
      target.setAttribute(
        'class',
        classes.join(' ')
      );
    }


    // ----------------------------------------------------------
    // Role
    // ----------------------------------------------------------

    const role =
      source.getAttribute('role');

    if (
      role &&
      role !== 'presentation' &&
      role !== 'none'
    ) {
      target.setAttribute(
        'role',
        role
      );
    }


    // ----------------------------------------------------------
    // Links
    // ----------------------------------------------------------

    if (
      source.tagName === 'A' &&
      source.hasAttribute('href')
    ) {
      const href =
        source.getAttribute('href');

      if (href) {
        target.setAttribute(
          'href',
          href
        );
      }
    }


    // ----------------------------------------------------------
    // ARIA label
    //
    // Avoid duplicating visible button/link text.
    // ----------------------------------------------------------

    const ariaLabel =
      source.getAttribute('aria-label');


    const isLandmarkLike =
      [
        'MAIN',
        'NAV',
        'SECTION',
        'ASIDE',
        'FORM'
      ].includes(source.tagName) ||
      USEFUL_GENERIC_ROLES.has(
        role || ''
      );


    const isFormControl =
      [
        'INPUT',
        'TEXTAREA',
        'SELECT'
      ].includes(source.tagName);


    if (
      ariaLabel &&
      (
        isLandmarkLike ||
        isFormControl ||
        !hasMeaningfulText(visibleText)
      )
    ) {
      target.setAttribute(
        'aria-label',
        ariaLabel
      );
    }


    // ----------------------------------------------------------
    // Images
    // ----------------------------------------------------------

    if (
      source.tagName === 'IMG'
    ) {
      const alt =
        source.getAttribute('alt');

      if (alt?.trim()) {
        target.setAttribute(
          'alt',
          alt.trim()
        );
      }
    }


    // ----------------------------------------------------------
    // Form controls
    // ----------------------------------------------------------

    if (
      source instanceof HTMLInputElement
    ) {
      if (source.type) {
        target.setAttribute(
          'type',
          source.type
        );
      }


      if (
        source.name?.trim()
      ) {
        target.setAttribute(
          'name',
          source.name
        );
      }


      if (
        source.placeholder?.trim()
      ) {
        target.setAttribute(
          'placeholder',
          source.placeholder
        );
      }


      if (
        source.type !== 'password' &&
        source.value?.trim()
      ) {
        target.setAttribute(
          'value',
          source.value
        );
      }


      if (
        source.checked
      ) {
        target.setAttribute(
          'checked',
          ''
        );
      }
    }


    if (
      source instanceof HTMLTextAreaElement &&
      source.placeholder?.trim()
    ) {
      target.setAttribute(
        'placeholder',
        source.placeholder
      );
    }


    if (
      source instanceof HTMLOptionElement &&
      source.selected
    ) {
      target.setAttribute(
        'selected',
        ''
      );
    }


    // ----------------------------------------------------------
    // Small semantic attributes
    // ----------------------------------------------------------

    if (
      source.tagName === 'TIME' &&
      source.hasAttribute('datetime')
    ) {
      target.setAttribute(
        'datetime',
        source.getAttribute('datetime')
      );
    }


    if (
      source.tagName === 'DETAILS' &&
      source.hasAttribute('open')
    ) {
      target.setAttribute(
        'open',
        ''
      );
    }


    if (
      source.tagName === 'TH' &&
      source.hasAttribute('scope')
    ) {
      target.setAttribute(
        'scope',
        source.getAttribute('scope')
      );
    }


    for (
      const attr
      of ['colspan', 'rowspan']
    ) {
      if (
        ['TD', 'TH'].includes(source.tagName) &&
        source.hasAttribute(attr)
      ) {
        target.setAttribute(
          attr,
          source.getAttribute(attr)
        );
      }
    }
  }


  // ============================================================
  // GENERIC WRAPPER DECISION
  // ============================================================

  function shouldKeepGenericWrapper(
    source,
    children,
    directText
  ) {
    const role =
      source.getAttribute('role');


    if (
      role &&
      USEFUL_GENERIC_ROLES.has(role)
    ) {
      return true;
    }


    const usefulClasses =
      getUsefulClasses(source);

    const usefulId =
      looksUsefulId(source.id);


    const elementChildren =
      countElementNodes(children);


    // A meaningful class/id should only preserve the wrapper if
    // it actually groups something useful.
    //
    // Examples preserved:
    //
    // <div class="product-card">
    //   <h2>...</h2>
    //   <span class="price">...</span>
    // </div>
    //
    // Examples flattened:
    //
    // <div class="some-wrapper">
    //   <h1>...</h1>
    // </div>
    if (
      (
        usefulClasses.length > 0 ||
        usefulId
      ) &&
      (
        hasMeaningfulText(directText) ||
        elementChildren >= 2
      )
    ) {
      return true;
    }


    return false;
  }


  // ============================================================
  // NORMAL DOM EXTRACTION
  // ============================================================

  function simplifyNode(node) {
    // ----------------------------------------------------------
    // TEXT
    // ----------------------------------------------------------

    if (
      node.nodeType === Node.TEXT_NODE
    ) {
      if (!textNodeIsVisible(node)) {
        return [];
      }


      const original =
        node.textContent || '';

      const normalized =
        normalizeText(original);


      if (hasMeaningfulText(normalized)) {
        return [
          document.createTextNode(normalized)
        ];
      }


      // Preserve an actual rendered whitespace separator between
      // inline elements.
      if (
        /\s/.test(original)
      ) {
        return [
          document.createTextNode(' ')
        ];
      }


      return [];
    }


    // ----------------------------------------------------------
    // ELEMENT
    // ----------------------------------------------------------

    if (
      node.nodeType !== Node.ELEMENT_NODE
    ) {
      return [];
    }


    const el = node;


    if (
      SKIP_TAGS.has(el.tagName)
    ) {
      return [];
    }


    // xterm is handled separately.
    if (
      el.classList?.contains('xterm')
    ) {
      return [];
    }


    if (subtreeIsHidden(el)) {
      return [];
    }


    // ----------------------------------------------------------
    // Children
    // ----------------------------------------------------------

    const simplifiedChildren = [];

    let directText = '';


    for (const child of el.childNodes) {
      if (
        child.nodeType === Node.TEXT_NODE
      ) {
        if (
          textNodeIsVisible(child)
        ) {
          const original =
            child.textContent || '';

          const normalized =
            normalizeText(original);


          if (
            hasMeaningfulText(normalized)
          ) {
            directText += normalized;

            simplifiedChildren.push(
              document.createTextNode(
                normalized
              )
            );
          } else if (
            /\s/.test(original)
          ) {
            simplifiedChildren.push(
              document.createTextNode(' ')
            );
          }
        }

        continue;
      }


      simplifiedChildren.push(
        ...simplifyNode(child)
      );
    }


    const visibleText =
      textFromNodes(
        simplifiedChildren
      );


    // ----------------------------------------------------------
    // Current textarea value
    // ----------------------------------------------------------

    if (
      el instanceof HTMLTextAreaElement
    ) {
      const currentValue =
        el.value || '';

      if (
        currentValue.trim() &&
        !visibleText.includes(currentValue)
      ) {
        simplifiedChildren.length = 0;

        simplifiedChildren.push(
          document.createTextNode(
            currentValue
          )
        );
      }
    }


    // ----------------------------------------------------------
    // Generic DIV / SPAN:
    // transparent unless meaningful.
    // ----------------------------------------------------------

    if (
      GENERIC_TAGS.has(el.tagName)
    ) {
      if (
        !shouldKeepGenericWrapper(
          el,
          simplifiedChildren,
          directText
        )
      ) {
        return simplifiedChildren;
      }
    }


    // ----------------------------------------------------------
    // Unknown/custom tags:
    // transparent by default.
    // ----------------------------------------------------------

    if (
      !GENERIC_TAGS.has(el.tagName) &&
      !SEMANTIC_TAGS.has(el.tagName)
    ) {
      return simplifiedChildren;
    }


    // ----------------------------------------------------------
    // Decide whether empty elements are useful.
    // ----------------------------------------------------------

    const hasChildren =
      simplifiedChildren.some(node => {
        if (
          node.nodeType === Node.TEXT_NODE
        ) {
          return hasMeaningfulText(
            node.textContent || ''
          );
        }

        return true;
      });


    let keepWithoutChildren = false;


    if (
      el.tagName === 'BR' ||
      el.tagName === 'HR'
    ) {
      keepWithoutChildren = true;
    }


    if (
      el.tagName === 'IMG'
    ) {
      keepWithoutChildren =
        !!el.getAttribute('alt')?.trim();
    }


    if (
      el instanceof HTMLInputElement
    ) {
      keepWithoutChildren =
        !!(
          el.value?.trim() ||
          el.placeholder?.trim() ||
          el.getAttribute('aria-label')?.trim() ||
          el.name?.trim()
        );
    }


    // Deliberately drop icon-only buttons.
    //
    // They are abundant on apps like Jira and usually add far
    // more noise than useful content.
    if (
      el.tagName === 'BUTTON' &&
      !hasMeaningfulText(visibleText)
    ) {
      return [];
    }


    if (
      el.tagName === 'A' &&
      !hasChildren
    ) {
      return [];
    }


    if (
      !hasChildren &&
      !keepWithoutChildren
    ) {
      return [];
    }


    // ----------------------------------------------------------
    // Create simplified element
    // ----------------------------------------------------------

    const clone =
      document.createElement(
        el.tagName.toLowerCase()
      );


    for (
      const child
      of simplifiedChildren
    ) {
      clone.appendChild(child);
    }


    copyUsefulAttributes(
      el,
      clone,
      visibleText
    );


    return [clone];
  }


  function buildSimplifiedDOM() {
    const root =
      document.createElement('body');


    for (
      const child
      of document.body.childNodes
    ) {
      const simplified =
        simplifyNode(child);

      for (
        const outputNode
        of simplified
      ) {
        root.appendChild(
          outputNode
        );
      }
    }


    return root;
  }


  // ============================================================
  // XTERM
  // ============================================================

  function isTerminalLike(obj) {
    if (!isObject(obj)) {
      return false;
    }

    try {
      const active =
        obj.buffer?.active;

      if (!active) {
        return false;
      }

      if (
        typeof active.getLine !== 'function' ||
        typeof active.length !== 'number'
      ) {
        return false;
      }


      return (
        typeof obj.getSelection === 'function' ||
        typeof obj.write === 'function' ||
        typeof obj.scrollToBottom === 'function' ||
        obj.element?.classList?.contains?.('xterm')
      );
    } catch {
      return false;
    }
  }


  function getTerminalElement(term) {
    try {
      return (
        term.element instanceof Element
          ? term.element
          : null
      );
    } catch {
      return null;
    }
  }


  function trimTrailingEmptyLines(lines) {
    while (
      lines.length &&
      lines[lines.length - 1].trim() === ''
    ) {
      lines.pop();
    }

    return lines;
  }


  // ------------------------------------------------------------
  // XTERM METHOD 1: real buffer
  // ------------------------------------------------------------

  function extractXtermBuffer(term) {
    const buffer =
      term.buffer.active;


    let start = 0;
    let end = buffer.length;


    if (!XTERM_INCLUDE_SCROLLBACK) {
      start =
        typeof buffer.viewportY === 'number'
          ? buffer.viewportY
          : Math.max(
              0,
              buffer.length -
              (term.rows || 0)
            );


      end = Math.min(
        buffer.length,
        start +
        (term.rows || buffer.length)
      );
    }


    const output = [];


    for (
      let i = start;
      i < end;
      i++
    ) {
      let line;

      try {
        line =
          buffer.getLine(i);
      } catch {
        continue;
      }

      if (!line) {
        continue;
      }


      let text;

      try {
        text =
          line.translateToString(true);
      } catch {
        continue;
      }


      if (
        XTERM_JOIN_WRAPPED_LINES &&
        line.isWrapped &&
        output.length
      ) {
        output[
          output.length - 1
        ] += text;
      } else {
        output.push(text);
      }
    }


    trimTrailingEmptyLines(output);

    return output.join('\n');
  }


  // ------------------------------------------------------------
  // XTERM METHOD 2: accessibility tree
  // ------------------------------------------------------------

  function extractXtermAccessibility(root) {
    const tree =
      root.querySelector(
        '.xterm-accessibility-tree'
      ) ||
      root.parentElement?.querySelector?.(
        '.xterm-accessibility-tree'
      );


    if (!tree) {
      return null;
    }


    const rows = [
      ...tree.querySelectorAll(
        '[aria-posinset]'
      )
    ];


    if (rows.length) {
      rows.sort(
        (a, b) =>
          (
            Number(
              a.getAttribute(
                'aria-posinset'
              )
            ) || 0
          ) -
          (
            Number(
              b.getAttribute(
                'aria-posinset'
              )
            ) || 0
          )
      );


      const lines =
        rows.map(row =>
          (
            row.textContent || ''
          ).replace(
            /[ \t]+$/g,
            ''
          )
        );


      trimTrailingEmptyLines(
        lines
      );


      const result =
        lines.join('\n');


      if (result.trim()) {
        return result;
      }
    }


    const text =
      tree.innerText ||
      tree.textContent ||
      '';


    return text.trim()
      ? text
      : null;
  }


  // ------------------------------------------------------------
  // XTERM METHOD 3: older DOM rows
  // ------------------------------------------------------------

  function extractXtermDOMRows(root) {
    const rows =
      root.querySelector(
        '.xterm-rows'
      ) ||
      root.parentElement?.querySelector?.(
        '.xterm-rows'
      );


    if (!rows) {
      return null;
    }


    const children = [
      ...rows.children
    ];


    if (!children.length) {
      const text =
        rows.innerText ||
        rows.textContent ||
        '';

      return text.trim()
        ? text
        : null;
    }


    const lines =
      children.map(row =>
        (
          row.innerText ||
          row.textContent ||
          ''
        ).replace(
          /[ \t]+$/g,
          ''
        )
      );


    trimTrailingEmptyLines(
      lines
    );


    const result =
      lines.join('\n');


    return result.trim()
      ? result
      : null;
  }


  // ============================================================
  // FIND XTERM OBJECTS
  // ============================================================

  function getOwnStoredValues(obj) {
    let descriptors;

    try {
      descriptors =
        Object.getOwnPropertyDescriptors(
          obj
        );
    } catch {
      return [];
    }


    const values = [];


    for (
      const descriptor
      of Object.values(descriptors)
    ) {
      // Never invoke arbitrary getters.
      if (
        'value' in descriptor &&
        isObject(descriptor.value)
      ) {
        values.push(
          descriptor.value
        );
      }
    }


    return values;
  }


  function findXtermObjects(
    xtermRoots
  ) {
    const found =
      new Set();


    function register(value) {
      if (
        isTerminalLike(value)
      ) {
        found.add(value);
        return true;
      }

      return false;
    }


    // Common globals.
    for (
      const name
      of [
        'term',
        'terminal',
        'xterm',
        'Terminal',
        'xtermTerminal'
      ]
    ) {
      register(
        safeGet(window, name)
      );
    }


    const seeds = [];


    // Values attached to xterm DOM and ancestors.
    for (
      const root
      of xtermRoots
    ) {
      let current = root;

      for (
        let level = 0;
        level < 5 && current;
        level++
      ) {
        seeds.push(
          ...getOwnStoredValues(
            current
          )
        );

        current =
          current.parentElement;
      }
    }


    // Stored window globals.
    let windowDescriptors = {};

    try {
      windowDescriptors =
        Object.getOwnPropertyDescriptors(
          window
        );
    } catch {
      // Ignore.
    }


    for (
      const descriptor
      of Object.values(
        windowDescriptors
      )
    ) {
      if (
        'value' in descriptor &&
        isObject(descriptor.value) &&
        descriptor.value !== window &&
        descriptor.value !== document
      ) {
        seeds.push(
          descriptor.value
        );
      }
    }


    const seen =
      new WeakSet();


    const queue =
      seeds
        .filter(isObject)
        .map(value => ({
          value,
          depth: 0
        }));


    let inspected = 0;


    while (
      queue.length &&
      inspected <
      XTERM_SEARCH_MAX_OBJECTS
    ) {
      const {
        value,
        depth
      } = queue.shift();


      if (
        !isObject(value) ||
        seen.has(value)
      ) {
        continue;
      }


      seen.add(value);
      inspected++;


      register(value);


      if (
        depth >=
        XTERM_SEARCH_MAX_DEPTH
      ) {
        continue;
      }


      // Don't recursively crawl browser-native DOM graphs.
      if (
        value === window ||
        value === document ||
        value instanceof Node
      ) {
        continue;
      }


      const children =
        getOwnStoredValues(value);


      for (
        const child
        of children
      ) {
        if (
          isObject(child) &&
          !seen.has(child)
        ) {
          queue.push({
            value: child,
            depth: depth + 1
          });
        }
      }
    }


    return {
      terminals: [
        ...found
      ],
      inspected
    };
  }


  // ============================================================
  // EXTRACT ALL XTERMS
  // ============================================================

  function extractAllXterms() {
    const allRoots = [
      ...document.querySelectorAll(
        '.xterm'
      )
    ];


    const roots =
      allRoots.filter(
        xtermRootIsVisible
      );


    if (!roots.length) {
      return {
        results: [],
        inspected: 0,
        detectedRoots:
          allRoots.length
      };
    }


    const {
      terminals,
      inspected
    } =
      findXtermObjects(
        roots
      );


    const usedTerminals =
      new Set();


    const results = [];


    for (
      const root
      of roots
    ) {
      let matchedTerminal =
        null;


      // Exact element match.
      for (
        const term
        of terminals
      ) {
        if (
          usedTerminals.has(term)
        ) {
          continue;
        }


        if (
          getTerminalElement(term) ===
          root
        ) {
          matchedTerminal =
            term;

          break;
        }
      }


      // Containment match.
      if (!matchedTerminal) {
        for (
          const term
          of terminals
        ) {
          if (
            usedTerminals.has(term)
          ) {
            continue;
          }


          const element =
            getTerminalElement(term);


          if (
            element &&
            (
              root.contains(element) ||
              element.contains(root)
            )
          ) {
            matchedTerminal =
              term;

            break;
          }
        }
      }


      let text = null;
      let method = null;


      // Best: actual xterm buffer.
      if (matchedTerminal) {
        try {
          const candidate =
            extractXtermBuffer(
              matchedTerminal
            );


          if (
            candidate.trim()
          ) {
            text = candidate;
            method = 'buffer';

            usedTerminals.add(
              matchedTerminal
            );
          }
        } catch {
          // Continue.
        }
      }


      // Accessibility representation.
      if (!text) {
        const candidate =
          extractXtermAccessibility(
            root
          );


        if (
          candidate?.trim()
        ) {
          text = candidate;
          method =
            'accessibility';
        }
      }


      // Older DOM renderer.
      if (!text) {
        const candidate =
          extractXtermDOMRows(
            root
          );


        if (
          candidate?.trim()
        ) {
          text = candidate;
          method = 'dom';
        }
      }


      if (
        text?.trim()
      ) {
        results.push({
          root,
          terminal:
            matchedTerminal,
          method,
          text
        });
      }
    }


    // Buffer objects we found but could not match to a DOM root.
    for (
      const term
      of terminals
    ) {
      if (
        usedTerminals.has(term)
      ) {
        continue;
      }


      const element =
        getTerminalElement(term);


      if (
        element &&
        !xtermRootIsVisible(element)
      ) {
        continue;
      }


      try {
        const text =
          extractXtermBuffer(
            term
          );


        if (
          text.trim()
        ) {
          results.push({
            root: element,
            terminal: term,
            method: 'buffer',
            text
          });
        }
      } catch {
        // Ignore.
      }
    }


    return {
      results,
      inspected,
      detectedRoots:
        allRoots.length
    };
  }


  // ============================================================
  // APPEND XTERM OUTPUT
  // ============================================================

  function appendXterms(
    root,
    xterms
  ) {
    for (
      let i = 0;
      i < xterms.length;
      i++
    ) {
      const result =
        xterms[i];


      const terminal =
        document.createElement(
          'terminal'
        );


      terminal.setAttribute(
        'source',
        'xterm'
      );


      terminal.setAttribute(
        'extraction',
        result.method
      );


      if (
        xterms.length > 1
      ) {
        terminal.setAttribute(
          'index',
          String(i + 1)
        );
      }


      if (
        result.root?.id &&
        looksUsefulId(
          result.root.id
        )
      ) {
        terminal.setAttribute(
          'id',
          result.root.id
        );
      }


      if (
        result.root?.classList
      ) {
        const classes =
          getUsefulClasses(
            result.root
          );


        if (
          classes.length
        ) {
          terminal.setAttribute(
            'class',
            classes.join(' ')
          );
        }
      }


      terminal.appendChild(
        document.createTextNode(
          result.text
        )
      );


      root.appendChild(
        terminal
      );
    }
  }


  // ============================================================
  // SERIALIZATION
  // ============================================================

  function escapeText(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }


  function escapeAttribute(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }


  function openingTag(el) {
    const attrs = [
      ...el.attributes
    ]
      .map(
        attr =>
          ` ${attr.name}="${escapeAttribute(attr.value)}"`
      )
      .join('');


    return (
      `<${el.tagName.toLowerCase()}${attrs}>`
    );
  }


  function serializeCompact(node) {
    if (
      node.nodeType ===
      Node.TEXT_NODE
    ) {
      return escapeText(
        node.textContent || ''
      );
    }


    if (
      node.nodeType !==
      Node.ELEMENT_NODE
    ) {
      return '';
    }


    const tag =
      node.tagName.toLowerCase();


    const open =
      openingTag(node);


    if (
      VOID_TAGS.has(
        node.tagName
      )
    ) {
      return open;
    }


    const content = [
      ...node.childNodes
    ]
      .map(
        serializeCompact
      )
      .join('');


    return (
      `${open}${content}</${tag}>`
    );
  }


  function serializePretty(
    node,
    depth = 0
  ) {
    const indent =
      '  '.repeat(depth);


    if (
      node.nodeType ===
      Node.TEXT_NODE
    ) {
      return (
        indent +
        escapeText(
          node.textContent || ''
        )
      );
    }


    if (
      node.nodeType !==
      Node.ELEMENT_NODE
    ) {
      return '';
    }


    const tag =
      node.tagName.toLowerCase();


    const open =
      openingTag(node);


    if (
      VOID_TAGS.has(
        node.tagName
      )
    ) {
      return (
        indent + open
      );
    }


    const children = [
      ...node.childNodes
    ];


    if (!children.length) {
      return (
        `${indent}${open}</${tag}>`
      );
    }


    // Terminal text keeps real line structure.
    if (
      node.tagName ===
      'TERMINAL'
    ) {
      const lines =
        (
          node.textContent || ''
        ).split('\n');


      const output = [
        indent + open
      ];


      for (
        const line
        of lines
      ) {
        output.push(
          '  '.repeat(
            depth + 1
          ) +
          escapeText(line)
        );
      }


      output.push(
        `${indent}</${tag}>`
      );


      return output.join('\n');
    }


    // Simple text-only elements stay on one line.
    const onlyText =
      children.every(
        child =>
          child.nodeType ===
          Node.TEXT_NODE
      );


    if (onlyText) {
      const text =
        children
          .map(
            child =>
              child.textContent || ''
          )
          .join('');


      return (
        `${indent}${open}` +
        `${escapeText(text.trim())}` +
        `</${tag}>`
      );
    }


    // Short inline structures also stay compact.
    const containsBlockChild =
      children.some(
        child =>
          child.nodeType ===
            Node.ELEMENT_NODE &&
          BLOCK_TAGS.has(
            child.tagName
          )
      );


    const compact =
      serializeCompact(node);


    if (
      !containsBlockChild &&
      compact.length <= 180
    ) {
      return (
        indent +
        compact.trim()
      );
    }


    const lines = [
      indent + open
    ];


    for (
      const child
      of children
    ) {
      if (
        child.nodeType ===
        Node.TEXT_NODE
      ) {
        const text =
          child.textContent || '';


        if (
          hasMeaningfulText(text)
        ) {
          lines.push(
            '  '.repeat(
              depth + 1
            ) +
            escapeText(
              text.trim()
            )
          );
        }

        continue;
      }


      const serialized =
        serializePretty(
          child,
          depth + 1
        );


      if (serialized) {
        lines.push(
          serialized
        );
      }
    }


    lines.push(
      `${indent}</${tag}>`
    );


    return (
      lines.join('\n')
    );
  }


  // ============================================================
  // RUN
  // ============================================================

  const simplified =
    buildSimplifiedDOM();


  const xtermExtraction =
    extractAllXterms();


  appendXterms(
    simplified,
    xtermExtraction.results
  );


  const html =
    PRETTY_FORMAT
      ? serializePretty(
          simplified
        )
      : serializeCompact(
          simplified
        );


  const output =
    `${METADATA_NOTE}\n${PAGE_CONTEXT}\n${html}`;


  // ============================================================
  // DIAGNOSTICS
  // ============================================================

  const plainTextLength =
    simplified.textContent.length;


  console.log(
    `✅ Simplified page: ${output.length.toLocaleString()} characters`
  );


  console.log(
    `📝 Text content: ${plainTextLength.toLocaleString()} characters`
  );


  if (
    xtermExtraction.detectedRoots
  ) {
    console.log(
      `🖥️ Detected ${xtermExtraction.detectedRoots} xterm instance(s); ` +
      `extracted ${xtermExtraction.results.length}.`
    );


    xtermExtraction.results.forEach(
      (result, index) => {
        console.log(
          `✅ xterm #${index + 1}: ` +
          `${result.method}, ` +
          `${result.text.length.toLocaleString()} chars`
        );
      }
    );
  }


  // Debug object.
  window.__aiPageScrapeResult = {
    output,
    simplifiedDOM:
      simplified,
    xterms:
      xtermExtraction.results,
    settings: {
      INCLUDE_HIDDEN,
      PRETTY_FORMAT,
      MAX_CLASSES_PER_ELEMENT
    }
  };


  // ============================================================
  // RETURN TO EXTENSION
  // ============================================================

  // Clipboard writing is handled by popup.js in the extension
  // context. DevTools' copy() helper is not available here, and
  // page-context clipboard writes are less reliable.

  console.log(output);


  return output;
})();
