import {
  INodeType, INodeTypeDescription, IExecuteFunctions, INodeExecutionData, NodeConnectionType,
} from 'n8n-workflow';
import { chromium, Browser } from 'playwright';
import { SessionObject } from '../../utils/SessionObject';

export class GetText implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Get Text',
    name: 'getText',
    group: ['transform'],
    version: 1,
    description: 'Extracts (inner) text from the first element matching the CSS selector.',
    defaults: { name: 'Get Text' },
    inputs: [NodeConnectionType.Main],
    outputs: [NodeConnectionType.Main],
    properties: [
      {
        displayName: 'CSS Selector',
        name: 'selector',
        type: 'string',
        default: '',
        required: true,
        placeholder: 'e.g. .result-title, #main-text',
      },
      {
        displayName: 'Trim Whitespace',
        name: 'trimWhitespace',
        type: 'boolean',
        default: true,
      }
    ]
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const results: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      const session = items[i].json as unknown as SessionObject;
      const selector = this.getNodeParameter('selector', i) as string;
      const trimWhitespace = this.getNodeParameter('trimWhitespace', i, true) as boolean;

      let browser: Browser | null = null;
      let textContent = '';
      let getTextResult: any = {};
      try {
        browser = await chromium.connectOverCDP(session.cdpUrl);
        const page = browser.contexts()[0].pages()[0] || await browser.contexts()[0].newPage();

        await page.waitForSelector(selector, { timeout: 5000 });
        textContent = await page.$eval(selector, el => (el.textContent || ""));
        getTextResult = {
          selector,
          text: trimWhitespace ? textContent.trim() : textContent,
          result: 'success'
        };

        await browser.close();
      } catch (e) {
        getTextResult = {
          selector,
          error: (e as Error).message
        };
        if (browser) await browser.close().catch(() => {});
      }

      results.push({ json: { ...session, getText: getTextResult } });
    }
    return [results];
  }
}
