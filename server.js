const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const PORT = Number(process.env.PORT || 3036);
const ROOT = __dirname;
const responseCache = new Map();

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
  { match: "market district", label: "Market District", siteUrl: "https://www.marketdistrict.com/stores", priceIndex: 1.14 },
  { match: "fresh thyme", label: "Fresh Thyme", siteUrl: "https://www.freshthyme.com/stores/", priceIndex: 1.08 },
  { match: "dave's supermarket", label: "Dave's Supermarket", siteUrl: "https://www.davesmarkets.com/locations", priceIndex: 1.01 },
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function json(res, status, payload) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

function profileFor(name = "") {
  const lowerName = name.toLowerCase();
  return chainProfiles.find((profile) => lowerName.includes(profile.match)) || null;
}

function chainRegex() {
  return chainProfiles.map((profile) => profile.match.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
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

async function fetchJson(url, options = {}) {
  const timeoutMs = options.timeoutMs || 12000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(url, {
    ...options,
    signal: controller.signal,
    headers: {
      "Accept": "application/json",
      "User-Agent": "RecipeBasketFinder/1.0 local development app",
      ...(options.headers || {}),
    },
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function geocode(location) {
  const zipOnly = location.match(/^\s*(\d{5})\s*$/);
  if (zipOnly) {
    const zipData = await fetchJson(`https://api.zippopotam.us/us/${zipOnly[1]}`, { timeoutMs: 8000 });
    const place = zipData.places?.[0];
    if (place) {
      return {
        display_name: `${zipOnly[1]}, ${place["place name"]}, ${place.state}, United States`,
        lat: place.latitude,
        lon: place.longitude,
        source: "Zippopotam live ZIP geocoder",
      };
    }
  }

  const variants = [...new Set([
    location,
    location.includes(",") ? location.split(",").slice(1).join(",").trim() : "",
    location.replace(/\b(supercenter|supermarket|grocery|store|market)\b/gi, "").replace(/\s+/g, " ").trim(),
  ].filter(Boolean))];

  for (const variant of variants) {
    const query = /\b\d{5}\b/.test(variant) && !/[a-z]/i.test(variant.replace(/\b\d{5}\b/g, ""))
    ? `${variant}, United States`
    : variant;
    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&countrycodes=us&q=${encodeURIComponent(query)}`;
    const results = await fetchJson(url, { timeoutMs: 10000 });
    if (results.length) return results[0];
  }

  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function searchNamedChains(location, center, radiusMiles) {
  const searchableChains = chainProfiles.slice(0, 8);
  const stores = [];

  for (const profile of searchableChains) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=3&countrycodes=us&q=${encodeURIComponent(`${profile.label} near ${location}`)}`;
      const results = await fetchJson(url, { timeoutMs: 7000 });
      stores.push(...results
      .map((place) => {
        const lat = Number(place.lat);
        const lon = Number(place.lon);
        const distance = Number(milesBetween(center, { lat, lon }).toFixed(1));
        if (distance > radiusMiles) return null;
        return {
          id: `nominatim-${profile.match.replace(/\W+/g, "-")}-${place.place_id}`,
          name: place.name || profile.label,
          siteUrl: profile.siteUrl,
          address: place.display_name || "",
          lat,
          lon,
          distance,
          priceIndex: profile.priceIndex,
          source: "Nominatim live search",
        };
      })
      .filter(Boolean));
      await sleep(1100);
    } catch (error) {
      if (String(error.message).includes("429")) break;
    }
  }

  return stores;
}

async function queryOverpass(center, radiusMiles) {
  const meters = Math.round(radiusMiles * 1609.344);
  const query = `
    [out:json][timeout:30];
    (
      node["shop"~"supermarket|grocery|greengrocer|convenience|department_store|wholesale|general|farm"](around:${meters},${center.lat},${center.lon});
      way["shop"~"supermarket|grocery|greengrocer|convenience|department_store|wholesale|general|farm"](around:${meters},${center.lat},${center.lon});
      relation["shop"~"supermarket|grocery|greengrocer|convenience|department_store|wholesale|general|farm"](around:${meters},${center.lat},${center.lon});
      node["amenity"="marketplace"](around:${meters},${center.lat},${center.lon});
      way["amenity"="marketplace"](around:${meters},${center.lat},${center.lon});
      relation["amenity"="marketplace"](around:${meters},${center.lat},${center.lon});
    );
    out center tags;
  `;
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
  ];

  return Promise.any(
    endpoints.map((endpoint) =>
      fetchJson(`${endpoint}?data=${encodeURIComponent(query)}`, {
        timeoutMs: 15000,
      }),
    ),
  );
}

function elementLocation(element) {
  return {
    lat: element.lat ?? element.center?.lat,
    lon: element.lon ?? element.center?.lon,
  };
}

function addressFromTags(tags) {
  const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  return [street, tags["addr:city"], tags["addr:state"], tags["addr:postcode"]].filter(Boolean).join(", ");
}

function normalizeStore(element, center) {
  const tags = element.tags || {};
  const name = tags.name || tags.brand || tags.operator;
  if (!name) return null;

  const location = elementLocation(element);
  if (!location.lat || !location.lon) return null;

  const profile = profileFor(`${name} ${tags.brand || ""} ${tags.operator || ""}`);
  const shop = tags.shop || "";
  const isGroceryStore = ["supermarket", "grocery", "greengrocer", "wholesale", "farm"].includes(shop) || tags.amenity === "marketplace";
  const isRecognizedFoodRetailer = Boolean(profile);
  if (!isGroceryStore && !isRecognizedFoodRetailer) return null;

  const distance = Number(milesBetween(center, location).toFixed(1));

  return {
    id: `osm-${element.type}-${element.id}`,
    name,
    siteUrl: tags.website || profile?.siteUrl || "",
    address: addressFromTags(tags),
    lat: Number(location.lat),
    lon: Number(location.lon),
    distance,
    priceIndex: profile?.priceIndex || 1.06,
    source: "OpenStreetMap live data",
  };
}

function searchedRetailer(location, place) {
  const text = `${location} ${place.display_name || ""}`.toLowerCase();
  const profile = chainProfiles.find((item) => text.includes(item.match));
  if (!profile) return null;

  return {
    id: `searched-${profile.match.replace(/\W+/g, "-")}`,
    name: `${profile.label} at searched location`,
    siteUrl: profile.siteUrl,
    address: place.display_name || location,
    lat: Number(place.lat),
    lon: Number(place.lon),
    distance: 0,
    priceIndex: profile.priceIndex,
    source: "Geocoded searched retailer",
  };
}

function dedupeStores(stores) {
  const seen = new Set();
  return stores.filter((store) => {
    const latBucket = Math.round((store.lat || 0) * 1000);
    const lonBucket = Math.round((store.lon || 0) * 1000);
    const key = `${store.name.toLowerCase()}-${latBucket}-${lonBucket}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function lookupStores(location, radiusInput) {
  const radius = Math.min(Math.max(Number(radiusInput || 5), 1), 50);
  if (!location) {
    return { status: 400, payload: { stores: [], message: "Enter a ZIP code or address." } };
  }

  const cacheKey = `${location.toLowerCase()}|${radius}`;
  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < 10 * 60 * 1000) {
    return { status: 200, payload: { ...cached.payload, cached: true } };
  }

  try {
    const place = await geocode(location);
    if (!place) {
      return { status: 404, payload: { stores: [], message: "That location could not be geocoded." } };
    }

    const center = { lat: Number(place.lat), lon: Number(place.lon) };
    const searchedStore = searchedRetailer(location, place);
    let data = { elements: [] };
    let overpassError = null;
    try {
      data = await queryOverpass(center, radius);
    } catch (error) {
      overpassError = error;
    }

    let mappedStores = [
      searchedStore,
      ...(data.elements || []).map((element) => normalizeStore(element, center)),
    ].filter(Boolean);

    if ((!mappedStores.length || overpassError) && !searchedStore) {
      mappedStores = mappedStores.concat(await searchNamedChains(place.display_name || location, center, radius));
    }

    const stores = dedupeStores(mappedStores)
      .filter((store) => store.distance <= radius)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 24);

    const payload = {
      stores,
      source: "OpenStreetMap live data",
      message: stores.length
        ? overpassError
          ? "The nearby-store index timed out, so results are from live geocoding/search."
          : ""
        : "No live mapped grocery stores were found inside that radius.",
      center,
    };
    responseCache.set(cacheKey, { createdAt: Date.now(), payload });
    return { status: 200, payload };
  } catch (error) {
    return {
      status: 502,
      payload: {
        stores: [],
        message: "Live lookup failed. No backup store data was used.",
        detail: error.message,
      },
    };
  }
}

async function handleStores(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const location = requestUrl.searchParams.get("location")?.trim();
  const radius = requestUrl.searchParams.get("radius");
  const result = await lookupStores(location, radius);
  json(res, result.status, result.payload);
}

async function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const filePath = path.normalize(path.join(ROOT, pathname));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
    });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

if (require.main === module) {
  const server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    if (req.url.startsWith("/api/stores")) {
      handleStores(req, res);
      return;
    }

    serveStatic(req, res);
  });

  server.listen(PORT, () => {
    console.log(`Recipe Basket Finder running at http://127.0.0.1:${PORT}`);
  });
}

module.exports = { lookupStores };
