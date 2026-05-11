const catalog = {
  chicken: { label: "Chicken", unit: "lb", basePrice: 4.29, aliases: ["chicken thigh", "chicken breast", "chicken"] },
  beef: { label: "Ground beef", unit: "lb", basePrice: 5.79, aliases: ["ground beef", "beef"] },
  salmon: { label: "Salmon", unit: "lb", basePrice: 10.99, aliases: ["salmon"] },
  shrimp: { label: "Shrimp", unit: "lb", basePrice: 8.99, aliases: ["shrimp"] },
  rice: { label: "Rice", unit: "lb", basePrice: 1.15, aliases: ["rice"] },
  pasta: { label: "Pasta", unit: "box", basePrice: 1.69, aliases: ["pasta", "spaghetti", "penne"] },
  onion: { label: "Onion", unit: "each", basePrice: 0.89, aliases: ["onion", "shallot"] },
  garlic: { label: "Garlic", unit: "head", basePrice: 0.74, aliases: ["garlic", "clove"] },
  "coconut milk": { label: "Coconut milk", unit: "can", basePrice: 2.29, aliases: ["coconut milk"] },
  tomato: { label: "Tomato", unit: "each", basePrice: 0.92, aliases: ["tomato", "tomatoes"] },
  egg: { label: "Eggs", unit: "dozen", basePrice: 3.19, aliases: ["egg", "eggs"] },
  milk: { label: "Milk", unit: "gallon", basePrice: 3.59, aliases: ["milk"] },
  cheese: { label: "Cheese", unit: "pack", basePrice: 3.79, aliases: ["cheese", "mozzarella", "cheddar", "parmesan"] },
  beans: { label: "Beans", unit: "can", basePrice: 1.19, aliases: ["beans", "black bean", "kidney bean", "chickpea"] },
  pepper: { label: "Bell pepper", unit: "each", basePrice: 1.09, aliases: ["bell pepper", "pepper"] },
  flour: { label: "Flour", unit: "bag", basePrice: 3.49, aliases: ["flour"] },
  sugar: { label: "Sugar", unit: "bag", basePrice: 3.19, aliases: ["sugar"] },
  butter: { label: "Butter", unit: "lb", basePrice: 4.49, aliases: ["butter"] },
  potato: { label: "Potato", unit: "lb", basePrice: 0.98, aliases: ["potato", "potatoes"] },
  carrot: { label: "Carrot", unit: "lb", basePrice: 1.04, aliases: ["carrot", "carrots"] },
  spinach: { label: "Spinach", unit: "bag", basePrice: 3.29, aliases: ["spinach"] },
  lemon: { label: "Lemon", unit: "each", basePrice: 0.79, aliases: ["lemon"] },
  lime: { label: "Lime", unit: "each", basePrice: 0.55, aliases: ["lime"] },
  tortilla: { label: "Tortillas", unit: "pack", basePrice: 2.69, aliases: ["tortilla", "tortillas"] },
  bread: { label: "Bread", unit: "loaf", basePrice: 2.99, aliases: ["bread"] },
  yogurt: { label: "Yogurt", unit: "tub", basePrice: 4.19, aliases: ["yogurt"] },
  basil: { label: "Basil", unit: "bunch", basePrice: 2.49, aliases: ["basil"] },
  parsley: { label: "Parsley", unit: "bunch", basePrice: 1.59, aliases: ["parsley"] },
  ginger: { label: "Ginger", unit: "piece", basePrice: 1.09, aliases: ["ginger"] },
};

const pantryBasics = new Set(["salt", "water", "oil", "olive oil", "vegetable oil"]);
const units = new Set(["cup", "cups", "tbsp", "tablespoon", "tablespoons", "tsp", "teaspoon", "teaspoons", "lb", "lbs", "pound", "pounds", "oz", "ounce", "ounces", "can", "cans", "clove", "cloves", "head", "heads", "bag", "bags", "box", "boxes", "each", "dozen"]);

const recipeInput = document.querySelector("#recipeInput");
const zipInput = document.querySelector("#zipInput");
const radiusInput = document.querySelector("#radiusInput");
const pantryToggle = document.querySelector("#pantryToggle");
const ingredientList = document.querySelector("#ingredientList");
const parseCount = document.querySelector("#parseCount");
const storeList = document.querySelector("#storeList");
const storeCount = document.querySelector("#storeCount");
const bestStore = document.querySelector("#bestStore");

