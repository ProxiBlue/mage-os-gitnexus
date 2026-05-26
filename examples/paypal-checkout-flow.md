# Practical example: mapping the PayPal checkout flow

Real-world test: "show me all files and functions involved when placing an order with PayPal payment." Two approaches compared — Cypher (structural graph query) vs keyword search (`query` tool).

## Approach 1: Cypher (recommended for module-level mapping)

Cypher queries the graph structure directly. Two queries return the complete PayPal module inventory:

**Query 1 — backend files (controllers, models, observers, plugins, gateway):**

```cypher
MATCH (f:File)
WHERE f.filePath CONTAINS 'module-paypal/'
  AND (f.filePath CONTAINS '/Controller/'
    OR f.filePath CONTAINS '/Observer/'
    OR f.filePath CONTAINS '/Plugin/'
    OR f.filePath CONTAINS '/Model/Express'
    OR f.filePath CONTAINS '/Model/Api/'
    OR f.filePath CONTAINS '/Model/Payflow'
    OR f.filePath CONTAINS '/Gateway/')
  AND NOT f.filePath CONTAINS 'Adminhtml'
  AND NOT f.filePath CONTAINS 'graph-ql'
  AND NOT f.filePath CONTAINS 'captcha'
RETURN f.filePath ORDER BY f.filePath
```

**Result: 109 PHP files** — every controller, model, API client, gateway command, observer, and plugin in the PayPal module.

| Category | Count | Key files |
|---|---:|---|
| Express controllers | 13 | `Start`, `ReturnAction`, `PlaceOrder`, `GetToken`, `OnAuthorization`, `Review`, `Cancel`, ... |
| Payflow controllers | 13 | `Form`, `ReturnUrl`, `SilentPost`, `CancelPayment` (Link, Advanced, Express variants) |
| Transparent controllers | 3 | `RequestSecureToken`, `Response`, `Redirect` |
| Other controllers | 11 | IPN, HostedPro, BML, Billing Agreement |
| Express models | 5 | `Express.php`, `Checkout.php`, `QuotePlugin.php`, `LocaleResolver.php`, `ConfigProvider.php` |
| API clients | 4 | `Nvp.php` (1,819 lines), `PayflowNvp.php`, `AbstractApi.php`, `ProcessableException.php` |
| Payflow models | 15 | `Transparent.php`, `Pro.php`, `Gateway.php`, validators, handlers |
| Gateway commands | 2 | `AuthorizationCommand.php`, `SaleCommand.php` |
| Observers | 7 | `SaveOrderAfterSubmitObserver`, `AddBillingAgreementToSession`, `HtmlTransactionId`, ... |
| Plugins | 7 | `OrderCanInvoice`, `ValidatorCanInvoice`, `TransparentOrderPayment`, `CheckoutIndex`, ... |

**Query 2 — frontend files (JS, templates, layouts):**

```cypher
MATCH (f:File)
WHERE f.filePath CONTAINS 'module-paypal/view/frontend'
RETURN f.filePath ORDER BY f.filePath
```

**Result: 89 frontend files:**

| Category | Count | Key files |
|---|---:|---|
| Layout XML | 25 | `checkout_index_index.xml`, `paypal_express_review.xml`, `transparent_payment_redirect.xml`, ... |
| JS renderers | 10 | `paypal-express.js`, `payflowpro-method.js`, `iframe-methods.js`, `vault.js`, ... |
| Smart Buttons / SDK | 6 | `express-checkout-smart-buttons.js`, `paypal-sdk.js`, `button.js`, ... |
| JS actions/models | 8 | `set-payment-method.js`, `iframe.js`, `paypal-checkout.js`, `order-review.js`, ... |
| HTML templates | 10 | `paypal-express.html`, `payflowpro-form.html`, `iframe-methods.html`, ... |
| PHTML templates | 30 | `shortcut_button.phtml`, `review.phtml`, `form.phtml`, `redirect.phtml`, ... |

## Approach 2: symbol context + impact (recommended for understanding call chains)

The `context` and `impact` tools trace relationships through the graph. Starting from `Model/Express/Checkout.php`:

```
context({name: "Checkout", repo: "mageos", file_path: "vendor/mage-os/module-paypal/Model/Express/Checkout.php"})
```

Returns the class (lines 25–1,169) with **29 methods** including the checkout flow sequence:

| Method | Role in checkout flow |
|---|---|
| `start()` | Initiates PayPal session → calls `SetExpressCheckout` API |
| `returnFromPaypal()` | Handles return → calls `GetExpressCheckoutDetails` |
| `place()` | Creates order → triggers `DoExpressCheckoutPayment` |
| `prepareOrderReview()` | Prepares review page |
| `updateShippingMethod()` | Updates shipping from PayPal selection |
| `getShippingOptionsCallbackResponse()` | AJAX shipping callback |
| `_getApi()` | Gets NVP API instance |

Plus **7 direct callers** (depth 1):

- `Controller/Express/OnAuthorization.php`
- `Controller/Express/GetToken.php`
- `Controller/Express/GetTokenData.php`
- `Model/Express.php`
- `Block/Express/Form.php`
- `ViewModel/PaypalFundingSourceDataProvider.php`
- `module-paypal-graph-ql/Model/Provider/Checkout.php`

Running `impact({target: "Checkout", direction: "upstream"})` extends to **16 files across 3 depths**, revealing the full dependency chain up to admin controllers and GraphQL resolvers.

The NVP API class (`Model/Api/Nvp.php`, lines 25–1,819) exposes all PayPal API calls:

| Method | PayPal API |
|---|---|
| `callSetExpressCheckout()` | `SetExpressCheckout` |
| `callGetExpressCheckoutDetails()` | `GetExpressCheckoutDetails` |
| `callDoExpressCheckoutPayment()` | `DoExpressCheckoutPayment` |
| `callDoAuthorization()` | `DoAuthorization` |
| `callDoCapture()` | `DoCapture` |
| `callDoVoid()` | `DoVoid` |
| `callRefundTransaction()` | `RefundTransaction` |
| `call()` | Generic API call (HTTP POST) |

## Which approach to use

| Goal | Best tool | Why |
|---|---|---|
| "List all files in module X" | `cypher` | Direct graph query, exact results, no ranking noise |
| "What calls this class?" | `context` | Returns categorized incoming/outgoing refs |
| "What breaks if I change X?" | `impact` | Traverses dependency graph with depth levels |
| "How does concept X work?" | `query` | Keyword + semantic search across execution flows |
| "Trace the full call chain" | `cypher` with `CALLS` edges | Follow `CodeRelation {type: 'CALLS'}` edges |

## Cost comparison

The Cypher approach used **~25–35k tokens** (~$1–2 USD on Opus) across 6 MCP calls. An equivalent manual search using an Explore agent reading dozens of files consumed **~70–100k tokens** (~$2–4 USD) — 3–4x more expensive, with unstructured output that required manual verification.
