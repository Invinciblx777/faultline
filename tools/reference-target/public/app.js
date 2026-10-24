// Deliberate defect: the layout code depends on a CSS custom property.
// When styles.css fails to load, the property is empty, parseInt returns NaN,
// and `new Array(NaN)` throws a RangeError, so the service grid never renders.
const services = ["Checkout", "Search", "Accounts", "Inventory", "Shipping", "Notifications"];

function renderGrid() {
  const grid = document.getElementById("grid");
  const columns = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--grid-columns"), 10);
  const rows = new Array(Math.ceil(services.length / columns)); // RangeError when columns is NaN
  rows.fill(null);
  grid.innerHTML = services
    .map((name) => `<article class="card"><h3>${name}</h3><span class="pill">Operational</span></article>`)
    .join("");
}

async function checkApi() {
  const el = document.getElementById("api-status");
  try {
    const res = await fetch("/api/status.json", { cache: "no-store" });
    const data = await res.json();
    el.textContent = data.healthy ? `API healthy (${data.region})` : "API degraded";
  } catch (error) {
    el.textContent = "API unreachable";
    console.error("Status API request failed:", error.message);
  }
}

renderGrid();
checkApi();
