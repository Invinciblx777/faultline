// Northwind Supply storefront. Plain browser JavaScript, no framework.
const state = { products: [], stock: {}, cart: [] };

const $ = (selector) => document.querySelector(selector);
const money = (value) => `$${value.toFixed(2)}`;

async function getJSON(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  return response.json();
}

function subtotal() {
  return state.cart.reduce((sum, sku) => sum + (state.products.find((p) => p.sku === sku)?.price ?? 0), 0);
}

function renderCart() {
  const count = state.cart.length;
  $('[data-testid="cart-count"]').textContent = `${count} item${count === 1 ? "" : "s"}`;
  $('[data-testid="subtotal"]').textContent = `Subtotal ${money(subtotal())}`;
}

function renderProducts() {
  const list = $("#products");
  list.innerHTML = "";
  for (const product of state.products) {
    const inStock = (state.stock[product.sku] ?? 0) > 0;
    const item = document.createElement("li");
    item.className = "product";
    item.innerHTML = `
      <h3></h3>
      <p class="price"></p>
      <p class="stock"></p>
      <button type="button"></button>`;
    item.querySelector("h3").textContent = product.name;
    item.querySelector(".price").textContent = money(product.price);
    item.querySelector(".stock").textContent = inStock ? `${state.stock[product.sku]} in stock` : "Out of stock";
    const button = item.querySelector("button");
    button.textContent = "Add to cart";
    button.setAttribute("aria-label", `Add ${product.name} to cart`);
    button.disabled = !inStock;
    button.addEventListener("click", () => {
      state.cart.push(product.sku);
      renderCart();
    });
    list.append(item);
  }
}

async function loadStorefront() {
  const status = $("#catalog-status");
  const retry = $("#catalog-retry");
  status.textContent = "Loading products…";
  retry.hidden = true;
  try {
    // Product details and stock levels are fetched together and rendered once both arrive.
    const [catalog, inventory] = await Promise.all([getJSON("/api/catalog"), getJSON("/api/inventory")]);
    state.products = catalog.products;
    state.stock = inventory.stock;
    renderProducts();
    status.textContent = `${state.products.length} products`;
  } catch (error) {
    console.error("Storefront failed to load:", error.message);
    status.textContent = "We couldn't load products right now.";
    retry.hidden = false;
  }
}

async function loadRecommendations() {
  const list = $("#recommendations");
  try {
    const data = await getJSON("/api/recommendations?sku=TB-01");
    list.innerHTML = "";
    for (const name of data.items) {
      const li = document.createElement("li");
      li.textContent = name;
      list.append(li);
    }
  } catch {
    list.innerHTML = "<li>Recommendations are unavailable right now.</li>";
  }
}

$("#catalog-retry").addEventListener("click", loadStorefront);

$("#quote-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const zip = $("#zip").value.trim();
  const total = $('[data-testid="order-total"]');
  const placeOrder = $("#place-order");
  placeOrder.disabled = true;
  total.textContent = "Calculating shipping…";
  try {
    const quote = await getJSON(`/api/shipping-quote?zip=${encodeURIComponent(zip)}&items=${state.cart.length}`);
    total.textContent = `Total ${money(subtotal() + quote.cost)} (shipping ${money(quote.cost)}, ${quote.days} days)`;
    placeOrder.disabled = state.cart.length === 0;
  } catch (error) {
    console.error("Shipping quote failed:", error.message);
    total.textContent = "We couldn't calculate shipping. Please try again.";
  }
});

$("#place-order").addEventListener("click", async () => {
  const response = await fetch("/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items: state.cart, zip: $("#zip").value }),
  });
  $('[data-testid="order-total"]').textContent = response.ok ? "Order placed." : "Order failed.";
});

renderCart();
loadStorefront();
loadRecommendations();
