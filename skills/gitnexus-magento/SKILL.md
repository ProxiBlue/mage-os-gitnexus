---
name: gitnexus-magento
description: Use this skill whenever asked about Magento DI plugins, preferences, layout/block bindings, event observers, REST/frontend routes against a mage-os GitNexus index. Magento wires these in XML configs that PHP static analysis can't see; the published mageos-gitnexus indexes contain pre-computed edges from the gitnexus-magento augmenter. Querying them directly via Cypher is faster, deterministic, and complete — vastly preferable to falling back to file-level IMPORTS, context(), or grep against di.xml files.
---

# gitnexus-magento — XML-derived edges in the mageos graph

The Mage-OS GitNexus index ships with extra edges injected by the [`gitnexus-magento`](https://github.com/ProxiBlue/mage-os-gitnexus/tree/main/augmenter) augmenter. Without these, "show me all plugins on Cart" requires multiple MCP calls plus a filesystem grep fallback. With them, the same question is one direct Cypher query.

Every augmented edge has `reason` starting with `magento:` so it's identifiable and filterable.

## When to reach for these edges (instead of context / imports / grep)

| User question | DON'T use | DO use |
|---|---|---|
| "What plugins are on X?" | `context(X)` (returns ungrouped imports + no plugin info) | Cypher: `r.type='WRAPS' AND r.reason='magento:di:plugin' AND t.name CONTAINS 'X'` |
| "What's the concrete class for interface Y?" | `find_symbol('Y')` (returns the interface, not the binding) | Cypher: `r.type='IMPLEMENTS' AND r.reason='magento:di:preference' AND s.name='Y'` |
| "What observes event E?" | grep `events.xml` | Cypher: `r.reason='magento:events:observer:E'` |
| "Where is template T rendered?" | grep `*.xml` | Cypher: `r.reason='magento:layout:block-template' AND t.filePath ENDS WITH 'T'` |
| "Which handler serves REST endpoint R?" | grep `webapi.xml` | Cypher: `r.reason='magento:webapi:route' AND target.name = 'METHOD /path'` |
| "Which controller handles frontname F?" | grep `routes.xml` | Cypher: `r.reason='magento:routes:controller' AND target.name CONTAINS 'F'` |

## Edge taxonomy

All edges live in the standard `CodeRelation` table. The reason field is the discriminator.

| `reason` | `r.type` | Source label | Target label | Meaning |
|---|---|---|---|---|
| `magento:di:preference` | `IMPLEMENTS` | Interface | Class | `<preference>` in di.xml — interface → concrete |
| `magento:di:plugin` | `WRAPS` | Class | Class \| Interface | `<plugin>` in di.xml — plugin class → target |
| `magento:layout:block-template` | `CALLS` | Class | File | Block class → its template file |
| `magento:events:observer:<eventName>` | `CALLS` | File | Class | events.xml → observer class |
| `magento:webapi:route` | `HANDLES_ROUTE` | File | Route | Service handler → REST route node |
| `magento:routes:controller` | `HANDLES_ROUTE` | File | Route | routes.xml → frontend route node |

`Route` nodes have `id`, `name` (e.g. `GET /V1/carts/mine` or `frontend:checkout`), and `filePath` (the XML file they came from).

## Concrete queries

### All plugins on a target

```cypher
MATCH (plugin)-[r:CodeRelation]->(target)
WHERE r.type = 'WRAPS' AND r.reason = 'magento:di:plugin'
  AND target.name CONTAINS 'Cart'
RETURN plugin.name AS plugin_class,
       plugin.filePath AS plugin_file,
       target.name    AS target_class,
       target.filePath AS target_file,
       r.alias        AS plugin_alias
ORDER BY target.filePath, r.alias
```

Use `target.filePath` (not just `.name`) when disambiguating — many Magento classes share names across modules.

### Preferences (interface → concrete)

```cypher
MATCH (iface)-[r:CodeRelation]->(impl)
WHERE r.type = 'IMPLEMENTS' AND r.reason = 'magento:di:preference'
  AND iface.name = 'ProductRepositoryInterface'
RETURN impl.name, impl.filePath
```

### Observers for an event

```cypher
MATCH (src)-[r:CodeRelation]->(observer)
WHERE r.reason STARTS WITH 'magento:events:observer:sales_order_place_after'
RETURN observer.name, observer.filePath, r.reason
```

The eventName is baked into the `reason` suffix, so `STARTS WITH` matches all observers of that event across `events.xml` / `frontend/events.xml` / `adminhtml/events.xml`.

### Block-to-template bindings

```cypher
MATCH (block)-[r:CodeRelation]->(template)
WHERE r.reason = 'magento:layout:block-template'
  AND template.filePath ENDS WITH 'cart/sidebar.phtml'
RETURN block.name, block.filePath
```

### REST endpoint handler

```cypher
MATCH (handler)-[r:CodeRelation]->(route:Route)
WHERE r.reason = 'magento:webapi:route'
  AND route.name = 'POST /V1/carts/mine/items'
RETURN handler.filePath, route.name
```

### Inventory: how many augmented edges exist?

```cypher
MATCH ()-[r:CodeRelation]->()
WHERE r.reason STARTS WITH 'magento:'
RETURN r.reason, count(*) AS n
ORDER BY n DESC
```

If this returns 0, the index does NOT have augmentation. Fall back to the without-augmenter strategy (multi-call discovery + grep) and surface a one-line note that the queries would be cheaper against an augmented index (`docker build` against latest `mage-os-gitnexus:latest`, or rebuild your own index with `gitnexus-magento augment`).

## Group queries (across mageos + hyva + deps + custom mounts)

When the user is querying via `repo: "@mageos-project"` (the group), the same Cypher patterns work — gitnexus federates the query across all member repos with RRF ranking. Note: edges only resolve **within** a single repo's lbug (split-index limitation). A plugin in `/mounts/myvendor` targeting `Magento\Catalog\Model\Product` will NOT appear as a WRAPS edge in either lbug — only in-mount plugins are linked. For full cross-augmentation, the user needs a unified `REBUILD=1` against their whole project.

## When NOT to use these queries

- For runtime/dynamic dispatch (e.g. plugins applied conditionally via virtualType). Augmenter writes declared plugins from `di.xml`; conditional/programmatic plugin behavior happens at runtime.
- For UI components defined entirely in JS (`Magento_Ui/js/...`). Those are JS modules indexed as Files but not augmented with XML edges.
- When the index is older than 2026-05-26 (no augmentation). Run the inventory query above to check before assuming.
