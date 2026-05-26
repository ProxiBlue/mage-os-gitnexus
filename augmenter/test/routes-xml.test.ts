import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseSingleRoutesXml, parseAndMapRoutesXml } from '../src/parsers/routes-xml.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'routes-xml-test-'));
}

function makeProject(
  tmpDir: string,
  opts: {
    frontendXml?: string;
    adminhtmlXml?: string;
  } = {},
): void {
  const moduleDir = path.join(tmpDir, 'vendor', 'acme', 'module');

  if (opts.frontendXml !== undefined) {
    const etcDir = path.join(moduleDir, 'etc', 'frontend');
    fs.mkdirSync(etcDir, { recursive: true });
    fs.writeFileSync(path.join(etcDir, 'routes.xml'), opts.frontendXml);
  }

  if (opts.adminhtmlXml !== undefined) {
    const etcDir = path.join(moduleDir, 'etc', 'adminhtml');
    fs.mkdirSync(etcDir, { recursive: true });
    fs.writeFileSync(path.join(etcDir, 'routes.xml'), opts.adminhtmlXml);
  }
}

const STANDARD_ROUTES_XML = `<?xml version="1.0"?>
<config>
    <router id="standard">
        <route id="catalog" frontName="catalog">
            <module name="Magento_Catalog"/>
        </route>
    </router>
</config>`;

const ADMIN_ROUTES_XML = `<?xml version="1.0"?>
<config>
    <router id="admin">
        <route id="admin_catalog" frontName="catalog">
            <module name="Magento_Catalog" before="Magento_Backend"/>
        </route>
    </router>
</config>`;

const MULTI_ROUTER_XML = `<?xml version="1.0"?>
<config>
    <router id="standard">
        <route id="catalog" frontName="catalog">
            <module name="Magento_Catalog"/>
        </route>
        <route id="checkout" frontName="checkout">
            <module name="Magento_Checkout"/>
        </route>
    </router>
</config>`;

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe('routes-xml parser', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('it extracts route frontName and module name from routes.xml', () => {
    const result = parseSingleRoutesXml(
      STANDARD_ROUTES_XML,
      '/some/module/etc/frontend/routes.xml',
      'frontend',
    );

    expect(result).toHaveLength(1);
    expect(result[0].frontName).toBe('catalog');
    expect(result[0].moduleName).toBe('Magento_Catalog');
    expect(result[0].routeId).toBe('catalog');
    expect(result[0].area).toBe('frontend');
    expect(result[0].sourceFile).toBe('/some/module/etc/frontend/routes.xml');
  });

  it('it discovers routes.xml across frontend and adminhtml areas', async () => {
    makeProject(tmpDir, {
      frontendXml: STANDARD_ROUTES_XML,
      adminhtmlXml: ADMIN_ROUTES_XML,
    });

    const result = await parseAndMapRoutesXml(tmpDir);

    const frontendEdges = result.edges.filter((e) => e.targetId.includes(':frontend:'));
    const adminhtmlEdges = result.edges.filter((e) => e.targetId.includes(':adminhtml:'));

    expect(frontendEdges.length).toBeGreaterThan(0);
    expect(adminhtmlEdges.length).toBeGreaterThan(0);
  });

  it('it creates HANDLES_ROUTE edges from module file to Route node for each route-module mapping', async () => {
    makeProject(tmpDir, { frontendXml: STANDARD_ROUTES_XML });

    const result = await parseAndMapRoutesXml(tmpDir);

    expect(result.edges.length).toBeGreaterThan(0);
    const edge = result.edges[0];
    expect(edge.type).toBe('HANDLES_ROUTE');
    expect(edge.sourceId).toMatch(/^File:/);
    expect(edge.targetId).toMatch(/^Route:frontend:catalog$/);
  });

  it('it tags edges with magento:routes:controller reason', async () => {
    makeProject(tmpDir, { frontendXml: STANDARD_ROUTES_XML });

    const result = await parseAndMapRoutesXml(tmpDir);

    expect(result.edges[0].reason).toBe('magento:routes:controller');
    expect(result.edges[0].confidence).toBe(1.0);
  });

  it('it handles routes with before/after module ordering', () => {
    const result = parseSingleRoutesXml(
      ADMIN_ROUTES_XML,
      '/some/module/etc/adminhtml/routes.xml',
      'adminhtml',
    );

    expect(result).toHaveLength(1);
    expect(result[0].moduleName).toBe('Magento_Catalog');
    expect(result[0].frontName).toBe('catalog');
    expect(result[0].area).toBe('adminhtml');
  });
});
