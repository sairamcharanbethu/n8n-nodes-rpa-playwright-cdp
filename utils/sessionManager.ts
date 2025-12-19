import playwright, { Browser } from 'playwright';
import http, { RequestOptions, IncomingMessage } from 'http';
import { URL } from 'url';
import { SessionObject } from './SessionObject';

export interface LaunchBrowserParams {
  seleniumHubUrl: string;
  profileDir: string;
  navigateUrl: string;
  browserArgs?: string[];
  windowSize?: string; // e.g. "1920,1080"
}

function parseUrl(url: string): URL {
  return new URL(url);
}

function reqJSON(
  method: string,
  url: string,
  body?: any
): Promise<{ status: number; data: any; raw?: string }> {
  return new Promise((resolve, reject) => {
    const urlObj = parseUrl(url);
    const options: RequestOptions = {
      method,
      hostname: urlObj.hostname,
      port: parseInt(urlObj.port) || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname,
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    };

    const req = http.request(options, (res: IncomingMessage) => {
      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode || 500,
            data: data ? JSON.parse(data) : {},
          });
        } catch (e) {
          resolve({ status: res.statusCode || 500, data: {}, raw: data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Request timeout')));

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

export async function launchGoogleSession(params: LaunchBrowserParams): Promise<SessionObject> {
  let sessionId: string | null = null;
  let browser: Browser | null = null;

  try {
    const browserArgs = [
      `--user-data-dir=${params.profileDir}`,
      '--profile-directory=Default',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      ...(params.windowSize ? [`--window-size=${params.windowSize}`] : []),
      ...(params.browserArgs || []),
      '--remote-debugging-port=0',
    ];

    const sessionResp = await reqJSON('POST', `${params.seleniumHubUrl}/session`, {
      capabilities: {
        alwaysMatch: {
          browserName: 'chrome',
          'goog:chromeOptions': {
            args: browserArgs,
          },
        },
        firstMatch: [{}],
      },
    });

    sessionId = sessionResp.data.value?.sessionId;
    const capabilities = sessionResp.data.value?.capabilities || {};
    const cdpUrl = capabilities['se:cdp'] as string;

    browser = await playwright.chromium.connectOverCDP(cdpUrl);
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    await page.goto(params.navigateUrl, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    const title = await page.title();
    const currentUrl = page.url();

    await browser.close();

    return {
      success: true,
      sessionId: sessionId || '',
      cdpUrl: cdpUrl || '',
      seleniumHubUrl: params.seleniumHubUrl,
      pageTitle: title,
      currentUrl,
      step: 'launch',
      message: 'Website session launched successfully',
      timestamp: new Date().toISOString(),
    };
  } catch (error: any) {
    if (browser) await browser.close().catch(() => {});
    if (sessionId) {
      await reqJSON('DELETE', `${params.seleniumHubUrl}/session/${sessionId}`).catch(() => {});
    }
    return {
      success: false,
      error: error.message || String(error),
      step: 'launch',
      timestamp: new Date().toISOString(),
      sessionId: sessionId || '',
      cdpUrl: '',
    };
  }
}

export async function navigateWithSession(
  session: SessionObject,
  navigateUrl: string
): Promise<SessionObject> {
  let browser: Browser | null = null;
  try {
    browser = await playwright.chromium.connectOverCDP(session.cdpUrl);
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = context.pages().length ? context.pages()[0] : await context.newPage();

    await page.goto(navigateUrl, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    const title = await page.title();
    await browser.close();

    return {
      ...session,
      currentUrl: page.url(),
      pageTitle: title,
      success: true,
      step: 'navigate',
      message: `Navigation to ${navigateUrl} successful`,
      timestamp: new Date().toISOString(),
    };
  } catch (error: any) {
    if (browser) await browser.close().catch(() => {});
    return {
      ...session,
      success: false,
      error: error.message || String(error),
      step: 'navigate',
      timestamp: new Date().toISOString(),
    };
  }
}

export async function closeSession(session: SessionObject): Promise<SessionObject> {
  try {
    await reqJSON('DELETE', `${session.seleniumHubUrl}/session/${session.sessionId}`);
    return {
      ...session,
      success: true,
      step: 'close',
      message: 'Session closed successfully',
      timestamp: new Date().toISOString(),
    };
  } catch (error: any) {
    return {
      ...session,
      success: false,
      error: error.message || String(error),
      step: 'close',
      timestamp: new Date().toISOString(),
    };
  }
}
