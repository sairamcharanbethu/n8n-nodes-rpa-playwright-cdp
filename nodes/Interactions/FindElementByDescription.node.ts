import {
  INodeType,
  INodeTypeDescription,
  IExecuteFunctions,
  INodeExecutionData,
  NodeConnectionType,
} from 'n8n-workflow';
import { chromium, Browser } from 'playwright';
import { SessionObject } from '../../utils/SessionObject';

// Map your human provider selection to the actual credential name/type in n8n
const CREDENTIAL_MAP: Record<string, string> = {
  openai: 'openAiApi',         // Common n8n built-in type for OpenAI
  openrouter: 'openrouterApi', // Your custom or community credential for OpenRouter
  gemini: 'googleGeminiApi',   // Your custom or community credential for Google Gemini
};

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

    // List all credential types your node supports here:
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

    for (let i = 0; i < items.length; i++) {
      const session = items[i].json as unknown as SessionObject;
      const description = this.getNodeParameter('description', i) as string;
      const aiProvider = this.getNodeParameter('aiProvider', i) as string;
      const model = this.getNodeParameter('model', i) as string;
      const maxAttempts = this.getNodeParameter('maxAttempts', i, 3) as number;

      // Lookup the credential type name (as entered in n8n's Credentials tab):
      const credentialType = CREDENTIAL_MAP[aiProvider];
      if (!this.getCredentials(credentialType)) {
        throw new Error(
          `No credential found! Click "Select credentials" and attach a ${aiProvider} credential.`
        );
      }

      if (!session.cdpUrl) {
        throw new Error('Session object missing cdpUrl.');
      }

      // --- Use Playwright to connect and extract current cleaned HTML ---
      let browser: Browser | null = null;
      let pageHTML = '';
      try {
        browser = await chromium.connectOverCDP(session.cdpUrl);
        const context = browser.contexts()[0];
        const page = context.pages()[0] || (await context.newPage());
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

      // --- AI request/response logic ---
      let attempts = 0,
        selector = '',
        confidence = 0,
        reasoning = '',
        alternatives: string[] = [];

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

        let aiResponse, parsed: any = {};
        try {
          if (credentialType === 'openAiApi') {
            aiResponse = await this.helpers.httpRequestWithAuthentication.call(
              this,
              credentialType,
              {
                method: 'POST',
                url: 'https://api.openai.com/v1/chat/completions',
                body: {
                  model,
                  messages: [{ role: 'user', content: prompt }],
                  temperature: 0.1,
                  max_tokens: 400,
                },
                json: true,
              }
            );
            const content = aiResponse.choices?.[0]?.message?.content ?? aiResponse;
            parsed = typeof content === 'string' ? JSON.parse(content) : content;
          } else if (credentialType === 'openrouterApi') {
            aiResponse = await this.helpers.httpRequestWithAuthentication.call(
              this,
              credentialType,
              {
                method: 'POST',
                url: 'https://openrouter.ai/api/v1/chat/completions',
                body: {
                  model,
                  messages: [{ role: 'user', content: prompt }],
                  temperature: 0.1,
                  max_tokens: 400,
                },
                json: true,
              }
            );
            const content = aiResponse.choices?.[0]?.message?.content ?? aiResponse;
            parsed = typeof content === 'string' ? JSON.parse(content) : content;
          } else if (credentialType === 'googleGeminiApi') {
            aiResponse = await this.helpers.httpRequestWithAuthentication.call(
              this,
              credentialType,
              {
                method: 'POST',
                url: 'https://generativelanguage.googleapis.com/v1beta/models/' +
                  model +
                  ':generateContent',
                body: {
                  contents: [{ parts: [{ text: prompt }] }],
                },
                json: true,
              }
            );
            // Gemini's response style
            const geminiContent =
              aiResponse?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
            parsed = typeof geminiContent === 'string' ? JSON.parse(geminiContent) : geminiContent;
          }
          selector = parsed.selector || '';
          confidence = parsed.confidence || 0;
          reasoning = parsed.reasoning || '';
          alternatives = parsed.alternatives || [];
        } catch (err) {
          reasoning = 'AI did not return valid JSON: ' + String(err);
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
            validated: false,
          },
        },
      });
    }

    return [results];
  }
}
