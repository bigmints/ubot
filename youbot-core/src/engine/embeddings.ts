import type OpenAI from 'openai';

/**
 * Utility class for generating vector embeddings
 */
export class EmbeddingPipeline {
  
  /**
   * Generates a vector embedding for the given text using the provided OpenAI-compatible client.
   * Works natively with Gemini (`text-embedding-004`) via the OpenAI compatibility API.
   */
  static async generateEmbedding(client: OpenAI, model: string, text: string): Promise<number[]> {
    try {
      const response = await client.embeddings.create({
        model: model,
        input: text,
        encoding_format: 'float'
      });
      
      const embedding = response.data[0]?.embedding;
      if (!embedding) {
        throw new Error('No embedding returned from API');
      }

      return embedding;
    } catch (err: any) {
      console.error(`[EmbeddingPipeline] Failed to generate embedding with model ${model}:`, err.message);
      throw err;
    }
  }

  /**
   * Generates embeddings in batch for multiple texts
   */
  static async generateEmbeddingsBatch(client: OpenAI, model: string, texts: string[]): Promise<number[][]> {
    try {
      const response = await client.embeddings.create({
        model: model,
        input: texts,
        encoding_format: 'float'
      });
      
      return response.data.map(item => item.embedding);
    } catch (err: any) {
      console.error(`[EmbeddingPipeline] Failed to generate batch embeddings with model ${model}:`, err.message);
      throw err;
    }
  }
}
