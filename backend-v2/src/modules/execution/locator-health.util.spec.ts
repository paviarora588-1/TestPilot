jest.mock('playwright', () => ({
  chromium: { launch: jest.fn() },
}));

import { chromium } from 'playwright';
import { verifyLocatorLive } from './locator-health.util';

function makeMockPage(count: number, gotoError?: Error) {
  return {
    goto: gotoError ? jest.fn().mockRejectedValue(gotoError) : jest.fn().mockResolvedValue(undefined),
    locator: jest.fn().mockReturnValue({ count: jest.fn().mockResolvedValue(count) }),
  };
}

function makeMockBrowser(page: unknown) {
  return {
    newPage: jest.fn().mockResolvedValue(page),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

describe('verifyLocatorLive', () => {
  const mockLaunch = chromium.launch as jest.Mock;

  afterEach(() => jest.clearAllMocks());

  it('reports resolves:true when the locator matches exactly one element', async () => {
    const page = makeMockPage(1);
    mockLaunch.mockResolvedValue(makeMockBrowser(page));

    const result = await verifyLocatorLive('http://example.com', '#login', 'ID');

    expect(result).toEqual({ resolves: true, ambiguous: false });
  });

  it('reports resolves:false, ambiguous:false when the locator matches nothing', async () => {
    const page = makeMockPage(0);
    mockLaunch.mockResolvedValue(makeMockBrowser(page));

    const result = await verifyLocatorLive('http://example.com', '#gone', 'ID');

    expect(result).toEqual({ resolves: false, ambiguous: false });
  });

  it('reports ambiguous:true when the locator matches more than one element', async () => {
    const page = makeMockPage(3);
    mockLaunch.mockResolvedValue(makeMockBrowser(page));

    const result = await verifyLocatorLive('http://example.com', '.button', 'CSS');

    expect(result).toEqual({ resolves: false, ambiguous: true });
  });

  it('prefixes an XPATH strategy locator with xpath= so Playwright interprets it correctly', async () => {
    const page = makeMockPage(1);
    mockLaunch.mockResolvedValue(makeMockBrowser(page));

    await verifyLocatorLive('http://example.com', '//div[@id="x"]', 'XPATH');

    expect(page.locator).toHaveBeenCalledWith('xpath=//div[@id="x"]');
  });

  it('prefixes a TEXT strategy locator with text=', async () => {
    const page = makeMockPage(1);
    mockLaunch.mockResolvedValue(makeMockBrowser(page));

    await verifyLocatorLive('http://example.com', 'Sign in', 'TEXT');

    expect(page.locator).toHaveBeenCalledWith('text=Sign in');
  });

  it('uses non-XPATH/TEXT locators as-is (already a ready-to-use CSS selector)', async () => {
    const page = makeMockPage(1);
    mockLaunch.mockResolvedValue(makeMockBrowser(page));

    await verifyLocatorLive('http://example.com', '[data-testid="submit"]', 'DATA_TESTID');

    expect(page.locator).toHaveBeenCalledWith('[data-testid="submit"]');
  });

  it('returns resolves:false with an errorMessage when navigation fails, instead of throwing', async () => {
    const page = makeMockPage(0, new Error('net::ERR_CONNECTION_REFUSED'));
    mockLaunch.mockResolvedValue(makeMockBrowser(page));

    const result = await verifyLocatorLive('http://unreachable.example', '#x', 'ID');

    expect(result.resolves).toBe(false);
    expect(result.errorMessage).toContain('ERR_CONNECTION_REFUSED');
  });

  it('always closes the browser, even when the check throws', async () => {
    const page = makeMockPage(0, new Error('boom'));
    const browser = makeMockBrowser(page);
    mockLaunch.mockResolvedValue(browser);

    await verifyLocatorLive('http://example.com', '#x', 'ID');

    expect(browser.close).toHaveBeenCalled();
  });
});
