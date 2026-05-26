import fs from 'fs/promises';
import path from 'path';

export interface AugmentEdge {
  sourceId: string;   // e.g., "Class:vendor/.../Product.php:Product"
  targetId: string;   // e.g., "Interface:vendor/.../ProductInterface.php:ProductInterface"
  type: string;       // e.g., "IMPLEMENTS", "WRAPS", "CALLS"
  confidence: number; // 0-1, usually 1.0
  reason: string;     // e.g., "magento:di:preference"
}

export interface AugmentNode {
  label: string;      // e.g., "Route"
  properties: Record<string, unknown>;
}

export interface WriteResult {
  edgesInjected: number;
  edgesSkipped: number;
  edgesFailed: number;
  nodesCreated: number;
  nodesFailed: number;
}

export interface NodeWriteResult {
  created: number;
  failed: number;
}

const CSV_HEADER = '"from","to","type","confidence","reason","step"';

/**
 * Extract the label prefix from a node ID.
 * Node IDs have the format: "Label:path:name"
 */
export function extractLabel(nodeId: string): string {
  return nodeId.split(':')[0];
}

/**
 * Escape a single CSV field value (always quoted).
 * Internal double-quotes are escaped with backslash.
 */
export function escapeField(value: string | number): string {
  const str = String(value);
  const escaped = str.replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Build a CSV row for an edge.
 */
function edgeToCsvRow(edge: AugmentEdge): string {
  return [
    escapeField(edge.sourceId),
    escapeField(edge.targetId),
    escapeField(edge.type),
    escapeField(edge.confidence),
    escapeField(edge.reason),
    '""', // step — empty
  ].join(',');
}

/**
 * Generate CSV files split by source-target label pair.
 * Returns paths of written CSV files.
 */
export async function generateEdgeCsvFiles(
  edges: AugmentEdge[],
  csvDir: string,
): Promise<string[]> {
  if (edges.length === 0) return [];

  // Ensure csvDir exists — the orchestrator passes `<project>/.gitnexus/magento-csv`
  // which doesn't exist on a fresh run.
  await fs.mkdir(csvDir, { recursive: true });

  // Group edges by from-label → to-label
  const groups = new Map<string, AugmentEdge[]>();
  for (const edge of edges) {
    const fromLabel = extractLabel(edge.sourceId);
    const toLabel = extractLabel(edge.targetId);
    const key = `${fromLabel}_${toLabel}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(edge);
  }

  const files: string[] = [];

  for (const [key, group] of groups) {
    const filename = `rel_${key}.csv`;
    const csvPath = path.join(csvDir, filename);
    const rows = [CSV_HEADER, ...group.map(edgeToCsvRow)].join('\n') + '\n';
    await fs.writeFile(csvPath, rows, 'utf-8');
    files.push(csvPath);
  }

  return files;
}

/**
 * Delete all edges whose reason starts with 'magento:'.
 * Returns number of deleted edges (best-effort from DB response).
 */
export async function cleanupMagentoEdges(dbPath: string): Promise<number> {
  await runCypherQuery(
    dbPath,
    "MATCH ()-[r:CodeRelation]->() WHERE r.reason STARTS WITH 'magento:' DELETE r",
  );
  return 0; // count not returned by current CLI
}

/**
 * Write edges into the DB using CSV bulk COPY. Per-CSV-file failures (typically
 * caused by an unknown source/target label-pair) are non-fatal — the writer
 * counts the edges in the failed file as failed and continues with the others.
 */
export async function writeEdges(
  edges: AugmentEdge[],
  dbPath: string,
  csvDir: string,
): Promise<Pick<WriteResult, 'edgesInjected' | 'edgesSkipped' | 'edgesFailed'>> {
  if (edges.length === 0) {
    return { edgesInjected: 0, edgesSkipped: 0, edgesFailed: 0 };
  }

  const csvFiles = await generateEdgeCsvFiles(edges, csvDir);
  let injected = 0;
  let failed = 0;
  const failures: Array<{ pair: string; message: string; rowCount: number }> = [];

  for (const csvPath of csvFiles) {
    const base = path.basename(csvPath, '.csv'); // rel_Class_Interface
    const parts = base.split('_'); // ['rel', 'Class', 'Interface']
    const fromLabel = parts[1];
    const toLabel = parts[2];

    // Count rows in this CSV (excluding header) for accurate per-file accounting
    let rowCount = 0;
    try {
      const csvContent = await fs.readFile(csvPath, 'utf-8');
      rowCount = Math.max(0, csvContent.split('\n').filter((l: string) => l.trim().length > 0).length - 1);
    } catch {
      // ignore — we'll just lose this count
    }

    const query = `COPY CodeRelation FROM "${csvPath}" (from="${fromLabel}", to="${toLabel}", HEADER=true, ESCAPE='"', DELIM=',', QUOTE='"', PARALLEL=false, auto_detect=false)`;

    try {
      await runCypherQuery(dbPath, query);
      injected += rowCount;
    } catch (err) {
      failed += rowCount;
      failures.push({
        pair: `${fromLabel} → ${toLabel}`,
        rowCount,
        message: ((err as Error)?.message ?? String(err)).split('\n')[0],
      });
    }
  }

  if (failures.length > 0) {
    console.warn(`[lbug-writer] ${failures.length}/${csvFiles.length} edge-label-pair writes failed. Details:`);
    for (const f of failures.slice(0, 5)) {
      console.warn(`  - ${f.pair} (${f.rowCount} edges) → ${f.message}`);
    }
    if (failures.length > 5) {
      console.warn(`  ... and ${failures.length - 5} more pairs`);
    }
  }

  return { edgesInjected: injected, edgesSkipped: 0, edgesFailed: failed };
}

/**
 * Serialize a property object as a Cypher map literal:
 *   {key1: 'value1', key2: 42}
 *
 * Differs from `JSON.stringify` (which double-quotes property names) — Cypher
 * requires bare identifiers as keys. Earlier versions of this writer used
 * JSON.stringify and produced syntactically invalid Cypher.
 */
function cypherMapLiteral(props: Record<string, unknown>): string {
  const entries = Object.entries(props).map(([key, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid Cypher property name: ${key}`);
    }
    if (value === null || value === undefined) return `${key}: null`;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return `${key}: ${value}`;
    }
    const str = String(value);
    // Single-quoted string literal — escape backslashes and single quotes
    const escaped = str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `${key}: '${escaped}'`;
  });
  return `{${entries.join(', ')}}`;
}

