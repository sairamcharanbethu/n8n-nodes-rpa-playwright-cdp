import {
  INodeType,
  INodeTypeDescription,
  IExecuteFunctions,
  INodeExecutionData,
  NodeConnectionType,
} from 'n8n-workflow';
import { chromium, Browser } from 'playwright';
import { SessionObject } from '../../utils/SessionObject';

export class Click implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Click Element',
    name: 'click',
    group: ['transform'],
    version: 1,
    description: 'Clicks an element specified by a selector (CSS, XPath, Text, etc.) using Playwright.',
    defaults: { name: 'Click Element' },
    inputs: [NodeConnectionType.Main],
    outputs: [NodeConnectionType.Main],
    properties: [
      {
        displayName: 'CDP URL',
        name: 'cdpUrl',
        type: 'string',
        default: '',
        placeholder: 'E.g. ws://localhost:9222/devtools/browser/...',
        required: true,
      },
      {
        displayName: 'Selector',
        name: 'selector',
        type: 'string',
        default: '',
        required: true,
        placeholder: 'E.g. #submit, text=Submit, xpath=//button',
        description: 'Selector (CSS, XPath, Text, etc.) to find the target element',
      },
      {
        displayName: 'Click Type',
        name: 'clickType',
        type: 'options',
        options: [
          { name: 'Single Click', value: 'single' },
          { name: 'Double Click', value: 'double' },
          { name: 'Right Click', value: 'right' },
        ],
        default: 'single',
        description: 'Type of click to perform',
      },
      {
        displayName: 'Wait For Selector Timeout (ms)',
        name: 'waitTimeout',
        type: 'number',
        default: 5000,
        description: 'Maximum time to wait for selector to appear',
      },
      {
        displayName: 'Scroll Into View First',
        name: 'scrollIntoView',
        type: 'boolean',
        default: true,
        description: 'Scroll element into view before clicking',
      },
      {
        displayName: 'Force Click (ignore blocking elements)',
        name: 'forceClick',
        type: 'boolean',
        default: false,
        description: 'Force click even if element is obscured',
      },
      {
        displayName: 'Wait Before Click (ms)',
        name: 'waitBefore',
        type: 'number',
        default: 0,
        description: 'Wait time before clicking',
      },
      {
        displayName: 'Wait After Click (ms)',
        name: 'waitAfter',
        type: 'number',
        default: 0,
        description: 'Wait time after clicking',
      },
      {
        displayName: 'Wait For Navigation',
        name: 'waitForNavigation',
        type: 'boolean',
        default: false,
        description: 'Wait for page navigation after click',
      },
      {
        displayName: 'Navigation Timeout (ms)',
        name: 'navigationTimeout',
        type: 'number',
        default: 30000,
        displayOptions: {
          show: {
            waitForNavigation: [true],
          },
        },
        description: 'Timeout for navigation wait',
      },
      {
        displayName: 'Click Position',
        name: 'clickPosition',
        type: 'options',
        options: [
          { name: 'Center', value: 'center' },
          { name: 'Top Left', value: 'top-left' },
          { name: 'Top Right', value: 'top-right' },
          { name: 'Bottom Left', value: 'bottom-left' },
          { name: 'Bottom Right', value: 'bottom-right' },
        ],
        default: 'center',
        description: 'Position within element to click',
      },
    ]
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const results: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      const session = items[i].json as unknown as SessionObject;
			const cdpUrl = this.getNodeParameter('cdpUrl', i) as string;
      const selector = this.getNodeParameter('selector', i) as string;
      const clickType = this.getNodeParameter('clickType', i, 'single') as string;
      const waitTimeout = this.getNodeParameter('waitTimeout', i, 5000) as number;
      const scrollIntoView = this.getNodeParameter('scrollIntoView', i, true) as boolean;
      const forceClick = this.getNodeParameter('forceClick', i, false) as boolean;
      const waitBefore = this.getNodeParameter('waitBefore', i, 0) as number;
      const waitAfter = this.getNodeParameter('waitAfter', i, 0) as number;
      const waitForNavigation = this.getNodeParameter('waitForNavigation', i, false) as boolean;
      const navigationTimeout = this.getNodeParameter('navigationTimeout', i, 30000) as number;
      const clickPosition = this.getNodeParameter('clickPosition', i, 'center') as string;

      let clickResult: any = {};
      let browser: Browser | null = null;

      try {
        browser = await chromium.connectOverCDP(cdpUrl);
        const context = browser.contexts()[0] || (await browser.newContext());
        const page = context.pages().length ? context.pages()[0] : await context.newPage();

        // Basic debug info
        clickResult.currentUrl = await page.url();
        clickResult.selector = selector;

        // Wait for element to be available
        await page.waitForSelector(selector, { timeout: waitTimeout });
        const elHandle = await page.$(selector);
        if (!elHandle) throw new Error(`Element with selector "${selector}" not found`);

        // Get element information for debugging
        clickResult.elementTag = await elHandle.evaluate(el => el.tagName);
        clickResult.elementVisible = await elHandle.isVisible();
        clickResult.elementEnabled = await elHandle.isEnabled();

        // Scroll into view if requested
        if (scrollIntoView) {
          await elHandle.scrollIntoViewIfNeeded();
          clickResult.scrolledIntoView = true;
        }

        // Wait before click if requested
        if (waitBefore > 0) {
          await page.waitForTimeout(waitBefore);
        }

        // Determine click position
        let position = undefined;
        if (clickPosition !== 'center') {
          const box = await elHandle.boundingBox();
          if (box) {
            switch (clickPosition) {
              case 'top-left': position = { x: box.x + 1, y: box.y + 1 }; break;
              case 'top-right': position = { x: box.x + box.width - 1, y: box.y + 1 }; break;
              case 'bottom-left': position = { x: box.x + 1, y: box.y + box.height - 1 }; break;
              case 'bottom-right': position = { x: box.x + box.width - 1, y: box.y + box.height - 1 }; break;
            }
          }
        }

        // Setup navigation promise if needed
        let navigationPromise;
        if (waitForNavigation) {
          navigationPromise = page.waitForNavigation({ timeout: navigationTimeout });
        }

        // Perform the click based on type
        const clickOptions = { force: forceClick, position };
        if (clickType === 'double') {
          await elHandle.dblclick(clickOptions);
        } else if (clickType === 'right') {
          await elHandle.click({ ...clickOptions, button: 'right' });
        } else {
          await elHandle.click(clickOptions);
        }

        clickResult.clickPerformed = true;

        // Wait for navigation if requested
        if (waitForNavigation && navigationPromise) {
          await navigationPromise;
          clickResult.navigationCompleted = true;
          clickResult.newUrl = await page.url();
        }

        // Wait after click if requested
        if (waitAfter > 0) {
          await page.waitForTimeout(waitAfter);
        }

        // Success result
        clickResult.result = 'success';
        clickResult.clickType = clickType;

        await browser.close();
        results.push({ json: { ...session, clickAction: clickResult } });

      } catch (e) {
        if (browser) await browser.close().catch(() => {});
        const errorMsg = (e as Error).message;
        clickResult.result = 'error';
        clickResult.error = errorMsg;
        clickResult.selector = selector;
        clickResult.clickType = clickType;
        results.push({ json: {...session, clickAction: clickResult} });
      }
    }

    return [results];
  }
}
