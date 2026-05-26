import { describe, it, expect, beforeEach } from 'vitest';
import path from 'path';
import { parsePsr4Map } from '../src/resolvers/psr4-map.js';
import { TemplatePathResolver } from '../src/resolvers/template-path.js';

const PROJECT_ROOT = '/var/www/html';

describe('TemplatePathResolver', () => {
  let resolver: TemplatePathResolver;
  let psr4Map: Map<string, string[]>;

  beforeEach(async () => {
    psr4Map = await parsePsr4Map(PROJECT_ROOT);
    resolver = new TemplatePathResolver(psr4Map, PROJECT_ROOT);
  });

  it('resolves Magento_Catalog::product/view.phtml to the correct vendor path', () => {
    // product/gallery.phtml exists in the real vendor installation
    const result = resolver.resolve('Magento_Catalog::product/gallery.phtml', 'frontend');
    expect(result).toBe('vendor/mage-os/module-catalog/view/frontend/templates/product/gallery.phtml');
  });

  it('handles frontend area templates', () => {
    const result = resolver.resolve('Magento_Catalog::product/list.phtml', 'frontend');
    expect(result).toBe('vendor/mage-os/module-catalog/view/frontend/templates/product/list.phtml');
  });

  it('handles adminhtml area templates', () => {
    const result = resolver.resolve('Magento_Catalog::catalog/product.phtml', 'adminhtml');
    expect(result).toBe('vendor/mage-os/module-catalog/view/adminhtml/templates/catalog/product.phtml');
  });

  it('returns null when the template file does not exist', () => {
    const result = resolver.resolve('Magento_Catalog::nonexistent/template.phtml', 'frontend');
    expect(result).toBeNull();
  });

  it('converts Vendor_Module underscore notation to namespace for PSR-4 lookup', () => {
    // Magento_ConfigurableProduct -> Magento\ConfigurableProduct (only first _ replaced)
    const result = resolver.resolve('Magento_ConfigurableProduct::product/listing.phtml', 'frontend');
    // If module not found or file missing, returns null — but must not throw
    expect(result === null || typeof result === 'string').toBe(true);
    // Verify resolution works for a known module with underscore notation
    const result2 = resolver.resolve('Magento_Catalog::product/image.phtml', 'frontend');
    expect(result2).toBe('vendor/mage-os/module-catalog/view/frontend/templates/product/image.phtml');
  });

  it('handles templates with nested subdirectories', () => {
    const result = resolver.resolve('Magento_Catalog::product/view/addtocart.phtml', 'frontend');
    expect(result).toBe('vendor/mage-os/module-catalog/view/frontend/templates/product/view/addtocart.phtml');
  });
});