/**
 * Write nodes into the DB via MERGE. Per-node failures are non-fatal —
 * the writer logs the first few and continues, returning a {created, failed}
 * tally so the orchestrator can include failures in its summary.
 *
 * Failures are typically schema mismatches (the lbug's node type doesn't allow
 * a property the augmenter is trying to set). Logging them surfaces upstream
 * schema drift without halting the rest of the write.
 */
export async function writeNodes(nodes: AugmentNode[], dbPath: string): Promise<NodeWriteResult> {
  if (nodes.length === 0) return { created: 0, failed: 0 };

  let created = 0;
  let failed = 0;
  const failures: Array<{ label: string; props: Record<string, unknown>; message: string }> = [];

  for (const node of nodes) {
    try {
      const propsLiteral = cypherMapLiteral(node.properties);
      const query = `MERGE (n:${node.label} ${propsLiteral})`;
      await runCypherQuery(dbPath, query);
      created++;
    } catch (err) {
      failed++;
      failures.push({
        label: node.label,
        props: node.properties,
        message: ((err as Error)?.message ?? String(err)).split('\n')[0],
      });
    }
  }

  if (failed > 0) {
    console.warn(`[lbug-writer] ${failed}/${nodes.length} node writes failed. First 3:`);
    for (const f of failures.slice(0, 3)) {
      console.warn(`  - ${f.label} ${JSON.stringify(f.props)} → ${f.message}`);
    }
    if (failures.length > 3) {
      console.warn(`  ... and ${failures.length - 3} more`);
    }
  }

  return { created, failed };
}

