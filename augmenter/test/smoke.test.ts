import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('project scaffolding', () => {
  const root = path.resolve(import.meta.dirname, '..');

  it('has a valid package.json with name gitnexus-magento', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
    expect(pkg.name).toBe('gitnexus-magento');
    expect(pkg.type).toBe('module');
    expect(pkg.bin).toBeDefined();
  });

  it('has fast-xml-parser as a dependency', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
    expect(pkg.dependencies['fast-xml-parser']).toBeDefined();
  });

  it('has vitest configured and a passing smoke test', () => {
    expect(true).toBe(true);
  });
});
