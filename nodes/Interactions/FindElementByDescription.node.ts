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
					{ name: 'Auto (Interactive)', value: 'auto' },
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
				default: 'auto',
				description: 'Select the type of element to find. "Auto" searches across all interactive elements.',
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
      {
        displayName: 'Discovery Mode (Connectivity Check)',
        name: 'discoveryMode',
        type: 'boolean',
        default: false,
        description: 'If enabled, list all candidate elements on the page instead of finding one',
      },
      {
        displayName: 'Heuristic Search',
        name: 'heuristicSearch',
        type: 'boolean',
        default: true,
        description: 'Attempt to find elements using standard attributes before calling AI',
        displayOptions: {
          hide: { discoveryMode: [true] },
        },
      },
      {
        displayName: 'Use AI Fallback',
        name: 'useAI',
        type: 'boolean',
        default: true,
        description: 'Whether to use AI if heuristic search fails',
        displayOptions: {
          hide: { discoveryMode: [true] },
        },
      },
      {
        displayName: 'Semantic Validation',
        name: 'semanticValidation',
        type: 'boolean',
        default: true,
        description: 'Perform a final AI check to ensure the found element matches your description',
        displayOptions: {
          hide: { discoveryMode: [true] },
        },
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const results: INodeExecutionData[] = [];

    const parseAiJson = (text: string) => {
      try {
        const cleaned = text.replace(/```(json)?\n?/g, '').replace(/```$/, '').trim();
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start === -1 || end === -1) throw new Error('No JSON object found in AI response');
        let jsonStr = cleaned.slice(start, end + 1);
        jsonStr = jsonStr.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        return JSON.parse(jsonStr);
      } catch (e) {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            return JSON.parse(match[0].replace(/\/\/.*$/gm, ''));
          } catch (e2) { throw e; }
        }
        throw e;
      }
    };

    const getRelevantHTML = (html: string, maxLength = 35000): string => {
      if (html.length <= maxLength) return html;
      const mid = Math.floor(html.length / 2);
      const start = Math.max(0, mid - maxLength / 2);
      return html.slice(start, start + maxLength);
    };

    const getRelevantHTMLByType = (html: string, elementType: string, maxLength = 35000): string => {
      let relevant = '';
      const et = elementType.toLowerCase();
      switch (et) {
        case 'auto': relevant = html.match(/<(a|button|input|select|textarea)[^>]*>[\s\S]*?<\/(a|button|input|select|textarea)>|<(a|button|input|select|textarea)[^>]*\/?>/gi)?.join('\n') || ''; break;
        case 'input': relevant = html.match(/<input[^>]*>/gi)?.join('\n') || ''; break;
        case 'button': relevant = html.match(/<button[^>]*>[\s\S]*?<\/button>/gi)?.join('\n') || ''; break;
        case 'select': relevant = html.match(/<select[^>]*>[\s\S]*?<\/select>/gi)?.join('\n') || ''; break;
        case 'checkbox': relevant = html.match(/<input[^>]*type=["']?checkbox["']?[^>]*>/gi)?.join('\n') || ''; break;
        case 'radio': relevant = html.match(/<input[^>]*type=["']?radio["']?[^>]*>/gi)?.join('\n') || ''; break;
        case 'textarea': relevant = html.match(/<textarea[^>]*>[\s\S]*?<\/textarea>/gi)?.join('\n') || ''; break;
        case 'div': relevant = html.match(/<div[^>]*>[\s\S]*?<\/div>/gi)?.join('\n') || ''; break;
        case 'a': relevant = html.match(/<a[^>]*>[\s\S]*?<\/a>/gi)?.join('\n') || ''; break;
        case 'img': relevant = html.match(/<img[^>]*>/gi)?.join('\n') || ''; break;
        case 'span': relevant = html.match(/<span[^>]*>[\s\S]*?<\/span>/gi)?.join('\n') || ''; break;
        case 'p': relevant = html.match(/<p[^>]*>[\s\S]*?<\/p>/gi)?.join('\n') || ''; break;
        case 'h1,h2,h3,h4,h5,h6': relevant = html.match(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/gi)?.join('\n') || ''; break;
        case 'table': relevant = html.match(/<table[^>]*>[\s\S]*?<\/table>/gi)?.join('\n') || ''; break;
        default: relevant = html;
      }
      if (!relevant) relevant = html;
      return relevant.length > maxLength ? relevant.slice(0, maxLength) : relevant;
    };

    const credentials = await this.getCredentials('aiProviderApi');
    if (!credentials) throw new Error('No credentials provided for AI provider.');

    for (let i = 0; i < items.length; i++) {
      const session = items[i].json as unknown as SessionObject;
      const cdpUrl = this.getNodeParameter('cdpUrl', i) as string;
      const description = this.getNodeParameter('description', i) as string;
      const aiProvider = this.getNodeParameter('aiProvider', i) as string;
      const maxAttempts = this.getNodeParameter('maxAttempts', i, 3) as number;
      const discoveryMode = this.getNodeParameter('discoveryMode', i, false) as boolean;
      const heuristicSearch = this.getNodeParameter('heuristicSearch', i, true) as boolean;
      const useAI = this.getNodeParameter('useAI', i, true) as boolean;
      const semanticValidation = this.getNodeParameter('semanticValidation', i, true) as boolean;
      const elementType = this.getNodeParameter('elementType', i, 'auto') as string;

      let model = '';
      let ollamaUrl = '';
      if (aiProvider === 'openai' || aiProvider === 'openrouter') model = this.getNodeParameter('openAiModel', i) as string;
      else if (aiProvider === 'gemini') model = this.getNodeParameter('geminiModel', i) as string;
      else if (aiProvider === 'ollama') {
        model = this.getNodeParameter('ollamaModel', i) as string;
        ollamaUrl = this.getNodeParameter('ollamaUrl', i) as string || credentials.ollamaUrl as string || 'http://localhost:11434';
      }

      let browser: Browser | null = null;
      let page: Page | null = null;
      let candidates: any[] = [];
      let selector = '', confidence = 0, reasoning = '', alternatives: string[] = [], validated = false;
      const aiStats = { totalTokens: 0, promptTokens: 0, completionTokens: 0, totalDurationMs: 0, apiCalls: 0 };

      try {
        browser = await chromium.connectOverCDP(cdpUrl);
        const context = browser.contexts()[0];
        page = context.pages()[0] || (await context.newPage());
        await page.waitForLoadState('domcontentloaded', { timeout: 9000 });

        candidates = await page.evaluate((type) => {
          const sel = type === 'auto' ? 'a, button, input, select, textarea, [role="button"]' : (type === '*' ? 'body *' : type);
          const elements = Array.from((globalThis as any).document.querySelectorAll(sel));
          return elements.map((el: any, index: number) => ({
            index,
            tagName: el.tagName.toLowerCase(),
            text: el.textContent?.trim().slice(0, 100) || '',
            id: el.id || '',
            name: el.name || '',
            class: el.className || '',
            placeholder: el.placeholder || '',
            type: el.type || '',
            ariaLabel: el.getAttribute('aria-label') || '',
            href: el.getAttribute('href') || '',
            title: el.getAttribute('title') || '',
            alt: el.getAttribute('alt') || '',
            isVisible: el.offsetWidth > 0 && el.offsetHeight > 0,
            rect: el.getBoundingClientRect(),
          }));
        }, elementType);

        if (discoveryMode) {
          results.push({ json: { ...session, discoveryResults: { totalCandidates: candidates.length, candidates: candidates.slice(0, 100) } } });
          if (browser) await browser.close();
          continue;
        }

        const runSemanticValidation = async (sel: string): Promise<boolean> => {
          if (!semanticValidation || !page) return true;
          const el = await page.$(sel).catch(() => null);
          if (!el) return false;
          const html = await el.evaluate(e => e.outerHTML.slice(0, 1000));
          const vPrompt = `Does this element represent a "${description}"? Element HTML: ${html}\nAnswer ONLY with JSON: { "matches": boolean, "reasoning": "..." }`;

          let vBody: any = {};
          if (aiProvider === 'openai' || aiProvider === 'openrouter') vBody = { model, messages: [{ role: 'user', content: vPrompt }], temperature: 0.1 };
          else if (aiProvider === 'gemini') vBody = { contents: [{ parts: [{ text: vPrompt }] }] };
          else if (aiProvider === 'ollama') vBody = { model, messages: [{ role: 'user', content: vPrompt }], stream: false, options: { temperature: 0.1 } };

          try {
            const vResp = await axios.post(aiProvider === 'gemini' ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${credentials.googleApiKey}` : (aiProvider === 'ollama' ? `${ollamaUrl}/api/chat` : (aiProvider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions')), vBody, { headers: { Authorization: credentials.apiKey ? `Bearer ${credentials.apiKey}` : undefined, 'Content-Type': 'application/json' } });
            aiStats.apiCalls++;
            let vContent = aiProvider === 'gemini' ? vResp.data.candidates?.[0]?.content?.parts?.[0]?.text : (aiProvider === 'ollama' ? vResp.data.message?.content : vResp.data.choices?.[0]?.message?.content);
            const vp = parseAiJson(vContent);
            return !!vp.matches;
          } catch { return true; }
        };

        const constructRobustSelector = (t: any) => {
          if (t.id) return `#${t.id}`;
          if (t.name) return `[name="${t.name}"]`;
          if (t.href && t.href.length > 5) {
             const pathParts = t.href.split(/[?#]/)[0].split('/');
             const last = pathParts.pop() || pathParts.pop();
             if (last && last.length > 3) return `${t.tagName}[href*="${last}"]`;
             return `${t.tagName}[href="${t.href}"]`;
          }
          if (t.ariaLabel) return `[aria-label="${t.ariaLabel}"]`;
          if (t.placeholder) return `[placeholder="${t.placeholder}"]`;
          if (t.title) return `[title="${t.title}"]`;
          if (t.alt) return `[alt="${t.alt}"]`;
          if (t.text && t.text.length > 2 && t.text.length < 50) return `${t.tagName}:has-text("${t.text}")`;
          return `${t.tagName}:nth-of-type(${parseInt(t.index) + 1})`;
        };

        // 1. Heuristic Search
        if (heuristicSearch) {
          const descLower = description.toLowerCase();
          const keywords = descLower.split(/\s+/).filter(w => w.length > 2);
          for (const cand of candidates) {
            const atts = [cand.id, cand.name, cand.placeholder, cand.text, cand.ariaLabel, cand.href, cand.title, cand.alt].map(v => String(v || '').toLowerCase());
            const isExact = atts.some(v => v === descLower);
            const isFuzzy = keywords.length > 0 && keywords.every(kw => atts.some(a => a.includes(kw)));
            if (isExact || isFuzzy) {
              const sel = constructRobustSelector(cand);
              const count = await page.evaluate((s) => (globalThis as any).document.querySelectorAll(s).length, sel);
              if (count === 1) {
                if (await runSemanticValidation(sel)) { selector = sel; validated = true; confidence = isExact ? 0.98 : 0.85; reasoning = `Heuristic match (${isExact ? 'exact' : 'fuzzy'}): Unique element found via ${sel}.`; break; }
              }
            }
            if (validated) break;
          }
        }

        // 2. AI Search
        if (!validated && useAI) {
          const rawHTML = await page.content();
          let bodyHTML = rawHTML.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '').replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
          bodyHTML = bodyHTML.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] || bodyHTML;
          bodyHTML = getRelevantHTMLByType(bodyHTML, elementType, 35000);
          const chunks = [bodyHTML];
          for (const chunk of chunks) {
            let attempt = 0;
            while (attempt < maxAttempts && !validated) {
              attempt++;
              const prompt = `Task: Find a ROBUST CSS selector for: "${description}". URL: ${await page.url()}\nAvoid using :nth-of-type() or :nth-child() if ANY other attribute (ID, Name, Href, Data-*, etc) can uniquely identify the element.\nReturn ONLY JSON: { "selector": "...", "confidence": 0.9, "reasoning": "...", "alternatives": [] }\nHTML: ${getRelevantHTML(chunk, 15000)}`;
              let body: any = {};
              if (aiProvider === 'openai' || aiProvider === 'openrouter') body = { model, messages: [{ role: 'user', content: prompt }], temperature: 0.1 };
              else if (aiProvider === 'gemini') body = { contents: [{ parts: [{ text: prompt }] }] };
              else if (aiProvider === 'ollama') body = { model, messages: [{ role: 'user', content: prompt }], stream: false, options: { temperature: 0.1 } };
              try {
                const start = Date.now();
                const resp = await axios.post(aiProvider === 'gemini' ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${credentials.googleApiKey}` : (aiProvider === 'ollama' ? `${ollamaUrl}/api/chat` : (aiProvider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions')), body, { headers: { Authorization: credentials.apiKey ? `Bearer ${credentials.apiKey}` : undefined, 'Content-Type': 'application/json' } });
                aiStats.totalDurationMs += Date.now() - start; aiStats.apiCalls++;
                let content = aiProvider === 'gemini' ? resp.data.candidates?.[0]?.content?.parts?.[0]?.text : (aiProvider === 'ollama' ? resp.data.message?.content : resp.data.choices?.[0]?.message?.content);
                const parsed = parseAiJson(content);
                selector = parsed.selector; confidence = parsed.confidence; reasoning = parsed.reasoning; alternatives = parsed.alternatives || [];
                for (const sel of [selector, ...alternatives]) {
                  if (!sel) continue;
                  if (await runSemanticValidation(sel)) { selector = sel; validated = true; break; }
                }
              } catch (e) { reasoning = `AI Error: ${(e as Error).message}`; }
            }
            if (validated) break;
          }

          // 3. Semantic Fallback
          if (!validated && candidates.length > 0) {
            const semPrompt = `Which element matches "${description}"? Candidates: ${JSON.stringify(candidates.slice(0, 50).map(c => ({...c, rect: undefined})))}\nReturn JSON: { "index": number, "reasoning": "..." }`;
            try {
              const resp = await axios.post(aiProvider === 'gemini' ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${credentials.googleApiKey}` : (aiProvider === 'ollama' ? `${ollamaUrl}/api/chat` : (aiProvider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions')), (aiProvider === 'gemini' ? { contents: [{ parts: [{ text: semPrompt }] }] } : { model, messages: [{ role: 'user', content: semPrompt }], stream: false }), { headers: { Authorization: credentials.apiKey ? `Bearer ${credentials.apiKey}` : undefined, 'Content-Type': 'application/json' } });
              let content = aiProvider === 'gemini' ? resp.data.candidates?.[0]?.content?.parts?.[0]?.text : (aiProvider === 'ollama' ? resp.data.message?.content : resp.data.choices?.[0]?.message?.content);
              const p = parseAiJson(content);
              if (p.index !== undefined) {
                const t = candidates[p.index];
                const sel = constructRobustSelector(t);
                if (await page.$(sel)) { selector = sel; validated = true; reasoning = `Semantic match: ${p.reasoning}`; }
              }
            } catch {}
          }
        }
      } catch (e) { reasoning = `Execution Error: ${(e as Error).message}`; }
      finally { if (browser) await browser.close(); }
      results.push({ json: { ...session, elementDescription: description, findElementResult: { selector, confidence, reasoning, validated, aiStats } } });
    }
    return [results];
  }
}
