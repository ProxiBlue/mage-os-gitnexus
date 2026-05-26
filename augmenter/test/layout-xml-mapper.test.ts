import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mapLayoutXmlEdges } from '../src/parsers/layout-xml-mapper.js';

// Build a minimal fake project with PSR-4 autoload, a block class file, a layout XML, and a template file.
function makeFakeProject(): { projectRoot: string } {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lxm-test-'));

  // PSR-4 autoload map
  const vendorComposer = path.join(projectRoot, 'vendor', 'composer');
  fs.mkdirSync(vendorComposer, { recursive: true });

  const moduleDir = path.join(projectRoot, 'vendor', 'acme', 'module-foo');
  const blockDir = path.join(moduleDir, 'Block');
  fs.mkdirSync(blockDir, { recursive: true });
  fs.writeFileSync(path.join(blockDir, 'Widget.php'), '<?php');

  // Template file
  const templateDir = path.join(moduleDir, 'view', 'frontend', 'templates', 'widget');
  fs.mkdirSync(templateDir, { recursive: true });
  fs.writeFileSync(path.join(templateDir, 'display.phtml'), '<?php echo "hi"; ?>');

  // Layout XML
  const layoutDir = path.join(moduleDir, 'view', 'frontend', 'layout');
  fs.mkdirSync(layoutDir, { recursive: true });
  fs.writeFileSync(
    path.join(layoutDir, 'default.xml'),
    `<?xml version="1.0"?>
<page>
  <body>
    <block class="Acme\\Foo\\Block\\Widget" name="acme.widget" template="Acme_Foo::widget/display.phtml"/>
  </body>
</page>`,
  );

  // autoload_psr4.php
  const autoloadContent = `<?php
$vendorDir = dirname(__DIR__);
$baseDir = dirname($vendorDir);
return array(
  'Acme\\\\Foo\\\\' => array($vendorDir . '/acme/module-foo'),
);
`;
  fs.writeFileSync(path.join(vendorComposer, 'autoload_psr4.php'), autoloadContent);

  return { projectRoot };
}

describe('layout-xml-mapper', () => {
  let projectRoot: string;

  beforeEach(() => {
    ({ projectRoot } = makeFakeProject());
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('creates CALLS edges from block class file to template file', async () => {
    const result = await mapLayoutXmlEdges(projectRoot);
    expect(result.edges).toHaveLength(1);
    const edge = result.edges[0];
    expect(edge.sourceId).toBe('File:vendor/acme/module-foo/Block/Widget.php');
    expect(edge.targetId).toBe('File:vendor/acme/module-foo/view/frontend/templates/widget/display.phtml');
    expect(edge.type).toBe('CALLS');
  });

  it('tags edges with magento:layout:block-template reason', async () => {
    const result = await mapLayoutXmlEdges(projectRoot);
    expect(result.edges[0].reason).toBe('magento:layout:block-template');
    expect(result.edges[0].confidence).toBe(1.0);
  });

  it('skips edges where block class cannot be resolved', async () => {
    // Overwrite layout XML with an unresolvable class
    const layoutFile = path.join(
      projectRoot,
      'vendor', 'acme', 'module-foo', 'view', 'frontend', 'layout', 'default.xml',
    );
    fs.writeFileSync(
      layoutFile,
      `<?xml version="1.0"?>
<page>
  <body>
    <block class="Unknown\\Vendor\\Block\\Thing" name="thing" template="Acme_Foo::widget/display.phtml"/>
  </body>
</page>`,
    );
    const result = await mapLayoutXmlEdges(projectRoot);
    expect(result.edges).toHaveLength(0);
    expect(result.stats.skippedNoClass).toBe(1);
    expect(result.stats.unresolvedClasses).toContain('Unknown\\Vendor\\Block\\Thing');
  });

  it('skips edges where template file does not exist', async () => {
    const layoutFile = path.join(
      projectRoot,
      'vendor', 'acme', 'module-foo', 'view', 'frontend', 'layout', 'default.xml',
    );
    fs.writeFileSync(
      layoutFile,
      `<?xml version="1.0"?>
<page>
  <body>
    <block class="Acme\\Foo\\Block\\Widget" name="acme.widget" template="Acme_Foo::widget/missing.phtml"/>
  </body>
</page>`,
    );
    const result = await mapLayoutXmlEdges(projectRoot);
    expect(result.edges).toHaveLength(0);
    expect(result.stats.skippedNoTemplate).toBe(1);
    expect(result.stats.unresolvedTemplates).toContain('Acme_Foo::widget/missing.phtml');
  });

  it('handles both attribute and argument-based template references', async () => {
    // Add a second block using argument-based template
    const moduleDir = path.join(projectRoot, 'vendor', 'acme', 'module-foo');
    const blockDir = path.join(moduleDir, 'Block');
    fs.writeFileSync(path.join(blockDir, 'Other.php'), '<?php');
    const templateDir = path.join(moduleDir, 'view', 'frontend', 'templates', 'other');
    fs.mkdirSync(templateDir, { recursive: true });
    fs.writeFileSync(path.join(templateDir, 'list.phtml'), '<?php ?>');

    const layoutFile = path.join(moduleDir, 'view', 'frontend', 'layout', 'default.xml');
    fs.writeFileSync(
      layoutFile,
      `<?xml version="1.0"?>
<page>
  <body>
    <block class="Acme\\Foo\\Block\\Widget" name="acme.widget" template="Acme_Foo::widget/display.phtml"/>
    <block class="Acme\\Foo\\Block\\Other" name="acme.other">
      <arguments>
        <argument name="template" xsi:type="string">Acme_Foo::other/list.phtml</argument>
      </arguments>
    </block>
  </body>
</page>`,
    );

    const result = await mapLayoutXmlEdges(projectRoot);
    expect(result.edges).toHaveLength(2);
    const sources = result.edges.map(e => e.sourceId);
    expect(sources).toContain('File:vendor/acme/module-foo/Block/Widget.php');
    expect(sources).toContain('File:vendor/acme/module-foo/Block/Other.php');
  });

  it('returns summary with counts of created and skipped edges', async () => {
    const result = await mapLayoutXmlEdges(projectRoot);
    expect(result.stats.resolved).toBe(1);
    expect(result.stats.skippedNoClass).toBe(0);
    expect(result.stats.skippedNoTemplate).toBe(0);
    expect(result.stats.unresolvedClasses).toHaveLength(0);
    expect(result.stats.unresolvedTemplates).toHaveLength(0);
  });
});
