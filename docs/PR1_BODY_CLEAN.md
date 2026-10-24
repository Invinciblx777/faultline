FAULTLINE-Repair: 268eeabb-af9e-4b86-828b-fbcf065f2a88

## Summary
When `GET /api/inventory` returns an error, `/shop/` showed "We couldn't load products right now." with no products, so the "Buy a backpack" journey broke at step 2.

**Root cause (I confirmed this):** `loadStorefront()` in `public/shop/shop.js` fetched both endpoints with `Promise.all([getJSON("/api/catalog"), getJSON("/api/inventory")])`. When the inventory request failed, the whole promise rejected, and the code went straight to the catalog-error branch. The catalog data had loaded fine, but it was never rendered.

**Fix:** the page now treats stock levels as extra information. Products still show when stock can't be loaded.
```js
const [catalog, inventory] = await Promise.allSettled([...]);
if (catalog rejected)        -> existing error state + Try again   (unchanged)
if (inventory has .stock)    -> state.stock = stock; "3 products"   (unchanged)
else                         -> state.stock = null;
                                "3 products · Stock levels are unavailable right now." + Try again
renderProducts(); renderCart();
```
`renderProducts()` treats `state.stock === null` as "stock unknown". Each product then shows "Stock level unavailable" and its Add to cart button stays enabled. Clicking Try again reloads both endpoints, and stock levels come back once the inventory endpoint recovers. Normal behaviour is unchanged: stock counts, "Out of stock" and the disabled Camp Bottle button all work as before.

Fault state after the fix (inventory returning 503):

### Tests added
- `e2e/shop.spec.mjs` (Playwright; run with `npm run test:e2e`; `playwright.config.mjs` starts `server.mjs` on :4610). `@playwright/test` is added as a dev dependency only, so there are still no runtime dependencies.
  - normal journey: stock levels shown, Camp Bottle disabled, checkout total `$93.50`, Place order enabled
  - `/api/inventory` returns 503: products listed, stock shown as "Stock level unavailable", full checkout works
  - Try again after inventory recovers restores real stock levels (Camp Bottle disabled again)
  - `/api/catalog` returns 503: existing error and Try again state kept
- The two inventory tests **fail on `main`** and pass with this change. I checked by running them against the original `shop.js`.

### Tests run (Node 22.23.4, Playwright 1.56.1, Chromium)
| Command | Result |
|---|---|
| `npm test` (node --test) | 4/4 passed |
| `npm run test:e2e` | 4/4 passed |
| FAULTLINE regression test `faultline-get-api-inventory-http-error-5f64dd02.spec.ts` (unchanged, SHA-256 `c171b00e…a3a` verified) against `http://localhost:4600` | **before fix: failed at step 2** (reproduced); **after fix: passed** |

## Known limitations
- While stock is unknown, all products can be added to the cart, including ones that are actually out of stock (such as Camp Bottle). `/api/orders` does not check stock on the server, so an out-of-stock item could be ordered while inventory is down. This was a product decision I made so customers can keep buying; a server-side stock check at order time would close the gap.
- The regression test file is not committed. FAULTLINE keeps its own copy, and the new e2e tests cover the same behaviour.
- If `/api/catalog` fails, the page still shows the error state. That is expected because no product data exists without the catalog.

Link to Devin session: https://app.devin.ai/sessions/60a680e3098142b0b1b2ca8fca9cf27a
Open in Devin Desktop: https://app.devin.ai/desktop/session/60a680e3098142b0b1b2ca8fca9cf27a?variant=devin
