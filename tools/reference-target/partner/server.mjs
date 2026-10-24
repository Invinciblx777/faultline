/**
 * Simulated third-party partner for the FAULTLINE reference target.
 *
 * Runs on its own origin (a separate port) so the storefront has a genuine
 * cross-origin dependency: an embeddable reviews widget with a CORS API and an
 * analytics script. It is test infrastructure, not a FAULTLINE component.
 */
import { createServer } from "node:http";

const reviews = {
  "TB-01": [
    { author: "Sam", rating: 5, text: "Carried it across the Lost Coast trail. Holds up." },
    { author: "Priya", rating: 4, text: "Great pockets, a little heavy." },
  ],
};

const widget = (origin) => `// Partner reviews widget (third-party script).
(async () => {
  const mount = document.getElementById("reviews");
  if (!mount) return;
  try {
    const res = await fetch(${JSON.stringify(origin)} + "/api/reviews?sku=" + encodeURIComponent(mount.dataset.sku || ""));
    const data = await res.json();
    mount.innerHTML = "";
    for (const review of data.reviews) {
      const p = document.createElement("p");
      p.textContent = "\\u2605".repeat(review.rating) + " " + review.text + " \\u2014 " + review.author;
      mount.append(p);
    }
  } catch (error) {
    mount.textContent = "Reviews are unavailable.";
  }
})();
`;

const analytics = (origin) => `// Partner analytics (third-party script).
fetch(${JSON.stringify(origin)} + "/collect", { method: "POST", mode: "no-cors", keepalive: true, body: JSON.stringify({ event: "pageview", path: location.pathname }) }).catch(() => {});
`;

/** @param {{ publicOrigin: string }} options Read on every request, so it may be set after the server binds a port. */
export function createPartnerServer(options) {
  return createServer((req, res) => {
    const publicOrigin = options.publicOrigin;
    const url = new URL(req.url ?? "/", "http://partner.local");
    const cors = { "access-control-allow-origin": "*" };
    if (url.pathname === "/widget/reviews.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache", ...cors }).end(widget(publicOrigin));
      return;
    }
    if (url.pathname === "/analytics.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache", ...cors }).end(analytics(publicOrigin));
      return;
    }
    if (url.pathname === "/api/reviews") {
      const sku = url.searchParams.get("sku") ?? "";
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cors }).end(JSON.stringify({ sku, reviews: reviews[sku] ?? [] }));
      return;
    }
    if (url.pathname === "/collect") {
      req.resume();
      res.writeHead(204, cors).end();
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
  });
}
