import {
  INodeType,
  INodeTypeDescription,
  IExecuteFunctions,
  INodeExecutionData,
  NodeConnectionType,
} from 'n8n-workflow';
import { chromium, Browser, Page } from 'playwright';
import { SessionObject } from '../../utils/SessionObject';

const CREDENTIAL_MAP: Record<string, string> = {
  openai: 'openAiApi',
  openrouter: 'openrouterApi',
  gemini: 'googleGeminiApi',
};

export class FindElementByDescription implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Find Element By Description (AI)',
    name: 'findElementByDescription',
    group: ['transform'],
    version: 1,
    description: 'Uses an LLM to find a reliable Playwright selector for a described element.',
    defaults: { name: 'Find Element' },
    inputs: [NodeConnectionType.Main],
    outputs: [NodeConnectionType.Main],
    credentials: [
      { name: 'openAiApi', required: false },
      { name: 'openrouterApi', required: false },
      { name: 'googleGeminiApi', required: false },
    ],
    properties: [
      {
        displayName: 'Element Description',
        name: 'description',
        type: 'string',
        default: '',
        placeholder: 'E.g. "blue submit button in signup form"',
        required: true,
      },
      {
        displayName: 'AI Provider',
        name: 'aiProvider',
        type: 'options',
        options: [
          { name: 'OpenAI', value: 'openai' },
          { name: 'OpenRouter', value: 'openrouter' },
          { name: 'Gemini', value: 'gemini' },
        ],
        default: 'openai',
        required: true,
      },
      {
        displayName: 'Model Name',
        name: 'model',
        type: 'string',
        default: 'gpt-4o',
        placeholder: 'e.g. gpt-4o, mistralai/mistral-7b-instruct, gemini-1.5-pro',
        required: true,
      },
      {
        displayName: 'Max Attempts per HTML Chunk',
        name: 'maxAttempts',
        type: 'number',
        default: 3,
        description: 'Number of AI retries per chunk before moving to next chunk',
      },
      {
        displayName: 'Wait for Network Calls (ms)',
        name: 'networkWait',
        type: 'number',
        default: 2000,
        description: 'Wait time after page load before validation, in milliseconds',
      },
    ],
  };


  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const results: INodeExecutionData[] = [];

		// Helper to parse AI JSON responses robustly
		function parseAiJson(text: string) {
    const cleaned = text.replace(/```(json)?\n?/g, '').replace(/```$/, '').trim();
    return JSON.parse(cleaned);
  }
  function getRelevantHTML(html: string, maxLength = 35000): string {
    if (html.length <= maxLength) return html;
    const mid = Math.floor(html.length / 2);
    const start = Math.max(0, mid - maxLength / 2);
    return html.slice(start, start + maxLength);
  }
    for (let i = 0; i < items.length; i++) {
      const session = items[i].json as unknown as SessionObject;
      const description = this.getNodeParameter('description', i) as string;
      const aiProvider = this.getNodeParameter('aiProvider', i) as string;
      const model = this.getNodeParameter('model', i) as string;
      const maxAttempts = this.getNodeParameter('maxAttempts', i, 3) as number;
      const networkWait = this.getNodeParameter('networkWait', i, 2000) as number;

      const credentialType = CREDENTIAL_MAP[aiProvider];
      if (!this.getCredentials(credentialType)) {
        throw new Error(`No credential found! Attach a ${aiProvider} credential.`);
      }
      if (!session.cdpUrl) throw new Error('Session object missing cdpUrl.');

      // -----------------------------
      // Connect to Playwright via CDP
      // -----------------------------
      let browser: Browser | null = null;
      let page: Page | null = null;
      let pageHTML = '';
      try {
        browser = await chromium.connectOverCDP(session.cdpUrl);
        const context = browser.contexts()[0];
        page = context.pages().find(p => p.url() !== 'about:blank') || (await context.newPage());
        await page.waitForLoadState('domcontentloaded', { timeout: 9000 });
        await page.waitForTimeout(networkWait); // optional networkidle wait
        const rawHTML = await page.content();

        // Preprocess HTML
        const cleanedHTML = rawHTML
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
          .replace(/<!--[\s\S]*?-->/g, '');
        const bodyHTML = cleanedHTML.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] || cleanedHTML;
        pageHTML = bodyHTML;
      } catch (e) {
        if (browser) await browser.close().catch(() => {});
        throw new Error('Could not connect to browser/obtain HTML: ' + (e as Error).message);
      }

      // -----------------------------
      // Chunk HTML for AI retries
      // -----------------------------
      const htmlChunks: string[] = [];
      const chunkSize = 35000;
      for (let start = 0; start < pageHTML.length; start += chunkSize) {
        htmlChunks.push(pageHTML.slice(start, start + chunkSize));
      }

      let selector = '';
      let confidence = 0;
      let reasoning = '';
      let alternatives: string[] = [];
      let validated = false;

      for (const chunk of htmlChunks) {
        let attempts = 0;
        while (attempts < maxAttempts && !validated) {
          attempts++;
          const prompt = `
You are an RPA agent. Given this HTML snippet, find the best Playwright-compatible CSS selector for the element described as: "${description}".

Requirements:
- Prefer ID selectors first, then unique attributes, then hierarchy.
- Ensure the selector works with Playwright's page.$() or page.locator().
- Provide multiple alternatives in case the first one does not work.

HTML snippet:
${getRelevantHTML(chunk, 35000)}

Respond strictly in JSON:
{
  "selector": "<playwright_selector>",
  "confidence": 0.0 to 1.0,
  "reasoning": "<Why this selector>",
  "alternatives": ["<other selectors>"]
}
`.trim();

          let parsed: any = {};
          try {
            const aiResponse = await this.helpers.httpRequestWithAuthentication.call(
              this,
              credentialType,
              {
                method: 'POST',
                url:
                  credentialType === 'openAiApi'
                    ? 'https://api.openai.com/v1/chat/completions'
                    : credentialType === 'openrouterApi'
                    ? 'https://openrouter.ai/api/v1/chat/completions'
                    : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
                body:
                  credentialType === 'googleGeminiApi'
                    ? { contents: [{ parts: [{ text: prompt }] }] }
                    : { model, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 400 },
                json: true,
              }
            );

            let content: string;
            if (credentialType === 'googleGeminiApi') {
              content = aiResponse?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
            } else {
              content = aiResponse.choices?.[0]?.message?.content ?? aiResponse;
            }
            parsed = typeof content === 'string' ? parseAiJson(content) : content;
          } catch (err) {
            reasoning = 'AI did not return valid JSON: ' + String(err);
            continue;
          }

          // -----------------------------
          // Validate selector using same browser
          // -----------------------------
          const allSelectors = [parsed.selector, ...(parsed.alternatives || [])];
          for (const sel of allSelectors) {
            try {
              await page.waitForSelector(sel, { timeout: 3000 });
              selector = sel;
              confidence = parsed.confidence || 0;
              reasoning = parsed.reasoning || '';
              alternatives = parsed.alternatives || [];
              validated = true;
              break;
            } catch {
              validated = false;
            }
          }
          if (validated) break;
        }
        if (validated) break;
      }

      if (browser) await browser.close(); // Close only after all validation attempts

      results.push({
        json: {
          ...session,
          elementDescription: description,
          findElementResult: {
            selector,
            confidence,
            reasoning,
            attempts: maxAttempts,
            alternatives,
            validated,
          },
        },
      });
    }

    return [results];
  }
}