let parsedIngredients = [];
let selectedStoreId = null;
let nearbyStores = [];
let storeLookupMessage = "Enter a recipe, then compare stores.";
let lookupToken = 0;

function parseQuantity(raw) {
  if (!raw) return 1;
  const mixed = raw.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = raw.match(/^(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : 1;
}

function normalizeLine(line) {
  return line
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[-*•]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function identifyIngredient(name) {
  const clean = name.replace(/\b(chopped|diced|minced|sliced|fresh|large|small|medium|boneless|skinless|dry|cooked)\b/g, " ").replace(/\s+/g, " ").trim();
  const match = Object.entries(catalog).find(([, item]) => item.aliases.some((alias) => clean.includes(alias)));
  if (match) {
    return { key: match[0], label: match[1].label, known: true };
  }
  const fallback = clean.split(",")[0].trim() || name;
  return { key: fallback, label: titleCase(fallback), known: false };
}

function parseRecipe(text) {
  return text
    .split(/\n|,/)
    .map(normalizeLine)
    .filter(Boolean)
    .map((line, index) => {
      const parts = line.split(" ");
      let quantity = 1;
      let unit = "each";
      let start = 0;

      if (parts[0] && /^(\d+(\.\d+)?|\d+\/\d+|\d+\s+\d+\/\d+)$/.test(parts.slice(0, 2).join(" "))) {
        quantity = parseQuantity(parts.slice(0, 2).join(" "));
        start = parts[1] && parts[1].includes("/") ? 2 : 1;
      } else if (parts[0] && /^(\d+(\.\d+)?|\d+\/\d+)$/.test(parts[0])) {
        quantity = parseQuantity(parts[0]);
        start = 1;
      }

      if (units.has(parts[start])) {
        unit = parts[start];
        start += 1;
      }

      const rawName = parts.slice(start).join(" ");
      const found = identifyIngredient(rawName || line);
      return {
        id: `${Date.now()}-${index}-${found.key}`,
        raw: line,
        key: found.key,
        label: found.label,
        quantity,
        unit,
        known: found.known,
      };
    })
    .filter((ingredient) => ingredient.label && !(pantryToggle.checked && pantryBasics.has(ingredient.key)));
}

function titleCase(value) {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function quantityMultiplier(ingredient) {
  const unit = ingredient.unit;
  const quantity = Math.max(ingredient.quantity, 0.25);
  if (["cup", "cups"].includes(unit)) return Math.max(quantity / 2, 0.45);
  if (["tbsp", "tablespoon", "tablespoons"].includes(unit)) return Math.max(quantity / 16, 0.2);
  if (["tsp", "teaspoon", "teaspoons"].includes(unit)) return Math.max(quantity / 48, 0.15);
  if (["oz", "ounce", "ounces"].includes(unit)) return Math.max(quantity / 16, 0.25);
  if (["clove", "cloves"].includes(unit)) return Math.max(quantity / 10, 0.25);
  if (["dozen"].includes(unit)) return quantity;
  return quantity;
}

function allCatalogKeys() {
  return Object.keys(catalog);
}

async function lookupNearbyStores() {
  const radius = Number(radiusInput.value);
  const input = zipInput.value.trim();
  if (!input) {
    storeLookupMessage = "Enter a ZIP code or address before comparing stores.";
    nearbyStores = [];
    return;
  }

  const currentToken = ++lookupToken;
  nearbyStores = [];
  storeLookupMessage = "Searching nearby grocery stores...";
  renderStoreList([]);

  try {
    const apiBase = window.location.protocol === "file:" ? "http://127.0.0.1:3036" : "";
    const response = await fetch(`${apiBase}/api/stores?location=${encodeURIComponent(input)}&radius=${encodeURIComponent(radius)}`);
    if (!response.ok) throw new Error("Store lookup failed.");
    const data = await response.json();
    const storesFromMap = data.stores.map((store) => ({
      ...store,
      coverage: allCatalogKeys(),
    }));

    if (currentToken !== lookupToken) return;
    nearbyStores = storesFromMap;
    storeLookupMessage = storesFromMap.length
      ? `Found ${storesFromMap.length} nearby grocery store${storesFromMap.length === 1 ? "" : "s"} from ${data.source}.`
      : data.message || "No mapped grocery stores were found inside that radius.";
  } catch (error) {
    if (currentToken !== lookupToken) return;
    nearbyStores = [];
    storeLookupMessage = "Live store lookup failed. Run the local server and try again; the app will not invent backup stores.";
  }
}

function compareStores() {
  const radius = Number(radiusInput.value);
  const candidates = nearbyStores
    .map((store) => {
      const cart = parsedIngredients.map((ingredient) => {
        const catalogItem = catalog[ingredient.key];
        const inStock = ingredient.known && store.coverage.includes(ingredient.key);
        const estimatedPrice = catalogItem ? catalogItem.basePrice * store.priceIndex * quantityMultiplier(ingredient) : 0;
        return {
          ...ingredient,
          inStock,
          price: inStock ? Number(estimatedPrice.toFixed(2)) : null,
        };
      });
      const missing = cart.filter((item) => !item.inStock);
      const subtotal = cart.reduce((sum, item) => sum + (item.price || 0), 0);
      return {
        ...store,
        cart,
        missing,
        subtotal: Number(subtotal.toFixed(2)),
        complete: missing.length === 0,
        withinRadius: store.distance <= radius,
      };
    })
    .filter((store) => store.withinRadius);

  return candidates.sort((a, b) => {
    if (a.complete !== b.complete) return a.complete ? -1 : 1;
    if (a.subtotal !== b.subtotal) return a.subtotal - b.subtotal;
    return a.distance - b.distance;
  });
}

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatQuantity(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function mapsUrl(store) {
  const query = store.address || (store.lat && store.lon ? `${store.lat},${store.lon}` : `${store.name} near ${zipInput.value || "me"}`);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function storeSiteUrl(store) {
  return store.siteUrl || mapsUrl(store);
}

function renderIngredients() {
  ingredientList.innerHTML = "";
  parseCount.textContent = `${parsedIngredients.length} ingredient${parsedIngredients.length === 1 ? "" : "s"}`;

  if (!parsedIngredients.length) {
    ingredientList.innerHTML = `<p class="muted">No ingredients parsed yet.</p>`;
    return;
  }

  parsedIngredients.forEach((ingredient) => {
    const row = document.querySelector("#ingredientTemplate").content.firstElementChild.cloneNode(true);
    row.querySelector("strong").textContent = ingredient.label;
    row.querySelector("span").textContent = `${formatQuantity(ingredient.quantity)} ${ingredient.unit} from "${ingredient.raw}"`;
    row.querySelector("button").addEventListener("click", () => {
      parsedIngredients = parsedIngredients.filter((item) => item.id !== ingredient.id);
      renderAll();
    });
    ingredientList.append(row);
  });
}

function selectedStore(results) {
  if (!results.length) return null;
  return results.find((store) => store.id === selectedStoreId) || results[0];
}

function syncSelectedStore(results) {
  if (!results.length) {
    selectedStoreId = null;
    return;
  }

  if (!results.some((store) => store.id === selectedStoreId)) {
    selectedStoreId = results[0].id;
  }
}

function renderBestStore(results) {
  const store = selectedStore(results);
  if (!parsedIngredients.length) {
    bestStore.innerHTML = `
      <div class="empty-state">
        <div class="basket-art" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
        <h2>Paste ingredients to price a full basket.</h2>
        <p>The app will parse quantities, compare store baskets, and show the cheapest complete option nearby.</p>
      </div>
    `;
    return;
  }

  if (!store) {
    bestStore.innerHTML = `
      <div class="empty-state">
        <h2>No stores ready to compare.</h2>
        <p>${storeLookupMessage}</p>
      </div>
    `;
    return;
  }

  const isCheapest = results[0] && results[0].id === store.id;
  const warning = store.complete
    ? ""
    : `<div class="notice">This store is missing ${store.missing.length} parsed item${store.missing.length === 1 ? "" : "s"}, so its total is a partial basket.</div>`;

  bestStore.innerHTML = `
    <div class="best-heading">
      <div>
        <p class="eyebrow">${isCheapest ? (store.complete ? "Cheapest complete basket" : "Best partial basket") : "Selected store breakdown"}</p>
        <h2>${store.name}</h2>
      </div>
      <span class="badge">${store.distance} mi</span>
    </div>
    <div class="price">${money(store.subtotal)}</div>
    <div class="meta-row">
      <span class="pill">${store.cart.length - store.missing.length}/${store.cart.length} items found</span>
      <span class="pill">${zipInput.value || "location not set"}</span>
      <span class="pill">${store.source || "Nearby store"} prices estimated</span>
    </div>
    <div class="action-row">
      <a href="${storeSiteUrl(store)}" target="_blank" rel="noopener noreferrer">${store.siteUrl ? "Store site" : "Store search"}</a>
      <a href="${mapsUrl(store)}" target="_blank" rel="noopener noreferrer">Open in Maps</a>
    </div>
    ${warning}
    <div class="best-breakdown">
      ${store.cart
        .map(
          (item) => `
          <div class="cart-row">
            <div>
              <strong>${item.label}</strong>
              <span>${item.quantity} ${item.unit}</span>
            </div>
            <strong>${item.inStock ? money(item.price) : "Missing"}</strong>
          </div>
        `,
        )
        .join("")}
    </div>
  `;
}

function renderStoreList(results) {
  storeList.innerHTML = "";

  if (!parsedIngredients.length) {
    storeCount.textContent = "0 stores";
    storeList.innerHTML = `<p class="muted">${storeLookupMessage}</p>`;
    return;
  }

  storeCount.textContent = `${results.length} store${results.length === 1 ? "" : "s"}`;

  if (!results.length) {
    selectedStoreId = null;
    storeList.innerHTML = `<p class="muted">${storeLookupMessage}</p>`;
    return;
  }

  results.forEach((store, index) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `store-card${index === 0 ? " best" : ""}${store.id === selectedStoreId ? " selected" : ""}`;
    card.setAttribute("aria-pressed", store.id === selectedStoreId ? "true" : "false");
    card.innerHTML = `
      <div class="store-heading">
        <h3>${store.name}</h3>
        <span class="badge${store.complete ? "" : " warning"}">${store.complete ? "complete" : `${store.missing.length} missing`}</span>
      </div>
      <div class="price-line">
        <strong class="price">${money(store.subtotal)}</strong>
        <span class="muted">${store.distance} mi</span>
      </div>
      <div class="meta-row">
        <span class="pill">${store.cart.length - store.missing.length} matched</span>
        <span class="pill">${Math.round(store.priceIndex * 100)} price index</span>
      </div>
      <div class="action-row compact">
        <a href="${storeSiteUrl(store)}" target="_blank" rel="noopener noreferrer">${store.siteUrl ? "Store" : "Search"}</a>
        <a href="${mapsUrl(store)}" target="_blank" rel="noopener noreferrer">Maps</a>
      </div>
    `;
    card.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      selectedStoreId = store.id;
      renderBestStore(results);
      renderStoreList(results);
    });
    storeList.append(card);
  });
}

function renderAll() {
  renderIngredients();
  const results = compareStores();
  syncSelectedStore(results);
  renderBestStore(results);
  renderStoreList(results);
}

async function updateParsed() {
  parsedIngredients = parseRecipe(recipeInput.value);
  if (!parsedIngredients.length) {
    nearbyStores = [];
    storeLookupMessage = "Enter a recipe, then compare stores.";
    renderAll();
    return;
  }

  await lookupNearbyStores();
  renderAll();
}

function handleDraftChange() {
  parsedIngredients = parseRecipe(recipeInput.value);
  nearbyStores = [];
  selectedStoreId = null;
  lookupToken += 1;
  storeLookupMessage = parsedIngredients.length ? "Press Compare stores to run a live nearby-store search." : "Enter a recipe, then compare stores.";
  renderAll();
}

document.querySelector("#sampleButton").addEventListener("click", () => {
  recipeInput.value = `2 lb chicken thighs
1 cup rice
1 onion
3 cloves garlic
1 can coconut milk
2 tomatoes
1 tbsp olive oil
1 lime`;
  updateParsed();
});

document.querySelector("#searchButton").addEventListener("click", updateParsed);
document.querySelector("#clearButton").addEventListener("click", () => {
  recipeInput.value = "";
  parsedIngredients = [];
  nearbyStores = [];
  selectedStoreId = null;
  storeLookupMessage = "Enter a recipe, then compare stores.";
  renderAll();
});

recipeInput.addEventListener("input", handleDraftChange);
pantryToggle.addEventListener("change", handleDraftChange);
[zipInput, radiusInput].forEach((control) => {
  control.addEventListener("input", handleDraftChange);
  control.addEventListener("change", handleDraftChange);
});

renderAll();
