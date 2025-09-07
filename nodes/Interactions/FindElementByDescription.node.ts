import {
  INodeType,
  INodeTypeDescription,
  IExecuteFunctions,
  INodeExecutionData,
  NodeConnectionType,
} from 'n8n-workflow';
import { chromium, Browser } from 'playwright';
import { SessionObject } from '../../utils/SessionObject';
import axios from 'axios';

export class FindElementByDescription implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Find Element By Description (AI)',
    name: 'findElementByDescription',
    group: ['transform'],
    version: 1,
    description: 'Uses an LLM to find a reliable selector for a described element on the current page.',
    defaults: { name: 'Find Element' },
    inputs: [NodeConnectionType.Main],
    outputs: [NodeConnectionType.Main],

    credentials: [
      { name: 'aiProviderApi', required: true },
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
        description: 'Number of AI retries before failing',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const results: INodeExecutionData[] = [];

    const credentials = await this.getCredentials('aiProviderApi');
 // Helper to safely parse JSON returned by AI (strip code fences)
  const parseAiJson = (text: string) => {
    const cleaned = text.replace(/```(json)?\n?/g, '').replace(/```$/, '').trim();
    return JSON.parse(cleaned);
  };
    // Simple API key validation
    if (!credentials) {
      throw new Error('No credentials provided for AI provider.');
    }
    if (
      (credentials.provider === 'openai' || credentials.provider === 'openrouter') &&
      !credentials.apiKey
    ) {
      throw new Error('API Key missing for OpenAI / OpenRouter');
    }
    if (credentials.provider === 'gemini' && !credentials.googleApiKey) {
      throw new Error('Google API Key missing for Gemini');
    }

    for (let i = 0; i < items.length; i++) {
      const session = items[i].json as unknown as SessionObject;
      const description = this.getNodeParameter('description', i) as string;
      const aiProvider = this.getNodeParameter('aiProvider', i) as string;
      const maxAttempts = this.getNodeParameter('maxAttempts', i, 3) as number;

      let model = '';
      if (aiProvider === 'openai' || aiProvider === 'openrouter') {
        model = this.getNodeParameter('openAiModel', i) as string;
      } else if (aiProvider === 'gemini') {
        model = this.getNodeParameter('geminiModel', i) as string;
      }

      if (!session.cdpUrl) {
        throw new Error('Session object missing cdpUrl.');
      }

      let browser: Browser | null = null;
      let pageHTML = '';
      let page: any;

      try {
        browser = await chromium.connectOverCDP(session.cdpUrl);
        const context = browser.contexts()[0];
        page = context.pages()[0] || (await context.newPage());
        await page.waitForLoadState('domcontentloaded', { timeout: 9000 });
        const rawHTML = await page.content();
        pageHTML = rawHTML
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
          .replace(/<!--[\s\S]*?-->/g, '');
        await browser.close();
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

      while (attempts < maxAttempts && !selector) {
        attempts++;
        const prompt = `
You are an RPA agent. Given this HTML, find the best CSS selector for the element described as: "${description}"

HTML:
${pageHTML.slice(0, 35000)}

Respond strictly in JSON:
{
  "selector": "<css_selector>",
  "confidence": 0.0 to 1.0,
  "reasoning": "<Why this selector>",
  "alternatives": ["<other selectors, if any>"]
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
        }

        try {
          const aiResponse = await axios.post(apiUrl, body, { headers });
          let parsed: any = {};

          if (aiProvider === 'gemini') {
            const geminiContent = aiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
            parsed = typeof geminiContent === 'string' ? parseAiJson(geminiContent) : geminiContent;
          } else {
            const content = aiResponse.data.choices?.[0]?.message?.content ?? aiResponse.data.choices?.[0]?.text ?? '';
            parsed = typeof content === 'string' ? parseAiJson(content) : content;
          }

          selector = parsed.selector || '';
          confidence = parsed.confidence || 0;
          reasoning = parsed.reasoning || '';
          alternatives = parsed.alternatives || [];

          // Validate selector
          if (selector && page) {
            try {
              const elementHandle = await page.$(selector);
              validated = !!elementHandle;
            } catch {
              validated = false;
            }
          }

        } catch (err: any) {
          reasoning = `AI did not return valid JSON or failed: ${err.message}`;
        }
      }

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
          },
        },
      });
    }

    return [results];
  }
}
