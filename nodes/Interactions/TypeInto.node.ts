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
			let page = null;
      try {
        typingResult.step1_connecting = true;
        browser = await chromium.connectOverCDP(session.cdpUrl);
        typingResult.step2_connected = true;
				const context = browser.contexts()[0];
        page = context.pages()[0] || (await context.newPage());
        await page.waitForLoadState('domcontentloaded', { timeout: 9000 });
        typingResult.step3_page_ready = true;

        // Debug info
        typingResult.currentUrl = await page.url();
        typingResult.pageTitle = await page.title();
        typingResult.step4_page_info_captured = true;

        typingResult.step5_waiting_for_selector = true;
        await page.waitForSelector(selector, { timeout: waitTimeout });
        typingResult.step6_selector_found = true;

        const el = await page.$(selector);
        typingResult.step7_element_queried = true;
        if (!el) throw new Error('Selector not found after wait');

        typingResult.step8_element_exists = true;

        // Get element info for debug
        typingResult.elementTag = await el.evaluate(el => el.tagName);
        typingResult.elementType = await el.evaluate(el => el.getAttribute('type') || 'none');
        typingResult.elementId = await el.evaluate(el => el.id || 'none');
        typingResult.elementClass = await el.evaluate(el => el.className || 'none');
        typingResult.valueBefore = await el.evaluate(el => (el as any).value || el.textContent || 'empty');
        typingResult.step9_element_info_captured = true;

        await el.fill(text);
        typingResult.step10_fill_completed = true;

        // Get value after typing for debug
        typingResult.valueAfter = await el.evaluate(el => (el as any).value || el.textContent || 'empty');
        typingResult.step11_value_after_captured = true;

        typingResult.result = 'success';
        typingResult.textTyped = text;
        typingResult.cdpUrl = session.cdpUrl;

        await browser.close();
        typingResult.step12_browser_closed = true;

      } catch (e) {
        const errorMsg = (e as Error).message;
        const errorStack = (e as Error).stack;

        typingResult.result = 'error';
        typingResult.error = errorMsg;
        typingResult.errorStack = errorStack;
        typingResult.cdpUrl = session.cdpUrl;
        typingResult.selector = selector;
        typingResult.textToType = text;

        // Capture any debug info we got before error
        if (typingResult.currentUrl) {
          typingResult.errorContext = 'Error occurred after page connection';
        } else {
          typingResult.errorContext = 'Error occurred during initial connection';
        }

        if (browser) {
          await browser.close().catch(() => {});
          typingResult.browserClosedAfterError = true;
        }
      }

      results.push({json: {...session, typeAction: typingResult}});
    }

    return [results];
  }
}
