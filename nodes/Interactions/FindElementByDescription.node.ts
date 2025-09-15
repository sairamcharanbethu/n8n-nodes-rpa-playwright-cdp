import {
  INodeType,
  INodeTypeDescription,
  IExecuteFunctions,
  INodeExecutionData,
  NodeConnectionType,
} from 'n8n-workflow';
import { chromium, Browser, Page } from 'playwright';
import { SessionObject } from '../../utils/SessionObject';
import axios from 'axios';
import * as cheerio from 'cheerio';

export class FindElementByDescription implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Find Element By Description (AI)',
    name: 'findElementByDescription',
    group: ['transform'],
    version: 1,
    description:
      'Uses an LLM to find a reliable Playwright-compatible selector for a described element on the current page.',
    defaults: { name: 'Find Element' },
    inputs: [NodeConnectionType.Main],
    outputs: [NodeConnectionType.Main],

    credentials: [{ name: 'aiProviderApi', required: true }],

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
        displayName: 'Element Description',
        name: 'description',
        type: 'string',
        default: '',
        placeholder: 'E.g. "blue submit button in signup form"',
        required: true,
      },
      {
        displayName: 'Element Type',
        name: 'elementType',
        type: 'options',
        options: [
          { name: 'Input', value: 'input' },
          { name: 'Button', value: 'button' },
          { name: 'Select / Dropdown', value: 'select' },
          { name: 'Checkbox', value: 'checkbox' },
          { name: 'Radio', value: 'radio' },
          { name: 'Textarea', value: 'textarea' },
          { name: 'Div / Container', value: 'div' },
          { name: 'Link / Anchor', value: 'a' },
          { name: 'Image', value: 'img' },
          { name: 'Span', value: 'span' },
          { name: 'Paragraph', value: 'p' },
          { name: 'Heading', value: 'h1,h2,h3,h4,h5,h6' },
          { name: 'Table', value: 'table' },
          { name: 'Other', value: '*' },
        ],
        default: 'input',
        description: 'Select the type of element to find for semantic validation',
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
        displayName: 'OpenAI / OpenRouter Model',
        name: 'openAiModel',
        type: 'string',
        default: 'gpt-4o',
        placeholder: 'e.g. gpt-4o, gpt-4o-mini',
        required: true,
        displayOptions: {
          show: { aiProvider: ['openai', 'openrouter'] },
        },
      },
      {
        displayName: 'Gemini Model',
        name: 'geminiModel',
        type: 'string',
        default: 'gemini-1.5-pro',
        placeholder: 'e.g. gemini-1.5-pro, gemini-2.0',
        required: true,
        displayOptions: {
          show: { aiProvider: ['gemini'] },
        },
      },
      {
        displayName: 'Max Attempts',
        name: 'maxAttempts',
        type: 'number',
        default: 3,
        description: 'Number of AI retries per HTML chunk before failing',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const results: INodeExecutionData[] = [];

    // ------------------------
    // Helpers
    // ------------------------
    function safeParseJson(text: string): any {
      if (!text) return {};
      const cleaned = text
        .replace(/```(json)?\n?/gi, '')
        .replace(/```$/gi, '')
        .trim();
      try {
        return JSON.parse(cleaned);
      } catch {
        try {
          return JSON.parse(
            cleaned.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']'),
          );
        } catch {
          return {};
        }
      }
    }

    function sliceHtml(html: string, maxLength = 35000): string[] {
      const chunks: string[] = [];
      for (let start = 0; start < html.length; start += maxLength) {
        chunks.push(html.slice(start, start + maxLength));
      }
      return chunks;
    }

    function filterHtmlByType(html: string, elementType: string): string {
      const $ = cheerio.load(html);
      let elements: string[] = [];

      switch (elementType.toLowerCase()) {
        case 'input':
          elements = $('input').toArray().map((el) => $.html(el));
          break;
        case 'button':
          elements = $('button').toArray().map((el) => $.html(el));
          break;
        case 'select':
          elements = $('select').toArray().map((el) => $.html(el));
          break;
        case 'checkbox':
          elements = $('input[type="checkbox"]').toArray().map((el) => $.html(el));
          break;
        case 'radio':
          elements = $('input[type="radio"]').toArray().map((el) => $.html(el));
          break;
        case 'textarea':
          elements = $('textarea').toArray().map((el) => $.html(el));
          break;
        case 'div':
          elements = $('div').toArray().map((el) => $.html(el));
          break;
        case 'a':
          elements = $('a').toArray().map((el) => $.html(el));
          break;
        case 'img':
          elements = $('img').toArray().map((el) => $.html(el));
          break;
        case 'span':
          elements = $('span').toArray().map((el) => $.html(el));
          break;
        case 'p':
          elements = $('p').toArray().map((el) => $.html(el));
          break;
        case 'h1,h2,h3,h4,h5,h6':
          elements = $('h1,h2,h3,h4,h5,h6').toArray().map((el) => $.html(el));
          break;
        case 'table':
          elements = $('table').toArray().map((el) => $.html(el));
          break;
        case '*':
          elements = [html];
          break;
        default:
          elements = [html];
      }

      return elements.join('\n');
    }

    async function callAI(
      aiProvider: string,
      model: string,
      credentials: any,
      prompt: string,
    ): Promise<any> {
      let apiUrl = '';
      let headers: any = {};
      let body: any = {};

      if (aiProvider === 'openai') {
        apiUrl = 'https://api.openai.com/v1/chat/completions';
        headers = { Authorization: `Bearer ${credentials.apiKey}` };
        body = {
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 400,
        };
      } else if (aiProvider === 'openrouter') {
        apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
        headers = { Authorization: `Bearer ${credentials.apiKey}` };
        body = {
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 400,
        };
      } else if (aiProvider === 'gemini') {
        apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${credentials.googleApiKey}`;
        headers = { 'Content-Type': 'application/json' };
        body = { contents: [{ parts: [{ text: prompt }] }] };
      }

      const response = await axios.post(apiUrl, body, { headers });
      if (aiProvider === 'gemini') {
        const text =
          response.data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        return safeParseJson(text);
      } else {
        const text =
          response.data.choices?.[0]?.message?.content ??
          response.data.choices?.[0]?.text ??
          '';
        return safeParseJson(text);
      }
    }

    // ------------------------
    // Main Loop
    // ------------------------
    const credentials = await this.getCredentials('aiProviderApi');
    if (!credentials) throw new Error('No credentials provided for AI provider.');

    for (let i = 0; i < items.length; i++) {
      const session = items[i].json as unknown as SessionObject;
      const cdpUrl = this.getNodeParameter('cdpUrl', i) as string;
      const description = this.getNodeParameter('description', i) as string;
      const aiProvider = this.getNodeParameter('aiProvider', i) as string;
      const maxAttempts = this.getNodeParameter('maxAttempts', i, 3) as number;
      const elementType = this.getNodeParameter('elementType', i) as string;

      let model = '';
      if (aiProvider === 'openai' || aiProvider === 'openrouter') {
        model = this.getNodeParameter('openAiModel', i) as string;
      } else if (aiProvider === 'gemini') {
        model = this.getNodeParameter('geminiModel', i) as string;
      }

      let browser: Browser | null = null;
      let page: Page | null = null;

      try {
        // ------------------------
        // Connect to browser
        // ------------------------
        browser = await chromium.connectOverCDP(cdpUrl);
        const context = browser.contexts()[0];
        page = context.pages()[0] || (await context.newPage());
        await page.waitForLoadState('domcontentloaded', { timeout: 15000 });

        // ------------------------
        // Extract & filter HTML
        // ------------------------
        const rawHTML = await page.content();
        const $ = cheerio.load(rawHTML);
        $('script, style').remove();
        const bodyHTML = $('body').html() || rawHTML;
        const filteredHTML = filterHtmlByType(bodyHTML, elementType);
        const chunks = sliceHtml(filteredHTML);

        let attempts = 0;
        let validatedResults: {
          selector: string;
          confidence: number;
          reasoning: string;
          validated: boolean;
        }[] = [];

        for (const chunk of chunks) {
          attempts = 0;
          while (attempts < maxAttempts) {
            attempts++;
            const prompt = `
You are an RPA agent. Given this HTML, find the best CSS selector for the element described as: "${description}"
and ensure it is of type "${elementType}".

Requirements:
1. Prefer selectors using the element's unique ID attribute first, if available.
2. If no ID is available, use other unique attributes (e.g., name, class, data-*).
3. If neither exists, use the element's position in the hierarchy (parent/child).
4. Ensure the selector works with Playwright's page.$() or page.locator().
5. Provide alternatives following the same priority.
6. Do not use XPath or overly generic selectors.

HTML snippet:
${chunk}

Return your answer strictly in JSON format:
{
  "selector": "<playwright_selector>",
  "confidence": 0.0 to 1.0,
  "reasoning": "<Why this selector>",
  "alternatives": ["<other selectors>"]
}
            `.trim();

            const parsed = await callAI(aiProvider, model, credentials, prompt);

            const selectors = [parsed.selector, ...(parsed.alternatives || [])]
              .filter((s: string) => s && s.trim());

            for (const sel of selectors) {
              try {
                const handle = await page.$(sel);
                if (handle) {
                  const tagName = await handle.evaluate((el) =>
                    el.tagName.toLowerCase(),
                  );
                  const typeAttr =
                    (await handle.evaluate((el) => el.getAttribute('type'))) ||
                    '';

                  let typeMatches = false;
                  switch (elementType.toLowerCase()) {
                    case 'input':
                      typeMatches = tagName === 'input';
                      break;
                    case 'button':
                      typeMatches = tagName === 'button';
                      break;
                    case 'select':
                      typeMatches = tagName === 'select';
                      break;
                    case 'checkbox':
                      typeMatches =
                        tagName === 'input' && typeAttr === 'checkbox';
                      break;
                    case 'radio':
                      typeMatches = tagName === 'input' && typeAttr === 'radio';
                      break;
                    case 'textarea':
                      typeMatches = tagName === 'textarea';
                      break;
                    case 'div':
                      typeMatches = tagName === 'div';
                      break;
                    case 'a':
                      typeMatches = tagName === 'a';
                      break;
                    case 'img':
                      typeMatches = tagName === 'img';
                      break;
                    case 'span':
                      typeMatches = tagName === 'span';
                      break;
                    case 'p':
                      typeMatches = tagName === 'p';
                      break;
                    case 'h1,h2,h3,h4,h5,h6':
                      typeMatches = /^h[1-6]$/.test(tagName);
                      break;
                    case 'table':
                      typeMatches = tagName === 'table';
                      break;
                    case '*':
                      typeMatches = true;
                      break;
                  }

                  validatedResults.push({
                    selector: sel,
                    confidence: parsed.confidence || 0,
                    reasoning: parsed.reasoning || '',
                    validated: typeMatches,
                  });
                }
              } catch {
                // Ignore invalid selector
              }
            }

            if (validatedResults.length > 0) break; // stop attempts for this chunk
          }
          if (validatedResults.length > 0) break; // stop at first valid chunk
        }

        // Rank results
        validatedResults.sort((a, b) => {
          if (a.validated && !b.validated) return -1;
          if (!a.validated && b.validated) return 1;
          return b.confidence - a.confidence;
        });

        const best = validatedResults[0] || {
          selector: '',
          confidence: 0,
          reasoning: 'No valid selector found',
          validated: false,
        };

        results.push({
          json: {
            ...session,
            elementDescription: description,
            success: best.validated,
            findElementResult: {
              finalSelector: best.selector,
              confidence: best.confidence,
              reasoning: best.reasoning,
              attempts,
              validated: best.validated,
              allResults: validatedResults,
            },
          },
        });
      } catch (err: any) {
        results.push({
          json: {
            ...session,
            elementDescription: description,
            success: false,
            error: err.message,
          },
        });
      } finally {
        if (browser) await browser.close().catch(() => {});
      }
    }

    return [results];
  }
}
