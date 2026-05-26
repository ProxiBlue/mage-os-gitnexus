import path from 'path';
import fs from 'fs/promises';

import { mapDiXmlEdges } from './parsers/di-xml-mapper.js';
import { mapLayoutXmlEdges } from './parsers/layout-xml-mapper.js';
import { parseAndMapEventsXml } from './parsers/events-xml.js';
import { parseAndMapWebapiXml } from './parsers/webapi-xml.js';
import { parseAndMapRoutesXml } from './parsers/routes-xml.js';
import {
  cleanupMagentoEdges,
  filterEdgesByExistingNodes,
  writeEdges,
  writeNodes,
  AugmentEdge,
  AugmentNode,
} from './writer/lbug-writer.js';

/**
 * Run a single augmentation phase under best-effort error handling. A parser
 * bug or transient failure in one phase logs a warning and contributes zero
 * edges/nodes — the rest of the augmentation continues. Returns null on
 * failure so the caller can skip aggregating its result.
 */
async function runPhase<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    console.warn(`[augment] Phase "${name}" failed (non-fatal): ${msg}`);
    return null;
  }
}

export async function augment(projectPath: string): Promise<void> {
  const absPath = path.resolve(projectPath);

  // 1. Verify GitNexus index exists
  const lbugPath = path.join(absPath, '.gitnexus', 'lbug');
  try {
    await fs.access(lbugPath);
  } catch {
    throw new Error(`.gitnexus/lbug not found at ${absPath}. Run 'gitnexus analyze' first.`);
  }

  // 2. Verify Magento project
  const autoloadPath = path.join(absPath, 'vendor', 'composer', 'autoload_psr4.php');
  try {
    await fs.access(autoloadPath);
  } catch {
    throw new Error(`vendor/composer/autoload_psr4.php not found. Is ${absPath} a Magento project?`);
  }

  const dbPath = lbugPath;
  const csvDir = path.join(absPath, '.gitnexus', 'magento-csv');

  console.log(`Augmenting GitNexus graph for: ${absPath}`);

  // 5. Clean up previous magento edges — best-effort; if the lbug has a schema
  // mismatch on the DELETE it shouldn't kill the augmentation.
  await runPhase('cleanup', () => cleanupMagentoEdges(dbPath));
  console.log('Cleaned up previous magento edges.');

  const allEdges: AugmentEdge[] = [];
  const allNodes: AugmentNode[] = [];

  // 6a. di.xml → preferences + plugins
  console.log('Phase 1: di.xml (preferences + plugins)...');
  const diResult = await runPhase('di.xml', () => mapDiXmlEdges(absPath));
  if (diResult) {
    allEdges.push(...diResult.edges);
    const { preferencesResolved, preferencesSkipped, pluginsResolved, pluginsSkipped } = diResult.stats;
    console.log(
      `  di.xml: ${preferencesResolved} preferences, ${pluginsResolved} plugins` +
      ` (skipped: ${preferencesSkipped + pluginsSkipped})`,
    );
  }

  // 6b. Layout XML → block→template
  console.log('Phase 2: layout XML (block→template)...');
  const layoutResult = await runPhase('layout-xml', () => mapLayoutXmlEdges(absPath));
  if (layoutResult) {
    allEdges.push(...layoutResult.edges);
    console.log(
      `  layout XML: ${layoutResult.stats.resolved} edges` +
      ` (skipped: ${layoutResult.stats.skippedNoClass + layoutResult.stats.skippedNoTemplate})`,
    );
  }

  // 6c. events.xml → observers
  console.log('Phase 3: events.xml (observers)...');
  const eventsResult = await runPhase('events.xml', () => parseAndMapEventsXml(absPath));
  if (eventsResult) {
    allEdges.push(...eventsResult.edges);
    console.log(
      `  events.xml: ${eventsResult.stats.resolved} edges (skipped: ${eventsResult.stats.skipped})`,
    );
  }

  // 6d. webapi.xml → REST routes (has nodes too)
  console.log('Phase 4: webapi.xml (REST routes)...');
  const webapiResult = await runPhase('webapi.xml', () => parseAndMapWebapiXml(absPath));
  if (webapiResult) {
    allEdges.push(...webapiResult.edges);
    allNodes.push(...webapiResult.nodes);
    console.log(
      `  webapi.xml: ${webapiResult.stats.resolved} edges (skipped: ${webapiResult.stats.skipped})`,
    );
  }

  // 6e. routes.xml → frontend routes (has nodes too)
  console.log('Phase 5: routes.xml (frontend routes)...');
  const routesResult = await runPhase('routes.xml', () => parseAndMapRoutesXml(absPath));
  if (routesResult) {
    allEdges.push(...routesResult.edges);
    allNodes.push(...routesResult.nodes);
    console.log(
      `  routes.xml: ${routesResult.stats.resolved} edges (skipped: ${routesResult.stats.skipped})`,
    );
  }

  // 7. Write all nodes first. Per-node failures are already captured inside
  // writeNodes (returns {created, failed} and logs the first failures).
  const nodeResult = (await runPhase('write-nodes', () => writeNodes(allNodes, dbPath))) ?? {
    created: 0,
    failed: allNodes.length,
  };

  // 7.5. Pre-flight: drop edges whose source or target node doesn't exist in
  // the lbug. ladybugdb's bulk COPY rejects the entire CSV on any FK miss,
  // so a single dangling reference would kill thousands of valid edges.
  // Typical cause: augmenter parsed XML from a vendor package outside this
  // lbug's indexed scope (e.g. project-wide XML, mageos-only lbug).
  const filterResult = (await runPhase('filter-existing-nodes', () =>
    filterEdgesByExistingNodes(allEdges, dbPath),
  )) ?? { kept: allEdges, skipped: 0 };
  const filteredEdges = filterResult.kept;
  if (filterResult.skipped > 0) {
    console.log(
      `[augment] Pre-flight: ${filterResult.skipped} edges skipped (one or both endpoint nodes not in lbug); ${filteredEdges.length} kept.`,
    );
  }

  // 8. Write filtered edges. Per-CSV-pair failures are captured inside writeEdges.
  const writeResult = (await runPhase('write-edges', () => writeEdges(filteredEdges, dbPath, csvDir))) ?? {
    edgesInjected: 0,
    edgesSkipped: filterResult.skipped,
    edgesFailed: filteredEdges.length,
  };
  // Carry through the pre-flight skip count in the summary
  writeResult.edgesSkipped = (writeResult.edgesSkipped ?? 0) + filterResult.skipped;

  // 9. Print summary — never throws; runs even if phases above failed.
  const anyFailures = nodeResult.failed > 0 || writeResult.edgesFailed > 0;
  console.log('\n--- Augmentation Summary ---');
  console.log(`  Nodes created:   ${nodeResult.created}`);
  if (nodeResult.failed > 0) console.log(`  Nodes failed:    ${nodeResult.failed}`);
  console.log(`  Edges injected:  ${writeResult.edgesInjected}`);
  if (writeResult.edgesFailed > 0) console.log(`  Edges failed:    ${writeResult.edgesFailed}`);
  console.log(
    anyFailures
      ? 'Augmentation completed with warnings (see [lbug-writer] / [augment] lines above).'
      : 'Augmentation complete.',
  );

  // 10. Clean up csvDir
  try {
    await fs.rm(csvDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}
