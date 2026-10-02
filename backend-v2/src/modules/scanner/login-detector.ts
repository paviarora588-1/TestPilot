import { Locator, Page } from 'playwright';

// Best-effort, generic login handling for the Scanner — this is not a
// substitute for the "scan the current browser page" CDP-attach mode, which
// remains the reliable path for anything this heuristic can't handle
// (OAuth/third-party IdP redirects, CAPTCHA, MFA/OTP all need a human in the
// loop and are deliberately out of scope here). What this covers: a plain
// username+password form, and a common two-step SSO-style variant
// (identifier screen, then a separate password screen — e.g. many SAP
// Fiori/enterprise IdP-fronted logins).
export interface LoginCredentials {
  username: string;
  password: string;
}

export interface LoginAttemptResult {
  // false when no password field was ever found — identical, by design, to
  // not having supplied credentials at all.
  attempted: boolean;
  succeeded: boolean;
  message: string;
}

const SUBMIT_TEXT = /sign.?in|log.?in|submit|continue|next/i;
const IDENTIFIER_HINT = /user|email|login|account/i;

async function isVisible(locator: Locator): Promise<boolean> {
  return locator.isVisible().catch(() => false);
}

async function findVisiblePasswordField(page: Page): Promise<Locator | null> {
  const candidates = page.locator('input[type="password"]');
  const count = await candidates.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const el = candidates.nth(i);
    if (await isVisible(el)) return el;
  }
  return null;
}

async function findIdentifierField(page: Page): Promise<Locator | null> {
  const emailCandidates = page.locator('input[type="email"]');
  const emailCount = await emailCandidates.count().catch(() => 0);
  for (let i = 0; i < emailCount; i++) {
    const el = emailCandidates.nth(i);
    if (await isVisible(el)) return el;
  }

  const textCandidates = page.locator('input[type="text"], input:not([type])');
  const textCount = await textCandidates.count().catch(() => 0);
  const visibleTextInputs: Locator[] = [];
  for (let i = 0; i < textCount; i++) {
    const el = textCandidates.nth(i);
    if (await isVisible(el)) visibleTextInputs.push(el);
  }

  for (const el of visibleTextInputs) {
    const attrs = await el
      .evaluate((node) => {
        const input = node as HTMLInputElement;
        return `${input.name || ''} ${input.id || ''} ${input.placeholder || ''} ${input.getAttribute('aria-label') || ''}`;
      })
      .catch(() => '');
    if (IDENTIFIER_HINT.test(attrs)) return el;
  }

  // No name/id/placeholder hint matched anything — the first visible
  // text-like input is still a reasonable guess (most login forms have
  // exactly one text input before the password field, hinted or not).
  return visibleTextInputs[0] ?? null;
}

async function clickLikelyButton(page: Page, pattern: RegExp): Promise<boolean> {
  const candidates = page.locator('button, input[type="submit"], input[type="button"], [role="button"], a');
  const count = await candidates.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const el = candidates.nth(i);
    if (!(await isVisible(el))) continue;
    const text = ((await el.innerText().catch(() => '')) || (await el.getAttribute('value').catch(() => '')) || '').trim();
    if (pattern.test(text)) {
      const clicked = await el
        .click({ timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      if (clicked) return true;
    }
  }
  return false;
}

const NOT_SUCCEEDED_MESSAGE = "Login attempt didn't seem to succeed — continuing scan from the current page.";
const SUCCEEDED_MESSAGE = 'Logged in with the provided test credentials — continuing scan.';

// Called once, right after the crawl's first navigation settles and before
// any scanning begins — so login-form fields are never captured as scanned
// objects, and the rest of the crawl proceeds from wherever this leaves the
// page (authenticated, or not, but never blocked on it).
export async function attemptAutoLogin(
  page: Page,
  credentials: LoginCredentials,
  timeoutMs = 20_000,
): Promise<LoginAttemptResult> {
  const deadline = Date.now() + timeoutMs;
  const timeLeft = () => Math.max(1000, deadline - Date.now());

  let passwordField = await findVisiblePasswordField(page);

  if (!passwordField) {
    // Two-step SSO-style form: an identifier-only screen first, password on
    // a second screen reached after "Next"/"Continue".
    const identifierField = await findIdentifierField(page);
    if (!identifierField) {
      return { attempted: false, succeeded: false, message: '' };
    }
    await identifierField.fill(credentials.username).catch(() => undefined);
    const clicked = await clickLikelyButton(page, SUBMIT_TEXT);
    if (!clicked) await page.keyboard.press('Enter').catch(() => undefined);
    await page.waitForLoadState('domcontentloaded', { timeout: timeLeft() }).catch(() => undefined);
    await page.waitForTimeout(800);

    passwordField = await findVisiblePasswordField(page);
    if (!passwordField) {
      return { attempted: true, succeeded: false, message: NOT_SUCCEEDED_MESSAGE };
    }
  }

  const identifierField = await findIdentifierField(page);
  if (identifierField) {
    const currentValue = await identifierField.inputValue().catch(() => '');
    if (!currentValue) {
      await identifierField.fill(credentials.username).catch(() => undefined);
    }
  }
  await passwordField.fill(credentials.password).catch(() => undefined);

  const clicked = await clickLikelyButton(page, SUBMIT_TEXT);
  if (!clicked) await passwordField.press('Enter').catch(() => undefined);

  await page.waitForLoadState('domcontentloaded', { timeout: timeLeft() }).catch(() => undefined);
  await page.waitForTimeout(800);

  const stillOnLogin = await findVisiblePasswordField(page);
  if (stillOnLogin) {
    return { attempted: true, succeeded: false, message: NOT_SUCCEEDED_MESSAGE };
  }
  // Confirmed live against a real app (OrangeHRM's demo): the password
  // field can disappear (form replaced, a spinner shown) BEFORE the actual
  // client-side redirect to the post-login URL has fired — the 800ms wait
  // above is sometimes not long enough for that redirect to land. Reading
  // page.url() right now would then capture the stale pre-redirect URL,
  // which the caller stores as "where login landed" — the crawl's own
  // subsequent goto() to that stale URL then races the app's own
  // now-in-flight redirect and Playwright reports it as one navigation
  // interrupting another. Bounded, best-effort: if the URL is still
  // changing, this gives it a real chance to settle; if it's genuinely
  // done (most logins), this resolves almost immediately.
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
  return { attempted: true, succeeded: true, message: SUCCEEDED_MESSAGE };
}

// Exported separately (rather than only reachable through attemptAutoLogin)
// so the identifier-hint and submit-text matching rules are unit-testable
// as plain string logic, without needing a real Page/browser.
export function matchesIdentifierHint(attrs: string): boolean {
  return IDENTIFIER_HINT.test(attrs);
}

export function matchesSubmitText(text: string): boolean {
  return SUBMIT_TEXT.test(text);
}
