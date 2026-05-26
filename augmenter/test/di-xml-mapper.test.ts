import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// We'll test the mapper by controlling what parseDiXml and NodeIdResolver return.
// To do that we set up a real tmp filesystem with known PHP files + PSR-4 map,
// then call mapDiXmlEdges with a project root that has a fabricated di.xml.

import { mapDiXmlEdges } from '../src/parsers/di-xml-mapper.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'di-mapper-test-'));
  return tmpDir;
}

/**
 * Lay out a minimal fake project:
 *   <root>/vendor/composer/autoload_psr4.php  (points at <root>/vendor/acme/module)
 *   <root>/vendor/acme/module/Model/ConcreteProduct.php
 *   <root>/vendor/acme/module/Api/ProductInterface.php
 *   <root>/vendor/acme/module/Plugin/ProductPlugin.php
 *   <root>/vendor/acme/module/etc/di.xml  (preference + plugin)
 */
function makeProject(
  tmpDir: string,
  opts: {
    preference?: { for: string; type: string };
    plugin?: { targetType: string; pluginType: string; pluginName: string };
    createForFile?: boolean;
    createTypeFile?: boolean;
    createTargetFile?: boolean;
    createPluginFile?: boolean;
  } = {},
) {
  const {
    preference,
    plugin,
    createForFile = true,
    createTypeFile = true,
    createTargetFile = true,
    createPluginFile = true,
  } = opts;

  const moduleDir = path.join(tmpDir, 'vendor', 'acme', 'module');

  // Create PHP stub files
  if (createForFile) {
    fs.mkdirSync(path.join(moduleDir, 'Api'), { recursive: true });
    fs.writeFileSync(path.join(moduleDir, 'Api', 'ProductInterface.php'), '<?php');
  }
  if (createTypeFile) {
    fs.mkdirSync(path.join(moduleDir, 'Model'), { recursive: true });
    fs.writeFileSync(path.join(moduleDir, 'Model', 'ConcreteProduct.php'), '<?php');
  }
  if (createTargetFile) {
    fs.mkdirSync(path.join(moduleDir, 'Model'), { recursive: true });
    fs.writeFileSync(path.join(moduleDir, 'Model', 'SomeService.php'), '<?php');
  }
  if (createPluginFile) {
    fs.mkdirSync(path.join(moduleDir, 'Plugin'), { recursive: true });
    fs.writeFileSync(path.join(moduleDir, 'Plugin', 'ProductPlugin.php'), '<?php');
  }

  // Write autoload_psr4.php
  const composerDir = path.join(tmpDir, 'vendor', 'composer');
  fs.mkdirSync(composerDir, { recursive: true });
  const vendorDir = path.join(tmpDir, 'vendor');
  const autoloadContent = `<?php
return array(
  'Acme\\\\Module\\\\' => array($vendorDir . '/acme/module'),
);
`.replace('$vendorDir', `$vendorDir`);

  // Write actual PHP with real paths
  const psr4Content = `<?php
$vendorDir = '${vendorDir.replace(/\\/g, '\\\\')}';
$baseDir = '${tmpDir.replace(/\\/g, '\\\\')}';
return array(
  'Acme\\\\Module\\\\' => array($vendorDir . '/acme/module'),
);
`;
  fs.writeFileSync(path.join(composerDir, 'autoload_psr4.php'), psr4Content);

  // Build di.xml content
  const prefXml = preference
    ? `  <preference for="${preference.for}" type="${preference.type}"/>`
    : '';
  const pluginXml =
    plugin
      ? `  <type name="${plugin.targetType}">
    <plugin name="${plugin.pluginName}" type="${plugin.pluginType}"/>
  </type>`
      : '';

  const diXmlContent = `<?xml version="1.0"?>
<config xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
${prefXml}
${pluginXml}
</config>`;

  const etcDir = path.join(moduleDir, 'etc');
  fs.mkdirSync(etcDir, { recursive: true });
  fs.writeFileSync(path.join(etcDir, 'di.xml'), diXmlContent);

  return { moduleDir, vendorDir };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mapDiXmlEdges', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpProject();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('it creates IMPLEMENTS edges for each resolved preference', async () => {
    makeProject(tmpDir, {
      preference: {
        for: 'Acme\\Module\\Api\\ProductInterface',
        type: 'Acme\\Module\\Model\\ConcreteProduct',
      },
    });

    const result = await mapDiXmlEdges(tmpDir);

    const implEdges = result.edges.filter((e) => e.type === 'IMPLEMENTS');
    expect(implEdges).toHaveLength(1);
    expect(implEdges[0].sourceId).toContain('ConcreteProduct');
    expect(implEdges[0].targetId).toContain('ProductInterface');
  });

  it('it creates WRAPS edges for each resolved plugin', async () => {
    makeProject(tmpDir, {
      plugin: {
        targetType: 'Acme\\Module\\Model\\SomeService',
        pluginType: 'Acme\\Module\\Plugin\\ProductPlugin',
        pluginName: 'acme_product_plugin',
      },
    });

    const result = await mapDiXmlEdges(tmpDir);

    const wrapsEdges = result.edges.filter((e) => e.type === 'WRAPS');
    expect(wrapsEdges).toHaveLength(1);
    expect(wrapsEdges[0].sourceId).toContain('ProductPlugin');
    expect(wrapsEdges[0].targetId).toContain('SomeService');
  });

  it('it tags preference edges with magento:di:preference reason', async () => {
    makeProject(tmpDir, {
      preference: {
        for: 'Acme\\Module\\Api\\ProductInterface',
        type: 'Acme\\Module\\Model\\ConcreteProduct',
      },
    });

    const result = await mapDiXmlEdges(tmpDir);

    const implEdges = result.edges.filter((e) => e.type === 'IMPLEMENTS');
    expect(implEdges[0].reason).toBe('magento:di:preference');
    expect(implEdges[0].confidence).toBe(1.0);
  });

  it('it tags plugin edges with magento:di:plugin reason', async () => {
    makeProject(tmpDir, {
      plugin: {
        targetType: 'Acme\\Module\\Model\\SomeService',
        pluginType: 'Acme\\Module\\Plugin\\ProductPlugin',
        pluginName: 'acme_product_plugin',
      },
    });

    const result = await mapDiXmlEdges(tmpDir);

    const wrapsEdges = result.edges.filter((e) => e.type === 'WRAPS');
    expect(wrapsEdges[0].reason).toBe('magento:di:plugin');
    expect(wrapsEdges[0].confidence).toBe(1.0);
  });

  it('it skips edges where source or target FQCN cannot be resolved', async () => {
    // createTypeFile=false → ConcreteProduct.php won't exist → toType unresolvable
    makeProject(tmpDir, {
      preference: {
        for: 'Acme\\Module\\Api\\ProductInterface',
        type: 'Acme\\Module\\Model\\ConcreteProduct',
      },
      createTypeFile: false,
    });

    const result = await mapDiXmlEdges(tmpDir);

    expect(result.edges).toHaveLength(0);
    expect(result.stats.preferencesSkipped).toBe(1);
    expect(result.stats.preferencesResolved).toBe(0);
  });

  it('it logs warning for each unresolved FQCN', async () => {
    makeProject(tmpDir, {
      preference: {
        for: 'Acme\\Module\\Api\\ProductInterface',
        type: 'Acme\\Module\\Model\\ConcreteProduct',
      },
      createTypeFile: false,
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await mapDiXmlEdges(tmpDir);

    expect(warnSpy).toHaveBeenCalled();
    const calls = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((msg) => msg.includes('ConcreteProduct'))).toBe(true);

    warnSpy.mockRestore();
  });

  it('it returns summary with counts of created and skipped edges', async () => {
    makeProject(tmpDir, {
      preference: {
        for: 'Acme\\Module\\Api\\ProductInterface',
        type: 'Acme\\Module\\Model\\ConcreteProduct',
      },
      plugin: {
        targetType: 'Acme\\Module\\Model\\SomeService',
        pluginType: 'Acme\\Module\\Plugin\\ProductPlugin',
        pluginName: 'acme_product_plugin',
      },
    });

    const result = await mapDiXmlEdges(tmpDir);

    expect(result.stats.preferencesResolved).toBe(1);
    expect(result.stats.preferencesSkipped).toBe(0);
    expect(result.stats.pluginsResolved).toBe(1);
    expect(result.stats.pluginsSkipped).toBe(0);
    expect(result.stats.unresolvedFqcns).toBeInstanceOf(Array);
    expect(result.edges).toHaveLength(2);
  });
});
