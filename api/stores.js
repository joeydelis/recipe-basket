const { lookupStores } = require("../server");

const FUNCTION_TIMEOUT_MS = 8500;

function sendJson(res, status, payload) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (typeof res.status === "function") {
    res.status(status);
  } else {
    res.statusCode = status;
  }

  if (typeof res.json === "function") {
    res.json(payload);
  } else {
    res.end(JSON.stringify(payload));
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Store lookup timed out before Vercel limit.")), ms);
    }),
  ]);
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
    const result = await withTimeout(lookupStores(location, query.radius, { serverless: true }), FUNCTION_TIMEOUT_MS);
    sendJson(res, result.status, result.payload);
  } catch (error) {
    sendJson(res, 504, {
      stores: [],
      message: "The live store lookup took too long. Try a smaller radius or a full street address.",
      detail: error.message,
    });
  }
};
