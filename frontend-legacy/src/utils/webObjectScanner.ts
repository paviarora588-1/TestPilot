// Frontend-only Web Product Library scanner.
// The generated script runs in the DevTools console of the target web app (a different
// origin from TestPilot), so it cannot call the TestPilot API directly. Instead it walks
// the live DOM and downloads a JSON file that the user re-uploads on the Library page,
// which is then converted to the same object payload the manual "Add Object" form posts
// to the existing /products/{id}/objects endpoint. No backend changes required.

export interface WebScannerItem {
  object_name: string;
  object_type: string;
  technical_path: string;
  module?: string;
  feature?: string;
  screen?: string;
  aliases?: string[];
  supported_actions?: string[];
}

export interface WebScannerPayload {
  source?: string;
  page?: string;
  captured_at?: string;
  objects: WebScannerItem[];
}

export function generateWebScannerScript(productName = 'TestPilot Product'): string {
  return `// TestPilot AI — Web Product Library Scanner
// Product: ${productName}
// How to use:
//   1. Open the target web application in your browser and log in / navigate to the screen you want to capture.
//   2. Open DevTools (F12) -> Console tab.
//   3. Paste this entire script and press Enter.
//   4. A JSON file named testpilot-web-objects-<host>-<timestamp>.json downloads automatically.
//   5. Repeat on other screens if needed (each run downloads a separate file).
//   6. Go back to TestPilot -> Product Library -> "Import Web Scanner JSON" and upload the file(s).
(function () {
  function visible(el) {
    if (!(el instanceof Element)) return false;
    var rect = el.getBoundingClientRect();
    var style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function cssPath(el) {
    if (el.id) return '#' + el.id;
    var testId = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy')
      || el.getAttribute('data-qa') || el.getAttribute('data-automation-id');
    if (testId) return '[data-testid="' + testId + '"]';
    if (el.getAttribute('name')) return el.tagName.toLowerCase() + '[name="' + el.getAttribute('name') + '"]';
    if (el.getAttribute('formcontrolname')) return el.tagName.toLowerCase() + '[formcontrolname="' + el.getAttribute('formcontrolname') + '"]';
    var path = [];
    var node = el;
    while (node && node.nodeType === 1 && node.tagName.toLowerCase() !== 'html') {
      var selector = node.tagName.toLowerCase();
      if (node.className && typeof node.className === 'string') {
        var cls = node.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2);
        if (cls.length) selector += '.' + cls.join('.');
      }
      var parent = node.parentElement;
      if (parent) {
        var siblings = Array.prototype.filter.call(parent.children, function (sib) { return sib.tagName === node.tagName; });
        if (siblings.length > 1) selector += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      }
      path.unshift(selector);
      node = parent;
    }
    return path.join(' > ');
  }

  function label(el) {
    var ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();
    if (el.id) {
      var forLabel = document.querySelector('label[for="' + el.id + '"]');
      if (forLabel && forLabel.textContent) return forLabel.textContent.trim();
    }
    var closestLabel = el.closest('label');
    if (closestLabel && closestLabel.textContent) return closestLabel.textContent.trim();
    if (el.getAttribute('placeholder')) return el.getAttribute('placeholder').trim();
    if (el.getAttribute('title')) return el.getAttribute('title').trim();
    if (el.getAttribute('name')) return el.getAttribute('name').trim();
    var text = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ');
    return text.slice(0, 80);
  }

  function nearestHeading(el) {
    var node = el;
    while (node) {
      var prev = node;
      while (prev) {
        if (prev.matches && prev.matches('h1, h2, h3, [role="heading"]') && prev.textContent) {
          return prev.textContent.trim().slice(0, 120);
        }
        prev = prev.previousElementSibling;
      }
      node = node.parentElement;
    }
    return '';
  }

  function objectTypeOf(el) {
    var tag = el.tagName.toLowerCase();
    var type = (el.getAttribute('type') || '').toLowerCase();
    var role = el.getAttribute('role');
    if (tag === 'select') return 'dropdown';
    if (tag === 'textarea') return 'input';
    if (tag === 'a' || tag === 'button' || role === 'button' || role === 'tab' || role === 'menuitem' || role === 'option'
      || (tag !== 'input' && (el.hasAttribute('onclick') || el.hasAttribute('tabindex')))) return 'button';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (tag === 'input') return 'input';
    return 'container';
  }

  function actionsFor(el) {
    var type = objectTypeOf(el);
    if (type === 'button') return ['click', 'verify'];
    if (type === 'checkbox' || type === 'radio') return ['click', 'verify'];
    if (type === 'dropdown') return ['select', 'verify'];
    return ['enter_text', 'verify'];
  }

  var selector = 'input, textarea, select, button, a, [role="button"], [role="link"], [role="tab"], [role="menuitem"],'
    + ' [role="option"], [role="checkbox"], [role="radio"], [contenteditable="true"], [onclick], [tabindex]:not([tabindex="-1"])';
  var seen = new Set();
  var objects = [];
  var unlabeledCount = 0;
  Array.prototype.forEach.call(document.querySelectorAll(selector), function (el) {
    if (!visible(el) || el.disabled) return;
    var path = cssPath(el);
    if (!path || seen.has(path)) return;
    seen.add(path);
    // A bare tag name ("a", "button") is meaningless as an object name — it is short enough to
    // accidentally substring-match almost any test step text during mapping. Fall back to the
    // link target or an explicitly "unlabeled" marker instead, never the raw tag name alone.
    var fallback = el.tagName.toLowerCase();
    if (fallback === 'a' && el.getAttribute('href')) {
      var hrefTail = el.getAttribute('href').split(/[?#]/)[0].split('/').filter(Boolean).pop();
      if (hrefTail) fallback = 'Link: ' + hrefTail;
    }
    if (fallback === el.tagName.toLowerCase()) {
      unlabeledCount += 1;
      fallback = 'Unlabeled ' + fallback + ' #' + unlabeledCount;
    }
    var name = label(el) || fallback;
    objects.push({
      object_name: name.slice(0, 255),
      object_type: objectTypeOf(el),
      technical_path: path,
      module: document.title.trim().slice(0, 255) || location.hostname,
      feature: nearestHeading(el) || 'General',
      screen: location.pathname || '/',
      aliases: [el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.getAttribute('name')].filter(Boolean),
      supported_actions: actionsFor(el)
    });
  });

  var payload = {
    source: 'TestPilot Web Scanner',
    page: location.href,
    captured_at: new Date().toISOString(),
    objects: objects
  };

  var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var link = document.createElement('a');
  var stamp = new Date().toISOString().replace(/[:.]/g, '-');
  link.href = url;
  link.download = 'testpilot-web-objects-' + location.hostname.replace(/[^a-z0-9.-]+/gi, '-') + '-' + stamp + '.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  console.log('TestPilot Web Scanner captured ' + objects.length + ' object(s). File downloaded.');
})();
`;
}

