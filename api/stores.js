const { lookupStores } = require("../server");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ stores: [], message: "Method not allowed." });
    return;
  }

  const result = await lookupStores(String(req.query.location || "").trim(), req.query.radius);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(result.status).json(result.payload);
};
