import fs from 'fs';
import path from 'path';

export class TemplatePathResolver {
  private psr4Map: Map<string, string[]>;
  private projectRoot: string;

  constructor(psr4Map: Map<string, string[]>, projectRoot: string) {
    this.psr4Map = psr4Map;
    this.projectRoot = projectRoot;
  }

  resolve(templateRef: string, area: string): string | null {
    const separatorIndex = templateRef.indexOf('::');
    if (separatorIndex === -1) return null;

    const moduleName = templateRef.slice(0, separatorIndex);
    const templatePath = templateRef.slice(separatorIndex + 2);

    // Convert Vendor_Module -> Vendor\Module\ (replace first _ with \)
    const firstUnderscore = moduleName.indexOf('_');
    if (firstUnderscore === -1) return null;

    const namespace = moduleName.slice(0, firstUnderscore) + '\\' + moduleName.slice(firstUnderscore + 1) + '\\';

    const dirs = this.psr4Map.get(namespace);
    if (!dirs || dirs.length === 0) return null;

    for (const dir of dirs) {
      const fullPath = path.join(dir, 'view', area, 'templates', templatePath);
      if (fs.existsSync(fullPath)) {
        return path.relative(this.projectRoot, fullPath);
      }
    }

    return null;
  }
}