export function downloadWebScannerScript(productName = 'TestPilot Product') {
  const script = generateWebScannerScript(productName);
  const blob = new Blob([script], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeName = productName.trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'product';
  link.href = url;
  link.download = `testpilot-web-scanner-${safeName}.js`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function parseWebScannerOutput(raw: string): WebScannerItem[] {
  const parsed = raw.trim().startsWith('[') || raw.trim().startsWith('{')
    ? JSON.parse(raw)
    : raw.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
  const items = Array.isArray(parsed) ? parsed : parsed.objects;
  if (!Array.isArray(items)) {
    throw new Error('Web scanner file must contain an "objects" array');
  }
  return items.filter((item): item is WebScannerItem => Boolean(item && item.object_name && item.technical_path));
}

export function webScannerItemToObjectPayload(item: WebScannerItem): Record<string, unknown> {
  return {
    object_name: item.object_name,
    platform: 'Web',
    module: item.module || 'Web App',
    feature: item.feature || 'General',
    screen: item.screen || '/',
    object_type: item.object_type || 'input',
    technical_path: item.technical_path,
    supported_actions: (item.supported_actions && item.supported_actions.length ? item.supported_actions : ['verify']).join(', '),
    aliases: (item.aliases || []).join(', '),
    confidence: 70,
    status: 'Active'
  };
}
