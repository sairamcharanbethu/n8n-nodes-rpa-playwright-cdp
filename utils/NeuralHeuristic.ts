import { pipeline, env } from '@xenova/transformers';

// Configure environment for local usage
env.allowLocalModels = false;
env.useBrowserCache = false;

export class NeuralHeuristic {
  private static instance: NeuralHeuristic;
  private extractor: any = null;
  private isInitializing = false;

  private constructor() {}

  public static getInstance(): NeuralHeuristic {
    if (!NeuralHeuristic.instance) {
      NeuralHeuristic.instance = new NeuralHeuristic();
    }
    return NeuralHeuristic.instance;
  }

  public async init() {
    if (this.extractor || this.isInitializing) return;
    this.isInitializing = true;
    try {
      // Load a small, efficient model for feature extraction (embeddings)
      this.extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    } catch (e) {
      console.error('Failed to initialize Neural Heuristic:', e);
    } finally {
      this.isInitializing = false;
    }
  }

  public async getEmbedding(text: string): Promise<number[]> {
    if (!this.extractor) await this.init();
    if (!this.extractor) return [];

    try {
      const output = await this.extractor(text, { pooling: 'mean', normalize: true });
      return Array.from(output.data);
    } catch (e) {
      console.error('Embedding error:', e);
      return [];
    }
  }

  public cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length || vecA.length === 0) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}

export const neuralHeuristic = NeuralHeuristic.getInstance();
