import { DataStore } from '../data/store';
import { Policy } from '../types';

export class PolicyRetriever {
  constructor(private store: DataStore) {}

  async retrieve(query: string, _topK: number = 3): Promise<Policy[]> {
    // In mock mode: keyword-based search (implemented in MockDataStore)
    // In prod mode: embed the query with OpenAI, then pgvector cosine similarity
    return this.store.searchPolicies(query);
  }

  formatContext(policies: Policy[]): string {
    if (policies.length === 0) {
      return 'No relevant policy documents found.';
    }

    return policies
      .map((p, i) => `[Source ${i + 1}: ${p.title}]\n${p.body}`)
      .join('\n\n---\n\n');
  }
}
