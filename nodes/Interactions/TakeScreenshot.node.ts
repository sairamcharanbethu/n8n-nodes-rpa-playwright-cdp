import {
  INodeType, INodeTypeDescription, IExecuteFunctions, INodeExecutionData, NodeConnectionType,
} from 'n8n-workflow';
import { chromium, Browser } from 'playwright';
import { SessionObject } from '../../utils/SessionObject';

export class TakeScreenshot implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Screenshot',
    name: 'screenshot',
    group: ['utilities'],
    version: 1,
    description: 'Takes a screenshot of the full page or a specific element.',
    defaults: { name: 'Screenshot' },
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
        required: false,
        placeholder: 'e.g. #main, text=Section 1, xpath=//div[@id="content"]',
        description: 'Selector (CSS, XPath, Text, etc.) to screenshot. Leave blank for full page.',
      },
      {
        displayName: 'Image Format',
        name: 'format',
        type: 'options',
        options: [
          { name: 'PNG', value: 'png' },
          { name: 'JPEG', value: 'jpeg' },
        ],
        default: 'png',
      },
      {
        displayName: 'Quality (only for JPEG, 0-100)',
        name: 'quality',
        type: 'number',
        default: 80,
        required: false,
      },
      {
        displayName: 'Base64 Output',
        name: 'base64',
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
			const cdpUrl = this.getNodeParameter('cdpUrl', i) as string;
      const selector = this.getNodeParameter('selector', i) as string;
      const format = this.getNodeParameter('format', i, 'png') as 'png'|'jpeg';
      const base64 = this.getNodeParameter('base64', i, true) as boolean;
      const quality = this.getNodeParameter('quality', i, 80) as number;
      let buffer: Buffer | undefined;
      let browser: Browser | null = null, screenshotResult: any = {};
      try {
        browser = await chromium.connectOverCDP(cdpUrl);
        const page = browser.contexts()[0].pages()[0] || await browser.contexts()[0].newPage();
        if (selector) {
          const el = await page.$(selector);
          if (!el) throw new Error(`Element "${selector}" not found`);
          buffer = await el.screenshot({ type: format, quality: format === 'jpeg' ? quality : undefined });
        } else {
          buffer = await page.screenshot({ fullPage: true, type: format, quality: format === 'jpeg' ? quality : undefined });
        }
        screenshotResult = {
          selector, format, base64,
          data: base64 && buffer ? buffer.toString('base64') : undefined,
          result: 'success'
        };
        await browser.close();
      } catch (e) {
        screenshotResult = { selector, error: (e as Error).message };
        if (browser) await browser.close().catch(() => {});
      }
      results.push({
        json: {
          ...session,
          screenshot: screenshotResult
        }
      });
    }
    return [results];
  }
}
