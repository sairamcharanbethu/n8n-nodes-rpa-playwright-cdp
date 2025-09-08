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
      },
      {
        displayName: 'Text to Type',
        name: 'text',
        type: 'string',
        default: '',
        required: true,
      },
      {
        displayName: 'Wait For Selector Timeout (ms)',
        name: 'waitTimeout',
        type: 'number',
        default: 5000,
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

      let typingResult: any = {};
      let browser = null;

      try {
        browser = await chromium.connectOverCDP(session.cdpUrl);
        const page = browser.contexts()[0].pages()[0] || await browser.contexts()[0].newPage();

        // Debug info
        typingResult.currentUrl = await page.url();
        typingResult.pageTitle = await page.title();

        await page.waitForSelector(selector, { timeout: waitTimeout });
        typingResult.selectorFound = true;

        const el = await page.$(selector);
        if (!el) throw new Error('Selector not found');

        // Get element info for debug
        typingResult.elementTag = await el.evaluate(el => el.tagName);
        typingResult.valueBefore = await el.evaluate(el => (el as HTMLInputElement).value || el.textContent || '');

        await el.fill(text);

        // Get value after typing for debug
        typingResult.valueAfter = await el.evaluate(el => (el as HTMLInputElement).value || el.textContent || '');

        typingResult = {
          selector,
          textTyped: text,
          result: 'success',
          cdpUrl: session.cdpUrl,
          currentUrl: typingResult.currentUrl,
          pageTitle: typingResult.pageTitle,
          selectorFound: typingResult.selectorFound,
          elementTag: typingResult.elementTag,
          valueBefore: typingResult.valueBefore,
          valueAfter: typingResult.valueAfter
        };

        await browser.close();
      } catch (e) {
        typingResult = {
          selector,
          error: (e as Error).message,
          cdpUrl: session.cdpUrl,
          currentUrl: typingResult.currentUrl || 'unknown',
          pageTitle: typingResult.pageTitle || 'unknown',
          selectorFound: typingResult.selectorFound || false
        };
        if (browser) await browser.close().catch(() => {});
      }

      results.push({json: {...session, typeAction: typingResult}});
    }

    return [results];
  }
}
