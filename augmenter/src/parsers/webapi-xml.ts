import fs from 'fs';
import path from 'path';
import { XMLParser } from 'fast-xml-parser';

import { AugmentEdge, AugmentNode } from '../writer/lbug-writer.js';
import { parsePsr4Map } from '../resolvers/psr4-map.js';
import { NodeIdResolver } from '../resolvers/node-id.js';

export interface WebapiRoute {
  url: string;
  httpMethod: string;
  serviceClass: string;
  serviceMethod: string;
  sourceFile: string;
}

export interface WebapiMappingResult {
  edges: AugmentEdge[];
  nodes: AugmentNode[];
  stats: {
    resolved: number;
    skipped: number;
    unresolvedServices: string[];
  };
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

export function parseSingleWebapiXml(xmlContent: string, sourceFile: string): WebapiRoute[] {
  const routes: WebapiRoute[] = [];

  let parsed: unknown;
  try {
    const parser = new XMLParser(parserOptions);
    parsed = parser.parse(xmlContent);
  } catch {
    return routes;
  }

  if (!parsed || typeof parsed !== 'object') return routes;

  const root = parsed as Record<string, unknown>;
  const routesEl = root['routes'] as Record<string, unknown> | undefined;
  if (!routesEl) return routes;

  const routeList = asArray(routesEl['route']);
  for (const routeRaw of routeList) {
    const route = routeRaw as Record<string, unknown>;
    const url = route['@_url'] as string | undefined;
    const httpMethod = route['@_method'] as string | undefined;

    const serviceRaw = route['service'] as Record<string, unknown> | undefined;
    if (!serviceRaw) continue;

    const serviceClass = serviceRaw['@_class'] as string | undefined;
    const serviceMethod = serviceRaw['@_method'] as string | undefined;

    if (!url || !httpMethod || !serviceClass || !serviceMethod) continue;

    routes.push({ url, httpMethod, serviceClass, serviceMethod, sourceFile });
  }

  return routes;
}

async function findWebapiXmlFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

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
      } else if (entry.isFile() && entry.name === 'webapi.xml') {
        results.push(full);
      }
    }
  }

  walk(dir);
  return results;
}

export async function parseAndMapWebapiXml(projectRoot: string): Promise<WebapiMappingResult> {
  const edges: AugmentEdge[] = [];
  const nodes: AugmentNode[] = [];
  const unresolvedServices: string[] = [];
  let resolved = 0;
  let skipped = 0;

  const psr4Map = await parsePsr4Map(projectRoot);
  const resolver = new NodeIdResolver(psr4Map, projectRoot);

  const searchDirs = [
    path.join(projectRoot, 'vendor'),
    path.join(projectRoot, 'app', 'code'),
  ];

  for (const searchDir of searchDirs) {
    if (!fs.existsSync(searchDir)) continue;

    const files = await findWebapiXmlFiles(searchDir);
    for (const file of files) {
      let content: string;
      try {
        content = fs.readFileSync(file, 'utf-8');
      } catch {
        continue;
      }

      const routes = parseSingleWebapiXml(content, file);
      for (const route of routes) {
        // Build Route node
        const routeId = `Route:webapi:${route.httpMethod}:${route.url}`;
        const routeNode: AugmentNode = {
          label: 'Route',
          properties: {
            id: routeId,
            name: `${route.httpMethod} ${route.url}`,
            filePath: file,
          },
        };

        // Resolve service class to a File/Interface/Class node
        const nodeResolved = resolver.resolve(route.serviceClass);
        if (!nodeResolved) {
          unresolvedServices.push(route.serviceClass);
          skipped++;
          continue;
        }

        // Ensure Route node added (deduplicate by id)
        if (!nodes.find((n) => n.properties['id'] === routeId)) {
          nodes.push(routeNode);
        }

        // Edge: File → Route (lbug schema allows File/Function/Method → Route,
        // NOT Interface → Route. The resolver returns an Interface node ID for
        // service contracts like Magento\Quote\Api\CartManagementInterface, so
        // convert it to the corresponding File node ID by stripping the symbol
        // name from the tail of `Label:path:Name`.)
        const idParts = nodeResolved.nodeId.split(':');
        const filePath = idParts.length >= 3 ? idParts.slice(1, -1).join(':') : '';
        const fileNodeId = filePath ? `File:${filePath}` : nodeResolved.nodeId;

        const edge: AugmentEdge = {
          sourceId: fileNodeId,
          targetId: routeId,
          type: 'HANDLES_ROUTE',
          confidence: 1.0,
          reason: 'magento:webapi:route',
        };

        edges.push(edge);
        resolved++;
      }
    }
  }

  return {
    edges,
    nodes,
    stats: { resolved, skipped, unresolvedServices },
  };
}
