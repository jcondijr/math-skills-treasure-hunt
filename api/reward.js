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

function stripCdata(value) {
  return String(value || "")
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .trim();
}

function parseTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = block.match(re);
  return match ? stripCdata(match[1]) : "";
}

function parseMediaUrl(block) {
  const mediaMatch = block.match(/<media:content[^>]*url="([^"]+)"/i);
  if (mediaMatch && mediaMatch[1]) return mediaMatch[1];
  const desc = parseTag(block, "description");
  const imgMatch = desc.match(/<img[^>]+src="([^"]+)"/i);
  return imgMatch && imgMatch[1] ? imgMatch[1] : "";
}

function parseRssItems(xmlText) {
  const blocks = String(xmlText || "").match(/<item>([\s\S]*?)<\/item>/gi) || [];
  return blocks
    .map((block) => {
      const title = parseTag(block, "title");
      const link = normalizeEbayLink(parseTag(block, "link"));
      const image = parseMediaUrl(block);
      return { title, link, image };
    })
    .filter((item) => item.link && /ebay\.com\/itm\//i.test(item.link));
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

  const searchUrl =
    `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(category)}` +
    `&LH_BIN=1&_udlo=${encodeURIComponent(low)}&_udhi=${encodeURIComponent(high)}&rt=nc&_ipg=50&_rss=1`;

  try {
    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36"
      }
    });
    if (!response.ok) {
      return res.status(502).json({ error: "Upstream search failed", status: response.status });
    }

    const xmlText = await response.text();
    const items = parseRssItems(xmlText).filter((item) => {
      const itemId = extractEbayItemId(item.link);
      return !itemId || !excludedSet.has(itemId);
    });

    if (!items.length) {
      return res.status(404).json({ error: "No live items found" });
    }

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
