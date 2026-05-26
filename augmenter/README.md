# augmenter — Magento XML graph augmenter for GitNexus

A post-processor that runs after `gitnexus analyze` and injects the dependency edges that PHP static analysis can't see — plugins, observers, layout block/template bindings, REST routes, and frontend route handlers. These all live in Magento's XML configs (`di.xml`, `events.xml`, layout XML, `webapi.xml`, `routes.xml`) and are invisible to tree-sitter parsing of PHP source.

Was a separate project ([`ProxiBlue/gitnexus-magento`](https://github.com/ProxiBlue/gitnexus-magento)). Folded into this repo so it ships with — and runs automatically during — every `REBUILD=1` invocation of the Docker image.

## Why this exists

GitNexus reads PHP source via tree-sitter and produces a graph of classes, methods, calls, imports, inheritance, etc. That graph is complete for code-to-code relationships expressed *in PHP syntax* — but Magento doesn't wire most of its dependencies in PHP. It wires them in XML:

- **`etc/di.xml`** declares interface→implementation preferences (`<preference>`) and plugin registrations (`<plugin>`). Without these, the graph can't tell you that `ProductRepository` is actually `Magento\Catalog\Model\ProductRepository` or that `Captcha\Model\Cart\ConfigPlugin` wraps `Checkout\Block\Cart\Sidebar`.
- **`view/*/layout/*.xml`** binds blocks to templates. Without this, "where is this `.phtml` rendered" has no answer in the graph.
- **`etc/events.xml`** binds observers to events. Without this, "what observes `sales_order_place_after`" has no answer either.
- **`etc/webapi.xml`** maps REST endpoints (`GET /V1/carts/mine`) to service-contract methods. Without this, the graph has no Route nodes for the REST API.
- **`etc/{frontend,adminhtml}/routes.xml`** registers HTTP frontnames. Without this, "what handles `/customer/account/login`" can't resolve in-graph.

The augmenter parses each of these and writes the corresponding edges/nodes into the same lbug GitNexus produced. After running, the graph contains both the PHP-derived relationships and the XML-derived ones. MCP queries don't know or care which is which — it's one graph.

Augmented edges are tagged with `reason: "magento:<source>"` so they're identifiable and idempotently removable when the augmenter re-runs.

## Worked example — "show me all plugins on the Cart model"

Real-world query against the same Mage-OS 2.3.0 index. Same question, asked two ways.

### Without the augmenter (PHP graph only)

The AI assistant has no way to find plugin registrations through the graph (di.xml isn't indexed), so it fans out:

1. `find_symbol` for `Cart` to locate candidate target classes
2. `context` on the matches to see incoming references
3. `query` with keyword `"plugin cart"` — returns Plugin-named PHP classes via BM25 but misses any plugin whose class doesn't include "Plugin" in its name
4. `impact` on Cart-related classes to widen the net
5. `cypher` to filter the union — gets a partial list
6. **Falls back to `Grep "<plugin"` against the workspace's `di.xml` files** to find what the graph missed
7. Manually reconciles the two result sets

**Cost:** ~25–35k tokens across the MCP calls + a file-system grep round-trip. The result is *still incomplete* — plugins on classes the AI didn't think to search are silently missed, and there's no way to verify completeness against a ground truth.

### With the augmenter (PHP graph + XML edges)

After `augmenter augment`, every `<plugin>` declaration in every `di.xml` is now a `WRAPS` edge with `reason: "magento:di:plugin"`. The complete answer is one Cypher query:

```cypher
MATCH (plugin)-[r {type: 'WRAPS'}]->(target)
WHERE r.reason = 'magento:di:plugin'
  AND target.name CONTAINS 'Cart'
RETURN plugin.name AS plugin_class,
       target.name AS target_class,
       r.alias     AS plugin_name
ORDER BY target.name, r.alias
```

Returns the complete set deterministically — every registered plugin, no false positives from naming-convention guessing, no missed entries. Example output on Mage-OS 2.3.0:

| plugin_name | target_class | plugin_class |
|---|---|---|
| `login_captcha` | `Checkout\Block\Cart\Sidebar` | `Captcha\Model\Cart\ConfigPlugin` |
| `customer_cart` | `Checkout\Block\Cart\Sidebar` | `Customer\Model\Cart\ConfigPlugin` |
| `coupon_label_plugin` | `Quote\Model\Cart\CartTotalRepository` | `SalesRule\Plugin\CartTotalRepository` |
| `Downloadable` | `Catalog\Model\Product\CartConfiguration` | `Downloadable\Model\Product\CartConfiguration\Plugin\Downloadable` |
| `isProductConfigured` | `Catalog\Model\Product\CartConfiguration` | `GroupedProduct\Model\Product\Cart\Configuration\Plugin\Grouped` |
| `persistent_convert_customer_cart_to_guest_cart` | `Quote\Api\CartRepositoryInterface` | `Persistent\Model\Plugin\ConvertCustomerCartToGuest` |

**Cost:** one `cypher` MCP call (~2k tokens), structured tabular response, complete and verifiable.

### Same pattern applies to

| Question | Without augmenter | With augmenter |
|---|---|---|
| *"What observes `sales_order_place_after`?"* | Keyword search + `grep events.xml` | `MATCH ... reason STARTS WITH 'magento:events:observer:sales_order_place_after'` |
| *"Where is `cart/sidebar.phtml` rendered?"* | Filesystem grep + manual block tracing | `MATCH (block)-[r]->(template) WHERE r.reason = 'magento:layout:block-template' AND template.filePath ENDS WITH 'cart/sidebar.phtml'` |
| *"Which handler serves `POST /V1/carts/mine/items`?"* | Search `webapi.xml` | `MATCH (handler)-[r]->(route) WHERE r.reason = 'magento:webapi:route' AND route.name = 'POST /V1/carts/mine/items'` |

Each is a multi-call/grep dance without augmentation, one direct Cypher query with it.

## What gets injected

| XML source | Edge / node | What it links | `reason` tag |
|---|---|---|---|
| `etc/di.xml` `<preference>` | `IMPLEMENTS` | Interface → concrete class | `magento:di:preference` |
| `etc/di.xml` `<plugin>` | `WRAPS` | Plugin class → target class | `magento:di:plugin` |
| `view/*/layout/*.xml` | `CALLS` (Class→File) | Block class → template file | `magento:layout:block-template` |
| `etc/events.xml` | `CALLS` (File→Class) | events.xml → observer class | `magento:events:observer:<event>` |
| `etc/webapi.xml` | `HANDLES_ROUTE` + `Route` node | Service handler → REST route | `magento:webapi:route` |
| `etc/{frontend,adminhtml}/routes.xml` | `HANDLES_ROUTE` + `Route` node | routes.xml → frontend route | `magento:routes:controller` |

## Integration

The augmenter runs **automatically** as part of the `REBUILD=1` flow of the parent Docker image. When you rebuild the Mage-OS index against your own project:

```bash
docker run --rm -it -e REBUILD=1 -v /path/to/your/mageos:/project -v mageos-index:/output mage-os-gitnexus:latest
```

Inside the container, the sequence is:

1. `gitnexus analyze --force /project` — builds the base PHP graph
2. `node /augmenter/dist/cli.js augment /project` — adds the XML-derived edges
3. `tar` and ship to `/output/mageos/`

The published GitHub release tarball (`mageos-X.Y.Z`) therefore contains a graph that already has the XML edges baked in. End users running the image don't run the augmenter themselves — they just get the result.

## Failure behavior

The augmenter is **best-effort**. A bad XML file, an unresolved FQCN, a schema mismatch against a future GitNexus version, or any other write failure produces a warning on stderr and a count in the final summary — it does **not** fail the rebuild. The base PHP graph from `gitnexus analyze` is the load-bearing artifact; XML augmentation is additive value on top.

Example summary on a successful run:

```
--- Augmentation Summary ---
  Nodes created:   556
  Edges injected:  4505
Augmentation complete.
```

Example summary on a partial failure:

```
--- Augmentation Summary ---
  Nodes created:   556
  Nodes failed:    3
  Edges injected:  4500
  Edges failed:    5
Augmentation completed with warnings (see [lbug-writer] / [augment] lines above).
```

Either way, the lbug is intact and the tarball gets shipped.

## Development

Run from inside `augmenter/`:

```bash
npm install
npm run build       # tsc → dist/
npm test            # vitest
```

### Layout

```
src/
├── cli.ts                      # CLI entry point
├── augment.ts                  # Orchestrator — runs all phases with isolation
├── resolvers/
│   ├── psr4-map.ts             # PSR-4 autoload parser
│   ├── node-id.ts              # FQCN → GitNexus node ID
│   └── template-path.ts        # Vendor_Module:: → file path
├── parsers/
│   ├── di-xml.ts               # di.xml parser
│   ├── di-xml-mapper.ts        # di.xml → edges
│   ├── layout-xml.ts           # Layout XML parser
│   ├── layout-xml-mapper.ts    # Layout XML → edges
│   ├── events-xml.ts           # events.xml parser + mapper
│   ├── webapi-xml.ts           # webapi.xml parser + mapper
│   └── routes-xml.ts           # routes.xml parser + mapper
└── writer/
    └── lbug-writer.ts          # CSV generation + DB writes (resilient)
```

### Requirements

- Node 20+ (the parent Docker image ships Node 22).
- GitNexus installed globally (`/usr/local/lib/node_modules/gitnexus`) — provides the lbug adapter the writer imports. The parent image satisfies this; standalone use needs `npm install -g gitnexus`.
- A Magento 2 / Mage-OS project on disk with `vendor/composer/autoload_psr4.php` (for PSR-4 resolution) and the pre-built `.gitnexus/lbug` to augment.

## License

MIT (same as the parent repo).
