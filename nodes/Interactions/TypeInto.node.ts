import {
  INodeType,
  INodeTypeDescription,
  IExecuteFunctions,
  INodeExecutionData,
  NodeConnectionType,
} from 'n8n-workflow';
import { chromium } from 'playwright';
import { SessionObject } from '../../utils/SessionObject';

// Type declarations for DOM elements
declare global {
  interface HTMLInputElement {
    value: string;
  }
  interface HTMLTextAreaElement {
    value: string;
  }
  interface Element {
    textContent: string | null;
    tagName: string;
  }
}

export class TypeInto implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Type Into Element',
    name: 'typeInto',
    group: ['transform'],
    version: 1,
    description: 'Types provided text into an element found by a manual CSS selector.',
    defaults: { name: 'Type Into' },
    inputs: [NodeConnectionType.Main],
    outputs: [NodeConnectionType.Main],
    properties: [
      {
        displayName: 'CSS Selector',
        name: 'selector',
        type: 'string',
        default: '',
        required: true,
        description: 'CSS selector to find the target element',
      },
      {
        displayName: 'Text to Type',
        name: 'text',
        type: 'string',
        default: '',
        required: true,
        description: 'Text content to type into the element',
      },
      {
        displayName: 'Wait For Selector Timeout (ms)',
        name: 'waitTimeout',
        type: 'number',
        default: 5000,
        description: 'Maximum time to wait for selector to appear',
      },
      {
        displayName: 'Clear Field First',
        name: 'clearFirst',
        type: 'boolean',
        default: true,
        description: 'Clear the field before typing',
      },
      {
        displayName: 'Typing Delay (ms)',
        name: 'typingDelay',
        type: 'number',
        default: 0,
        description: 'Delay between keystrokes (0 for instant)',
      },
      {
        displayName: 'Click Before Typing',
        name: 'clickFirst',
        type: 'boolean',
        default: false,
        description: 'Click the element before typing to ensure focus',
      },
      {
        displayName: 'Press Enter After',
        name: 'pressEnter',
        type: 'boolean',
        default: false,
        description: 'Press Enter key after typing',
      },
      {
        displayName: 'Press Tab After',
        name: 'pressTab',
        type: 'boolean',
        default: false,
        description: 'Press Tab key after typing',
      },
      {
        displayName: 'Wait After Typing (ms)',
        name: 'waitAfter',
        type: 'number',
        default: 0,
        description: 'Wait time after typing is complete',
      }
    ]
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const results: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      const session = items[i].json as unknown as SessionObject;
      const selector = this.getNodeParameter('selector', i) as string;
      const text = this.getNodeParameter('text', i) as string;
      const waitTimeout = this.getNodeParameter('waitTimeout', i, 5000) as number;
      const clearFirst = this.getNodeParameter('clearFirst', i, true) as boolean;
      const typingDelay = this.getNodeParameter('typingDelay', i, 0) as number;
      const clickFirst = this.getNodeParameter('clickFirst', i, false) as boolean;
      const pressEnter = this.getNodeParameter('pressEnter', i, false) as boolean;
      const pressTab = this.getNodeParameter('pressTab', i, false) as boolean;
      const waitAfter = this.getNodeParameter('waitAfter', i, 0) as number;

      let typingResult: any = {};
      let browser = null;
      let page = null;

      try {
        // Connect to browser via CDP
        browser = await chromium.connectOverCDP(session.cdpUrl);
        const context = browser.contexts()[0];
        page = context.pages()[0] || (await context.newPage());

        // Wait for page to be ready
        await page.waitForLoadState('domcontentloaded', { timeout: 9000 });

        // Basic debug info
        typingResult.currentUrl = await page.url();
        typingResult.selector = selector;

        // Wait for element to be available
        await page.waitForSelector(selector, { timeout: waitTimeout });

        // Get the element
        const el = await page.$(selector);
        if (!el) throw new Error('Selector not found after wait');

        // Get element information for debugging
        typingResult.elementTag = await el.evaluate(el => el.tagName);
        typingResult.valueBefore = await el.evaluate(el => (el as any).value || el.textContent || '');

        // Click element first if requested (helps with focus)
        if (clickFirst) {
          await el.click();
        }

        // Clear field if requested
        if (clearFirst) {
          await el.fill('');
        }

        // Type the text with optional delay
        if (typingDelay > 0) {
          await el.focus();
          await page.keyboard.type(text, { delay: typingDelay });
        } else {
          await el.fill(text);
        }

        // Press Enter if requested
        if (pressEnter) {
          await page.keyboard.press('Enter');
        }

        // Press Tab if requested
        if (pressTab) {
          await page.keyboard.press('Tab');
        }

        // Wait after typing if requested
        if (waitAfter > 0) {
          await page.waitForTimeout(waitAfter);
        }

        // Get final value for verification
        typingResult.valueAfter = await el.evaluate(el => (el as any).value || el.textContent || '');

        // Success result
        typingResult.result = 'success';
        typingResult.textTyped = text;

        await browser.close();

      } catch (e) {
        const errorMsg = (e as Error).message;

        // Error result with context
        typingResult.result = 'error';
        typingResult.error = errorMsg;
        typingResult.selector = selector;
        typingResult.textToType = text;

        if (browser) {
          await browser.close().catch(() => {});
        }
      }

      // Push result without merging into session (reusable across workflows)
      results.push({json: typingResult});
    }

    return [results];
  }
}
