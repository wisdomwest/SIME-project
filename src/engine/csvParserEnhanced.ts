import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export interface Vertex {
  id: string;
  label: string;
  degree: number;
  inDegree: number;
  outDegree: number;
  betweenness: number;
  closeness: number;
  eigenvector: number;
  pagerank: number;
  clusteringCoefficient: number;
  cluster: number;
  clusterLabel: string;
  sentiment: 'Pos' | 'Neu' | 'Neg';
  followers: number;
  retweets: number;
  favorites: number;
  date: string;
  platform: string;
  topic: string;
  tweetText: string;
  hashtags: string[];
  isBot: boolean;
  botScore: number;
}

export interface Edge {
  source: string;
  target: string;
  weight: number;
  date: string;
  relation: string;
}

export interface GraphData {
  vertices: Vertex[];
  edges: Edge[];
  metrics: NetworkMetrics;
}

export interface NetworkMetrics {
  totalVertices: number;
  totalEdges: number;
  density: number;
  diameter: number;
  avgClusteringCoefficient: number;
  connectedComponents: number;
  reciprocity: number;
  avgDegree: number;
  sentimentDistribution: { Pos: number; Neu: number; Neg: number };
  topInfluencers: Vertex[];
  topBetweenness: Vertex[];
}

const NODEXL_COLUMN_MAP: Record<string, string[]> = {
  source: ['Vertex 1', 'Vertex1', 'Source', 'source', 'Twitter Screen Name', 'Screen Name', 'User', 'Author', 'From', 'Sender'],
  target: ['Vertex 2', 'Vertex2', 'Target', 'target', 'Mentioned', 'To', 'Recipient', 'Receiver'],
  tweetText: ['Tweet', 'Tweet / Text', 'Text', 'Content', 'Post', 'Message', 'Description', 'Body'],
  followers: ['Followers', 'Twitter Followers', 'Follower Count', 'User Followers'],
  retweets: ['Retweets', 'Retweet Count', 'RTs', 'Shares', 'Reposts'],
  favorites: ['Favorites', 'Likes', 'Favs', 'Favorite Count', 'Like Count'],
  betweenness: ['Betweenness Centrality', 'Betweenness', 'Betweenness Centrality (Raw)'],
  pagerank: ['PageRank', 'Page Rank', 'PageRank Centrality'],
  sentiment: ['Sentiment', 'Sentiment Score', 'SentimentLabel', 'Tone', 'Emotion'],
  date: ['Date', 'Tweet Date', 'Time', 'Published', 'Created At', 'Timestamp', 'UTC'],
  hashtags: ['Hashtags', 'Tags', 'Hashtag', 'Topics'],
  platform: ['Platform', 'Source', 'Device', 'App', 'Client'],
  topic: ['Topic', 'Category', 'Theme', 'Subject'],
};

function findColumn(headers: string[], key: string): string | null {
  const candidates = NODEXL_COLUMN_MAP[key] || [];
  for (const h of headers) {
    const hl = h.trim().toLowerCase();
    for (const c of candidates) {
      if (hl === c.toLowerCase()) return h;
    }
  }
  // Fuzzy match
  for (const h of headers) {
    const hl = h.trim().toLowerCase();
    for (const c of candidates) {
      if (hl.includes(c.toLowerCase()) || c.toLowerCase().includes(hl)) return h;
    }
  }
  return null;
}

function parseSentiment(val: unknown): 'Pos' | 'Neu' | 'Neg' {
  if (val === undefined || val === null || val === '') return 'Neu';
  const s = String(val).trim().toLowerCase();
  if (['pos', 'positive', 'good', 'happy', 'joy', 'love'].some(t => s.includes(t))) return 'Pos';
  if (['neg', 'negative', 'bad', 'angry', 'hate', 'sad'].some(t => s.includes(t))) return 'Neg';
  const n = parseFloat(String(val));
  if (!isNaN(n)) {
    if (n > 0.05) return 'Pos';
    if (n < -0.05) return 'Neg';
  }
  return 'Neu';
}

function extractHashtags(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/#[A-Za-z0-9_]+/g);
  return matches ? [...new Set(matches)] : [];
}

export async function parseNodeXLFile(file: File): Promise<GraphData> {
  if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
    return parseXLSXFile(file);
  }
  return parseCSVFile(file);
}

