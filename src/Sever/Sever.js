const express = require("express");
const bodyParser = require("body-parser");
const { exec } = require("child_process");
const os = require("os");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 5050;

// ✅ Log all requests
app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.url}`);
  next();
});

// ✅ Preflight handler for CORS (fixes 403)
app.options("/convert", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:3000");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  return res.sendStatus(200);
});

// ✅ Apply CORS header to all responses
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:3000");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

app.use(bodyParser.json());

// ✅ /convert route
app.post("/convert", (req, res) => {
  const videoUrl = req.body.url;

  if (!videoUrl || typeof videoUrl !== "string") {
    return res.status(400).json({ error: "Missing or invalid URL" });
  }

  const downloadsDir = path.resolve(os.homedir(), "Downloads");
  const outputTemplate = path.join(downloadsDir, "%(title).150s.%(ext)s");

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
  "${videoUrl}"`;

  console.log(`▶️ Running command: ${cmd}`);

  exec(cmd, (err, stdout, stderr) => {
    if (err) {
      console.error(`❌ yt-dlp error: ${err.message}`);
      return res.status(500).json({
        error: "Conversion failed",
        details: stderr || err.message,
      });
    }

    console.log(`✅ MP3 saved to Downloads folder`);
    res.setHeader("Access-Control-Allow-Origin", "http://localhost:3000");
    res.setHeader("Referrer-Policy", "no-referrer");

    res.json({
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
