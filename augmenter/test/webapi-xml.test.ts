import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { parseSingleWebapiXml, parseAndMapWebapiXml } from '../src/parsers/webapi-xml.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SIMPLE_XML = `<?xml version="1.0"?>
<routes xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <route url="/V1/products/:sku" method="GET">
        <service class="Magento\\Catalog\\Api\\ProductRepositoryInterface" method="get"/>
        <resources><resource ref="Magento_Catalog::products"/></resources>
    </route>
    <route url="/V1/products" method="POST">
        <service class="Magento\\Catalog\\Api\\ProductRepositoryInterface" method="save"/>
        <resources><resource ref="Magento_Catalog::products"/></resources>
    </route>
</routes>`;

const MULTI_RESOURCE_XML = `<?xml version="1.0"?>
<routes xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <route url="/V1/products" method="GET">
        <service class="Magento\\Catalog\\Api\\ProductRepositoryInterface" method="getList"/>
        <resources>
            <resource ref="Magento_Catalog::products"/>
            <resource ref="Magento_Catalog::products_attributes"/>
        </resources>
    </route>
</routes>`;

function makeTmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'webapi-mapper-test-'));
}

/**
 * Lay out a minimal fake project:
 *   <root>/vendor/composer/autoload_psr4.php
 *   <root>/vendor/acme/module/Api/ProductRepositoryInterface.php
 *   <root>/vendor/acme/module/etc/webapi.xml
 */
function makeProject(
  tmpDir: string,
  opts: {
    createServiceFile?: boolean;
    serviceClass?: string;
    serviceMethod?: string;
    url?: string;
    httpMethod?: string;
  } = {},
) {
  const {
    createServiceFile = true,
    serviceClass = 'Acme\\Module\\Api\\ProductRepositoryInterface',
    serviceMethod = 'get',
    url = '/V1/products/:id',
    httpMethod = 'GET',
  } = opts;

  const moduleDir = path.join(tmpDir, 'vendor', 'acme', 'module');

  if (createServiceFile) {
    fs.mkdirSync(path.join(moduleDir, 'Api'), { recursive: true });
    fs.writeFileSync(path.join(moduleDir, 'Api', 'ProductRepositoryInterface.php'), '<?php');
  }

  // Write autoload_psr4.php
  const composerDir = path.join(tmpDir, 'vendor', 'composer');
  fs.mkdirSync(composerDir, { recursive: true });
  const vendorDir = path.join(tmpDir, 'vendor');

  const psr4Content = `<?php
$vendorDir = '${vendorDir.replace(/\\/g, '\\\\')}';
$baseDir = '${tmpDir.replace(/\\/g, '\\\\')}';
return array(
  'Acme\\\\Module\\\\' => array($vendorDir . '/acme/module'),
);
`;
  fs.writeFileSync(path.join(composerDir, 'autoload_psr4.php'), psr4Content);

  const webapiXml = `<?xml version="1.0"?>
<routes xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <route url="${url}" method="${httpMethod}">
        <service class="${serviceClass}" method="${serviceMethod}"/>
        <resources><resource ref="Acme_Module::products"/></resources>
    </route>
</routes>`;

  const etcDir = path.join(moduleDir, 'etc');
  fs.mkdirSync(etcDir, { recursive: true });
  const webapiPath = path.join(etcDir, 'webapi.xml');
  fs.writeFileSync(webapiPath, webapiXml);

  return { moduleDir, vendorDir, webapiPath };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('webapi-xml parser', () => {
  it('it extracts route URL, HTTP method, and service class+method from webapi.xml', () => {
    const routes = parseSingleWebapiXml(SIMPLE_XML, '/some/module/etc/webapi.xml');

    expect(routes).toHaveLength(2);

    expect(routes[0].url).toBe('/V1/products/:sku');
    expect(routes[0].httpMethod).toBe('GET');
    expect(routes[0].serviceClass).toBe('Magento\\Catalog\\Api\\ProductRepositoryInterface');
    expect(routes[0].serviceMethod).toBe('get');

    expect(routes[1].url).toBe('/V1/products');
    expect(routes[1].httpMethod).toBe('POST');
    expect(routes[1].serviceClass).toBe('Magento\\Catalog\\Api\\ProductRepositoryInterface');
    expect(routes[1].serviceMethod).toBe('save');
  });

  it('it creates Route nodes for API endpoints', async () => {
    const tmpDir = makeTmpProject();
    try {
      makeProject(tmpDir, { url: '/V1/products/:id', httpMethod: 'GET' });

      const result = await parseAndMapWebapiXml(tmpDir);

      expect(result.nodes.length).toBeGreaterThanOrEqual(1);
      const routeNode = result.nodes.find(
        (n) => n.label === 'Route' && String(n.properties['id']).includes('GET'),
      );
      expect(routeNode).toBeDefined();
      expect(routeNode!.properties['id']).toBe('Route:webapi:GET:/V1/products/:id');
      expect(routeNode!.properties['name']).toBe('GET /V1/products/:id');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('it creates HANDLES_ROUTE edges from service handler (File) to Route node', async () => {
    const tmpDir = makeTmpProject();
    try {
      makeProject(tmpDir, {
        serviceClass: 'Acme\\Module\\Api\\ProductRepositoryInterface',
        serviceMethod: 'get',
        url: '/V1/products/:id',
        httpMethod: 'GET',
      });

      const result = await parseAndMapWebapiXml(tmpDir);

      const handlesEdges = result.edges.filter((e) => e.type === 'HANDLES_ROUTE');
      expect(handlesEdges).toHaveLength(1);

      // source = File node of service class
      expect(handlesEdges[0].sourceId).toContain('ProductRepositoryInterface');
      // target = Route node
      expect(handlesEdges[0].targetId).toBe('Route:webapi:GET:/V1/products/:id');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('it tags edges with magento:webapi:route reason including URL', async () => {
    const tmpDir = makeTmpProject();
    try {
      makeProject(tmpDir, { url: '/V1/products/:id', httpMethod: 'GET' });

      const result = await parseAndMapWebapiXml(tmpDir);

      const handlesEdges = result.edges.filter((e) => e.type === 'HANDLES_ROUTE');
      expect(handlesEdges).toHaveLength(1);
      expect(handlesEdges[0].reason).toBe('magento:webapi:route');
      expect(handlesEdges[0].confidence).toBe(1.0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('it discovers webapi.xml across all modules', async () => {
    const projectRoot = '/var/www/html';

    const result = await parseAndMapWebapiXml(projectRoot);

    // Should discover multiple webapi.xml files across vendor modules
    const routeIds = result.nodes.map((n) => n.properties['id'] as string);
    expect(routeIds.some((id) => id.startsWith('Route:webapi:'))).toBe(true);

    // Catalog module routes should be present
    const catalogRoutes = routeIds.filter((id) => id.includes('/V1/products'));
    expect(catalogRoutes.length).toBeGreaterThan(0);
  });

  it('it handles routes with multiple resources', () => {
    const routes = parseSingleWebapiXml(MULTI_RESOURCE_XML, '/some/module/etc/webapi.xml');

    expect(routes).toHaveLength(1);
    expect(routes[0].url).toBe('/V1/products');
    expect(routes[0].httpMethod).toBe('GET');
    expect(routes[0].serviceClass).toBe('Magento\\Catalog\\Api\\ProductRepositoryInterface');
    expect(routes[0].serviceMethod).toBe('getList');
  });
});
