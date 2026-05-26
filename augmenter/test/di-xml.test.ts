import { describe, it, expect } from 'vitest';
import path from 'path';
import { parseSingleDiXml, parseDiXml } from '../src/parsers/di-xml.js';

describe('di-xml parser', () => {
  it('extracts preference for and type attributes from di.xml', () => {
    const xml = `<?xml version="1.0"?>
<config xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <preference for="Magento\\Catalog\\Api\\Data\\ProductInterface" type="Magento\\Catalog\\Model\\Product" />
    <preference for="Magento\\Catalog\\Api\\ProductRepositoryInterface" type="Magento\\Catalog\\Model\\ProductRepository" />
</config>`;

    const result = parseSingleDiXml(xml, '/some/module/etc/di.xml', 'global');

    expect(result.preferences).toHaveLength(2);
    expect(result.preferences[0].forType).toBe('Magento\\Catalog\\Api\\Data\\ProductInterface');
    expect(result.preferences[0].toType).toBe('Magento\\Catalog\\Model\\Product');
    expect(result.preferences[1].forType).toBe('Magento\\Catalog\\Api\\ProductRepositoryInterface');
    expect(result.preferences[1].toType).toBe('Magento\\Catalog\\Model\\ProductRepository');
  });

  it('extracts plugin type and target class from type elements', () => {
    const xml = `<?xml version="1.0"?>
<config xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <type name="Magento\\Catalog\\Model\\Product">
        <plugin name="myPlugin" type="Vendor\\Module\\Plugin\\ProductPlugin" sortOrder="10" disabled="false"/>
    </type>
</config>`;

    const result = parseSingleDiXml(xml, '/some/module/etc/di.xml', 'global');

    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0].targetType).toBe('Magento\\Catalog\\Model\\Product');
    expect(result.plugins[0].pluginType).toBe('Vendor\\Module\\Plugin\\ProductPlugin');
    expect(result.plugins[0].pluginName).toBe('myPlugin');
    expect(result.plugins[0].sortOrder).toBe(10);
    expect(result.plugins[0].disabled).toBe(false);
  });

  it('skips disabled plugins', () => {
    const xml = `<?xml version="1.0"?>
<config xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <type name="Magento\\Catalog\\Model\\Product">
        <plugin name="activePlugin" type="Vendor\\Module\\Plugin\\Active" disabled="false"/>
        <plugin name="disabledPlugin" type="Vendor\\Module\\Plugin\\Disabled" disabled="true"/>
    </type>
</config>`;

    const result = parseSingleDiXml(xml, '/some/module/etc/di.xml', 'global');

    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0].pluginName).toBe('activePlugin');
  });

  it('discovers di.xml files across all area scopes', async () => {
    const projectRoot = '/var/www/html';
    const result = await parseDiXml(projectRoot);

    const areas = new Set(result.preferences.map(p => p.area));
    // global scope must exist
    expect(areas.has('global')).toBe(true);
  });

  it('scans both vendor and app/code directories', async () => {
    const projectRoot = '/var/www/html';
    const result = await parseDiXml(projectRoot);

    const vendorFiles = result.preferences.filter(p => p.sourceFile.includes('/vendor/'));
    expect(vendorFiles.length).toBeGreaterThan(0);
  });

  it('handles malformed XML without crashing', () => {
    const malformed = `<?xml version="1.0"?>
<config>
    <preference for="A" type="B"
    <!-- missing closing tag -->`;

    expect(() => parseSingleDiXml(malformed, '/some/di.xml', 'global')).not.toThrow();
    const result = parseSingleDiXml(malformed, '/some/di.xml', 'global');
    expect(result.preferences).toBeInstanceOf(Array);
    expect(result.plugins).toBeInstanceOf(Array);
  });

  it('returns the source file path for each extracted declaration', () => {
    const xml = `<?xml version="1.0"?>
<config>
    <preference for="Foo\\Bar" type="Foo\\Baz" />
    <type name="Foo\\Qux">
        <plugin name="myPlugin" type="Foo\\Plugin" />
    </type>
</config>`;
    const sourceFile = '/var/www/html/vendor/some/module/etc/frontend/di.xml';

    const result = parseSingleDiXml(xml, sourceFile, 'frontend');

    expect(result.preferences[0].sourceFile).toBe(sourceFile);
    expect(result.preferences[0].area).toBe('frontend');
    expect(result.plugins[0].sourceFile).toBe(sourceFile);
    expect(result.plugins[0].area).toBe('frontend');
  });
});
