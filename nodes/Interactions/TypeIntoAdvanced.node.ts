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

export class TypeIntoAdvanced implements INodeType {
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
        displayName: 'CDP URL',
        name: 'cdpUrl',
        type: 'string',
        default: '',
        placeholder: 'E.g. ws://localhost:9222/devtools/browser/...',
        required: true,
      },
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
        description: 'Text content to type into the element (numbers will be converted to string)',
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
        displayName: 'Typing Strategy',
        name: 'typingStrategy',
        type: 'options',
        default: 'auto',
        options: [
          {
            name: 'Auto (Recommended)',
            value: 'auto',
            description: 'Automatically choose the best method based on element and content',
          },
          {
            name: 'Fill Method (Fast)',
            value: 'fill',
            description: 'Use Playwright fill() - faster but may not work with all validation',
          },
          {
            name: 'Keyboard Typing (Compatible)',
            value: 'keyboard',
            description: 'Simulate real keystrokes - slower but works with most validation',
          },
        ],
        description: 'Strategy for entering text into the element',
      },
      {
        displayName: 'Typing Delay (ms)',
        name: 'typingDelay',
        type: 'number',
        default: 0,
        description: 'Delay between keystrokes (only applies to keyboard typing)',
        displayOptions: {
          show: {
            typingStrategy: ['keyboard', 'auto'],
          },
        },
      },
      {
        displayName: 'Retry on Failure',
        name: 'retryOnFailure',
        type: 'boolean',
        default: true,
        description: 'If first typing method fails, try alternative method',
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
      },
      {
        displayName: 'Validate Text Input',
        name: 'validateInput',
        type: 'boolean',
        default: true,
        description: 'Validate that the text was successfully typed into the element',
      },
      {
        displayName: 'Validation Method',
        name: 'validationMethod',
        type: 'options',
        default: 'exact',
        displayOptions: {
          show: {
            validateInput: [true],
          },
        },
        options: [
          {
            name: 'Exact Match',
            value: 'exact',
            description: 'Element value must exactly match the typed text',
          },
          {
            name: 'Contains',
            value: 'contains',
            description: 'Element value must contain the typed text',
          },
          {
            name: 'Not Empty',
            value: 'notEmpty',
            description: 'Element value must not be empty after typing',
          },
        ],
        description: 'How to validate the typed text',
      },
      {
        displayName: 'Fail on Validation Error',
        name: 'failOnValidationError',
        type: 'boolean',
        default: true,
        displayOptions: {
          show: {
            validateInput: [true],
          },
        },
        description: 'Throw an error if validation fails (otherwise just mark as validation failed)',
      }
    ]
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const results: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      const session = items[i].json as unknown as SessionObject;
      const cdpUrl = this.getNodeParameter('cdpUrl', i) as string;
      const selector = this.getNodeParameter('selector', i) as string;
      const textParam = this.getNodeParameter('text', i);
      const text = String(textParam);
      const waitTimeout = this.getNodeParameter('waitTimeout', i, 5000) as number;
      const clearFirst = this.getNodeParameter('clearFirst', i, true) as boolean;
      const typingStrategy = this.getNodeParameter('typingStrategy', i, 'auto') as string;
      const retryOnFailure = this.getNodeParameter('retryOnFailure', i, true) as boolean;
      const typingDelay = this.getNodeParameter('typingDelay', i, 0) as number;
      const clickFirst = this.getNodeParameter('clickFirst', i, false) as boolean;
      const pressEnter = this.getNodeParameter('pressEnter', i, false) as boolean;
      const pressTab = this.getNodeParameter('pressTab', i, false) as boolean;
      const waitAfter = this.getNodeParameter('waitAfter', i, 0) as number;
      const validateInput = this.getNodeParameter('validateInput', i, true) as boolean;
      const validationMethod = this.getNodeParameter('validationMethod', i, 'exact') as string;
      const failOnValidationError = this.getNodeParameter('failOnValidationError', i, true) as boolean;

      let typingResult: any = {};
      let browser: any = null;
      let page: any = null;

      try {
        browser = await chromium.connectOverCDP(cdpUrl);
        const context = browser.contexts()[0];
        page = context.pages()[0] || (await context.newPage());

        await page.waitForLoadState('domcontentloaded', { timeout: 9000 });

        typingResult.currentUrl = await page.url();
        typingResult.selector = selector;

        await page.waitForSelector(selector, { timeout: waitTimeout });

        const el = await page.$(selector);
        if (!el) throw new Error('Selector not found after wait');

        typingResult.elementTag = await el.evaluate((el: any) => el.tagName);
        typingResult.valueBefore = await el.evaluate((el: any) => (el as any).value || el.textContent || '');

        if (clickFirst) {
          await el.click();
        }

        const safeClearElement = async (element: any) => {
          try {
            await element.focus();
            await page.keyboard.press('Control+a');
            await page.keyboard.press('Delete');
            return true;
          } catch (e1) {
            try {
              await element.fill('');
              return true;
            } catch (e2) {
              try {
                await element.evaluate((el: any) => {
                  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                    (el as HTMLInputElement).value = '';
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                  } else {
                    el.textContent = '';
                  }
                });
                return true;
              } catch (e3) {
                return false;
              }
            }
          }
        };

        const keyboardType = async (element: any, textToType: string) => {
          await element.focus();
          if (clearFirst) {
            await safeClearElement(element);
          }

          if (typingDelay > 0) {
            await page.keyboard.type(textToType, { delay: typingDelay });
          } else {
            await page.keyboard.type(textToType);
          }
        };

        const fillType = async (element: any, textToType: string) => {
          if (clearFirst) {
            await element.fill('');
          }
          await element.fill(textToType);
        };

        const getRecommendedStrategy = async (element: any, textToType: string) => {
          const elementInfo = await element.evaluate((el: any) => {
            const rect = el.getBoundingClientRect();
            return {
              type: el.getAttribute('type'),
              tagName: el.tagName.toLowerCase(),
              isVisible: rect.width > 0 && rect.height > 0,
              isContentEditable: el.contentEditable === 'true',
              hasAngularAttributes: Array.from(el.attributes).some((attr: any) =>
                attr.name.startsWith('ng-') || attr.name.startsWith('_ng')
              ),
              hasReactAttributes: Array.from(el.attributes).some((attr: any) =>
                attr.name.startsWith('data-react') || el.className.includes('react')
              ),
              hasValidationAttributes: el.hasAttribute('required') ||
                                       el.hasAttribute('pattern') ||
                                       el.hasAttribute('min') ||
                                       el.hasAttribute('max'),
              className: el.className,
              name: el.getAttribute('name') || '',
              id: el.getAttribute('id') || ''
            };
          });

          const preferKeyboard = (
            /^\d+(\.\d+)?$/.test(textToType) ||
            elementInfo.type === 'number' ||
            elementInfo.hasAngularAttributes ||
            elementInfo.hasReactAttributes ||
            elementInfo.hasValidationAttributes ||
            elementInfo.isContentEditable ||
            ['tel', 'email', 'url', 'search'].includes(elementInfo.type)
          );

          return preferKeyboard ? 'keyboard' : 'fill';
        };

        const performTyping = async (strategy: string) => {
          if (strategy === 'keyboard') {
            await keyboardType(el, text);
          } else {
            await fillType(el, text);
          }
        };

        let selectedStrategy = typingStrategy;
        let typingSuccess = false;
        let lastError = null;

        if (selectedStrategy === 'auto') {
          selectedStrategy = await getRecommendedStrategy(el, text);
        }

        try {
          await performTyping(selectedStrategy);
          typingSuccess = true;
          typingResult.typingMethod = selectedStrategy;
        } catch (e) {
          lastError = e;
          typingResult.firstAttemptError = (e as Error).message;
        }

        if (!typingSuccess && retryOnFailure && typingStrategy === 'auto') {
          const alternativeStrategy = selectedStrategy === 'keyboard' ? 'fill' : 'keyboard';
          try {
            await performTyping(alternativeStrategy);
            typingSuccess = true;
            typingResult.typingMethod = alternativeStrategy;
            typingResult.retriedWithMethod = alternativeStrategy;
          } catch (e2) {
            lastError = e2;
            typingResult.retryError = (e2 as Error).message;
          }
        }

        if (!typingSuccess && lastError) {
          throw lastError;
        }

        if (pressEnter) {
          await page.keyboard.press('Enter');
        }

        if (pressTab) {
          await page.keyboard.press('Tab');
        }

        if (waitAfter > 0) {
          await page.waitForTimeout(waitAfter);
        }

        typingResult.valueAfter = await el.evaluate((el: any) => (el as any).value || el.textContent || '');

        if (validateInput) {
          const actualValue = typingResult.valueAfter || '';
          let validationPassed = false;
          let validationMessage = '';

          switch (validationMethod) {
            case 'exact':
              validationPassed = actualValue === text;
              validationMessage = validationPassed
                ? 'Text matches exactly'
                : `Expected: "${text}", Actual: "${actualValue}"`;
              break;

            case 'contains':
              validationPassed = actualValue.includes(text);
              validationMessage = validationPassed
                ? 'Text contains expected value'
                : `Expected text "${text}" not found in actual value: "${actualValue}"`;
              break;

            case 'notEmpty':
              validationPassed = actualValue.trim().length > 0;
              validationMessage = validationPassed
                ? 'Element has non-empty value'
                : 'Element is empty after typing';
              break;
          }

          typingResult.validation = {
            enabled: true,
            method: validationMethod,
            passed: validationPassed,
            message: validationMessage,
            expectedText: text,
            actualValue: actualValue
          };

          if (!validationPassed) {
            if (failOnValidationError) {
              throw new Error(`Text validation failed: ${validationMessage}`);
            }
            typingResult.result = 'validation_failed';
          } else {
            typingResult.result = 'success';
          }
        } else {
          typingResult.validation = {
            enabled: false
          };
          typingResult.result = 'success';
        }

        typingResult.textTyped = text;

        await browser.close();

      } catch (e) {
        const errorMsg = (e as Error).message;

        typingResult.result = 'error';
        typingResult.error = errorMsg;
        typingResult.selector = selector;
        typingResult.textToType = text;

        if (browser) {
          await browser.close().catch(() => {});
        }
      }

      results.push({json: {...session, typeAction: typingResult}});
    }

    return [results];
  }
}
