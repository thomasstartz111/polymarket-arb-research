/**
 * Semantic Embeddings for Market Correlation
 *
 * Uses transformers.js to generate sentence embeddings locally.
 * Enables finding semantically similar markets without API costs.
 */

import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';

let embedder: FeatureExtractionPipeline | null = null;
let isLoading = false;

/**
 * Initialize the embedding model (lazy load)
 */
export async function initEmbedder(): Promise<FeatureExtractionPipeline> {
  if (embedder) return embedder;

  if (isLoading) {
    // Wait for existing load to complete
    while (isLoading) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return embedder!;
  }

  isLoading = true;
  console.log('🧠 Loading sentence embedding model...');

  try {
    // Use a small, fast model for sentence embeddings
    // all-MiniLM-L6-v2 is ~80MB and very fast
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true, // Use quantized model for speed
    });
    console.log('✅ Embedding model loaded');
    return embedder;
  } finally {
    isLoading = false;
  }
}

/**
 * Generate embedding for a single text
 */
export async function embed(text: string): Promise<number[]> {
  const model = await initEmbedder();
  const output = await model(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data as Float32Array);
}

/**
 * Generate embeddings for multiple texts (batched)
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const model = await initEmbedder();
  const embeddings: number[][] = [];

  // Process in batches of 32 for efficiency
  const batchSize = 32;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const outputs = await Promise.all(
      batch.map(async (text) => {
        const output = await model(text, { pooling: 'mean', normalize: true });
        return Array.from(output.data as Float32Array);
      })
    );
    embeddings.push(...outputs);
  }

  return embeddings;
}

/**
 * Compute cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Find similar items using cosine similarity
 */
export function findSimilar(
  queryEmbedding: number[],
  embeddings: number[][],
  threshold = 0.75
): { index: number; similarity: number }[] {
  const results: { index: number; similarity: number }[] = [];

  for (let i = 0; i < embeddings.length; i++) {
    const similarity = cosineSimilarity(queryEmbedding, embeddings[i]);
    if (similarity >= threshold) {
      results.push({ index: i, similarity });
    }
  }

  return results.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Cluster items by semantic similarity
 * Uses simple greedy clustering
 */
export function clusterBySimilarity(
  embeddings: number[][],
  threshold = 0.80
): number[][] {
  const n = embeddings.length;
  const visited = new Set<number>();
  const clusters: number[][] = [];

  for (let i = 0; i < n; i++) {
    if (visited.has(i)) continue;

    // Start new cluster
    const cluster = [i];
    visited.add(i);

    // Find all similar items
    for (let j = i + 1; j < n; j++) {
      if (visited.has(j)) continue;

      const similarity = cosineSimilarity(embeddings[i], embeddings[j]);
      if (similarity >= threshold) {
        cluster.push(j);
        visited.add(j);
      }
    }

    if (cluster.length >= 2) {
      clusters.push(cluster);
    }
  }

  return clusters;
}

export interface MarketCluster {
  markets: Array<{
    id: string;
    question: string;
    priceYes: number;
  }>;
  avgSimilarity: number;
}

/**
 * Cluster markets by question similarity
 */
export async function clusterMarkets(
  markets: Array<{ id: string; question: string; priceYes: number }>,
  threshold = 0.80
): Promise<MarketCluster[]> {
  if (markets.length === 0) return [];

  console.log(`🧠 Embedding ${markets.length} market questions...`);
  const questions = markets.map((m) => m.question);
  const embeddings = await embedBatch(questions);

  console.log(`🔗 Clustering by similarity (threshold: ${threshold})...`);
  const clusterIndices = clusterBySimilarity(embeddings, threshold);

  const clusters: MarketCluster[] = clusterIndices.map((indices) => {
    const clusterMarkets = indices.map((i) => markets[i]);

    // Calculate average pairwise similarity
    let totalSimilarity = 0;
    let pairs = 0;
    for (let i = 0; i < indices.length; i++) {
      for (let j = i + 1; j < indices.length; j++) {
        totalSimilarity += cosineSimilarity(
          embeddings[indices[i]],
          embeddings[indices[j]]
        );
        pairs++;
      }
    }

    return {
      markets: clusterMarkets,
      avgSimilarity: pairs > 0 ? totalSimilarity / pairs : 1,
    };
  });

  console.log(`✅ Found ${clusters.length} market clusters`);
  return clusters;
}