async function parseCSVFile(file: File): Promise<GraphData> {
  const text = await file.text();
  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: (results) => {
        try {
          resolve(processRows(results.data as Record<string, unknown>[]));
        } catch (e) { reject(e); }
      },
      error: (e: unknown) => reject(e),
    });
  });
}

async function parseXLSXFile(file: File): Promise<GraphData> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });

  // Check for NodeXL multi-sheet format (Edges + Vertices sheets)
  const hasEdges = workbook.SheetNames.includes('Edges');
  const hasVertices = workbook.SheetNames.includes('Vertices');

  if (hasEdges && hasVertices) {
    return parseNodeXLWorkbook(workbook);
  }

  // Single sheet fallback
  const firstSheet = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheet];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
  return processRows(rows);
}

function processRows(rows: Record<string, unknown>[]): GraphData {
  if (rows.length === 0) throw new Error('Empty file — no data rows found');

  const headers = Object.keys(rows[0]);
  return buildGraphFromRows(rows, headers);
}

// === NODEXL WORKBOOK PARSER (multi-sheet: Edges + Vertices) ===
function parseNodeXLWorkbook(workbook: XLSX.WorkBook): GraphData {
  // Parse Edges sheet
  const edgesSheet = workbook.Sheets['Edges'];
  const edgesRaw = XLSX.utils.sheet_to_json(edgesSheet, { header: 1 }) as unknown as unknown[][];

  // NodeXL has 2 header rows: Row 0 = category, Row 1 = column names, data starts Row 2
  let edgeHeaders: string[] = [];
  let edgeDataStart = 0;
  if (edgesRaw.length >= 2) {
    const row0 = edgesRaw[0];
    const row1 = edgesRaw[1];
    // Detect NodeXL 2-row header (first row contains category labels like "Visual Properties")
    const isNodeXL = row0.some((v: unknown) => String(v || '').includes('Visual') || String(v || '').includes('Graph Metrics'));
    if (isNodeXL) {
      edgeHeaders = row1.map((v: unknown) => String(v || '').trim());
      edgeDataStart = 2;
    } else {
      edgeHeaders = row0.map((v: unknown) => String(v || '').trim());
      edgeDataStart = 1;
    }
  }

  // Parse Vertices sheet
  const vertSheet = workbook.Sheets['Vertices'];
  const vertRaw = XLSX.utils.sheet_to_json(vertSheet, { header: 1 }) as unknown as unknown[][];

  let vertHeaders: string[] = [];
  let vertDataStart = 0;
  if (vertRaw.length >= 2) {
    const row0v = vertRaw[0];
    const row1v = vertRaw[1];
    const isNodeXL = row0v.some((v: unknown) => String(v || '').includes('Visual') || String(v || '').includes('Graph Metrics'));
    if (isNodeXL) {
      vertHeaders = row1v.map((v: unknown) => String(v || '').trim());
      vertDataStart = 2;
    } else {
      vertHeaders = row0v.map((v: unknown) => String(v || '').trim());
      vertDataStart = 1;
    }
  }

  // Build vertex map from Vertices sheet (has precomputed metrics)
  const vertexMap = new Map<string, Vertex>();
  const vertexColVal = (row: unknown[], hdr: string): string => {
    const idx = vertHeaders.findIndex((h: string) => h.toLowerCase() === hdr.toLowerCase());
    return idx >= 0 ? String(row[idx] || '').trim() : '';
  };
  const vertexColNum = (row: unknown[], hdr: string): number => {
    const idx = vertHeaders.findIndex((h: string) => h.toLowerCase() === hdr.toLowerCase());
    if (idx < 0) return 0;
    const v = parseFloat(String(row[idx] || '0'));
    return isNaN(v) ? 0 : v;
  };

  for (let i = vertDataStart; i < vertRaw.length; i++) {
    const row = vertRaw[i];
    if (!row || row.length === 0) continue;
    const name = vertexColVal(row, 'Vertex') || vertexColVal(row, 'Label') || vertexColVal(row, 'Name');
    if (!name) continue;

    vertexMap.set(name, {
      id: name,
      label: name,
      degree: vertexColNum(row, 'Degree'),
      inDegree: vertexColNum(row, 'In-Degree'),
      outDegree: vertexColNum(row, 'Out-Degree'),
      betweenness: vertexColNum(row, 'Betweenness Centrality'),
      closeness: vertexColNum(row, 'Closeness Centrality'),
      eigenvector: vertexColNum(row, 'Eigenvector Centrality'),
      pagerank: vertexColNum(row, 'PageRank'),
      clusteringCoefficient: vertexColNum(row, 'Clustering Coefficient'),
      cluster: -1,
      clusterLabel: '',
      sentiment: 'Neu',
      followers: vertexColNum(row, 'Followers'),
      retweets: vertexColNum(row, 'Tweets'),
      favorites: vertexColNum(row, 'Favourites Count'),
      date: vertexColVal(row, 'Joined Twitter Date (UTC)'),
      platform: 'Twitter',
      topic: 'RejectFinanceBill2024',
      tweetText: '',
      hashtags: [],
      isBot: false,
      botScore: 0,
    });
  }

  // Build edges from Edges sheet
  const edges: Edge[] = [];
  const edgeColVal = (row: unknown[], hdr: string): string => {
    const idx = edgeHeaders.findIndex((h: string) => h.toLowerCase() === hdr.toLowerCase());
    return idx >= 0 ? String(row[idx] || '').trim() : '';
  };

  for (let i = edgeDataStart; i < edgesRaw.length; i++) {
    const row = edgesRaw[i];
    if (!row || row.length === 0) continue;
    const v1 = edgeColVal(row, 'Vertex 1');
    const v2 = edgeColVal(row, 'Vertex 2');
    if (!v1 || !v2) continue;

    // Add target vertex if not already in the map
    if (!vertexMap.has(v1)) {
      vertexMap.set(v1, createEmptyVertex(v1));
    }
    if (!vertexMap.has(v2)) {
      vertexMap.set(v2, createEmptyVertex(v2));
    }

    edges.push({
      source: v1,
      target: v2,
      weight: 1,
      date: edgeColVal(row, 'Date') || edgeColVal(row, 'Relationship Date (UTC)') || '',
      relation: edgeColVal(row, 'Relationship') || 'mention',
    });

    const sv = vertexMap.get(v1)!;
    const tv = vertexMap.get(v2)!;
    sv.outDegree++;
    tv.inDegree++;
    sv.degree = sv.inDegree + sv.outDegree;
    tv.degree = tv.inDegree + tv.outDegree;
  }

  const vertices = Array.from(vertexMap.values());
  const posN = vertices.filter(v => v.sentiment === 'Pos').length;
  const neuN = vertices.filter(v => v.sentiment === 'Neu').length;
  const negN = vertices.filter(v => v.sentiment === 'Neg').length;

  return {
    vertices,
    edges,
    metrics: {
      totalVertices: vertices.length,
      totalEdges: edges.length,
      density: vertices.length > 1 ? (2 * edges.length) / (vertices.length * (vertices.length - 1)) : 0,
      diameter: 0, avgClusteringCoefficient: 0, connectedComponents: 1,
      reciprocity: 0,
      avgDegree: vertices.length > 0 ? vertices.reduce((s, v) => s + v.degree, 0) / vertices.length : 0,
      sentimentDistribution: { Pos: posN, Neu: neuN, Neg: negN },
      topInfluencers: [],
      topBetweenness: [],
    },
  };
}

