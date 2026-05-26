import fs from 'fs';
import path from 'path';

export async function parsePsr4Map(projectRoot: string): Promise<Map<string, string[]>> {
  const autoloadFile = path.join(projectRoot, 'vendor', 'composer', 'autoload_psr4.php');

  let content: string;
  try {
    content = fs.readFileSync(autoloadFile, 'utf-8');
  } catch {
    return new Map();
  }

  const vendorDir = path.join(projectRoot, 'vendor');
  const baseDir = projectRoot;

  const map = new Map<string, string[]>();

  // Match each namespace entry: 'Namespace\' => array(...)
  const entryPattern = /'([^']+)'\s*=>\s*array\(([^)]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = entryPattern.exec(content)) !== null) {
    const namespace = match[1].replace(/\\\\/g, '\\');
    const pathsRaw = match[2];

    // Extract individual path strings from the array contents
    const dirs: string[] = [];
    const pathPattern = /\$(vendorDir|baseDir)\s*\.\s*'([^']*)'/g;
    let pathMatch: RegExpExecArray | null;

    while ((pathMatch = pathPattern.exec(pathsRaw)) !== null) {
      const varName = pathMatch[1];
      const suffix = pathMatch[2];
      const base = varName === 'vendorDir' ? vendorDir : baseDir;
      // suffix starts with '/' so join handles it correctly
      dirs.push(path.join(base, suffix));
    }

    if (dirs.length > 0) {
      map.set(namespace, dirs);
    }
  }

  return map;
}
