import { chromium, Browser, Page } from 'playwright';

export async function connectBrowser(cdpUrl: string): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.newPage();
  await page.waitForLoadState('domcontentloaded', { timeout: 9000 });
  return { browser, page };
}

export async function validateSelector(page: Page, selector: string): Promise<boolean> {
  try {
    const el = await page.$(selector);
    return !!el;
  } catch {
    return false;
  }
}
