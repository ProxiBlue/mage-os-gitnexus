import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseSingleLayoutXml, parseLayoutXml } from '../src/parsers/layout-xml.js';

describe('layout-xml parser', () => {
  it('extracts block class and template from block elements', () => {
    const xml = `<?xml version="1.0"?>
<page>
  <body>
    <block class="Magento\\Catalog\\Block\\Product\\View" name="product.info.main" template="Magento_Catalog::product/view.phtml"/>
  </body>
</page>`;
    const result = parseSingleLayoutXml(xml, '/some/path/view/frontend/layout/test.xml', 'frontend');
    expect(result.blockTemplates).toHaveLength(1);
    expect(result.blockTemplates[0].blockClass).toBe('Magento\\Catalog\\Block\\Product\\View');
    expect(result.blockTemplates[0].templateRef).toBe('Magento_Catalog::product/view.phtml');
  });

  it('extracts template from block arguments', () => {
    const xml = `<?xml version="1.0"?>
<page>
  <body>
    <block class="Magento\\Framework\\View\\Element\\Template" name="some.block">
        <arguments>
            <argument name="template" xsi:type="string">Magento_Catalog::product/list.phtml</argument>
        </arguments>
    </block>
  </body>
</page>`;
    const result = parseSingleLayoutXml(xml, '/some/path/view/frontend/layout/test.xml', 'frontend');
    expect(result.blockTemplates).toHaveLength(1);
    expect(result.blockTemplates[0].blockClass).toBe('Magento\\Framework\\View\\Element\\Template');
    expect(result.blockTemplates[0].templateRef).toBe('Magento_Catalog::product/list.phtml');
  });

  it('extracts template from referenceBlock elements', () => {
    const xml = `<?xml version="1.0"?>
<page>
  <body>
    <referenceBlock name="product.info.main" template="Magento_Catalog::product/view/custom.phtml"/>
    <block class="Magento\\Catalog\\Block\\Product\\View" name="product.info.main" template="Magento_Catalog::product/view.phtml"/>
  </body>
</page>`;
    const result = parseSingleLayoutXml(xml, '/some/path/view/frontend/layout/test.xml', 'frontend');
    // referenceBlock without class should be skipped; block with both class+template should be included
    const refs = result.blockTemplates.filter(b => b.templateRef === 'Magento_Catalog::product/view/custom.phtml');
    // referenceBlock has no class → skip
    expect(refs).toHaveLength(0);
    expect(result.blockTemplates).toHaveLength(1);
    expect(result.blockTemplates[0].templateRef).toBe('Magento_Catalog::product/view.phtml');
  });

  it('determines area from the layout file path', () => {
    const xml = `<?xml version="1.0"?>
<page>
  <body>
    <block class="Magento\\Backend\\Block\\Template" name="admin.block" template="Magento_Backend::template.phtml"/>
  </body>
</page>`;
    const frontendResult = parseSingleLayoutXml(xml, '/module/view/frontend/layout/test.xml', 'frontend');
    const adminhtmlResult = parseSingleLayoutXml(xml, '/module/view/adminhtml/layout/test.xml', 'adminhtml');
    expect(frontendResult.blockTemplates[0].area).toBe('frontend');
    expect(adminhtmlResult.blockTemplates[0].area).toBe('adminhtml');
  });

  it('discovers layout XML across vendor and app/code', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-xml-test-'));
    try {
      // Create a vendor module layout file
      const vendorLayoutDir = path.join(tmpDir, 'vendor', 'mage-os', 'module-catalog', 'view', 'frontend', 'layout');
      fs.mkdirSync(vendorLayoutDir, { recursive: true });
      fs.writeFileSync(path.join(vendorLayoutDir, 'catalog_product_view.xml'), `<?xml version="1.0"?>
<page>
  <body>
    <block class="Magento\\Catalog\\Block\\Product\\View" name="product.info" template="Magento_Catalog::product/view.phtml"/>
  </body>
</page>`);

      // Create an app/code module layout file
      const appLayoutDir = path.join(tmpDir, 'app', 'code', 'My', 'Module', 'view', 'adminhtml', 'layout');
      fs.mkdirSync(appLayoutDir, { recursive: true });
      fs.writeFileSync(path.join(appLayoutDir, 'my_page.xml'), `<?xml version="1.0"?>
<page>
  <body>
    <block class="My\\Module\\Block\\Widget" name="my.widget" template="My_Module::widget.phtml"/>
  </body>
</page>`);

      const result = await parseLayoutXml(tmpDir);
      expect(result.blockTemplates.length).toBeGreaterThanOrEqual(2);
      const vendorEntry = result.blockTemplates.find(b => b.blockClass === 'Magento\\Catalog\\Block\\Product\\View');
      expect(vendorEntry).toBeDefined();
      expect(vendorEntry!.area).toBe('frontend');

      const appEntry = result.blockTemplates.find(b => b.blockClass === 'My\\Module\\Block\\Widget');
      expect(appEntry).toBeDefined();
      expect(appEntry!.area).toBe('adminhtml');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('handles blocks without template attribute', () => {
    const xml = `<?xml version="1.0"?>
<page>
  <body>
    <block class="Magento\\Catalog\\Block\\Product\\View" name="product.no.template"/>
    <block class="Magento\\Catalog\\Block\\Product\\View" name="product.with.template" template="Magento_Catalog::product/view.phtml"/>
  </body>
</page>`;
    const result = parseSingleLayoutXml(xml, '/some/path/view/frontend/layout/test.xml', 'frontend');
    // Only the block with template should be included
    expect(result.blockTemplates).toHaveLength(1);
    expect(result.blockTemplates[0].templateRef).toBe('Magento_Catalog::product/view.phtml');
  });

  it('returns source layout file path for each mapping', () => {
    const xml = `<?xml version="1.0"?>
<page>
  <body>
    <block class="Magento\\Catalog\\Block\\Product\\View" name="product.info.main" template="Magento_Catalog::product/view.phtml"/>
  </body>
</page>`;
    const sourceFile = '/var/www/html/vendor/mage-os/module-catalog/view/frontend/layout/catalog_product_view.xml';
    const result = parseSingleLayoutXml(xml, sourceFile, 'frontend');
    expect(result.blockTemplates[0].sourceFile).toBe(sourceFile);
  });
});
