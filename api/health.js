module.exports = function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(200).json({
    ok: true,
    service: "recipe-basket",
    timestamp: new Date().toISOString(),
  });
};