/**
 * Thin DB adapter — runs a Cypher query via the gitnexus lbug adapter.
 * Wrapped so tests can mock or skip.
 */
async function runCypherQuery(dbPath: string, query: string): Promise<void> {
  let mod;
  try {
    mod = await import(
      '/usr/local/lib/node_modules/gitnexus/dist/core/lbug/lbug-adapter.js'
    );
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    throw new Error(
      `lbug adapter not loadable (gitnexus must be installed globally): ${msg}`,
    );
  }
  // Don't swallow the actual lbug error — surface it so writer bugs are visible.
  await mod.withLbugDb(dbPath, async () => {
    try {
      await mod.executeQuery(query);
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      throw new Error(`lbug query failed: ${msg}\nQuery: ${query}`);
    }
  });
}

/**
 * Read-mode counterpart of runCypherQuery — returns the result rows.
 */
async function runCypherRead(dbPath: string, query: string): Promise<unknown[]> {
  let mod;
  try {
    mod = await import(
      '/usr/local/lib/node_modules/gitnexus/dist/core/lbug/lbug-adapter.js'
    );
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    throw new Error(
      `lbug adapter not loadable: ${msg}`,
    );
  }
  let rows: unknown[] = [];
  await mod.withLbugDb(dbPath, async () => {
    rows = await mod.executeQuery(query);
  });
  return rows;
}

/**
 * Pre-flight: filter `edges` to only those where BOTH endpoint node IDs
 * already exist in the lbug. Without this, ladybugdb's COPY rejects the
 * *whole* CSV when any single row violates the foreign-key constraint —
 * dropping thousands of valid edges because of one bad reference.
 *
 * Typical reason an endpoint is missing: the augmenter parsed XML from a
 * vendor package the lbug doesn't include (e.g. parsed all of vendor/ but
 * the lbug only indexed vendor/mage-os/). The skipped count is returned so
 * the orchestrator can surface it in the summary.
 */
export async function filterEdgesByExistingNodes(
  edges: AugmentEdge[],
  dbPath: string,
): Promise<{ kept: AugmentEdge[]; skipped: number }> {
  if (edges.length === 0) return { kept: [], skipped: 0 };

  // Collect unique IDs grouped by label
  const byLabel = new Map<string, Set<string>>();
  for (const edge of edges) {
    for (const id of [edge.sourceId, edge.targetId]) {
      const label = extractLabel(id);
      if (!byLabel.has(label)) byLabel.set(label, new Set());
      byLabel.get(label)!.add(id);
    }
  }

  // Query the lbug for which IDs exist (chunked to keep query strings sane)
  const CHUNK = 500;
  const existing = new Set<string>();
  for (const [label, idSet] of byLabel) {
    const ids = Array.from(idSet);
    for (let i = 0; i < ids.length; i += CHUNK) {
      const batch = ids.slice(i, i + CHUNK);
      // Escape single quotes for Cypher string literals
      const idList = batch.map((id) => `'${id.replace(/'/g, "\\'")}'`).join(', ');
      // Quote the label in case it collides with a reserved word
      const query = `MATCH (n:\`${label}\`) WHERE n.id IN [${idList}] RETURN n.id AS id`;
      try {
        const rows = (await runCypherRead(dbPath, query)) as Array<{ id: string }>;
        for (const row of rows) existing.add(row.id);
      } catch (err) {
        // Label might not exist in this lbug — skip gracefully
        const msg = (err as Error)?.message ?? String(err);
        if (!/does not exist|Cannot find/i.test(msg)) {
          console.warn(`[lbug-writer] node-existence probe for label "${label}" failed: ${msg.split('\n')[0]}`);
        }
      }
    }
  }

  const kept = edges.filter((e) => existing.has(e.sourceId) && existing.has(e.targetId));
  return { kept, skipped: edges.length - kept.length };
}
