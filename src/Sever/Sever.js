const express = require("express");
const bodyParser = require("body-parser");
const { exec } = require("child_process");
const os = require("os");
const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer");
const cors = require("cors");

const app = express();
const PORT = 5050;

// Enable CORS for http://localhost:3000
app.use(cors({
  origin: "http://localhost:3000",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
}));

// ✅ Log all requests
app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.url}`);
  next();
});

// // ✅ Preflight handler for CORS (fixes 403)
// app.options("/convert", (req, res) => {
//   res.setHeader("Access-Control-Allow-Origin", "http://localhost:3000");
//   res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
//   res.setHeader("Access-Control-Allow-Headers", "Content-Type");
//   return res.sendStatus(200);
// });

// // ✅ Apply CORS header to all responses
// app.use((req, res, next) => {
//   res.setHeader("Access-Control-Allow-Origin", "http://localhost:3000");
//   res.setHeader("Referrer-Policy", "no-referrer");
//   next();
// });

app.use(bodyParser.json());

// Search route
app.post("/search", async (req, res) => {
  const { query } = req.body;

  if (!query || typeof query !== "string") {
    console.error("Invalid search query:", query);
    return res.status(400).json({ error: "Missing or invalid query" });
  }

  try {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
       await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Wait for video elements to load
    await page.waitForSelector("ytd-video-renderer", { timeout: 10000 }).catch(err => {
      console.error("Failed to find video elements:", err.message);
    });

    await page.waitForSelector("yt-image img", { timeout: 10000 }).catch(err => {
      console.error("Failed to find thumbnail images:", err.message);
    });

    // Scroll multiple times to load dynamic content
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 1000));
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    // Extract video data
    const results = await page.evaluate(() => {
      const videos = Array.from(document.querySelectorAll("ytd-video-renderer, ytd-playlist-renderer"));
      return videos.slice(0, 10).map((video) => {
        const titleElement = video.querySelector("#video-title") || video.querySelector("a[title]") || video.querySelector("a[href*='/watch?v=']");
        const thumbnailElement = video.querySelector("yt-image img") || video.querySelector("img[src*='ytimg.com']") || 
                               video.querySelector("ytd-thumbnail img");
        const channelElement = video.querySelector("ytd-channel-name a");
        const url = titleElement?.href || "";
        const id = url.includes("v=") ? url.split("v=")[1]?.split("&")[0] || "" : "";
        // Fallback to metadata thumbnail if available
        const thumbnailMeta = video.querySelector("ytd-thumbnail #img")?.getAttribute("src") || 
                             (id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : "");
        if (!thumbnailElement?.src && !thumbnailMeta) {
          console.log(`Missing thumbnail for video ${index + 1}: ${url || "no URL"}`);
        }
        if (!url) {
          console.log(`Missing URL for video ${index + 1}`);
        }
        return {
          id: id,
          title: titleElement?.textContent.trim() || `Untitled Video ${index + 1}`,
          thumbnail: thumbnailElement?.src || thumbnailMeta || "https://placehold.co/120x90?text=Thumbnail",
          channel: channelElement?.textContent.trim() || "Unknown Channel",
          url: url,
        };
      }).filter(video => {
        const isValidUrl = /^(https?:\/\/)(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\/.+$/.test(video.url);
        if (!isValidUrl && video.url) {
          console.log(`Invalid URL filtered: ${video.url || "undefined"}`);
        }
        return video.id && video.title && video.url && isValidUrl && video.thumbnail;
      });
    });

    await browser.close();
    console.log(`Search results for "${query}": ${results.length} valid videos`);
    if (results.length === 0) {
      console.warn("No valid search results found for query:", query);
    }
    res.status(200).json({ results });
  } catch (err) {
    console.error(`❌ Search error: ${err.message}`);
    res.status(500).json({ error: "Search failed", details: err.message });
  }
});

// ✅ /convert route
app.post("/convert", (req, res) => {
  const videoUrl = req.body.url;

  if (!videoUrl || typeof videoUrl !== "string") {
    console.error("Invalid URL received:", videoUrl);
    return res.status(400).json({ error: "Missing or invalid URL" });
  }

  const urlPattern = /^(https?:\/\/)(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\/.+$/;
  if (!urlPattern.test(videoUrl)) {
    console.error("URL does not match YouTube pattern:", videoUrl);
    return res.status(400).json({ error: "Invalid YouTube or YouTube Music URL", receivedUrl: videoUrl });
  }

  const downloadsDir = path.resolve(os.homedir(), "Downloads");
  const outputTemplate = path.join(downloadsDir, "%(title).150s.%(ext)s");

  // Sanitize URL to prevent command injection
  const sanitizedUrl = videoUrl.replace(/"/g, '\\"').replace(/\$/g, '\\$');

  const cmd = `/opt/homebrew/bin/yt-dlp \
  --no-playlist \
  --no-mtime \
  --extract-audio \
  --audio-format mp3 \
  --audio-quality 0 \
  --embed-thumbnail \
  --add-metadata \
  --user-agent "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" \
  --restrict-filenames \
  -o "${outputTemplate}" \
  --print after_move:filename \
  "${sanitizedUrl}"`;

  console.log(`▶️ Running command: ${cmd}`);

  exec(cmd, (err, stdout, stderr) => {
    if (err) {
      console.error(`❌ yt-dlp error: ${err.message}`);
      console.error(`❌ stderr: ${stderr}`);
      return res.status(500).json({
        error: "Conversion failed",
        details: stderr || err.message,
      });
    }

    if (!stdout.trim()) {
      console.error("No output file generated by yt-dlp");
      return res.status(500).json({
        error: "Conversion failed",
        details: "No output file generated",
      });
    }

    console.log(`✅ MP3 saved to Downloads folder`);
    res.setHeader("Access-Control-Allow-Origin", "http://localhost:3000");
    res.setHeader("Referrer-Policy", "no-referrer");

    res.status(200).json({
      filePath: stdout.trim(),
      message: `MP3 saved using video title`,
    });
  });
});


// ✅ Catch-all for unmatched routes (optional)
app.use((req, res) => {
  res.status(404).send("Not found");
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
