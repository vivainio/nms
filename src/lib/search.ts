/**
 * Item search: exact/prefix/substring/subsequence matching with ranking.
 *
 * 3,769 names is small enough to scan linearly on every keystroke, so there is
 * no index to keep in sync - we just precompute the lowercased names once.
 */

import type { Db } from './db';

export interface SearchHit {
  idx: number;
  score: number;
}

export interface SearchOptions {
  /** Restrict to these category keys; empty/undefined means all. */
  categories?: Set<string>;
  limit?: number;
}

const enum Score {
  Exact = 1000,
  Prefix = 500,
  WordStart = 300,
  Substring = 150,
  Subsequence = 40,
}

/** Case-insensitive subsequence test: "ntm" matches "NaniTe Metal". */
function subsequence(needle: string, hay: string): boolean {
  let n = 0;
  for (let h = 0; h < hay.length && n < needle.length; h++) {
    if (hay[h] === needle[n]) n++;
  }
  return n === needle.length;
}

export class SearchIndex {
  private readonly lower: string[];

  constructor(private readonly db: Db) {
    this.lower = new Array(db.count);
    for (let i = 0; i < db.count; i++) this.lower[i] = db.name(i).toLowerCase();
  }

  search(query: string, opts: SearchOptions = {}): SearchHit[] {
    const q = query.trim().toLowerCase();
    const { categories, limit = 200 } = opts;
    const hits: SearchHit[] = [];

    for (let i = 0; i < this.db.count; i++) {
      if (categories?.size && !categories.has(this.db.catKey(i))) continue;

      if (!q) {
        hits.push({ idx: i, score: 0 });
        continue;
      }

      const name = this.lower[i];
      let score: number;

      if (name === q) {
        score = Score.Exact;
      } else if (name.startsWith(q)) {
        score = Score.Prefix;
      } else {
        const at = name.indexOf(q);
        if (at > 0) {
          // Prefer matches that start a word over ones mid-word.
          score = name[at - 1] === ' ' ? Score.WordStart : Score.Substring;
        } else if (q.length >= 3 && subsequence(q, name)) {
          score = Score.Subsequence;
        } else {
          continue;
        }
      }

      // Nudge shorter names up: "Carbon" should beat "Condensed Carbon".
      hits.push({ idx: i, score: score - Math.min(name.length, 60) / 100 });
    }

    hits.sort(
      (a, b) =>
        b.score - a.score || this.lower[a.idx].localeCompare(this.lower[b.idx]),
    );
    return hits.length > limit ? hits.slice(0, limit) : hits;
  }
}
