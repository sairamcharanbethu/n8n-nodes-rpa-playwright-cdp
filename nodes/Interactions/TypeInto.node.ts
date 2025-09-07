import {
  INodeType,
  INodeTypeDescription,
  IExecuteFunctions,
  INodeExecutionData,
  NodeConnectionType,
} from 'n8n-workflow';
import { chromium, Browser } from 'playwright';
import { SessionObject } from '../../utils/SessionObject';

export class TypeInto implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Type Into Element',
    name: 'typeInto',
    group: ['transform'],
    version: 1,
    description: 'Types text into a field using a CSS selector, with options for human-like delays.',
    defaults: { name: 'Type Into' },
    inputs: [NodeConnectionType.Main],
    outputs: [NodeConnectionType.Main],
    properties: [
      {
        displayName: 'CSS Selector',
        name: 'manualSelector',
        type: 'string',
        default: '',
        displayOptions: {
          show: {
            selectorSource: ['manual']
          }
        }
      },
      {
        displayName: 'Text to Type',
        name: 'text',
        type: 'string',
        default: '',
        required: true
      },
      {
        displayName: 'Typing Speed (ms per char)',
        name: 'delay',
        type: 'number',
        default: 70,
        description: 'Delay between keystrokes (simulate human typing)'
      },
      {
        displayName: 'Clear Field First',
        name: 'clearBeforeTyping',
        type: 'boolean',
        default: true
      },
      {
        displayName: 'Focus Before Typing',
        name: 'focusFirst',
        type: 'boolean',
        default: true
      },
      {
        displayName: 'Wait For Selector Timeout (ms)',
        name: 'waitTimeout',
        type: 'number',
        default: 5000
      }
    ]
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const results: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      const session = items[i].json as unknown as SessionObject;
      const selectorSource = this.getNodeParameter('selectorSource', i) as string;
      const text = this.getNodeParameter('text', i) as string;
      const delay = this.getNodeParameter('delay', i, 70) as number;
      const clearBeforeTyping = this.getNodeParameter('clearBeforeTyping', i, true) as boolean;
      const focusFirst = this.getNodeParameter('focusFirst', i, true) as boolean;
      const waitTimeout = this.getNodeParameter('waitTimeout', i, 5000) as number;
      let selector = '';

			if (selectorSource === 'manual') {
        selector = this.getNodeParameter('manualSelector', i) as string;
      }
			// Future: add 'fromPreviousStep' option to get selector from previous node output

      if (!selector) {
        throw new Error('No selector found for element to type into.');
      }
      if (!session.cdpUrl) {
        throw new Error('Session object missing cdpUrl.');
      }

      // --- Playwright action block ---
      let browser: Browser | null = null;
      let typingResult: any = {};
      try {
        browser = await chromium.connectOverCDP(session.cdpUrl);
        const context = browser.contexts()[0];
        const page = context.pages()[0] || (await context.newPage());

        await page.waitForSelector(selector, { timeout: waitTimeout });

        const elHandle = await page.$(selector);
        if (!elHandle) {
          throw new Error(`Element with selector "${selector}" not found after waiting.`);
        }

        if (focusFirst) await elHandle.focus();
        if (clearBeforeTyping) await elHandle.fill('');

        // Optional: random delay for human-like behavior
        for (const char of text) {
          await elHandle.type(char, { delay: delay + Math.round(Math.random()*15) });
        }

        typingResult = {
          selector,
          textTyped: text,
          delay,
          clearBeforeTyping,
          focusFirst,
          result: "success"
        };

        await browser.close();
      } catch (e) {
        typingResult = {
          selector,
          error: (e as Error).message
        };
        if (browser) await browser.close().catch(() => {});
      }

      results.push({
        json: {
          ...session,
          typeAction: typingResult
        }
      });
    }

    return [results];
  }
}
