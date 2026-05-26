import fs from 'fs';
import path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { AugmentEdge } from '../writer/lbug-writer.js';
import { NodeIdResolver } from '../resolvers/node-id.js';
import { parsePsr4Map } from '../resolvers/psr4-map.js';

export interface EventObserver {
  eventName: string;
  observerName: string;
  instanceFqcn: string;
  disabled: boolean;
  sourceFile: string;
  area: string;
}

export interface EventsMappingResult {
  edges: AugmentEdge[];
  stats: {
    resolved: number;
    skipped: number;
    unresolvedObservers: string[];
  };
}

const AREA_PATTERNS: Array<{ suffix: string; area: string }> = [
  { suffix: 'etc/frontend/events.xml', area: 'frontend' },
  { suffix: 'etc/adminhtml/events.xml', area: 'adminhtml' },
  { suffix: 'etc/webapi_rest/events.xml', area: 'webapi_rest' },
  { suffix: 'etc/webapi_soap/events.xml', area: 'webapi_soap' },
  { suffix: 'etc/events.xml', area: 'global' },
];

function areaFromPath(filePath: string): string {
  for (const { suffix, area } of AREA_PATTERNS) {
    if (filePath.endsWith(suffix)) return area;
  }
  return 'global';
}

export function parseSingleEventsXml(xmlContent: string, sourceFile: string, area: string): EventObserver[] {
  const observers: EventObserver[] = [];

  let parsed: unknown;
  try {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    parsed = parser.parse(xmlContent);
  } catch {
    return observers;
  }

  if (!parsed || typeof parsed !== 'object') return observers;

  const root = parsed as Record<string, unknown>;
  const config = root['config'] as Record<string, unknown> | undefined;
  if (!config) return observers;

  const eventRaw = config['event'];
  const eventList: unknown[] = Array.isArray(eventRaw) ? eventRaw : eventRaw != null ? [eventRaw] : [];

  for (const eventEl of eventList) {
    const ev = eventEl as Record<string, unknown>;
    const eventName = ev['@_name'] as string | undefined;
    if (!eventName) continue;

    const observerRaw = ev['observer'];
    const observerList: unknown[] = Array.isArray(observerRaw) ? observerRaw : observerRaw != null ? [observerRaw] : [];

    for (const obs of observerList) {
      const o = obs as Record<string, unknown>;
      const observerName = o['@_name'] as string | undefined;
      const instanceFqcn = o['@_instance'] as string | undefined;
      const disabled = String(o['@_disabled'] ?? 'false').toLowerCase() === 'true';

      if (!observerName || !instanceFqcn) continue;

      observers.push({ eventName, observerName, instanceFqcn, disabled, sourceFile, area });
    }
  }

  return observers;
}

async function findEventsXmlFiles(dir: string): Promise<string[]> {
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
      } else if (entry.isFile() && entry.name === 'events.xml') {
        results.push(full);
      }
    }
  }

  walk(dir);
  return results;
}

export async function parseAndMapEventsXml(projectRoot: string): Promise<EventsMappingResult> {
  const edges: AugmentEdge[] = [];
  const unresolvedObservers: string[] = [];
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

    const files = await findEventsXmlFiles(searchDir);
    for (const file of files) {
      if (!/\/etc\//.test(file)) continue;

      let content: string;
      try {
        content = fs.readFileSync(file, 'utf-8');
      } catch {
        continue;
      }

      const area = areaFromPath(file);
      const observers = parseSingleEventsXml(content, file, area);

      const relSourceFile = path.relative(projectRoot, file).replace(/\\/g, '/');
      const sourceId = `File:${relSourceFile}`;

      for (const obs of observers) {
        if (obs.disabled) {
          skipped++;
          continue;
        }

        const nodeResolved = resolver.resolve(obs.instanceFqcn);
        if (!nodeResolved) {
          unresolvedObservers.push(obs.instanceFqcn);
          skipped++;
          continue;
        }

        const targetId = `File:${nodeResolved.filePath}`;

        edges.push({
          sourceId,
          targetId,
          type: 'CALLS',
          confidence: 1.0,
          reason: `magento:events:observer:${obs.eventName}`,
        });

        resolved++;
      }
    }
  }

  return { edges, stats: { resolved, skipped, unresolvedObservers } };
}
