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
    description: 'Clicks an element specified by CSS selector using Playwright.',
    defaults: { name: 'Click Element' },
    inputs: [NodeConnectionType.Main],
    outputs: [NodeConnectionType.Main],
    properties: [
      {
        displayName: 'CSS Selector',
        name: 'selector',
        type: 'string',
        default: '',
        required: true,
        placeholder: 'E.g. #submit, .my-btn, input[name="user"]',
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
      },
      {
        displayName: 'Wait For Selector Timeout (ms)',
        name: 'waitTimeout',
        type: 'number',
        default: 5000,
      },
      {
        displayName: 'Scroll Into View First',
        name: 'scrollIntoView',
        type: 'boolean',
        default: true,
      },
      {
        displayName: 'Force Click (ignore blocking elements)',
        name: 'forceClick',
        type: 'boolean',
        default: false,
      }
    ]
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const results: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      const session = items[i].json as unknown as SessionObject;
      const selector = this.getNodeParameter('selector', i) as string;
      const clickType = this.getNodeParameter('clickType', i, 'single') as string;
      const waitTimeout = this.getNodeParameter('waitTimeout', i, 5000) as number;
      const scrollIntoView = this.getNodeParameter('scrollIntoView', i, true) as boolean;
      const forceClick = this.getNodeParameter('forceClick', i, false) as boolean;

      let clickResult: any = {};
      let browser: Browser | null = null;
      try {
        browser = await chromium.connectOverCDP(session.cdpUrl);
        const context = browser.contexts()[0];
        const page = context.pages()[0] || await context.newPage();

        await page.waitForSelector(selector, { timeout: waitTimeout });
        const elHandle = await page.$(selector);
        if (!elHandle) throw new Error(`Element with selector "${selector}" not found`);

        if (scrollIntoView) await elHandle.scrollIntoViewIfNeeded();

        if (clickType === 'double')
          await elHandle.dblclick({ force: forceClick });
        else if (clickType === 'right')
          await elHandle.click({ button: 'right', force: forceClick });
        else
          await elHandle.click({ force: forceClick });

        clickResult = {
          selector,
          clickType,
          scrollIntoView,
          forceClick,
          result: 'clicked',
        };

        await browser.close();
      } catch (e) {
        clickResult = {
          selector,
          clickType,
          error: (e as Error).message,
        };
        if (browser) await browser.close().catch(() => { });
      }

      results.push({
        json: {
          ...session,
          clickAction: clickResult,
        }
      });
    }

    return [results];
  }
}
