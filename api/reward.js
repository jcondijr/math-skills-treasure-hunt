function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function extractEbayItemId(link) {
  const raw = String(link || "");
  const pathMatch = raw.match(/\/itm\/(?:[^/]*\/)?(\d{9,14})/i);
  if (pathMatch && pathMatch[1]) return pathMatch[1];
  const queryMatch = raw.match(/[?&](?:item|itm)=(\d{9,14})/i);
  return queryMatch && queryMatch[1] ? queryMatch[1] : "";
}

function normalizeEbayLink(link) {
  const raw = String(link || "");
  const itemId = extractEbayItemId(raw);
  if (itemId) return `https://www.ebay.com/itm/${itemId}`;
  const clean = raw.split("?")[0];
  return clean || raw;
}

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const category = String(req.query.category || "").trim();
  const target = Number(req.query.target || 0);
  const low = Math.max(1, Number(req.query.low || Math.max(1, target - 2)));
  const high = Math.max(low, Number(req.query.high || target + 2));
  const excludeIds = String(req.query.excludeIds || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const excludedSet = new Set(excludeIds);

  if (!category) {
    return res.status(400).json({ error: "Missing category query" });
  }

  const page = Math.max(1, Math.min(8, Number(req.query.page || Math.floor(Math.random() * 8) + 1)));
  const searchUrls = [
    `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(category)}` +
      `&LH_BIN=1&_udlo=${encodeURIComponent(low)}&_udhi=${encodeURIComponent(high)}` +
      `&rt=nc&_ipg=50&_pgn=${encodeURIComponent(page)}&_sop=10&_rss=1`,
    `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(category)}` +
      `&_udlo=${encodeURIComponent(low)}&_udhi=${encodeURIComponent(high)}` +
      `&rt=nc&_ipg=50&_pgn=${encodeURIComponent(page)}&_sop=10&_rss=1`,
    `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(category)}` +
      `&LH_BIN=1&_udlo=${encodeURIComponent(Math.max(1, low - 5))}&_udhi=${encodeURIComponent(high + 10)}` +
      `&rt=nc&_ipg=50&_pgn=${encodeURIComponent(page)}&_sop=12&_rss=1`
  ];

  try {
    let items = [];
    for (const searchUrl of searchUrls) {
      const proxyUrl =
        `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(searchUrl)}` +
        `&t=${Date.now()}`;
      const response = await fetch(proxyUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36"
        }
      });
      if (!response.ok) continue;
      const payload = await response.json();
      if (!payload || payload.status !== "ok" || !Array.isArray(payload.items)) continue;
      items = payload.items
        .map((entry) => {
          const link = normalizeEbayLink((entry && entry.link) || "");
          const title = String((entry && entry.title) || "").trim();
          const image =
            (entry && entry.thumbnail) ||
            (entry && entry.enclosure && entry.enclosure.link) ||
            "";
          return { title, link, image };
        })
        .filter((item) => item.link && /ebay\.com\//i.test(item.link))
        .filter((item) => {
          const itemId = extractEbayItemId(item.link);
          return !itemId || !excludedSet.has(itemId);
        });
      if (items.length) break;
    }

    if (!items.length) return res.status(404).json({ error: "No live items found" });

    const picked = randomFrom(items);
    return res.status(200).json({
      item: {
        link: picked.link,
        title: picked.title,
        image: picked.image
      }
    });
  } catch (err) {
    return res.status(500).json({ error: "Live reward lookup failed" });
  }
};
