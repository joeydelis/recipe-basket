const FUNCTION_TIMEOUT_MS = 8500;

const chainProfiles = [
  { match: "aldi", label: "ALDI", siteUrl: "https://www.aldi.us/store-locator/", priceIndex: 0.82 },
  { match: "walmart", label: "Walmart", siteUrl: "https://www.walmart.com/store-finder", priceIndex: 0.9 },
  { match: "giant eagle", label: "Giant Eagle", siteUrl: "https://www.gianteagle.com/stores", priceIndex: 1.03 },
  { match: "kroger", label: "Kroger", siteUrl: "https://www.kroger.com/stores/search", priceIndex: 1 },
  { match: "target", label: "Target", siteUrl: "https://www.target.com/store-locator/find-stores", priceIndex: 1.08 },
  { match: "heinen", label: "Heinen's", siteUrl: "https://www.heinens.com/stores/", priceIndex: 1.12 },
  { match: "whole foods", label: "Whole Foods", siteUrl: "https://www.wholefoodsmarket.com/stores", priceIndex: 1.32 },
  { match: "trader joe", label: "Trader Joe's", siteUrl: "https://www.traderjoes.com/home/store-search", priceIndex: 1.06 },
  { match: "meijer", label: "Meijer", siteUrl: "https://www.meijer.com/shopping/store-locator.html", priceIndex: 0.96 },
  { match: "costco", label: "Costco", siteUrl: "https://www.costco.com/warehouse-locations", priceIndex: 0.92 },
  { match: "sam's club", label: "Sam's Club", siteUrl: "https://www.samsclub.com/clubfinder", priceIndex: 0.91 },
  { match: "save a lot", label: "Save A Lot", siteUrl: "https://savealot.com/grocery-stores/", priceIndex: 0.88 },
  { match: "marcs", label: "Marc's", siteUrl: "https://www.marcs.com/stores", priceIndex: 0.93 },
];

function sendJson(res, status, payload) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (typeof res.status === "function") res.status(status);
  else res.statusCode = status;
  if (typeof res.json === "function") res.json(payload);
  else res.end(JSON.stringify(payload));
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Store lookup timed out.")), ms)),
  ]);
}

function profileFor(name = "") {
  const lowerName = name.toLowerCase();
  return chainProfiles.find((profile) => lowerName.includes(profile.match)) || null;
}

