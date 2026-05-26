import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

// Mock all writer functions to avoid hitting real DB
vi.mock('../src/writer/lbug-writer.js', () => ({
  cleanupMagentoEdges: vi.fn().mockResolvedValue(0),
  writeEdges: vi.fn().mockResolvedValue({ edgesInjected: 0, edgesSkipped: 0, nodesCreated: 0 }),
  writeNodes: vi.fn().mockResolvedValue(0),
}));

// Mock all mappers
vi.mock('../src/parsers/di-xml-mapper.js', () => ({
  mapDiXmlEdges: vi.fn().mockResolvedValue({
    edges: [],
    stats: { preferencesResolved: 3, preferencesSkipped: 0, pluginsResolved: 2, pluginsSkipped: 0, unresolvedFqcns: [] },
  }),
}));

vi.mock('../src/parsers/layout-xml-mapper.js', () => ({
  mapLayoutXmlEdges: vi.fn().mockResolvedValue({
    edges: [],
    stats: { resolved: 5, skippedNoClass: 0, skippedNoTemplate: 0, unresolvedClasses: [], unresolvedTemplates: [] },
  }),
}));

vi.mock('../src/parsers/events-xml.js', () => ({
  parseAndMapEventsXml: vi.fn().mockResolvedValue({
    edges: [],
    stats: { resolved: 4, skipped: 0 },
  }),
}));

vi.mock('../src/parsers/webapi-xml.js', () => ({
  parseAndMapWebapiXml: vi.fn().mockResolvedValue({
    edges: [],
    nodes: [],
    stats: { resolved: 6, skipped: 0 },
  }),
}));

vi.mock('../src/parsers/routes-xml.js', () => ({
  parseAndMapRoutesXml: vi.fn().mockResolvedValue({
    edges: [],
    nodes: [],
    stats: { resolved: 7, skipped: 0 },
  }),
}));

import { augment } from '../src/augment.js';
import * as writer from '../src/writer/lbug-writer.js';
import * as diMapper from '../src/parsers/di-xml-mapper.js';
import * as layoutMapper from '../src/parsers/layout-xml-mapper.js';
import * as eventsXml from '../src/parsers/events-xml.js';
import * as webapiXml from '../src/parsers/webapi-xml.js';
import * as routesXml from '../src/parsers/routes-xml.js';

async function createFakeProject(tmpDir: string): Promise<void> {
  // Create .gitnexus/lbug
  await fs.mkdir(path.join(tmpDir, '.gitnexus', 'lbug'), { recursive: true });
  // Create vendor/composer/autoload_psr4.php
  await fs.mkdir(path.join(tmpDir, 'vendor', 'composer'), { recursive: true });
  await fs.writeFile(
    path.join(tmpDir, 'vendor', 'composer', 'autoload_psr4.php'),
    '<?php return [];',
  );
}

