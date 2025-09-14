import {
  INodeType, INodeTypeDescription, IExecuteFunctions, INodeExecutionData, NodeConnectionType,
} from 'n8n-workflow';
import { chromium, Browser } from 'playwright';
import { SessionObject } from '../../utils/SessionObject';

export class PageLoaded implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Page Loaded',
    name: 'pageLoaded',
    group: ['validation'],
    version: 1,
    description: 'Waits for the page to reach the specified ready state.',
    defaults: { name: 'Page Loaded' },
    inputs: [NodeConnectionType.Main],
    outputs: [NodeConnectionType.Main],
    properties: [
      {
        displayName: 'Wait Strategy',
        name: 'waitUntil',
        type: 'options',
        options: [
          { name: 'Load', value: 'load' },
          { name: 'DOMContentLoaded', value: 'domcontentloaded' },
          { name: 'Network Idle', value: 'networkidle' },
        ],
        default: 'load',
      },
      {
        displayName: 'Timeout (ms)',
        name: 'timeout',
        type: 'number',
        default: 10000,
        description: 'Max time to wait'
      }
    ]
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const results: INodeExecutionData[] = [];
    for (let i = 0; i < items.length; i++) {
      const session = items[i].json as unknown as SessionObject;
      const waitUntil = this.getNodeParameter('waitUntil', i, 'load') as 'load'|'domcontentloaded'|'networkidle';
      const timeout = this.getNodeParameter('timeout', i, 10000) as number;

      let browser: Browser | null = null, loaded = false, errorMsg = '';
      try {
        browser = await chromium.connectOverCDP(session.cdpUrl);
        const page = browser.contexts()[0].pages()[0] || await browser.contexts()[0].newPage();
        await page.waitForLoadState(waitUntil, { timeout });
        loaded = true;
        await browser.close();
      } catch (e) {
        errorMsg = (e as Error).message;
        if (browser) await browser.close().catch(() => {});
      }
      results.push({
        json: {
          ...session,
          pageLoaded: { loaded, waitUntil, error: errorMsg }
        }
      });
    }
    return [results];
  }
}
