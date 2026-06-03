import { Vertex, Edge } from './csvParserEnhanced';

export interface AIInsights {
  summary: string;
  keyNarratives: NarrativeTheme[];
  topEvents: TimelineEvent[];
  suspiciousAccounts: SuspiciousAccount[];
  platformBreakdown: PlatformStat[];
  hashtagTrends: HashtagStat[];
  botActivityScore: number;
  polarizationIndex: number;
}

export interface NarrativeTheme {
  theme: string;
  keywords: string[];
  postCount: number;
  dominantSentiment: string;
  examplePosts: string[];
}

export interface TimelineEvent {
  date: string;
  event: string;
  volume: number;
  significance: 'high' | 'medium' | 'low';
}

export interface SuspiciousAccount {
  id: string;
  label: string;
  score: number;
  reasons: string[];
}

export interface PlatformStat {
  platform: string;
  count: number;
  percentage: number;
}

export interface HashtagStat {
  hashtag: string;
  count: number;
  sentiment: string;
}

// === BOT / COORDINATED BEHAVIOUR DETECTION ===
function detectBots(vertices: Vertex[], edges: Edge[]): void {
  const edgeMap = new Map<string, number[]>(); // source -> [timestamps]
  for (const e of edges) {
    if (!edgeMap.has(e.source)) edgeMap.set(e.source, []);
    try {
      const ts = new Date(e.date).getTime();
      if (!isNaN(ts)) edgeMap.get(e.source)!.push(ts);
    } catch (_) {}
  }

  for (const v of vertices) {
    let score = 0;
    const reasons: string[] = [];

    // 1. High retweet-to-follower ratio
    if (v.followers > 0 && v.retweets / v.followers > 5) {
      score += 0.3;
      reasons.push('Very high retweet-to-follower ratio');
    }

    // 2. High out-degree with zero followers (broadcaster without audience)
    if (v.outDegree > 20 && v.followers === 0) {
      score += 0.25;
      reasons.push('High activity with zero followers (suspicious)');
    }

    // 3. Zero betweenness but high degree (doesn't bridge communities)
    if (v.degree > 10 && v.betweenness < 0.01) {
      score += 0.2;
      reasons.push('High degree, low betweenness (amplification pattern)');
    }

    // 4. Timing pattern: very regular intervals
    const timestamps = edgeMap.get(v.id) || [];
    if (timestamps.length > 5) {
      timestamps.sort((a, b) => a - b);
      const intervals: number[] = [];
      for (let i = 1; i < timestamps.length; i++) {
        intervals.push(timestamps[i] - timestamps[i - 1]);
      }
      if (intervals.length > 0) {
        const avg = intervals.reduce((s, x) => s + x, 0) / intervals.length;
        const variance = intervals.reduce((s, x) => s + (x - avg) ** 2, 0) / intervals.length;
        const cv = Math.sqrt(variance) / avg;
        if (cv < 0.3 && intervals.length > 5) {
          score += 0.25;
          reasons.push('Abnormally regular posting pattern (possible automation)');
        }
      }
    }

    // 5. No tweet text (anonymous)
    if (!v.tweetText || v.tweetText.trim().length === 0) {
      score += 0.1;
      reasons.push('No content text (blank account)');
    }

    v.botScore = Math.min(score, 1.0);
    v.isBot = v.botScore > 0.5;
  }
}

