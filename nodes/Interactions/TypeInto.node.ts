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
        placeholder: 'e.g. input[name="email"], #search, .username-field',
      },
      {
        displayName: 'Text to Type',
        name: 'text',
        type: 'string',
        default: '',
        required: true,
      },
      {
        displayName: 'Typing Speed (ms per character) [0 for instant]',
        name: 'delay',
        type: 'number',
        default: 0,
        description: 'Delay between keystrokes. Use 0 for instant fill.'
      },
      {
        displayName: 'Clear Field First',
        name: 'clearBeforeTyping',
        type: 'boolean',
        default: true,
        description: 'Clear input element before typing'
      },
      {
        displayName: 'Focus Before Typing',
        name: 'focusFirst',
        type: 'boolean',
        default: true,
        description: 'Focus element before typing'
      },
      {
        displayName: 'Wait For Selector Timeout (ms)',
        name: 'waitTimeout',
        type: 'number',
        default: 5000,
        description: 'How long to wait for the selector'
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
      const delay = this.getNodeParameter('delay', i, 0) as number;
      const clearBeforeTyping = this.getNodeParameter('clearBeforeTyping', i, true) as boolean;
      const focusFirst = this.getNodeParameter('focusFirst', i, true) as boolean;
      const waitTimeout = this.getNodeParameter('waitTimeout', i, 5000) as number;

      let typingResult: any = {};
      let browser: Browser | null = null;
      try {
        browser = await chromium.connectOverCDP(session.cdpUrl);
        const context = browser.contexts()[0];
        const page = context.pages()[0] || await context.newPage();

        await page.waitForSelector(selector, { timeout: waitTimeout });
        const elHandle = await page.$(selector);

        if (!elHandle) {
          throw new Error(`Element with selector "${selector}" not found after waiting.`);
        }

        if (focusFirst) await elHandle.focus();

        if (clearBeforeTyping) {
          await elHandle.fill('');
        }

        if (delay && delay > 0) {
          // Human-like typing
          for (const char of text) {
            await elHandle.type(char, { delay });
          }
        } else {
          // Fast, safest fill for input/textarea
          await elHandle.fill(text);
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
