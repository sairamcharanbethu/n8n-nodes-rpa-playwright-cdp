import {
  INodeType,
  INodeTypeDescription,
  IExecuteFunctions,
  INodeExecutionData,
  NodeConnectionType,
  IDataObject,
} from 'n8n-workflow';
import { chromium, Browser } from 'playwright';
import { SessionObject } from '../../utils/SessionObject';

export class DownloadFile implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Download File',
    name: 'downloadFile',
    group: ['utilities'],
    version: 1,
    description: 'Clicks an element (link/button) to trigger a file download and returns the file buffer and metadata.',
    defaults: { name: 'Download File' },
    inputs: [NodeConnectionType.Main],
    outputs: [NodeConnectionType.Main],
    properties: [
      {
        displayName: 'Trigger Selector',
        name: 'selector',
        type: 'string',
        required: true,
        default: '',
        placeholder: 'e.g. a.download-link, button.export',
        description: 'CSS selector for the element that triggers the download',
      },
      {
        displayName: 'Wait For Selector Timeout (ms)',
        name: 'waitTimeout',
        type: 'number',
        default: 5000,
        description: 'Maximum time to wait for selector to appear',
      },
      {
        displayName: 'Download Timeout (ms)',
        name: 'downloadTimeout',
        type: 'number',
        default: 30000,
        description: 'Maximum time to wait for download to start',
      },
      {
        displayName: 'Return File as',
        name: 'outputType',
        type: 'options',
        options: [
          { name: 'Buffer (recommended)', value: 'buffer' },
          { name: 'Base64 String', value: 'base64' },
        ],
        default: 'buffer',
        description: 'Format to return the downloaded file',
      },
      {
        displayName: 'Scroll Into View',
        name: 'scrollIntoView',
        type: 'boolean',
        default: true,
        description: 'Scroll element into view before clicking',
      }
    ]
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const results: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      const session = items[i].json as unknown as SessionObject;
      const selector = this.getNodeParameter('selector', i) as string;
      const waitTimeout = this.getNodeParameter('waitTimeout', i, 5000) as number;
      const downloadTimeout = this.getNodeParameter('downloadTimeout', i, 30000) as number;
      const outputType = this.getNodeParameter('outputType', i, 'buffer') as string;
      const scrollIntoView = this.getNodeParameter('scrollIntoView', i, true) as boolean;

      let downloadResult: IDataObject = {};
      let browser: Browser | null = null;

      try {
        // Connect to browser via CDP
        browser = await chromium.connectOverCDP(session.cdpUrl);
        const context = browser.contexts()[0];
        const page = context.pages()[0] || await context.newPage();

        // Wait for page to be ready
        await page.waitForLoadState('domcontentloaded', { timeout: 9000 });

        // Basic debug info
        const currentUrl = await page.url();
        downloadResult.currentUrl = currentUrl;
        downloadResult.selector = selector;

        // Wait for element and prepare for download
        await page.waitForSelector(selector, { timeout: waitTimeout });
        const el = await page.$(selector);
        if (!el) throw new Error(`Download trigger element "${selector}" not found`);

        // Get element info for debugging
        downloadResult.elementTag = await el.evaluate(el => el.tagName);
        downloadResult.elementText = await el.evaluate(el => el.textContent?.trim() || '');

        // Scroll into view if requested
        if (scrollIntoView) {
          await el.scrollIntoViewIfNeeded();
        }

        // Listen for download event BEFORE clicking
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: downloadTimeout }),
          el.click()
        ]);

        // Get download metadata
        const suggestedFilename = download.suggestedFilename();
        const downloadUrl = download.url();

        // Get file buffer using createReadStream
        const stream = await download.createReadStream();
        if (!stream) throw new Error('Failed to create download stream');

        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          chunks.push(chunk);
        }
        const fileBuffer = Buffer.concat(chunks);

        // Get file size for debugging
        const fileSize = fileBuffer.length;

        // Convert to base64 if requested
        let base64: string | undefined;
        if (outputType === 'base64') {
          base64 = fileBuffer.toString('base64');
        }

        // Determine MIME type from filename or URL
        const getFileExtension = (filename: string) => {
          const match = filename.match(/\.([^.]+)$/);
          return match ? match[1].toLowerCase() : 'unknown';
        };

        const fileExtension = getFileExtension(suggestedFilename || downloadUrl);
        const mimeTypeMap: { [key: string]: string } = {
          'pdf': 'application/pdf',
          'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'xls': 'application/vnd.ms-excel',
          'csv': 'text/csv',
          'txt': 'text/plain',
          'zip': 'application/zip',
          'png': 'image/png',
          'jpg': 'image/jpeg',
          'jpeg': 'image/jpeg',
        };

        const mimeType = mimeTypeMap[fileExtension] || 'application/octet-stream';

        downloadResult = {
          selector,
          suggestedFilename: suggestedFilename || 'download',
          fileExtension,
          mimeType,
          fileSize,
          downloadUrl,
          fileBuffer: outputType === 'buffer' ? fileBuffer : undefined,
          base64: outputType === 'base64' ? base64 : undefined,
          result: 'success',
          currentUrl,
        };

        await browser.close();

      } catch (e) {
        const errorMsg = (e as Error).message;

        // Error result with context
        downloadResult = {
          selector,
          error: errorMsg,
          result: 'error',
          currentUrl: downloadResult.currentUrl || 'unknown',
        };

        if (browser) {
          await browser.close().catch(() => {});
        }
      }

      // Push result WITH session data to maintain browser connection for RPA workflows
      results.push({
        json: {
          ...session,
          downloadAction: downloadResult,
        }
      });
    }

    return [results];
  }
}
