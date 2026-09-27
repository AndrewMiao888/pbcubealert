# 3x3 Stock Dashboard

A Nuxt 4 / Vue 3 dashboard backed by a same-origin Nitro API. Requires Node 22+ (tested on Node 24).

```sh
npm install
npm run dev
```

Open the URL printed by Nuxt. The old standalone `index.html` has been replaced by `app/app.vue`; this project needs a running Node server.

```sh
npm test
npm run typecheck
npm run build
npm run preview
```

For deployment, run `node .output/server/index.mjs` after building. Set environment variables on the host; production does not automatically read `.env`.

## Configuration

Copy `.env.example` to `.env` to override the store URL, collection, displayed store name, requested currency, refresh interval, low-stock threshold or pagination limit. Prices default to **AUD**: every catalog page requests `currency=AUD`, and the API verifies that the store accepts that currency using its cart currency response. The UI formats the currency returned with the catalog, and product links request that same currency. The store supplies the converted amounts; the app does not use a fixed exchange rate or relabel USD prices. An empty `NUXT_COLLECTION_HANDLE` reads the whole store catalog and filters by 3x3 product type/title. Auto-refresh runs while the page is visible, with a minimum interval of 30 seconds; use 0 to disable it.

## Data behavior

- No curated cube list, default favorite, fixed brand list, product handles, prices or generation rankings. Brands, title versions, variant names, product links, publication dates and prices come from the current feed. Version filters reflect explicit V-number text only; no undocumented model mappings are inferred.
- The API fetches every page until an empty page, deduplicates products, and rejects incomplete or repeated-page responses. A failed refresh keeps the previous successful catalog visibly marked as stale. First-load errors show a retryable empty state, never fabricated inventory.
- Availability uses variant `available` flags. An available product may be a preorder. Exact quantity is displayed only when every variant exposes inventory; public feeds commonly omit it. Low stock means a positive known total below the configured threshold. Missing availability is unknown, not sold out.
- Prices are the minimum across listed variants, including sold-out variants. The average uses only known starting prices. Product pages remain the source for the selected variant's final price and purchase conditions.
- Favorites are stored locally, with no preselected product. Existing `scs_favorites` IDs/handles are supported. Blocked or malformed browser storage does not prevent loading products.
- Remote descriptions are never injected as HTML. Requests go through the Nuxt server, without public CORS proxies. Source settings are server configuration, not request-controlled URLs.

Nuxt configuration follows the [Nuxt 4 server directory](https://nuxt.com/docs/4.x/directory-structure/server) and [runtime configuration](https://nuxt.com/docs/4.x/guide/going-further/runtime-config) documentation.