function milesBetween(from, to) {
  const earthRadius = 3958.8;
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const deltaLat = ((to.lat - from.lat) * Math.PI) / 180;
  const deltaLon = ((to.lon - from.lon) * Math.PI) / 180;
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(url, {
    signal: controller.signal,
    headers: {
      "Accept": "application/json",
      "User-Agent": "RecipeBasketFinder/1.0 (Vercel serverless)",
    },
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function geocode(location) {
  const zipOnly = location.match(/^\s*(\d{5})\s*$/);
  if (zipOnly) {
    const zipData = await fetchJson(`https://api.zippopotam.us/us/${zipOnly[1]}`, 2500);
    const place = zipData.places?.[0];
    if (place) {
      return {
        display_name: `${zipOnly[1]}, ${place["place name"]}, ${place.state}, United States`,
        lat: Number(place.latitude),
        lon: Number(place.longitude),
      };
    }
  }

  const variants = [...new Set([
    location,
    location.includes(",") ? location.split(",").slice(1).join(",").trim() : "",
    location.replace(/\b(supercenter|supermarket|grocery|store|market)\b/gi, "").replace(/\s+/g, " ").trim(),
  ].filter(Boolean))];

  for (const variant of variants.slice(0, 2)) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(variant)}`;
    const results = await fetchJson(url, 3000);
    if (results.length) {
      return {
        display_name: results[0].display_name || variant,
        lat: Number(results[0].lat),
        lon: Number(results[0].lon),
      };
    }
  }

  return null;
}

async function queryOverpass(center, radiusMiles) {
  const meters = Math.round(radiusMiles * 1609.344);
  const query = `
    [out:json][timeout:25];
    (
      node["shop"~"supermarket|grocery|greengrocer|wholesale|department_store"](around:${meters},${center.lat},${center.lon});
      way["shop"~"supermarket|grocery|greengrocer|wholesale|department_store"](around:${meters},${center.lat},${center.lon});
      relation["shop"~"supermarket|grocery|greengrocer|wholesale|department_store"](around:${meters},${center.lat},${center.lon});
    );
    out center tags;
  `;
  const endpoint = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
  return fetchJson(endpoint, 4500);
}

function addressFromTags(tags) {
  const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  return [street, tags["addr:city"], tags["addr:state"], tags["addr:postcode"]].filter(Boolean).join(", ");
}

function normalizeStore(element, center) {
  const tags = element.tags || {};
  const name = tags.name || tags.brand || tags.operator;
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  if (!name || !lat || !lon) return null;

  const profile = profileFor(`${name} ${tags.brand || ""} ${tags.operator || ""}`);
  const shop = tags.shop || "";
  const groceryTag = ["supermarket", "grocery", "greengrocer", "wholesale"].includes(shop);
  if (!groceryTag && !profile) return null;

  return {
    id: `osm-${element.type}-${element.id}`,
    name,
    siteUrl: tags.website || profile?.siteUrl || "",
    address: addressFromTags(tags),
    lat: Number(lat),
    lon: Number(lon),
    distance: Number(milesBetween(center, { lat: Number(lat), lon: Number(lon) }).toFixed(1)),
    priceIndex: profile?.priceIndex || 1.06,
    source: "OpenStreetMap live data",
  };
}

function searchedRetailer(location, place) {
  const profile = profileFor(`${location} ${place.display_name || ""}`);
  if (!profile) return null;
  return {
    id: `searched-${profile.match.replace(/\W+/g, "-")}`,
    name: `${profile.label} at searched location`,
    siteUrl: profile.siteUrl,
    address: place.display_name || location,
    lat: place.lat,
    lon: place.lon,
    distance: 0,
    priceIndex: profile.priceIndex,
    source: "Geocoded searched retailer",
  };
}

function dedupeStores(stores) {
  const seen = new Set();
  return stores.filter((store) => {
    const key = `${store.name.toLowerCase()}-${Math.round(store.lat * 1000)}-${Math.round(store.lon * 1000)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function lookupStores(location, radiusInput) {
  const radius = Math.min(Math.max(Number(radiusInput || 5), 1), 25);
  if (!location) return { status: 400, payload: { stores: [], message: "Enter a ZIP code or address." } };

  const place = await geocode(location);
  if (!place) return { status: 404, payload: { stores: [], message: "That location could not be geocoded." } };

  const center = { lat: place.lat, lon: place.lon };
  const data = await queryOverpass(center, radius);
  const stores = dedupeStores([
    searchedRetailer(location, place),
    ...(data.elements || []).map((element) => normalizeStore(element, center)),
  ].filter(Boolean))
    .filter((store) => store.distance <= radius)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 24);

  return {
    status: 200,
    payload: {
      stores,
      source: "OpenStreetMap live data",
      message: stores.length ? "" : "No live mapped grocery stores were found inside that radius.",
      center,
    },
  };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method !== "GET") {
      sendJson(res, 405, { stores: [], message: "Method not allowed." });
      return;
    }

    const requestUrl = new URL(req.url || "/", `https://${req.headers.host || "recipe-basket.vercel.app"}`);
    const query = req.query || Object.fromEntries(requestUrl.searchParams);
    const location = String(query.location || "").trim();
    const result = await withTimeout(lookupStores(location, query.radius), FUNCTION_TIMEOUT_MS);
    sendJson(res, result.status, result.payload);
  } catch (error) {
    sendJson(res, 200, {
      stores: [],
      message: "Live store lookup failed, but the function recovered instead of crashing.",
      detail: error.message,
    });
  }
};
