import {
  INodeType, INodeTypeDescription, IExecuteFunctions, INodeExecutionData, NodeConnectionType,
} from 'n8n-workflow';
import { chromium, Browser } from 'playwright';
import { SessionObject } from '../../utils/SessionObject';

export class ElementExists implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Element Exists',
    name: 'elementExists',
    group: ['validation'],
    version: 1,
    description: 'Checks if at least one element exists for a selector (CSS, XPath, Text, etc.).',
    defaults: { name: 'Element Exists' },
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
        displayName: 'Timeout (ms)',
        name: 'waitTimeout',
        type: 'number',
        default: 1000,
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
      const waitTimeout = this.getNodeParameter('waitTimeout', i, 1000) as number;

      let exists = false;
      let browser: Browser | null = null, errorMsg = '';
      try {
        browser = await chromium.connectOverCDP(cdpUrl);
        const page = browser.contexts()[0].pages()[0] || await browser.contexts()[0].newPage();
        exists = !!(await page.$(selector));
        if (!exists) {
          try { // Try waiting for it (short)
            await page.waitForSelector(selector, { timeout: waitTimeout });
            exists = true;
          } catch { exists = false; }
        }
        await browser.close();
      } catch (e) {
        errorMsg = (e as Error).message;
        if (browser) await browser.close().catch(() => {});
      }
      results.push({
        json: {
          ...session,
          elementExists: { selector, exists, error: errorMsg }
        }
      });
    }
    return [results];
  }
}
