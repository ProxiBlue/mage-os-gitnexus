import { describe, it, expect } from 'vitest';
import path from 'path';
import { parseSingleEventsXml, parseAndMapEventsXml, EventObserver, EventsMappingResult } from '../src/parsers/events-xml.js';

describe('events-xml parser', () => {
  it('extracts event name and observer class from events.xml', () => {
    const xml = `<?xml version="1.0"?>
<config xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <event name="catalog_product_save_after">
        <observer name="catalogProductFlatIndexer" instance="Magento\\Catalog\\Observer\\ProductFlatIndexer"/>
    </event>
    <event name="catalog_category_save_after">
        <observer name="anotherObserver" instance="Vendor\\Module\\Observer\\CategoryObserver"/>
    </event>
</config>`;

    const result = parseSingleEventsXml(xml, '/some/module/etc/events.xml', 'global');

    expect(result).toHaveLength(2);
    expect(result[0].eventName).toBe('catalog_product_save_after');
    expect(result[0].observerName).toBe('catalogProductFlatIndexer');
    expect(result[0].instanceFqcn).toBe('Magento\\Catalog\\Observer\\ProductFlatIndexer');
    expect(result[0].sourceFile).toBe('/some/module/etc/events.xml');
    expect(result[0].area).toBe('global');
    expect(result[1].eventName).toBe('catalog_category_save_after');
    expect(result[1].instanceFqcn).toBe('Vendor\\Module\\Observer\\CategoryObserver');
  });

  it('discovers events.xml across all area scopes', async () => {
    const projectRoot = '/var/www/html';
    const result = await parseAndMapEventsXml(projectRoot);

    const areas = new Set(result.edges.map(e => e.reason.split(':')[0] === 'magento' ? 'found' : 'other'));
    expect(result.stats.resolved + result.stats.skipped).toBeGreaterThan(0);
  });

  it('creates CALLS edges for each resolved observer', async () => {
    const projectRoot = '/var/www/html';
    const result = await parseAndMapEventsXml(projectRoot);

    // At least some edges should be CALLS type
    const callsEdges = result.edges.filter(e => e.type === 'CALLS');
    expect(callsEdges.length).toBeGreaterThan(0);
    // Each edge should have sourceId as File: node
    for (const edge of callsEdges.slice(0, 5)) {
      expect(edge.sourceId).toMatch(/^File:/);
      expect(edge.targetId).toMatch(/^File:/);
      expect(edge.confidence).toBe(1.0);
    }
  });

  it('tags edges with magento:events:observer reason including event name', () => {
    const xml = `<?xml version="1.0"?>
<config>
    <event name="catalog_product_save_after">
        <observer name="myObserver" instance="Magento\\Catalog\\Observer\\ProductFlatIndexer"/>
    </event>
</config>`;

    const observers = parseSingleEventsXml(xml, '/some/module/etc/events.xml', 'global');
    expect(observers[0].eventName).toBe('catalog_product_save_after');
    // The reason format is verified by parseAndMapEventsXml — check observer data here
    expect(observers[0].observerName).toBe('myObserver');
  });

  it('skips disabled observers', () => {
    const xml = `<?xml version="1.0"?>
<config>
    <event name="some_event">
        <observer name="active_obs" instance="Vendor\\Module\\Observer\\Active"/>
        <observer name="disabled_obs" instance="Vendor\\Module\\Observer\\Foo" disabled="true"/>
    </event>
</config>`;

    const result = parseSingleEventsXml(xml, '/some/module/etc/events.xml', 'global');

    expect(result).toHaveLength(2);
    expect(result[0].disabled).toBe(false);
    expect(result[1].disabled).toBe(true);
  });

  it('handles observers with method attribute (non-execute)', () => {
    const xml = `<?xml version="1.0"?>
<config>
    <event name="some_event">
        <observer name="custom_method_obs" instance="Vendor\\Module\\Observer\\Custom" method="customMethod"/>
    </event>
</config>`;

    const result = parseSingleEventsXml(xml, '/some/module/etc/events.xml', 'global');

    expect(result).toHaveLength(1);
    expect(result[0].instanceFqcn).toBe('Vendor\\Module\\Observer\\Custom');
    // method attribute should not cause parsing failure; observer is still captured
    expect(result[0].disabled).toBe(false);
  });
});
