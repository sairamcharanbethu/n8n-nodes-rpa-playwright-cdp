export interface ResultItem {
  description: string;
  selector: string;
  validated: boolean;
  confidence: number;
  reasoning?: string;
  alternatives?: string[];
  aiRaw?: string;
  error?: string;

  // <-- Add this
  [key: string]: any;
}

export interface AISuggestion {
  selector: string;
  confidence: number;
  reasoning?: string;
}

export interface AIResponse {
  suggestions: AISuggestion[];
  raw: string;
}
