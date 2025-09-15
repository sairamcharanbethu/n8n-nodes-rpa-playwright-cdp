import type { AISuggestion, AIResponse } from '../types';
import { safeJsonParse } from '../utils';
import axios from 'axios';

export async function callAIProvider(
  provider: 'openai' | 'openrouter' | 'gemini',
  apiKey: string,
  model: string,
  prompt: string
): Promise<AIResponse> {
  let apiUrl = '';
  let headers: any = {};
  let body: any = {};
  let raw = '';

  if (provider === 'openai') {
    apiUrl = 'https://api.openai.com/v1/chat/completions';
    headers = { Authorization: `Bearer ${apiKey}` };
    body = {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 400,
    };

    const response = await axios.post(apiUrl, body, { headers });
    raw = response.data?.choices?.[0]?.message?.content?.trim() || '';

  } else if (provider === 'openrouter') {
    apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
    headers = { Authorization: `Bearer ${apiKey}` };
    body = {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 400,
    };

    const response = await axios.post(apiUrl, body, { headers });
    raw = response.data?.choices?.[0]?.message?.content?.trim() || '';

  } else if (provider === 'gemini') {
    apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    headers = { 'Content-Type': 'application/json' };
    body = { contents: [{ parts: [{ text: prompt }] }] };

    const response = await axios.post(apiUrl, body, { headers });
    raw = response.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  } else {
    throw new Error(`Provider not implemented: ${provider}`);
  }

  // Parse JSON safely
  const parsed = safeJsonParse<{ suggestions: AISuggestion[] }>(raw, { suggestions: [] });

  return { suggestions: parsed.suggestions, raw };
}
