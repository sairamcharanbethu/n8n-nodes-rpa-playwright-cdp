import {
  INodeType,
  INodeTypeDescription,
  IExecuteFunctions,
  INodeExecutionData,
  NodeConnectionType,
} from 'n8n-workflow';
import { chromium, Browser, Page } from 'playwright';
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
        description: 'CSS selector to identify the element to type into',
      },
      {
        displayName: 'Text to Type',
        name: 'text',
        type: 'string',
        default: '',
        required: true,
        description: 'The text content to type into the element',
      },
      {
        displayName: 'Typing Speed (ms per character)',
        name: 'delay',
        type: 'number',
        default: 0,
        description: 'Delay between keystrokes in milliseconds (0 for instant typing)',
      },
      {
        displayName: 'Clear Field First',
        name: 'clearBeforeTyping',
        type: 'boolean',
        default: true,
        description: 'Whether to clear the input field before typing new text',
      },
      {
        displayName: 'Focus Before Typing',
        name: 'focusFirst',
        type: 'boolean',
        default: true,
        description: 'Whether to focus the element before typing',
      },
      {
        displayName: 'Wait For Selector Timeout (ms)',
        name: 'waitTimeout',
        type: 'number',
        default: 5000,
        description: 'Maximum time to wait for the selector to appear (in milliseconds)',
      },
      {
        displayName: 'Wait for Element State',
        name: 'waitState',
        type: 'options',
        default: 'visible',
        options: [
          { name: 'Attached', value: 'attached' },
          { name: 'Detached', value: 'detached' },
          { name: 'Visible', value: 'visible' },
          { name: 'Hidden', value: 'hidden' },
        ],
        description: 'State to wait for before interacting with the element',
      },
      {
        displayName: 'Press Enter After Typing',
        name: 'pressEnter',
        type: 'boolean',
        default: false,
        description: 'Whether to press Enter key after typing the text',
      },
    ],
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
      const waitState = this.getNodeParameter('waitState', i, 'visible') as 'attached' | 'detached' | 'visible' | 'hidden';
      const pressEnter = this.getNodeParameter('pressEnter', i, false) as boolean;

      let typingResult: any = {};
      let browser: Browser | null = null;
      let page: Page | null = null;

      try {
        // Validate session object
        if (!session || !session.cdpUrl) {
          throw new Error('Invalid session object or missing CDP URL');
        }

        // Connect to browser
        browser = await chromium.connectOverCDP(session.cdpUrl);
        const context = browser.contexts()[0];

        if (!context) {
          throw new Error('No browser context available');
        }

        // Get or create page
        page = context.pages()[0];
        if (!page) {
          page = await context.newPage();
        }

        // Validate selector
        if (!selector || selector.trim() === '') {
          throw new Error('CSS selector cannot be empty');
        }

        // Wait for element with specified state
        await page.waitForSelector(selector, {
          timeout: waitTimeout,
          state: waitState
        });

        // Get element handle
        const elHandle = await page.$(selector);
        if (!elHandle) {
          throw new Error(`Element with selector "${selector}" not found after waiting`);
        }

        // Check if element is actually interactable
        const isVisible = await elHandle.isVisible();
        const isEnabled = await elHandle.isEnabled();

        if (!isVisible) {
          throw new Error(`Element with selector "${selector}" is not visible`);
        }

        if (!isEnabled) {
          throw new Error(`Element with selector "${selector}" is not enabled/interactable`);
        }

        // Focus element if requested
        if (focusFirst) {
          await elHandle.focus();
          // Small delay to ensure focus is properly set
          await page.waitForTimeout(100);
        }

        // Clear field if requested
        if (clearBeforeTyping) {
          await elHandle.fill('');
        }

        // Type text with specified delay
        if (delay > 0) {
          await elHandle.type(text, { delay });
        } else {
          await elHandle.fill(text);
        }

        // Press Enter if requested
        if (pressEnter) {
          await elHandle.press('Enter');
        }

        // Get the final value from the element
        const finalValue = await page.$eval(selector, (el: any) => {
          if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
            return el.value || '';
          } else {
            return el.textContent || el.innerText || '';
          }
        }).catch(() => {
          // Fallback if $eval fails
          return 'Could not retrieve element value';
        });

        // Get element info for debugging
        const elementInfo = await page.$eval(selector, (el: any) => {
          return {
            tagName: el.tagName,
            type: el.type || null,
            id: el.id || null,
            className: el.className || null,
          };
        }).catch(() => null);

        typingResult = {
          selector,
          textTyped: text,
          delay,
          clearBeforeTyping,
          focusFirst,
          pressEnter,
          waitState,
          result: 'success',
          elementValue: finalValue,
          elementInfo,
          timestamp: new Date().toISOString(),
        };

        // Dispose of element handle
        await elHandle.dispose();

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        typingResult = {
          selector,
          textTyped: text,
          delay,
          clearBeforeTyping,
          focusFirst,
          pressEnter,
          waitState,
          result: 'failed',
          error: errorMessage,
          timestamp: new Date().toISOString(),
        };

        // Log error for debugging (if n8n logging is available)
        console.error('TypeInto node error:', errorMessage);
      } finally {
        // Clean up browser connection
        if (browser) {
          try {
            await browser.close();
          } catch (closeError) {
            console.warn('Failed to close browser connection:', closeError);
          }
        }
      }

      // Add result to output
      results.push({
        json: {
          ...session,
          typeAction: typingResult,
        },
      });
    }

    return [results];
  }
}
