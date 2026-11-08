module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  try {
    const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
    const headers = {
      "Authorization": req.headers.authorization || "",
      "Content-Type": "application/json"
    };
    const oidc = req.headers["x-vercel-oidc-token"];
    if (oidc) headers["x-vercel-oidc-token"] = Array.isArray(oidc) ? oidc[0] : oidc;
    const upstream = await fetch("https://the-cut-tracker-980v8fvzp-anantthakur2000-1624.vercel.app/api/ai-plan", {
      method: "POST",
      headers,
      body
    });
    const responseText = await upstream.text();
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
    return res.send(responseText);
  } catch (error) {
    console.error("AI planner upstream error:", error);
    return res.status(502).json({ error: "AI planner service is temporarily unavailable." });
  }
};