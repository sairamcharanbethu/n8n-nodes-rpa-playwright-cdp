export class NeuralHeuristic {
  private static instance: NeuralHeuristic;

  private constructor() {}

  public static getInstance(): NeuralHeuristic {
    if (!NeuralHeuristic.instance) {
      NeuralHeuristic.instance = new NeuralHeuristic();
    }
    return NeuralHeuristic.instance;
  }

  public async init() {
    // Disabled due to n8n crashing issues with native dependencies
    return;
  }

  public async getEmbedding(text: string): Promise<number[]> {
    return [];
  }

  public cosineSimilarity(vecA: number[], vecB: number[]): number {
    return 0;
  }
}

export const neuralHeuristic = NeuralHeuristic.getInstance();
