import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parsePsr4Map } from '../src/resolvers/psr4-map.js';

describe('parsePsr4Map', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'psr4-test-'));
    fs.mkdirSync(path.join(tmpDir, 'vendor', 'composer'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses a simple PSR-4 autoload file with vendorDir paths', async () => {
    const content = `<?php
$vendorDir = dirname(__DIR__);
$baseDir = dirname($vendorDir);
return array(
    'Magento\\\\Catalog\\\\' => array($vendorDir . '/mage-os/module-catalog'),
    'Yireo\\\\Webp2\\\\' => array($vendorDir . '/yireo/magento2-webp2'),
);
`;
    fs.writeFileSync(
      path.join(tmpDir, 'vendor', 'composer', 'autoload_psr4.php'),
      content,
    );

    const map = await parsePsr4Map(tmpDir);

    expect(map).toBeInstanceOf(Map);
    expect(map.get('Magento\\Catalog\\')).toEqual([
      path.join(tmpDir, 'vendor', 'mage-os', 'module-catalog'),
    ]);
    expect(map.get('Yireo\\Webp2\\')).toEqual([
      path.join(tmpDir, 'vendor', 'yireo', 'magento2-webp2'),
    ]);
  });

  it('parses entries using baseDir variable', async () => {
    const content = `<?php
$vendorDir = dirname(__DIR__);
$baseDir = dirname($vendorDir);
return array(
    'Magento\\\\Tools\\\\' => array($baseDir . '/dev/tools/Magento/Tools'),
);
`;
    fs.writeFileSync(
      path.join(tmpDir, 'vendor', 'composer', 'autoload_psr4.php'),
      content,
    );

    const map = await parsePsr4Map(tmpDir);

    expect(map.get('Magento\\Tools\\')).toEqual([
      path.join(tmpDir, 'dev', 'tools', 'Magento', 'Tools'),
    ]);
  });

  it('handles namespaces with multiple directory paths', async () => {
    const content = `<?php
$vendorDir = dirname(__DIR__);
$baseDir = dirname($vendorDir);
return array(
    'Magento\\\\Framework\\\\' => array($vendorDir . '/mage-os/framework', $baseDir . '/app/code/Magento/Framework'),
);
`;
    fs.writeFileSync(
      path.join(tmpDir, 'vendor', 'composer', 'autoload_psr4.php'),
      content,
    );

    const map = await parsePsr4Map(tmpDir);

    expect(map.get('Magento\\Framework\\')).toEqual([
      path.join(tmpDir, 'vendor', 'mage-os', 'framework'),
      path.join(tmpDir, 'app', 'code', 'Magento', 'Framework'),
    ]);
  });

  it('resolves vendorDir and baseDir relative to the given project root', async () => {
    const content = `<?php
$vendorDir = dirname(__DIR__);
$baseDir = dirname($vendorDir);
return array(
    'Foo\\\\Bar\\\\' => array($vendorDir . '/foo/bar'),
    'App\\\\Code\\\\' => array($baseDir . '/app/code/App'),
);
`;
    fs.writeFileSync(
      path.join(tmpDir, 'vendor', 'composer', 'autoload_psr4.php'),
      content,
    );

    const map = await parsePsr4Map(tmpDir);

    expect(map.get('Foo\\Bar\\')).toEqual([path.join(tmpDir, 'vendor', 'foo', 'bar')]);
    expect(map.get('App\\Code\\')).toEqual([path.join(tmpDir, 'app', 'code', 'App')]);
  });

  it('returns an empty map when the file does not exist', async () => {
    const map = await parsePsr4Map(path.join(tmpDir, 'nonexistent'));

    expect(map).toBeInstanceOf(Map);
    expect(map.size).toBe(0);
  });

  it('handles the real Mage-OS autoload_psr4.php format correctly', async () => {
    const realFile = '/var/www/html/vendor/composer/autoload_psr4.php';
    const projectRoot = '/var/www/html';

    const map = await parsePsr4Map(projectRoot);

    expect(map).toBeInstanceOf(Map);
    expect(map.size).toBeGreaterThan(100);
    // vendorDir path entry
    expect(map.get('Yireo\\Webp2\\')).toBeDefined();
    expect(map.get('Yireo\\Webp2\\')![0]).toBe(
      path.join(projectRoot, 'vendor', 'yireo', 'magento2-webp2'),
    );
    // baseDir path entry
    expect(map.get('Magento\\Tools\\')).toBeDefined();
    expect(map.get('Magento\\Tools\\')![0]).toBe(
      path.join(projectRoot, 'dev', 'tools', 'Magento', 'Tools'),
    );

    void realFile; // referenced for clarity
  });
});
