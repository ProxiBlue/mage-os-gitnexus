import fs from 'fs';
import path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { AugmentEdge, AugmentNode } from '../writer/lbug-writer.js';

export interface FrontendRoute {
  routeId: string;
  frontName: string;
  moduleName: string;
  area: string;
  sourceFile: string;
}

export interface RoutesMappingResult {
  edges: AugmentEdge[];
  nodes: AugmentNode[];
  stats: { resolved: number; skipped: number };
}

const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
};

function asArray(val: unknown): unknown[] {
  if (val === undefined || val === null) return [];
  if (Array.isArray(val)) return val;
  return [val];
}

export function parseSingleRoutesXml(
  xmlContent: string,
  sourceFile: string,
  area: string,
): FrontendRoute[] {
  const routes: FrontendRoute[] = [];

  let parsed: unknown;
  try {
    const parser = new XMLParser(parserOptions);
    parsed = parser.parse(xmlContent);
  } catch {
    return routes;
  }

  if (!parsed || typeof parsed !== 'object') return routes;

  const root = parsed as Record<string, unknown>;
  const config = root['config'] as Record<string, unknown> | undefined;
  if (!config) return routes;

  for (const routerNode of asArray(config['router'])) {
    const router = routerNode as Record<string, unknown>;

    for (const routeNode of asArray(router['route'])) {
      const route = routeNode as Record<string, unknown>;
      const routeId = route['@_id'] as string | undefined;
      const frontName = route['@_frontName'] as string | undefined;
      if (!routeId || !frontName) continue;

      for (const moduleNode of asArray(route['module'])) {
        const mod = moduleNode as Record<string, unknown>;
        const moduleName = mod['@_name'] as string | undefined;
        if (!moduleName) continue;

        routes.push({ routeId, frontName, moduleName, area, sourceFile });
      }
    }
  }

  return routes;
}

function findRoutesXmlFiles(dir: string, area: string): Array<{ file: string; area: string }> {
  const results: Array<{ file: string; area: string }> = [];

  function walk(current: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name === 'routes.xml') {
        const suffix = `etc/${area}/routes.xml`;
        if (full.endsWith(suffix)) {
          results.push({ file: full, area });
        }
      }
    }
  }

  walk(dir);
  return results;
}

export async function parseAndMapRoutesXml(projectRoot: string): Promise<RoutesMappingResult> {
  const edges: AugmentEdge[] = [];
  const nodes: AugmentNode[] = [];
  let resolved = 0;
  let skipped = 0;

  const searchDirs = [
    path.join(projectRoot, 'vendor'),
    path.join(projectRoot, 'app', 'code'),
  ];

  const areas = ['frontend', 'adminhtml'];
  const allFiles: Array<{ file: string; area: string }> = [];

  for (const searchDir of searchDirs) {
    if (!fs.existsSync(searchDir)) continue;
    for (const area of areas) {
      allFiles.push(...findRoutesXmlFiles(searchDir, area));
    }
  }

  const routeNodesSeen = new Set<string>();

  for (const { file, area } of allFiles) {
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf-8');
    } catch {
      skipped++;
      continue;
    }

    const relFile = path.relative(projectRoot, file);
    const routes = parseSingleRoutesXml(content, file, area);

    for (const route of routes) {
      const routeNodeId = `Route:${area}:${route.frontName}`;

      if (!routeNodesSeen.has(routeNodeId)) {
        nodes.push({
          label: 'Route',
          properties: {
            // GitNexus's Route schema only allows id/name/filePath/responseKeys/
            // errorKeys/middleware. Encode area + frontName into the display
            // name and keep filePath pointing at the routes.xml file.
            id: routeNodeId,
            name: `${area}:${route.frontName}`,
            filePath: relFile,
          },
        });
        routeNodesSeen.add(routeNodeId);
      }

      edges.push({
        sourceId: `File:${relFile}`,
        targetId: routeNodeId,
        type: 'HANDLES_ROUTE',
        confidence: 1.0,
        reason: 'magento:routes:controller',
      });
      resolved++;
    }
  }

  return { edges, nodes, stats: { resolved, skipped } };
}
