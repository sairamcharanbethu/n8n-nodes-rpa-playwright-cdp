import {
  INodeType,
  INodeTypeDescription,
  IExecuteFunctions,
  INodeExecutionData,
  NodeConnectionType,
} from 'n8n-workflow';
import { chromium } from 'playwright';
import { SessionObject } from '../../utils/SessionObject';
import { executeWithRecording } from '../../utils/sessionManager';
import * as fs from 'fs';

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

export class TypeInto implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Type Into Element',
    name: 'typeInto',
    group: ['transform'],
    version: 1,
    description: 'Types provided text into an element found by a selector (CSS, XPath, Text, etc.).',
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
        displayName: 'Selector',
        name: 'selector',
        type: 'string',
        default: '',
        required: true,
        description: 'Selector (CSS, XPath, Text, etc.) to find the target element',
      },
      {
        displayName: 'Text to Type',
        name: 'text',
        type: 'string',
        default: '',
        required: true,
        description: 'Text content to type into the element',
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
        displayName: 'Typing Delay (ms)',
        name: 'typingDelay',
        type: 'number',
        default: 0,
        description: 'Delay between keystrokes (0 for instant)',
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
        displayName: 'Record Video',
        name: 'recordVideo',
        type: 'boolean',
        default: false,
        description: 'Whether to record a video of this specific action',
      },
      {
        displayName: 'Video Resolution',
        name: 'videoResolution',
        type: 'string',
        default: '1280,720',
        description: 'Resolution for the recorded video, e.g. 1280,720',
        displayOptions: {
          show: {
            recordVideo: [true],
          },
        },
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
      const text = this.getNodeParameter('text', i) as string;
      const waitTimeout = this.getNodeParameter('waitTimeout', i, 5000) as number;
      const clearFirst = this.getNodeParameter('clearFirst', i, true) as boolean;
      const typingDelay = this.getNodeParameter('typingDelay', i, 0) as number;
      const clickFirst = this.getNodeParameter('clickFirst', i, false) as boolean;
      const pressEnter = this.getNodeParameter('pressEnter', i, false) as boolean;
      const pressTab = this.getNodeParameter('pressTab', i, false) as boolean;
      const waitAfter = this.getNodeParameter('waitAfter', i, 0) as number;
      const recordVideo = this.getNodeParameter('recordVideo', i, false) as boolean;
      const videoResolution = this.getNodeParameter('videoResolution', i, '1280,720') as string;

      let typingResult: any = {};

      try {
        const { videoRecording } = await executeWithRecording(session, { recordVideo, videoResolution }, async (page) => {
          // Basic debug info
          typingResult.currentUrl = await page.url();
          typingResult.selector = selector;

          // Wait for element to be available
          await page.waitForSelector(selector, { timeout: waitTimeout });

          // Get the element
          const el = await page.$(selector);
          if (!el) throw new Error('Selector not found after wait');

          // Get element information for debugging
          typingResult.elementTag = await el.evaluate(el => el.tagName);
          typingResult.valueBefore = await el.evaluate(el => (el as any).value || el.textContent || '');

          // Click element first if requested (helps with focus)
          if (clickFirst) { await el.click(); }

          // Clear field if requested
          if (clearFirst) { await el.fill(''); }

          // Type the text with optional delay
          if (typingDelay > 0) {
            await el.focus();
            await page.keyboard.type(text, { delay: typingDelay });
          } else {
            await el.fill(text);
          }

          // Press Enter if requested
          if (pressEnter) { await page.keyboard.press('Enter'); }

          // Press Tab if requested
          if (pressTab) { await page.keyboard.press('Tab'); }

          // Wait after typing if requested
          if (waitAfter > 0) { await page.waitForTimeout(waitAfter); }

          // Get final value for verification
          typingResult.valueAfter = await el.evaluate(el => (el as any).value || el.textContent || '');

          // Success result
          typingResult.result = 'success';
          typingResult.textTyped = text;
        });

        const output: INodeExecutionData = { json: { ...session, typeAction: typingResult } };

        if (videoRecording && fs.existsSync(videoRecording)) {
          const videoBuffer = fs.readFileSync(videoRecording);
          output.binary = {
            video: {
              data: videoBuffer.toString('base64'),
              mimeType: 'video/webm',
              fileName: 'type_recording.webm',
            }
          };
          try { fs.unlinkSync(videoRecording); } catch (err) {}
        }
        results.push(output);

      } catch (e) {
        const errorMsg = (e as Error).message;
        typingResult.result = 'error';
        typingResult.error = errorMsg;
        typingResult.selector = selector;
        typingResult.textToType = text;
        results.push({ json: {...session, typeAction: typingResult} });
      }
    }

    return [results];
  }
}
