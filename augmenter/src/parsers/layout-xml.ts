import fs from 'fs';
import path from 'path';
import { XMLParser } from 'fast-xml-parser';

export interface LayoutBlockTemplate {
  blockClass: string;
  templateRef: string;
  area: string;
  sourceFile: string;
}

export interface LayoutXmlResult {
  blockTemplates: LayoutBlockTemplate[];
}

const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
};

function extractFromNode(node: unknown, sourceFile: string, area: string, results: LayoutBlockTemplate[]): void {
  if (!node || typeof node !== 'object') return;

  const obj = node as Record<string, unknown>;

  // Process block elements
  for (const blockNode of asArray(obj['block'])) {
    const blockObj = blockNode as Record<string, unknown>;
    const blockClass = blockObj['@_class'] as string | undefined;
    let templateRef = blockObj['@_template'] as string | undefined;

    // Check arguments for template
    if (!templateRef) {
      templateRef = extractTemplateFromArguments(blockObj['arguments']);
    }

    if (blockClass && templateRef) {
      results.push({ blockClass, templateRef, area, sourceFile });
    }

    // Recurse into block children
    extractFromNode(blockObj, sourceFile, area, results);
  }

  // Process referenceBlock elements — skip (no class = skip per spec)
  // But still recurse into their children for nested blocks
  for (const refNode of asArray(obj['referenceBlock'])) {
    const refObj = refNode as Record<string, unknown>;
    extractFromNode(refObj, sourceFile, area, results);
  }

  // Recurse into containers and referenceContainers
  for (const key of ['container', 'referenceContainer', 'body', 'page']) {
    for (const child of asArray(obj[key])) {
      extractFromNode(child, sourceFile, area, results);
    }
  }
}

function extractTemplateFromArguments(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const argsObj = args as Record<string, unknown>;
  for (const argNode of asArray(argsObj['argument'])) {
    const argObj = argNode as Record<string, unknown>;
    if (argObj['@_name'] === 'template') {
      return (argObj['#text'] ?? argObj['']) as string | undefined;
    }
  }
  return undefined;
}

function asArray(val: unknown): unknown[] {
  if (val === undefined || val === null) return [];
  if (Array.isArray(val)) return val;
  return [val];
}

export function parseSingleLayoutXml(xmlContent: string, sourceFile: string, area: string): LayoutXmlResult {
  const parser = new XMLParser(parserOptions);
  const parsed = parser.parse(xmlContent) as Record<string, unknown>;
  const results: LayoutBlockTemplate[] = [];
  extractFromNode(parsed, sourceFile, area, results);
  return { blockTemplates: results };
}

export async function parseLayoutXml(projectRoot: string): Promise<LayoutXmlResult> {
  const results: LayoutBlockTemplate[] = [];

  const searchRoots = [
    path.join(projectRoot, 'vendor'),
    path.join(projectRoot, 'app', 'code'),
  ];

  for (const searchRoot of searchRoots) {
    if (!fs.existsSync(searchRoot)) continue;
    collectLayoutFiles(searchRoot, results);
  }

  return { blockTemplates: results };
}

function collectLayoutFiles(dir: string, results: LayoutBlockTemplate[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectLayoutFiles(fullPath, results);
    } else if (entry.isFile() && entry.name.endsWith('.xml')) {
      // Only process files inside view/frontend/layout/ or view/adminhtml/layout/
      const area = detectArea(fullPath);
      if (!area) continue;

      let content: string;
      try {
        content = fs.readFileSync(fullPath, 'utf-8');
      } catch {
        continue;
      }

      const parsed = parseSingleLayoutXml(content, fullPath, area);
      results.push(...parsed.blockTemplates);
    }
  }
}

function detectArea(filePath: string): string | undefined {
  if (filePath.includes(`/view/frontend/layout/`)) return 'frontend';
  if (filePath.includes(`/view/adminhtml/layout/`)) return 'adminhtml';
  return undefined;
}
