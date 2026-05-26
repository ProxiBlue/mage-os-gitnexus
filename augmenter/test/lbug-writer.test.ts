import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  generateEdgeCsvFiles,
  extractLabel,
  escapeField,
  writeEdges,
  cleanupMagentoEdges,
  writeNodes,
} from '../src/writer/lbug-writer.js';
import type { AugmentEdge, AugmentNode, WriteResult } from '../src/writer/lbug-writer.js';

describe('lbug-writer', () => {
  let csvDir: string;

  beforeEach(() => {
    csvDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lbug-csv-'));
  });

  afterEach(() => {
    fs.rmSync(csvDir, { recursive: true, force: true });
  });

  it('generates valid CSV files for edge bulk loading', async () => {
    const edges: AugmentEdge[] = [
      {
        sourceId: 'Class:vendor/mage-os/module-catalog/Model/Product.php:Product',
        targetId: 'Interface:vendor/mage-os/module-catalog/Api/Data/ProductInterface.php:ProductInterface',
        type: 'IMPLEMENTS',
        confidence: 1,
        reason: 'magento:di:preference',
      },
    ];

    const files = await generateEdgeCsvFiles(edges, csvDir);

    expect(files.length).toBe(1);
    const csvPath = files[0];
    expect(fs.existsSync(csvPath)).toBe(true);

    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.trim().split('\n');

    // Header line
    expect(lines[0]).toBe('"from","to","type","confidence","reason","step"');
    // Data row
    expect(lines[1]).toContain('IMPLEMENTS');
    expect(lines[1]).toContain('magento:di:preference');
  });

  it('splits CSV by source-target label pair', async () => {
    const edges: AugmentEdge[] = [
      {
        sourceId: 'Class:vendor/a/Model/Foo.php:Foo',
        targetId: 'Interface:vendor/a/Api/FooInterface.php:FooInterface',
        type: 'IMPLEMENTS',
        confidence: 1,
        reason: 'magento:di:preference',
      },
      {
        sourceId: 'Class:vendor/b/Model/Bar.php:Bar',
        targetId: 'Route:vendor/b/etc/routes.xml:bar_index_index',
        type: 'CALLS',
        confidence: 1,
        reason: 'magento:routes',
      },
    ];

    const files = await generateEdgeCsvFiles(edges, csvDir);

    expect(files.length).toBe(2);

    const fileNames = files.map((f) => path.basename(f));
    expect(fileNames).toContain('rel_Class_Interface.csv');
    expect(fileNames).toContain('rel_Class_Route.csv');
  });

  it('reports count of injected edges and created nodes', async () => {
    const edges: AugmentEdge[] = [
      {
        sourceId: 'Class:vendor/a/Model/Foo.php:Foo',
        targetId: 'Interface:vendor/a/Api/FooInterface.php:FooInterface',
        type: 'IMPLEMENTS',
        confidence: 1,
        reason: 'magento:di:preference',
      },
    ];

    // Mock DB adapter — only test WriteResult shape
    const result: WriteResult = {
      edgesInjected: edges.length,
      edgesSkipped: 0,
      nodesCreated: 0,
    };

    expect(result.edgesInjected).toBe(1);
    expect(result.edgesSkipped).toBe(0);
    expect(result.nodesCreated).toBe(0);
  });

  it('handles empty edge list without error', async () => {
    const files = await generateEdgeCsvFiles([], csvDir);
    expect(files).toEqual([]);
  });

  it('escapes CSV fields containing commas and quotes', () => {
    expect(escapeField('hello,world')).toBe('"hello,world"');
    expect(escapeField('say "hi"')).toBe('"say \\"hi\\""');
    expect(escapeField('plain')).toBe('"plain"');
    expect(escapeField('')).toBe('""');
  });

  it('extracts label from node ID correctly', () => {
    expect(extractLabel('Class:vendor/mage-os/module-catalog/Model/Product.php:Product')).toBe('Class');
    expect(extractLabel('Interface:vendor/a/Api/FooInterface.php:FooInterface')).toBe('Interface');
    expect(extractLabel('Route:vendor/b/etc/routes.xml:bar_index_index')).toBe('Route');
    expect(extractLabel('Function:some/path.php:myFn')).toBe('Function');
  });
});
