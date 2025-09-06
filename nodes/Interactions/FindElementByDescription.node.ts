import {
  INodeType,
  INodeTypeDescription,
  IExecuteFunctions,
  INodeExecutionData,
  NodeConnectionType,
  INodeProperties,
} from 'n8n-workflow';
import { chromium, Browser } from 'playwright';
import { SessionObject } from '../../utils/SessionObject';

export class FindElementByDescription implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Find Element By Description (AI)',
    name: 'findElementByDescription',
    group: ['transform'],
    version: 1,
    description: 'Uses an LLM to find the best selector for a described element on the current page, supporting OpenAI and OpenRouter.',
    defaults: {
      name: 'Find Element',
    },
    inputs: [NodeConnectionType.Main],
    outputs: [NodeConnectionType.Main],
    properties: [
      {
        displayName: 'Element Description',
        name: 'description',
        type: 'string',
        default: '',
        placeholder: 'e.g. Submit button below login form',
        required: true,
      },
      {
        displayName: 'AI Provider',
        name: 'aiProvider',
        type: 'options',
        options: [
          { name: 'OpenAI', value: 'openaiApi' },
          { name: 'OpenRouter', value: 'openrouterApi' },
          // Add additional providers here!
        ],
        default: 'openaiApi',
        required: true,
      },
			{
  displayName: 'AI Credential',
  name: 'aiCredential',
  type: 'credentials',
  options: [
    {
      name: 'OpenAI API',
      value: 'openApi',
    },
    {
      name: 'OpenRouter API',
      value: 'openrouterApi',
    },
    {
      name: 'Google Gemini API',
      value: 'googleGeminiApi',
    }
    // Add more as you define credential definitions in your n8n environment
  ],
  required: true,
  default: 'openApi'
},
      {
        displayName: 'Model Name',
        name: 'model',
        type: 'string',
        default: 'gpt-4o',
        placeholder: 'e.g. gpt-4o, openrouter/all-Mistral, etc.',
        required: true,
      },
      {
        displayName: 'Max Attempts',
        name: 'maxAttempts',
        type: 'number',
        default: 3,
        description: 'How many times to try with the AI before failing',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const results: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      // Cast through unknown to squash type mismatch for custom session objects
      const session = items[i].json as unknown as SessionObject;
      const description = this.getNodeParameter('description', i) as string;
      const aiProvider = this.getNodeParameter('aiProvider', i) as string;
      const aiCredential = this.getNodeParameter('aiCredential', i, '') as string;
      const model = this.getNodeParameter('model', i) as string;
      const maxAttempts = this.getNodeParameter('maxAttempts', i, 3) as number;

      if (!session.cdpUrl) {
        throw new Error('Session object missing cdpUrl.');
      }

      // --- Connect to live browser, get live page HTML ---
      let browser: Browser | null = null;
      let pageHTML = '';
      try {
        browser = await chromium.connectOverCDP(session.cdpUrl);
        const context = browser.contexts()[0];
        const page = context.pages()[0] || await context.newPage();
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

      // --- Prompt and parse AI response ---
      let attempts = 0, selector = '', confidence = 0, reasoning = '', alternatives: string[] = [];
      while (attempts < maxAttempts && !selector) {
        attempts++;

        const prompt = `
You are an RPA agent. Given the following HTML, find the best CSS selector for the element described as: "${description}"

HTML (may be partial):
${pageHTML.slice(0,35000)}

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
          if (aiProvider === 'openaiApi') {
            aiResponse = await this.helpers.httpRequestWithAuthentication.call(
              this,
              aiCredential,
              {
                method: 'POST',
                url: 'https://api.openai.com/v1/chat/completions',
                body: {
                  model,
                  messages: [{ role: 'user', content: prompt }],
                  temperature: 0.1,
                  max_tokens: 400
                },
                json: true,
              }
            );
            const content = aiResponse.choices?.[0]?.message?.content ?? aiResponse;
            parsed = typeof content === 'string' ? JSON.parse(content) : content;
          }
          else if (aiProvider === 'openrouterApi') {
            aiResponse = await this.helpers.httpRequestWithAuthentication.call(
              this,
              aiCredential,
              {
                method: 'POST',
                url: 'https://openrouter.ai/api/v1/chat/completions',
                body: {
                  model,
                  messages: [{ role: 'user', content: prompt }],
                  temperature: 0.1,
                  max_tokens: 400
                },
                json: true,
              }
            );
            const content = aiResponse.choices?.[0]?.message?.content ?? aiResponse;
            parsed = typeof content === 'string' ? JSON.parse(content) : content;
          }
          // Add more providers here as needed

          selector = parsed.selector || '';
          confidence = parsed.confidence || 0;
          reasoning = parsed.reasoning || '';
          alternatives = parsed.alternatives || [];

        } catch (err) {
          reasoning = "AI did not return valid JSON: " + String(err);
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
            validated: false
          }
        }
      });
    }

    return [results];
  }
}