function createEmptyVertex(id: string): Vertex {
  return {
    id, label: id,
    degree: 0, inDegree: 0, outDegree: 0,
    betweenness: 0, closeness: 0, eigenvector: 0, pagerank: 0,
    clusteringCoefficient: 0,
    cluster: -1, clusterLabel: '',
    sentiment: 'Neu',
    followers: 0, retweets: 0, favorites: 0,
    date: '', platform: '', topic: 'Uncategorized',
    tweetText: '', hashtags: [],
    isBot: false, botScore: 0,
  };
}

function buildGraphFromRows(rows: Record<string, unknown>[], headers: string[]): GraphData {
  const sourceCol = findColumn(headers, 'source');
  const targetCol = findColumn(headers, 'target');
  const tweetCol = findColumn(headers, 'tweetText');
  const followersCol = findColumn(headers, 'followers');
  const retweetsCol = findColumn(headers, 'retweets');
  const favsCol = findColumn(headers, 'favorites');
  const betweennessCol = findColumn(headers, 'betweenness');
  const pagerankCol = findColumn(headers, 'pagerank');
  const sentimentCol = findColumn(headers, 'sentiment');
  const dateCol = findColumn(headers, 'date');
  const hashtagsCol = findColumn(headers, 'hashtags');
  const platformCol = findColumn(headers, 'platform');
  const topicCol = findColumn(headers, 'topic');

  const vertexMap = new Map<string, Vertex>();
  const edges: Edge[] = [];

  for (const row of rows) {
    const source = sourceCol ? String(row[sourceCol] || '').trim() : '';
    const target = targetCol ? String(row[targetCol] || '').trim() : '';

    // If no target column, try to treat each row as a vertex only
    if (!source) continue;

    if (!vertexMap.has(source)) {
      const tweet = tweetCol ? String(row[tweetCol] || '') : '';
      vertexMap.set(source, {
        id: source,
        label: source,
        degree: 0, inDegree: 0, outDegree: 0,
        betweenness: betweennessCol ? parseFloat(String(row[betweennessCol] || '0')) || 0 : 0,
        closeness: 0,
        eigenvector: 0,
        pagerank: pagerankCol ? parseFloat(String(row[pagerankCol] || '0')) || 0 : 0,
        clusteringCoefficient: 0,
        cluster: -1,
        clusterLabel: '',
        sentiment: parseSentiment(sentimentCol ? row[sentimentCol] : undefined),
        followers: followersCol ? parseInt(String(row[followersCol] || '0')) || 0 : 0,
        retweets: retweetsCol ? parseInt(String(row[retweetsCol] || '0')) || 0 : 0,
        favorites: favsCol ? parseInt(String(row[favsCol] || '0')) || 0 : 0,
        date: dateCol ? String(row[dateCol] || '') : '',
        platform: platformCol ? String(row[platformCol] || '') : '',
        topic: topicCol ? String(row[topicCol] || '') : 'Uncategorized',
        tweetText: tweet,
        hashtags: hashtagsCol ? extractHashtags(String(row[hashtagsCol] || '')) : extractHashtags(tweet),
        isBot: false,
        botScore: 0,
      });
    }

    if (target) {
      if (!vertexMap.has(target)) {
        vertexMap.set(target, {
          id: target,
          label: target,
          degree: 0, inDegree: 0, outDegree: 0,
          betweenness: 0, closeness: 0, eigenvector: 0, pagerank: 0,
          clusteringCoefficient: 0,
          cluster: -1, clusterLabel: '',
          sentiment: 'Neu',
          followers: 0, retweets: 0, favorites: 0,
          date: '', platform: '', topic: 'Uncategorized',
          tweetText: '',
          hashtags: [],
          isBot: false, botScore: 0,
        });
      }
      edges.push({
        source,
        target,
        weight: retweetsCol ? (parseInt(String(row[retweetsCol] || '1')) || 1) : 1,
        date: dateCol ? String(row[dateCol] || '') : '',
        relation: 'mention',
      });
      vertexMap.get(source)!.outDegree++;
      vertexMap.get(target)!.inDegree++;
    }
  }

  const vertices = Array.from(vertexMap.values());
  vertices.forEach(v => { v.degree = v.inDegree + v.outDegree; });

  const posN = vertices.filter(v => v.sentiment === 'Pos').length;
  const neuN = vertices.filter(v => v.sentiment === 'Neu').length;
  const negN = vertices.filter(v => v.sentiment === 'Neg').length;

  const totalEdges = edges.length;
  const maxEdges = vertices.length * (vertices.length - 1);
  const density = totalEdges > 0 && maxEdges > 0 ? totalEdges / maxEdges : 0;

  return {
    vertices,
    edges,
    metrics: {
      totalVertices: vertices.length,
      totalEdges,
      density,
      diameter: 0,
      avgClusteringCoefficient: 0,
      connectedComponents: 1,
      reciprocity: 0,
      avgDegree: vertices.length > 0 ? vertices.reduce((s, v) => s + v.degree, 0) / vertices.length : 0,
      sentimentDistribution: { Pos: posN, Neu: neuN, Neg: negN },
      topInfluencers: [],
      topBetweenness: [],
    },
  };
}