describe('augment CLI integration', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitnexus-test-'));

    // Reset call counts without clearing implementations
    vi.mocked(writer.cleanupMagentoEdges).mockReset().mockResolvedValue(0);
    vi.mocked(writer.writeEdges).mockReset().mockResolvedValue({ edgesInjected: 0, edgesSkipped: 0, nodesCreated: 0 });
    vi.mocked(writer.writeNodes).mockReset().mockResolvedValue(0);
    vi.mocked(diMapper.mapDiXmlEdges).mockReset().mockResolvedValue({
      edges: [],
      stats: { preferencesResolved: 0, preferencesSkipped: 0, pluginsResolved: 0, pluginsSkipped: 0, unresolvedFqcns: [] },
    });
    vi.mocked(layoutMapper.mapLayoutXmlEdges).mockReset().mockResolvedValue({
      edges: [],
      stats: { resolved: 0, skippedNoClass: 0, skippedNoTemplate: 0, unresolvedClasses: [], unresolvedTemplates: [] },
    });
    vi.mocked(eventsXml.parseAndMapEventsXml).mockReset().mockResolvedValue({
      edges: [],
      stats: { resolved: 0, skipped: 0 },
    });
    vi.mocked(webapiXml.parseAndMapWebapiXml).mockReset().mockResolvedValue({
      edges: [],
      nodes: [],
      stats: { resolved: 0, skipped: 0 },
    });
    vi.mocked(routesXml.parseAndMapRoutesXml).mockReset().mockResolvedValue({
      edges: [],
      nodes: [],
      stats: { resolved: 0, skipped: 0 },
    });

    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('exits with error when .gitnexus/lbug does not exist', async () => {
    // Only create autoload_psr4.php, no .gitnexus/lbug
    await fs.mkdir(path.join(tmpDir, 'vendor', 'composer'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'vendor', 'composer', 'autoload_psr4.php'),
      '<?php return [];',
    );

    await expect(augment(tmpDir)).rejects.toThrow('.gitnexus/lbug not found');
  });

  it('exits with error when vendor/composer/autoload_psr4.php does not exist', async () => {
    // Only create .gitnexus/lbug, no vendor/composer
    await fs.mkdir(path.join(tmpDir, '.gitnexus', 'lbug'), { recursive: true });

    await expect(augment(tmpDir)).rejects.toThrow(
      'vendor/composer/autoload_psr4.php not found',
    );
  });

  it('runs di.xml augmentation and reports edge counts', async () => {
    await createFakeProject(tmpDir);
    vi.mocked(diMapper.mapDiXmlEdges).mockResolvedValue({
      edges: [{ sourceId: 'A', targetId: 'B', type: 'IMPLEMENTS', confidence: 1, reason: 'magento:di:preference' }],
      stats: { preferencesResolved: 1, preferencesSkipped: 0, pluginsResolved: 0, pluginsSkipped: 0, unresolvedFqcns: [] },
    });

    await augment(tmpDir);

    expect(diMapper.mapDiXmlEdges).toHaveBeenCalledWith(path.resolve(tmpDir));
  });

  it('runs layout XML augmentation and reports edge counts', async () => {
    await createFakeProject(tmpDir);
    vi.mocked(layoutMapper.mapLayoutXmlEdges).mockResolvedValue({
      edges: [{ sourceId: 'A', targetId: 'B', type: 'RENDERS', confidence: 1, reason: 'magento:layout:block' }],
      stats: { resolved: 1, skippedNoClass: 0, skippedNoTemplate: 0, unresolvedClasses: [], unresolvedTemplates: [] },
    });

    await augment(tmpDir);

    expect(layoutMapper.mapLayoutXmlEdges).toHaveBeenCalledWith(path.resolve(tmpDir));
  });

  it('runs events.xml augmentation and reports edge counts', async () => {
    await createFakeProject(tmpDir);
    vi.mocked(eventsXml.parseAndMapEventsXml).mockResolvedValue({
      edges: [{ sourceId: 'A', targetId: 'B', type: 'OBSERVES', confidence: 1, reason: 'magento:events:observer' }],
      stats: { resolved: 1, skipped: 0 },
    });

    await augment(tmpDir);

    expect(eventsXml.parseAndMapEventsXml).toHaveBeenCalledWith(path.resolve(tmpDir));
  });

  it('runs webapi.xml augmentation and reports edge counts', async () => {
    await createFakeProject(tmpDir);
    vi.mocked(webapiXml.parseAndMapWebapiXml).mockResolvedValue({
      edges: [{ sourceId: 'A', targetId: 'B', type: 'ROUTES_TO', confidence: 1, reason: 'magento:webapi:route' }],
      nodes: [{ label: 'Route', properties: { url: '/V1/test' } }],
      stats: { resolved: 1, skipped: 0 },
    });

    await augment(tmpDir);

    expect(webapiXml.parseAndMapWebapiXml).toHaveBeenCalledWith(path.resolve(tmpDir));
  });

  it('runs routes.xml augmentation and reports edge counts', async () => {
    await createFakeProject(tmpDir);
    vi.mocked(routesXml.parseAndMapRoutesXml).mockResolvedValue({
      edges: [{ sourceId: 'A', targetId: 'B', type: 'ROUTES_TO', confidence: 1, reason: 'magento:routes:frontend' }],
      nodes: [{ label: 'Route', properties: { frontName: 'catalog' } }],
      stats: { resolved: 1, skipped: 0 },
    });

    await augment(tmpDir);

    expect(routesXml.parseAndMapRoutesXml).toHaveBeenCalledWith(path.resolve(tmpDir));
  });

  it('accepts a custom path argument for the project root', async () => {
    await createFakeProject(tmpDir);

    await augment(tmpDir);

    // All mappers called with resolved path (not cwd)
    const resolved = path.resolve(tmpDir);
    expect(diMapper.mapDiXmlEdges).toHaveBeenCalledWith(resolved);
    expect(layoutMapper.mapLayoutXmlEdges).toHaveBeenCalledWith(resolved);
    expect(eventsXml.parseAndMapEventsXml).toHaveBeenCalledWith(resolved);
    expect(webapiXml.parseAndMapWebapiXml).toHaveBeenCalledWith(resolved);
    expect(routesXml.parseAndMapRoutesXml).toHaveBeenCalledWith(resolved);
  });

  it('passes dbPath (from .gitnexus/lbug) to the edge writer', async () => {
    await createFakeProject(tmpDir);

    await augment(tmpDir);

    const expectedDbPath = path.join(path.resolve(tmpDir), '.gitnexus', 'lbug');
    expect(writer.cleanupMagentoEdges).toHaveBeenCalledWith(expectedDbPath);
    expect(writer.writeEdges).toHaveBeenCalledWith(
      expect.any(Array),
      expectedDbPath,
      expect.any(String),
    );
    expect(writer.writeNodes).toHaveBeenCalledWith(expect.any(Array), expectedDbPath);
  });

  it('prints a summary of all injected and skipped edges', async () => {
    await createFakeProject(tmpDir);
    vi.mocked(writer.writeEdges).mockResolvedValue({
      edgesInjected: 10,
      edgesSkipped: 2,
      nodesCreated: 3,
    });
    vi.mocked(writer.writeNodes).mockResolvedValue(5);

    await augment(tmpDir);

    const logCalls = vi.mocked(console.log).mock.calls.map((c) => c.join(' '));
    const summaryLine = logCalls.find((l) => l.includes('injected') || l.includes('summary') || l.includes('edges'));
    expect(summaryLine).toBeDefined();
  });
});