// === NARRATIVE / THEME DETECTION via TF-IDF ===
function detectNarratives(vertices: Vertex[]): NarrativeTheme[] {
  const docs = vertices
    .filter(v => v.tweetText && v.tweetText.trim().length > 20)
    .map(v => ({ id: v.id, text: v.tweetText.toLowerCase(), sentiment: v.sentiment }));

  if (docs.length < 3) return [];

  // Build vocabulary from top bigrams
  const bigramCounts = new Map<string, number>();
  for (const doc of docs) {
    const words = doc.text.split(/\s+/).filter(w => w.length > 3 && !isStopWord(w));
    for (let i = 0; i < words.length - 1; i++) {
      const bigram = `${words[i]} ${words[i + 1]}`;
      bigramCounts.set(bigram, (bigramCounts.get(bigram) || 0) + 1);
    }
  }

  // Top bigrams as themes
  const topBigrams = [...bigramCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const themes: NarrativeTheme[] = topBigrams.map(([bigram, count]) => {
    const matchingDocs = docs.filter(d => d.text.includes(bigram));
    const sentiments = matchingDocs.map(d => d.sentiment);
    const posCount = sentiments.filter(s => s === 'Pos').length;
    const negCount = sentiments.filter(s => s === 'Neg').length;
    const domSentiment = posCount > negCount ? 'Positive' : negCount > posCount ? 'Negative' : 'Neutral';

    return {
      theme: bigram,
      keywords: bigram.split(' '),
      postCount: count,
      dominantSentiment: domSentiment,
      examplePosts: matchingDocs.slice(0, 2).map(d => d.text),
    };
  });

  return themes;
}

// === TIMELINE EVENT DETECTION ===
function detectTimelineEvents(vertices: Vertex[]): TimelineEvent[] {
  const dateCounts = new Map<string, number>();
  for (const v of vertices) {
    if (!v.date) continue;
    const date = v.date.split('T')[0].split(' ')[0]; // YYYY-MM-DD
    dateCounts.set(date, (dateCounts.get(date) || 0) + 1);
  }

  const entries = [...dateCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (entries.length === 0) return [];

  const avgVolume = entries.reduce((s, [_, c]) => s + c, 0) / entries.length;

  return entries.map(([date, count]) => ({
    date,
    event: count > avgVolume * 2 ? `Spike in activity (${count} posts)` : `${count} posts`,
    volume: count,
    significance: count > avgVolume * 2.5 ? 'high' : count > avgVolume * 1.5 ? 'medium' : 'low',
  }));
}

// === PLATFORM BREAKDOWN ===
function platformBreakdown(vertices: Vertex[]): PlatformStat[] {
  const counts = new Map<string, number>();
  for (const v of vertices) {
    const p = v.platform || 'Unknown';
    counts.set(p, (counts.get(p) || 0) + 1);
  }
  const total = vertices.length || 1;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([platform, count]) => ({
      platform,
      count,
      percentage: Math.round((count / total) * 100),
    }));
}

// === HASHTAG TRENDS ===
function hashtagTrends(vertices: Vertex[]): HashtagStat[] {
  const counts = new Map<string, { count: number; sentiments: string[] }>();
  for (const v of vertices) {
    for (const tag of v.hashtags) {
      if (!counts.has(tag)) counts.set(tag, { count: 0, sentiments: [] });
      const entry = counts.get(tag)!;
      entry.count++;
      entry.sentiments.push(v.sentiment);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 15)
    .map(([hashtag, { count, sentiments }]) => {
      const posCount = sentiments.filter(s => s === 'Pos').length;
      const negCount = sentiments.filter(s => s === 'Neg').length;
      const domSent = posCount > negCount ? 'Positive' : negCount > posCount ? 'Negative' : 'Neutral';
      return { hashtag, count, sentiment: domSent };
    });
}

// === POLARIZATION INDEX ===
function computePolarization(vertices: Vertex[]): number {
  const posRatio = vertices.filter(v => v.sentiment === 'Pos').length / Math.max(vertices.length, 1);
  const negRatio = vertices.filter(v => v.sentiment === 'Neg').length / Math.max(vertices.length, 1);
  // High polarization = mostly positive OR mostly negative, not mixed
  return Math.abs(posRatio - negRatio);
}

// === AUTO-GENERATED SUMMARY ===
function generateSummary(vertices: Vertex[], edges: Edge[], themes: NarrativeTheme[], bots: number): string {
  const totalV = vertices.length;
  const totalE = edges.length;
  const topNode = [...vertices].sort((a, b) => b.degree - a.degree)[0];
  const posPct = Math.round((vertices.filter(v => v.sentiment === 'Pos').length / Math.max(totalV, 1)) * 100);
  const themeStr = themes.slice(0, 3).map(t => t.theme).join(', ');

  return `This dataset contains ${totalV} accounts and ${totalE} connections across the network. ` +
    `The conversation is ${posPct}% positive overall. ` +
    (topNode ? `The most connected account is @${topNode.label} with ${topNode.degree} connections. ` : '') +
    (themeStr ? `Key discussion themes include: ${themeStr}. ` : '') +
    (bots > 0 ? `${bots} accounts show suspicious activity patterns consistent with automated or coordinated behaviour. ` : '') +
    `The network density is ${totalV > 1 ? ((2 * totalE) / (totalV * (totalV - 1))).toFixed(4) : 'N/A'}, indicating ${totalE > totalV * 2 ? 'a highly interconnected' : 'a loosely connected'} conversation.`;
}

// === MAIN EXPORT ===
export function analyzeAI(vertices: Vertex[], edges: Edge[]): AIInsights {
  detectBots(vertices, edges);
  const narratives = detectNarratives(vertices);
  const events = detectTimelineEvents(vertices);
  const platforms = platformBreakdown(vertices);
  const hashtags = hashtagTrends(vertices);
  const polIndex = computePolarization(vertices);
  const botCount = vertices.filter(v => v.isBot).length;
  const summary = generateSummary(vertices, edges, narratives, botCount);

  return {
    summary,
    keyNarratives: narratives,
    topEvents: events.slice(-10),
    suspiciousAccounts: vertices
      .filter(v => v.isBot)
      .slice(0, 5)
      .map(v => ({
        id: v.id,
        label: v.label,
        score: v.botScore,
        reasons: [v.botScore > 0.5 ? 'High automation score' : 'Moderate suspicion'],
      })),
    platformBreakdown: platforms,
    hashtagTrends: hashtags,
    botActivityScore: vertices.length > 0 ? botCount / vertices.length : 0,
    polarizationIndex: polIndex,
  };
}

function isStopWord(word: string): boolean {
  const stops = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'are',
    'was', 'not', 'but', 'you', 'all', 'can', 'had', 'her', 'his',
    'its', 'our', 'out', 'has', 'been', 'were', 'they', 'their', 'will',
    'about', 'what', 'when', 'where', 'which', 'would', 'could', 'should',
    'http', 'https', 'co', 'com', 'just', 'like', 'dont', 'amp', 'via'
  ]);
  return stops.has(word);
}
