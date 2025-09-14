import {
  INodeType, INodeTypeDescription, IExecuteFunctions, INodeExecutionData, NodeConnectionType,
} from 'n8n-workflow';
import { chromium, Browser } from 'playwright';
import { SessionObject } from '../../utils/SessionObject';

// Type declarations for DOM elements
declare global {
  interface Element {
    querySelectorAll(selectors: string): NodeListOf<Element>;
    textContent: string | null;
  }
  interface NodeListOf<T> extends ArrayLike<T> {
    [index: number]: T;
  }
}

export class GetTable implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Get Table',
    name: 'getTable',
    group: ['data'],
    version: 1,
    description: 'Extracts HTML table as structured (array-of-object) JSON.',
    defaults: { name: 'Get Table' },
    inputs: [NodeConnectionType.Main],
    outputs: [NodeConnectionType.Main],
    properties: [
      {
        displayName: 'Table Selector',
        name: 'selector',
        type: 'string',
        default: '',
        required: true,
        placeholder: 'e.g. table.data-table, #price-table',
        description: 'CSS selector to find the table element',
      },
      {
        displayName: 'Has Header Row?',
        name: 'hasHeader',
        type: 'boolean',
        default: true,
        description: 'Whether the table has a header row to use as column names',
      },
      {
        displayName: 'Wait For Table Timeout (ms)',
        name: 'waitTimeout',
        type: 'number',
        default: 5000,
        description: 'Maximum time to wait for table to appear',
      }
    ]
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const results: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      const session = items[i].json as unknown as SessionObject;
      const selector = this.getNodeParameter('selector', i) as string;
      const hasHeader = this.getNodeParameter('hasHeader', i, true) as boolean;
      const waitTimeout = this.getNodeParameter('waitTimeout', i, 5000) as number;

      let browser: Browser | null = null;
      let tableResult: any = {};

      try {
        // Connect to browser via CDP
        browser = await chromium.connectOverCDP(session.cdpUrl);
        const context = browser.contexts()[0];
        const page = context.pages()[0] || await context.newPage();

        // Wait for page to be ready
        await page.waitForLoadState('domcontentloaded', { timeout: 9000 });

        // Basic debug info
        tableResult.currentUrl = await page.url();
        tableResult.selector = selector;

        // Wait for table to be available
        await page.waitForSelector(selector, { timeout: waitTimeout });

        // Extract table data - pass hasHeader as serializable parameter
        const tableRows = await page.$eval(selector, (table: Element, hasHeaderParam: boolean) => {
          const rows = Array.from(table.querySelectorAll('tr'));
          let headers: string[] = [];

          // Handle header row if specified
          if (hasHeaderParam) {
            const headerRow = rows.shift();
            if (headerRow) {
              const headerCells = Array.from(headerRow.querySelectorAll('th,td'));
              headers = headerCells.map(cell => cell.textContent?.trim() || `Column_${headers.length + 1}`);
            }
          }

          // Process data rows
          return rows.map((row, rowIndex) => {
            const cells = Array.from(row.querySelectorAll('td,th'));
            const values = cells.map(cell => cell.textContent?.trim() || '');

            if (hasHeaderParam && headers.length > 0) {
              // Return as object with header keys
              const obj: {[k: string]: string} = {};
              headers.forEach((header, idx) => {
                obj[header || `Column_${idx + 1}`] = values[idx] || '';
              });
              return obj;
            } else {
              // Return as array
              return values;
            }
          });
        }, hasHeader); // Pass hasHeader as serializable parameter

        // Get additional table info
        tableResult.rowCount = tableRows.length;
        tableResult.hasHeader = hasHeader;

        // Success result
        tableResult.result = 'success';
        tableResult.rows = tableRows;

        await browser.close();

      } catch (e) {
        const errorMsg = (e as Error).message;

        // Error result with context
        tableResult.result = 'error';
        tableResult.error = errorMsg;
        tableResult.selector = selector;
        tableResult.hasHeader = hasHeader;
        tableResult.rows = [];

        if (browser) {
          await browser.close().catch(() => {});
        }
      }

      // Push result WITH session data to maintain browser connection for RPA workflows
      results.push({
        json: {
          ...session,
          getTableAction: tableResult
        }
      });
    }

    return [results];
  }
}
