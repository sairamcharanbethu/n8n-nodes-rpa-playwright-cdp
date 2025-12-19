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

export class FindElementByDescription implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Find Element By Description (AI)',
    name: 'findElementByDescription',
    group: ['transform'],
    version: 1,
    description: 'Uses an LLM to find a reliable Playwright-compatible selector for a described element on the current page.',
    defaults: { name: 'Find Element' },
    inputs: [NodeConnectionType.Main],
    outputs: [NodeConnectionType.Main],

    credentials: [
      { name: 'aiProviderApi', required: true },
    ],

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
          { name: 'Ollama', value: 'ollama' },
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
        displayName: 'Ollama Model',
        name: 'ollamaModel',
        type: 'string',
        default: 'llama3',
        placeholder: 'e.g. llama3, mistral',
        required: true,
        displayOptions: {
          show: { aiProvider: ['ollama'] },
        },
      },
      {
        displayName: 'Ollama URL',
        name: 'ollamaUrl',
        type: 'string',
        default: 'http://localhost:11434',
        placeholder: 'E.g. http://localhost:11434',
        required: true,
        displayOptions: {
          show: { aiProvider: ['ollama'] },
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
    const credentials = await this.getCredentials('aiProviderApi');

    if (!credentials) throw new Error('No credentials provided for AI provider.');
    if ((credentials.provider === 'openai' || credentials.provider === 'openrouter') && !credentials.apiKey) {
      throw new Error('API Key missing for OpenAI / OpenRouter');
    }
    if (credentials.provider === 'gemini' && !credentials.googleApiKey) {
      throw new Error('Google API Key missing for Gemini');
    }

    for (let i = 0; i < items.length; i++) {
      const session = items[i].json as unknown as SessionObject;
			const cdpUrl = this.getNodeParameter('cdpUrl', i) as string;
      const description = this.getNodeParameter('description', i) as string;
      const aiProvider = this.getNodeParameter('aiProvider', i) as string;
      const maxAttempts = this.getNodeParameter('maxAttempts', i, 3) as number;

      let model = '';
      let ollamaUrl = '';
      if (aiProvider === 'openai' || aiProvider === 'openrouter') {
        model = this.getNodeParameter('openAiModel', i) as string;
      } else if (aiProvider === 'gemini') {
        model = this.getNodeParameter('geminiModel', i) as string;
      } else if (aiProvider === 'ollama') {
        model = this.getNodeParameter('ollamaModel', i) as string;
        ollamaUrl = this.getNodeParameter('ollamaUrl', i) as string || credentials.ollamaUrl as string || 'http://localhost:11434';
      }

      if (!cdpUrl) throw new Error('Session object missing cdpUrl.');

      let browser: Browser | null = null;
      let page: Page | null = null;
      let pageHTML = '';
      let bodyHTML = '';

      try {
        browser = await chromium.connectOverCDP(cdpUrl);
        const context = browser.contexts()[0];
        page = context.pages()[0] || (await context.newPage());
        await page.waitForLoadState('domcontentloaded', { timeout: 9000 });
        const rawHTML = await page.content();

        pageHTML = rawHTML
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
          .replace(/<!--[\s\S]*?-->/g, '');
        bodyHTML = pageHTML.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] || pageHTML;
      } catch (e) {
        if (browser) await browser.close().catch(() => {});
        throw new Error('Could not connect to browser/obtain HTML: ' + (e as Error).message);
      }

      let attempts = 0,
        selector = '',
        confidence = 0,
        reasoning = '',
        alternatives: string[] = [],
        validated = false;

      const aiStats = {
        totalTokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalDurationMs: 0,
        apiCalls: 0,
      };
function getRelevantHTMLByType(html: string, elementType: string, maxLength = 35000): string {
  let relevant = '';

  switch (elementType.toLowerCase()) {
    case 'input':
      relevant = html.match(/<input[^>]*>/gi)?.join('\n') || '';
      break;
    case 'button':
      relevant = html.match(/<button[^>]*>[\s\S]*?<\/button>/gi)?.join('\n') || '';
      break;
    case 'select':
      relevant = html.match(/<select[^>]*>[\s\S]*?<\/select>/gi)?.join('\n') || '';
      break;
    case 'checkbox':
      relevant = html.match(/<input[^>]*type=["']?checkbox["']?[^>]*>/gi)?.join('\n') || '';
      break;
    case 'radio':
      relevant = html.match(/<input[^>]*type=["']?radio["']?[^>]*>/gi)?.join('\n') || '';
      break;
    case 'textarea':
      relevant = html.match(/<textarea[^>]*>[\s\S]*?<\/textarea>/gi)?.join('\n') || '';
      break;
    case 'div':
      relevant = html.match(/<div[^>]*>[\s\S]*?<\/div>/gi)?.join('\n') || '';
      break;
    case 'a':
      relevant = html.match(/<a[^>]*>[\s\S]*?<\/a>/gi)?.join('\n') || '';
      break;
    case 'img':
      relevant = html.match(/<img[^>]*>/gi)?.join('\n') || '';
      break;
    case 'span':
      relevant = html.match(/<span[^>]*>[\s\S]*?<\/span>/gi)?.join('\n') || '';
      break;
    case 'p':
      relevant = html.match(/<p[^>]*>[\s\S]*?<\/p>/gi)?.join('\n') || '';
      break;
    case 'h1,h2,h3,h4,h5,h6':
      relevant = html.match(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/gi)?.join('\n') || '';
      break;
    case 'table':
      relevant = html.match(/<table[^>]*>[\s\S]*?<\/table>/gi)?.join('\n') || '';
      break;
    case '*': // "Other"
      relevant = html;
      break;
    default:
      relevant = html;
  }

  if (!relevant) relevant = html;

  if (relevant.length > maxLength) {
    return relevant.slice(0, maxLength);
  }

  return relevant;
}
			bodyHTML = getRelevantHTMLByType(bodyHTML, this.getNodeParameter('elementType', i) as string, 35000);
      // ------------------------
      // Slice HTML into chunks for multiple attempts
      // ------------------------
      const chunkSize = 35000;
      const htmlChunks: string[] = [];
      for (let start = 0; start < bodyHTML.length; start += chunkSize) {
        htmlChunks.push(bodyHTML.slice(start, start + chunkSize));
      }

      for (const chunk of htmlChunks) {
        attempts = 0;
        while (attempts < maxAttempts && !validated) {
          attempts++;
					const elementType = this.getNodeParameter('elementType', i) as string;
          const prompt = `
You are an RPA agent. Given this HTML, find the best CSS selector for the element described as: "${description}"
and ensure it is of type "${elementType}" (e.g., input, button, select, etc.).

Requirements:
1. Prefer selectors using the element's unique ID attribute first, if available.
2. If no ID is available, use other unique attributes (e.g., name, class, data-*).
3. If neither exists, use the element's position in the hierarchy (parent/child).
4. Ensure the selector works with Playwright's page.$() or page.locator().
5. Provide alternatives following the same priority.
6. Do not use XPath or overly generic selectors (e.g., div, span).

HTML snippet:
${getRelevantHTML(chunk, 35000)}

Return your answer strictly in JSON format with the following keys:
- selector: The best CSS selector as a string.
- confidence: A number between 0 and 1 indicating confidence in the selector's reliability.
- reasoning: A brief explanation of why this selector was chosen.
- alternatives: An array of alternative selectors, if any.

Here is the relevant JSON format example:
{
  "selector": "<playwright_selector>",
  "confidence": 0.0 to 1.0,
  "reasoning": "<Why this selector>",
  "alternatives": ["<other selectors>"]
}
`.trim();

          let apiUrl = '';
          let headers: any = {};
          let body: any = {};

          if (aiProvider === 'openai') {
            apiUrl = 'https://api.openai.com/v1/chat/completions';
            headers = { Authorization: `Bearer ${credentials.apiKey}` };
            body = { model, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 400 };
          } else if (aiProvider === 'openrouter') {
            apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
            headers = { Authorization: `Bearer ${credentials.apiKey}` };
            body = { model, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 400 };
          } else if (aiProvider === 'gemini') {
            apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${credentials.googleApiKey}`;
            headers = { 'Content-Type': 'application/json' };
            body = { contents: [{ parts: [{ text: prompt }] }] };
          } else if (aiProvider === 'ollama') {
            apiUrl = `${ollamaUrl}/api/chat`;
            headers = { 'Content-Type': 'application/json' };
            body = {
              model,
              messages: [{ role: 'user', content: prompt }],
              stream: false,
              options: { temperature: 0.1 },
            };
          }

          try {
            const startTime = Date.now();
            const aiResponse = await axios.post(apiUrl, body, { headers });
            aiStats.totalDurationMs += Date.now() - startTime;
            aiStats.apiCalls++;

            let parsed: any = {};

            if (aiProvider === 'gemini') {
              const geminiContent = aiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
              parsed = typeof geminiContent === 'string' ? parseAiJson(geminiContent) : geminiContent;
              // Gemini token stats (if available in response)
              if (aiResponse.data.usageMetadata) {
                aiStats.promptTokens += aiResponse.data.usageMetadata.promptTokenCount || 0;
                aiStats.completionTokens += aiResponse.data.usageMetadata.candidatesTokenCount || 0;
                aiStats.totalTokens += aiResponse.data.usageMetadata.totalTokenCount || 0;
              }
            } else if (aiProvider === 'ollama') {
              const content = aiResponse.data.message?.content ?? '';
              parsed = typeof content === 'string' ? parseAiJson(content) : content;
              aiStats.promptTokens += aiResponse.data.prompt_eval_count || 0;
              aiStats.completionTokens += aiResponse.data.eval_count || 0;
              aiStats.totalTokens += (aiResponse.data.prompt_eval_count || 0) + (aiResponse.data.eval_count || 0);
            } else {
              const content = aiResponse.data.choices?.[0]?.message?.content ?? aiResponse.data.choices?.[0]?.text ?? '';
              parsed = typeof content === 'string' ? parseAiJson(content) : content;
              if (aiResponse.data.usage) {
                aiStats.promptTokens += aiResponse.data.usage.prompt_tokens || 0;
                aiStats.completionTokens += aiResponse.data.usage.completion_tokens || 0;
                aiStats.totalTokens += aiResponse.data.usage.total_tokens || 0;
              }
            }

            selector = parsed.selector || '';
            confidence = parsed.confidence || 0;
            reasoning = parsed.reasoning || '';
            alternatives = parsed.alternatives || [];

            // ------------------------
            // Validate selector + alternatives
            // ------------------------
            // for (const sel of [selector, ...alternatives]) {
            //   if (!sel || !page) continue;
            //   try {
            //     const elementHandle = await page.$(sel);
            //     if (elementHandle) {
            //       selector = sel;
            //       validated = true;
            //       break;
            //     }
            //   } catch {
            //     validated = false;
            //   }
            // }
						for (const sel of [selector, ...alternatives]) {
							if (!sel || !page) continue;
							try {
								const elementHandle = await page.$(sel);
								if (elementHandle) {
									// Get tagName to validate against requested type
									const tagName = (await elementHandle.evaluate(el => el.tagName.toLowerCase())) || '';
									const typeAttr = (await elementHandle.evaluate(el => el.getAttribute('type'))) || '';

									const elementType = (this.getNodeParameter('elementType', i) as string).toLowerCase();

									let typeMatches = false;
									switch (elementType) {
										case 'input': typeMatches = tagName === 'input'; break;
										case 'button': typeMatches = tagName === 'button'; break;
										case 'select': typeMatches = tagName === 'select'; break;
										case 'checkbox': typeMatches = tagName === 'input' && typeAttr === 'checkbox'; break;
										case 'radio': typeMatches = tagName === 'input' && typeAttr === 'radio'; break;
										case 'textarea': typeMatches = tagName === 'textarea'; break;
										case 'div': typeMatches = tagName === 'div'; break;
										case 'a': typeMatches = tagName === 'a'; break;
										case 'img': typeMatches = tagName === 'img'; break;
										case 'span': typeMatches = tagName === 'span'; break;
										case 'p': typeMatches = tagName === 'p'; break;
										case 'h1,h2,h3,h4,h5,h6': typeMatches = /^h[1-6]$/.test(tagName); break;
										case 'table': typeMatches = tagName === 'table'; break;
										case '*': typeMatches = true; break;
									}

									if (typeMatches) {
										selector = sel;
										validated = true;
										break;
									}
								}
							} catch {
								validated = false;
							}
						}

          } catch (err: any) {
            reasoning = `AI did not return valid JSON or failed: ${err.message}`;
          }
        }
        if (validated) break;
      }

      // ------------------------
      // "Last Resort" Semantic Fallback (Crawl4AI Inspired)
      // ------------------------
      if (!validated && page) {
        reasoning += " | Standard selector matching failed. Attempting semantic fallback...";
        try {
          const elementType = this.getNodeParameter('elementType', i) as string;
          // Extract elements and their text/attributes
          const elementsData = await page.evaluate((type) => {
            const sel = type === '*' ? 'body *' : type;
            const elements = Array.from((globalThis as any).document.querySelectorAll(sel));
            return elements.slice(0, 100).map((el: any, index: number) => ({
              index,
              text: el.textContent?.trim().slice(0, 50) || '',
              id: el.id,
              name: el.name || '',
              class: el.className,
              placeholder: el.placeholder || '',
            }));
          }, elementType);

          if (elementsData.length > 0) {
            const semanticPrompt = `
You are an RPA agent. I am looking for an element described as: "${description}"
Here is a list of candidate elements of type "${elementType}" found on the page:
${JSON.stringify(elementsData, null, 2)}

Identify the index of the most likely element.
Return strictly JSON: { "index": number, "reasoning": "string" }
`.trim();

            let semanticResponse;
            const semanticStartTime = Date.now();

            // Generate semantic API URL and headers based on provider
            let sApiUrl = '';
            let sHeaders: any = {};
            let sBody: any = {};

            if (aiProvider === 'openai') {
              sApiUrl = 'https://api.openai.com/v1/chat/completions';
              sHeaders = { Authorization: `Bearer ${credentials.apiKey}` };
              sBody = { model, messages: [{ role: 'user', content: semanticPrompt }], temperature: 0.1 };
            } else if (aiProvider === 'openrouter') {
              sApiUrl = 'https://openrouter.ai/api/v1/chat/completions';
              sHeaders = { Authorization: `Bearer ${credentials.apiKey}` };
              sBody = { model, messages: [{ role: 'user', content: semanticPrompt }], temperature: 0.1 };
            } else if (aiProvider === 'gemini') {
              sApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${credentials.googleApiKey}`;
              sHeaders = { 'Content-Type': 'application/json' };
              sBody = { contents: [{ parts: [{ text: semanticPrompt }] }] };
            } else if (aiProvider === 'ollama') {
              sApiUrl = `${ollamaUrl}/api/chat`;
              sHeaders = { 'Content-Type': 'application/json' };
              sBody = { model, messages: [{ role: 'user', content: semanticPrompt }], stream: false };
            }

            semanticResponse = await axios.post(sApiUrl, sBody, { headers: sHeaders });

            aiStats.totalDurationMs += Date.now() - semanticStartTime;
            aiStats.apiCalls++;

            let semanticParsed: any = {};
            if (aiProvider === 'gemini') {
              const content = semanticResponse?.data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
              semanticParsed = parseAiJson(content);
            } else if (aiProvider === 'ollama') {
              semanticParsed = parseAiJson(semanticResponse?.data.message?.content || '');
            } else {
              semanticParsed = parseAiJson(semanticResponse?.data.choices?.[0]?.message?.content || '');
            }

            if (semanticParsed.index !== undefined && semanticParsed.index >= 0) {
              const targetIndex = semanticParsed.index;
              // Generate robust selector based on index for the specific element type
              selector = `${elementType}:nth-of-type(${targetIndex + 1})`;
              if (elementType === '*') selector = `*:nth-child(${targetIndex + 1})`;

              // Verify it exists
              const check = await page.$(selector);
              if (check) {
                validated = true;
                reasoning = `Semantic match: ${semanticParsed.reasoning}`;
              }
            }
          }
        } catch (e: any) {
          reasoning += ` | Semantic fallback failed: ${e.message}`;
        }
      }

      if (browser) await browser.close(); // Close after all validation attempts

      results.push({
        json: {
          ...session,
          elementDescription: description,
          findElementResult: {
            selector,
            confidence,
            reasoning,
            attempts,
            alternatives,
            validated,
            aiStats,
          },
        },
      });
    }

    return [results];
  }
}
