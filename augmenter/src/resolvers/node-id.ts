import fs from 'fs';
import path from 'path';

export interface ResolvedNodeId {
  nodeId: string;
  nodeType: string;
  filePath: string;
  shortName: string;
}

export class NodeIdResolver {
  private psr4Map: Map<string, string[]>;
  private projectRoot: string;

  constructor(psr4Map: Map<string, string[]>, projectRoot: string) {
    this.psr4Map = psr4Map;
    this.projectRoot = projectRoot;
  }

  resolve(fqcn: string): ResolvedNodeId | null {
    // Normalize: ensure trailing backslash for prefix matching
    const parts = fqcn.split('\\');
    const shortName = parts[parts.length - 1];

    // Find longest matching namespace prefix
    const sortedKeys = [...this.psr4Map.keys()].sort((a, b) => b.length - a.length);

    let matchedPrefix: string | null = null;
    let matchedDirs: string[] | null = null;

    for (const key of sortedKeys) {
      if (fqcn.startsWith(key)) {
        matchedPrefix = key;
        matchedDirs = this.psr4Map.get(key)!;
        break;
      }
    }

    if (matchedPrefix === null || matchedDirs === null) {
      return null;
    }

    // Remaining namespace after prefix → relative path
    const remainder = fqcn.slice(matchedPrefix.length);
    const relPath = remainder.replace(/\\/g, '/') + '.php';

    // Determine candidate node types — try Interface first if name ends in Interface
    const nodeTypes = shortName.endsWith('Interface')
      ? ['Interface', 'Class']
      : ['Class', 'Interface'];

    for (const baseDir of matchedDirs) {
      const absPath = path.join(baseDir, relPath);
      if (!fs.existsSync(absPath)) {
        continue;
      }

      // Build relative file path from projectRoot
      let filePath = path.relative(this.projectRoot, absPath);
      // Normalize to forward slashes
      filePath = filePath.replace(/\\/g, '/');

      for (const nodeType of nodeTypes) {
        const nodeId = `${nodeType}:${filePath}:${shortName}`;
        return { nodeId, nodeType, filePath, shortName };
      }
    }

    return null;
  }
}
