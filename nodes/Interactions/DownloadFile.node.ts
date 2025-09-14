import {
  INodeType,
  INodeTypeDescription,
  IExecuteFunctions,
  INodeExecutionData,
  NodeConnectionType,
  IDataObject,
} from 'n8n-workflow';
import { chromium, Browser } from 'playwright';
import { promises as fs } from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { SessionObject } from '../../utils/SessionObject';

export class DownloadFile implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Download File',
    name: 'downloadFile',
    group: ['utilities'],
    version: 1,
    description: 'Triggers a file download and stores the file as n8n binary with metadata.',
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
      },
      {
        displayName: 'Wait For Selector Timeout (ms)',
        name: 'waitTimeout',
        type: 'number',
        default: 5000,
      },
      {
        displayName: 'Download Timeout (ms)',
        name: 'downloadTimeout',
        type: 'number',
        default: 30000,
      },
      {
        displayName: 'Delete File After',
        name: 'deleteAfter',
        type: 'boolean',
        default: true,
        description: 'Remove file from /tmp after binary ingest?',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const results: INodeExecutionData[] = [];
    const downloadDir = '/tmp/n8n-downloads';
    await fs.mkdir(downloadDir, { recursive: true });

    for (let i = 0; i < items.length; i++) {
      const session = items[i].json as unknown as SessionObject;
      const selector = this.getNodeParameter('selector', i) as string;
      const waitTimeout = this.getNodeParameter('waitTimeout', i, 5000) as number;
      const downloadTimeout = this.getNodeParameter('downloadTimeout', i, 30000) as number;
      const deleteAfter = this.getNodeParameter('deleteAfter', i, true) as boolean;

      let downloadResult: IDataObject = {};
      let binaryData: Buffer | undefined;
      let binaryPropertyName = 'data';
      let browser: Browser | null = null;
      let filePath: string | undefined = '';
      try {
        browser = await chromium.connectOverCDP(session.cdpUrl);
        const context = browser.contexts()[0];
        const page = context.pages()[0] || await context.newPage();

        await page.waitForLoadState('domcontentloaded', { timeout: 9000 });
        await page.waitForSelector(selector, { timeout: waitTimeout });
        const el = await page.$(selector);
        if (!el) throw new Error(`Download trigger "${selector}" not found`);

        // Prepare a unique file name
        const uuid = uuidv4();
        let filename = 'downloaded_file_' + uuid;
        let fileExtension = '';
        let suggestedFilename = '';
        let mimeType = '';
        let downloadUrl = '';

        // Listen for download and set path
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: downloadTimeout }),
          el.click()
        ]);

        suggestedFilename = download.suggestedFilename() || filename;
        fileExtension = (suggestedFilename.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
        filename = suggestedFilename || filename;
        downloadUrl = download.url();
        // Minimal mimeType guess
        const extMimeMap: { [ext: string]: string } = {
          pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          xls: 'application/vnd.ms-excel', csv: 'text/csv', txt: 'text/plain', zip: 'application/zip',
          png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', doc: 'application/msword',
          docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        };
        mimeType = extMimeMap[fileExtension] || 'application/octet-stream';

        filePath = path.join(downloadDir, `${uuid}-${filename}`);
        await download.saveAs(filePath);

        // Read as buffer and add to binary property
        binaryData = await fs.readFile(filePath);

        downloadResult = {
          selector,
          filePath: String(filePath),
          suggestedFilename: String(suggestedFilename),
          fileExtension: String(fileExtension),
          mimeType: String(mimeType),
          downloadUrl: String(downloadUrl),
          size: binaryData.length.toString(),
          result: 'success',
        };

        if (deleteAfter) {
          await fs.unlink(filePath);
          downloadResult.fileRemoved = 'true';
        }

        await browser.close();
      } catch (e) {
        downloadResult = {
          selector,
          error: (e as Error).message,
          result: 'error',
        };
        if (browser) await browser.close().catch(() => {});
      }

      const out: INodeExecutionData = {
        json: { ...session, downloadAction: downloadResult },
      };
      // assign n8n binary property for use in later file/email/cloud nodes
      if (binaryData && downloadResult.mimeType && downloadResult.suggestedFilename) {
        out.binary = {
          [binaryPropertyName]: {
            data: binaryData.toString('base64'),
            mimeType: downloadResult.mimeType as string,
            fileName: downloadResult.suggestedFilename as string,
            fileExtension: downloadResult.fileExtension as string,
          }
        };
      }
      results.push(out);
    }
    return [results];
  }
}
