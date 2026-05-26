import { parseDiXml } from './di-xml.js';
import { parsePsr4Map } from '../resolvers/psr4-map.js';
import { NodeIdResolver } from '../resolvers/node-id.js';
import { AugmentEdge } from '../writer/lbug-writer.js';

export interface DiMappingResult {
  edges: AugmentEdge[];
  stats: {
    preferencesResolved: number;
    preferencesSkipped: number;
    pluginsResolved: number;
    pluginsSkipped: number;
    unresolvedFqcns: string[];
  };
}

export async function mapDiXmlEdges(projectRoot: string): Promise<DiMappingResult> {
  const [psr4Map, diResult] = await Promise.all([
    parsePsr4Map(projectRoot),
    parseDiXml(projectRoot),
  ]);

  const resolver = new NodeIdResolver(psr4Map, projectRoot);
  const edges: AugmentEdge[] = [];
  const unresolvedFqcns: string[] = [];

  let preferencesResolved = 0;
  let preferencesSkipped = 0;
  let pluginsResolved = 0;
  let pluginsSkipped = 0;

  // Map preferences → IMPLEMENTS edges
  for (const pref of diResult.preferences) {
    const sourceNode = resolver.resolve(pref.toType);
    const targetNode = resolver.resolve(pref.forType);

    const unresolved: string[] = [];
    if (!sourceNode) unresolved.push(pref.toType);
    if (!targetNode) unresolved.push(pref.forType);

    if (unresolved.length > 0) {
      for (const fqcn of unresolved) {
        console.warn(`[di-xml-mapper] unresolved FQCN: ${fqcn}`);
        unresolvedFqcns.push(fqcn);
      }
      preferencesSkipped++;
      continue;
    }

    edges.push({
      sourceId: sourceNode!.nodeId,
      targetId: targetNode!.nodeId,
      type: 'IMPLEMENTS',
      confidence: 1.0,
      reason: 'magento:di:preference',
    });
    preferencesResolved++;
  }

  // Map plugins → WRAPS edges
  for (const plug of diResult.plugins) {
    const sourceNode = resolver.resolve(plug.pluginType);
    const targetNode = resolver.resolve(plug.targetType);

    const unresolved: string[] = [];
    if (!sourceNode) unresolved.push(plug.pluginType);
    if (!targetNode) unresolved.push(plug.targetType);

    if (unresolved.length > 0) {
      for (const fqcn of unresolved) {
        console.warn(`[di-xml-mapper] unresolved FQCN: ${fqcn}`);
        unresolvedFqcns.push(fqcn);
      }
      pluginsSkipped++;
      continue;
    }

    edges.push({
      sourceId: sourceNode!.nodeId,
      targetId: targetNode!.nodeId,
      type: 'WRAPS',
      confidence: 1.0,
      reason: 'magento:di:plugin',
    });
    pluginsResolved++;
  }

  return {
    edges,
    stats: {
      preferencesResolved,
      preferencesSkipped,
      pluginsResolved,
      pluginsSkipped,
      unresolvedFqcns,
    },
  };
}
