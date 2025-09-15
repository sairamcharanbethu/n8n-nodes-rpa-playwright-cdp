import { type INodeType, type INodeTypeDescription, type IExecuteFunctions, type INodeExecutionData, NodeConnectionType,IDataObject } from 'n8n-workflow';
import { connectBrowser, validateSelector } from './browser/browserHelper';
import { callAIProvider } from './ai/aiHelper';
import { buildElementPrompt } from './prompts/elementPrompt';
import { sortSuggestions } from './utils';
import type { ResultItem } from './types';
import * as cheerio from 'cheerio';

export class FindElementByDescription implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Find Element By Description (AI)',
    name: 'findElementByDescription',
    group: ['transform'],
    version: 1,
    description: 'Finds a reliable CSS selector for a described element on the current page using AI.',
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
        required: true,
        placeholder: 'ws://localhost:9222/devtools/browser/...',
      },
      {
        displayName: 'Element Description',
        name: 'description',
        type: 'string',
        default: '',
        required: true,
        placeholder: 'E.g., "blue submit button in signup form"',
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
      },
      {
        displayName: 'Model',
        name: 'model',
        type: 'string',
        default: 'gpt-4o-mini',
      },
      {
        displayName: 'Max Attempts',
        name: 'maxAttempts',
        type: 'number',
        default: 3,
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const results: ResultItem[] = [];

    for (let i = 0; i < items.length; i++) {
      const description = this.getNodeParameter('description', i) as string;
      const provider = this.getNodeParameter('aiProvider', i) as 'openai' | 'openrouter' | 'gemini';
      const model = this.getNodeParameter('model', i) as string;
      const maxAttempts = this.getNodeParameter('maxAttempts', i) as number;

      const credentials = await this.getCredentials('aiProviderApi');
      if (!credentials) throw new Error('No credentials provided for AI provider.');

      const cdpUrl = this.getNodeParameter('cdpUrl', i) as string;
      if (!cdpUrl) throw new Error('CDP URL is required.');

      const { browser, page } = await connectBrowser(cdpUrl);

      try {
        const html = await page.content();
        const $ = cheerio.load(html);
        const domSnippet = $.html().slice(0, 2000); // feed only first 2000 chars to AI

        const prompt = buildElementPrompt(description, domSnippet);

        let attempt = 0;
        let suggestions: any[] = [];

        while (attempt < maxAttempts && suggestions.length === 0) {
          attempt++;
          try {
            const aiResponse = await callAIProvider(provider, credentials.apiKey as string, model, prompt);
            suggestions = aiResponse.suggestions.map(s => ({
              ...s,
              validated: false,
              aiRaw: aiResponse.raw,
            }));

            // Playwright validation
            for (const s of suggestions) {
              s.validated = await validateSelector(page, s.selector);
            }

            // Sort by validated first, then confidence
            suggestions = sortSuggestions(suggestions);

          } catch (err: any) {
            suggestions = [{
              selector: '',
              confidence: 0,
              validated: false,
              reasoning: `AI failed: ${err.message}`,
              aiRaw: '',
            }];
          }
        }

        // Return best suggestion
        results.push({
          description,
          ...suggestions[0],
        });

      } finally {
        await browser.close().catch(() => {});
      }
    }

    return [this.helpers.returnJsonArray(results as IDataObject[])];
  }
}
