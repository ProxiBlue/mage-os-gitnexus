import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { NodeIdResolver } from '../src/resolvers/node-id.js';

// Helper: build a PSR-4 map pointing at a tmp dir
function makeTmpProject(): { tmpDir: string; psr4Map: Map<string, string[]> } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-id-test-'));
  const psr4Map = new Map<string, string[]>();
  return { tmpDir, psr4Map };
}

describe('NodeIdResolver', () => {
  it('it resolves a class FQCN to a Class node ID with correct file path', () => {
    const { tmpDir, psr4Map } = makeTmpProject();
    const moduleDir = path.join(tmpDir, 'vendor', 'mage-os', 'module-catalog');
    const modelDir = path.join(moduleDir, 'Model');
    fs.mkdirSync(modelDir, { recursive: true });
    fs.writeFileSync(path.join(modelDir, 'Product.php'), '<?php');

    psr4Map.set('Magento\\Catalog\\', [moduleDir]);

    const resolver = new NodeIdResolver(psr4Map, tmpDir);
    const result = resolver.resolve('Magento\\Catalog\\Model\\Product');

    expect(result).not.toBeNull();
    expect(result!.nodeType).toBe('Class');
    expect(result!.filePath).toBe('vendor/mage-os/module-catalog/Model/Product.php');
    expect(result!.nodeId).toBe(
      'Class:vendor/mage-os/module-catalog/Model/Product.php:Product',
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('it resolves an interface FQCN to an Interface node ID', () => {
    const { tmpDir, psr4Map } = makeTmpProject();
    const moduleDir = path.join(tmpDir, 'vendor', 'mage-os', 'module-catalog');
    const apiDir = path.join(moduleDir, 'Api');
    fs.mkdirSync(apiDir, { recursive: true });
    fs.writeFileSync(path.join(apiDir, 'ProductRepositoryInterface.php'), '<?php');

    psr4Map.set('Magento\\Catalog\\', [moduleDir]);

    const resolver = new NodeIdResolver(psr4Map, tmpDir);
    const result = resolver.resolve('Magento\\Catalog\\Api\\ProductRepositoryInterface');

    expect(result).not.toBeNull();
    expect(result!.nodeType).toBe('Interface');
    expect(result!.filePath).toBe(
      'vendor/mage-os/module-catalog/Api/ProductRepositoryInterface.php',
    );
    expect(result!.nodeId).toBe(
      'Interface:vendor/mage-os/module-catalog/Api/ProductRepositoryInterface.php:ProductRepositoryInterface',
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('it tries both Class and Interface node types when name is ambiguous', () => {
    const { tmpDir, psr4Map } = makeTmpProject();
    const moduleDir = path.join(tmpDir, 'vendor', 'acme', 'module');
    const modelDir = path.join(moduleDir, 'Model');
    fs.mkdirSync(modelDir, { recursive: true });
    // Only create Class version, not Interface
    fs.writeFileSync(path.join(modelDir, 'Widget.php'), '<?php');

    psr4Map.set('Acme\\Module\\', [moduleDir]);

    const resolver = new NodeIdResolver(psr4Map, tmpDir);
    const result = resolver.resolve('Acme\\Module\\Model\\Widget');

    // Name doesn't end in Interface, tries Class first → should find it
    expect(result).not.toBeNull();
    expect(result!.nodeType).toBe('Class');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('it uses the short class name as the qualifiedName', () => {
    const { tmpDir, psr4Map } = makeTmpProject();
    const moduleDir = path.join(tmpDir, 'vendor', 'acme', 'module');
    const blockDir = path.join(moduleDir, 'Block', 'Adminhtml');
    fs.mkdirSync(blockDir, { recursive: true });
    fs.writeFileSync(path.join(blockDir, 'Grid.php'), '<?php');

    psr4Map.set('Acme\\Module\\', [moduleDir]);

    const resolver = new NodeIdResolver(psr4Map, tmpDir);
    const result = resolver.resolve('Acme\\Module\\Block\\Adminhtml\\Grid');

    expect(result).not.toBeNull();
    expect(result!.shortName).toBe('Grid');
    expect(result!.nodeId).toMatch(/:Grid$/);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('it handles deeply nested namespaces correctly', () => {
    const { tmpDir, psr4Map } = makeTmpProject();
    const moduleDir = path.join(tmpDir, 'vendor', 'acme', 'deep');
    const deepDir = path.join(moduleDir, 'A', 'B', 'C', 'D');
    fs.mkdirSync(deepDir, { recursive: true });
    fs.writeFileSync(path.join(deepDir, 'Service.php'), '<?php');

    psr4Map.set('Acme\\Deep\\', [moduleDir]);

    const resolver = new NodeIdResolver(psr4Map, tmpDir);
    const result = resolver.resolve('Acme\\Deep\\A\\B\\C\\D\\Service');

    expect(result).not.toBeNull();
    expect(result!.filePath).toBe('vendor/acme/deep/A/B/C/D/Service.php');
    expect(result!.shortName).toBe('Service');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('it returns null when the FQCN namespace has no PSR-4 mapping', () => {
    const { tmpDir, psr4Map } = makeTmpProject();
    // Empty map — no mappings at all
    const resolver = new NodeIdResolver(psr4Map, tmpDir);
    const result = resolver.resolve('Unknown\\Vendor\\SomeClass');

    expect(result).toBeNull();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('it returns null when the resolved file path does not exist on disk', () => {
    const { tmpDir, psr4Map } = makeTmpProject();
    const moduleDir = path.join(tmpDir, 'vendor', 'acme', 'module');
    // Do NOT create any files — mapping exists but file doesn't
    psr4Map.set('Acme\\Module\\', [moduleDir]);

    const resolver = new NodeIdResolver(psr4Map, tmpDir);
    const result = resolver.resolve('Acme\\Module\\Model\\Missing');

    expect(result).toBeNull();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('it resolves Magento\\Catalog\\Api\\ProductRepositoryInterface correctly', () => {
    // Integration test against real Mage-OS vendor dir
    const projectRoot = '/var/www/html';
    const realMap = new Map<string, string[]>();
    realMap.set('Magento\\Catalog\\', [
      path.join(projectRoot, 'vendor', 'mage-os', 'module-catalog'),
    ]);

    const resolver = new NodeIdResolver(realMap, projectRoot);
    const result = resolver.resolve('Magento\\Catalog\\Api\\ProductRepositoryInterface');

    expect(result).not.toBeNull();
    expect(result!.nodeType).toBe('Interface');
    expect(result!.shortName).toBe('ProductRepositoryInterface');
    expect(result!.filePath).toBe(
      'vendor/mage-os/module-catalog/Api/ProductRepositoryInterface.php',
    );
    expect(result!.nodeId).toBe(
      'Interface:vendor/mage-os/module-catalog/Api/ProductRepositoryInterface.php:ProductRepositoryInterface',
    );
  });
});
