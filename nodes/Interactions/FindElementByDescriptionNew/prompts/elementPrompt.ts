export function buildElementPrompt(description: string, domSnippet: string) {
  return `
You are an expert web automation assistant. Your task is to generate the best CSS selectors for the described element.

Description: "${description}"
HTML Snippet:
${domSnippet}

Requirements:
- Respond ONLY with valid JSON using this schema:
{
  "suggestions": [
    { "selector": string, "confidence": number, "reasoning": string }
  ]
}
- Provide 1–3 suggestions.
- Confidence must be 0–1.
- Selectors MUST exist in the provided HTML and must work with Playwright tool.
- Do not include any text outside the JSON (no markdown, no explanation).

Example:
{
  "suggestions": [
    { "selector": "#submitBtn", "confidence": 0.9, "reasoning": "Unique ID button" }
  ]
}
`;
}
