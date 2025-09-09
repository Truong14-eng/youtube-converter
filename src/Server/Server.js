const express = require("express");
const bodyParser = require("body-parser");
const { exec } = require("child_process");
const os = require("os");
const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer");
const cors = require("cors");
const util = require("util");

const app = express();
const PORT = 5050;

const execPromise = util.promisify(exec);

// Enable CORS for http://localhost:3000
app.use(cors({
  origin: "http://localhost:3000",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
}));

// In-memory cache for search results
const searchCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// ✅ Log all requests
app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.url}`);
  next();
});

// Set Referrer-Policy for all responses
app.use((req, res, next) => {
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  console.log(`[${req.method}] ${req.url} - Body: ${JSON.stringify(req.body)} - Referrer: ${req.get("Referer") || "None"}`);
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
  const { query, page = 1 } = req.body;

  if (!query || typeof query !== "string") {
    console.error("Invalid search query:", query);
    return res.status(400).json({ error: "Missing or invalid query" });
  }

  const cacheKey = `${query}:${page}`;
  const cachedResult = searchCache.get(cacheKey);
  if (cachedResult && cachedResult.timestamp + CACHE_DURATION > Date.now()) {
    console.log(`Cache hit for "${query}" (page ${page})`);
    return res.status(200).json({ results: cachedResult.results, page });
  }

  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--window-size=1280,720'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    await page.waitForSelector("ytd-video-renderer", { timeout: 10000 }).catch(err => {
      console.error("Failed to find video elements:", err.message);
    });

    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => window.scrollBy(0, 1000));
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    for (let i = 0; i < 3; i++) {
      const loadMoreButton = await page.$('button[aria-label*="Load more"]');
      if (loadMoreButton) {
        console.log(`Clicking 'Load more' button (attempt ${i + 1})`);
        await loadMoreButton.click();
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        break;
      }
    }

    const results = await page.evaluate(() => {
      const videos = Array.from(document.querySelectorAll("ytd-video-renderer, ytd-playlist-renderer"));
      const seenIds = new Set();
      return videos.map((video, index) => {
        const titleElement = video.querySelector("#video-title") || video.querySelector("a[title]") || video.querySelector("a[href*='/watch?v=']");
        const thumbnailElement = video.querySelector("yt-image img") || video.querySelector("img[src*='ytimg.com']") ||
          video.querySelector("ytd-thumbnail img");
        const channelElement = video.querySelector("ytd-channel-name a");
        const url = titleElement?.href || "";
        const idMatch = url.match(/v=([^&]+)/);
        const id = idMatch ? idMatch[1] : `fallback-${index}`;
        const thumbnailMeta = video.querySelector("ytd-thumbnail #img")?.getAttribute("src") ||
          (id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : "");
        const title = titleElement?.textContent.trim() || `Untitled Video ${index + 1}`;
        console.log(`Video ${index + 1} - ID: ${id}, Title: ${title}`); // Debug log
        if (!thumbnailElement?.src && !thumbnailMeta) {
          console.log(`Missing thumbnail for video ${index + 1}: ${url || "no URL"}`);
        }
        if (!url) {
          console.log(`Missing URL for video ${index + 1}`);
        }
        return {
          id: id,
          title: title,
          thumbnail: thumbnailElement?.src || thumbnailMeta || "https://placehold.co/120x90?text=Thumbnail",
          channel: channelElement?.textContent.trim() || "Unknown Channel",
          url: url,
        };
      }).filter(video => {
        const isValidUrl = /^(https?:\/\/)(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\/.+$/.test(video.url);
        if (!isValidUrl && video.url) {
          console.log(`Invalid URL filtered: ${video.url || "undefined"}`);
        }
        if (seenIds.has(video.id)) {
          console.log(`Duplicate ID filtered: ${video.id}`);
          return false;
        }
        seenIds.add(video.id);
        return video.id && video.title && video.url && isValidUrl && video.thumbnail;
      });
    });

    await browser.close();
    console.log(`Search results for "${query}" (page ${page}): ${results.length} valid videos`);
    if (results.length === 0) {
      console.warn("No valid search results found for query:", query);
    }

    searchCache.set(cacheKey, { results, timestamp: Date.now() });

    res.status(200).json({ results, page });
  } catch (err) {
    console.error(`❌ Search error: ${err.message}`);
    res.status(500).json({ error: "Search failed", details: err.message });
  }
});

// Preview route (simplified to return video ID)
app.post("/preview", async (req, res) => {
  const videoUrl = req.body.url;

  if (!videoUrl || typeof videoUrl !== "string") {
    console.error("Invalid URL received:", videoUrl);
    return res.status(400).json({ error: "Missing or invalid URL" });
  }

  // Extract only the video ID from the URL
  const urlPattern = /(?:v=|\/)([0-9A-Za-z_-]{11})/;
  const match = videoUrl.match(urlPattern);
  if (!match) {
    console.error("Could not extract video ID from URL:", videoUrl);
    return res.status(400).json({ error: "Invalid YouTube URL format" });
  }
  const videoId = match[1];

  console.log(`✅ Video ID fetched: ${videoId}`);
  res.status(200).json({ videoId });
});

//   // const outputTemplate = path.join(downloadsDir, "%(title).150s.%(ext)s");
//   const tempOutput = path.join(downloadsDir, `${title}_temp.wav`);
//   const finalOutput = path.join(downloadsDir, `${title}.mp4`);

//   // Sanitize URL to prevent command injection
//   const sanitizedUrl = videoUrl.replace(/"/g, '\\"').replace(/\$/g, '\\$');

//   const ytDlpCmd = `/opt/homebrew/bin/yt-dlp \
//   --no-playlist \
//   --no-mtime \
//   --extract-audio \
//   --audio-format wav \
//   --postprocessor-args "FFmpegExtractAudio:-c:a pcm_f32le -ar 96000 -ac 2" \
//   --add-metadata \
//   --user-agent "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" \
//   --restrict-filenames \
//   -o "${tempOutput}" \
//   "${videoUrl.replace(/"/g, '\\"').replace(/\$/g, '\\$')}"`;


//   // console.log(`▶️ Running command: ${cmd}`);

//   // exec(cmd, (err, stdout, stderr) => {
//   //   if (err) {
//   //     console.error(`❌ yt-dlp error: ${err.message}`);
//   //     console.error(`❌ stderr: ${stderr}`);
//   //     return res.status(500).json({
//   //       error: "Conversion failed",
//   //       details: stderr || err.message,
//   //     });
//   //   }

//   //   if (!stdout.trim()) {
//   //     console.error("No output file generated by yt-dlp");
//   //     return res.status(500).json({
//   //       error: "Conversion failed",
//   //       details: "No output file generated",
//   //     });
//   //   }

//   //   const outputFile = stdout.trim();
//   //   if (!outputFile.endsWith('.wma')) {
//   //     console.error(`Unexpected file extension: ${outputFile}`);
//   //     return res.status(500).json({
//   //       error: "Conversion failed",
//   //       details: "Unexpected file extension",
//   //     });
//   //   }

//   //   if (!fs.existsSync(outputFile)) {
//   //     console.error(`Output file not found: ${outputFile}`);
//   //     return res.status(500).json({
//   //       error: "Conversion failed",
//   //       details: "Output file not generated",
//   //     });
//   //   }
//   //   // if (!outputFile.endsWith('.wav')) {
//   //   //   console.error(`Unexpected file extension: ${outputFile}`);
//   //   // }
//   //   console.log(`✅ WAV saved to: ${outputFile}`);

//   try {
//     // Run yt-dlp
//     console.log(`▶️ Running yt-dlp: ${ytDlpCmd}`);
//     await execPromise(ytDlpCmd);

//     if (!fs.existsSync(tempOutput)) {
//       console.error(`Temporary WAV file not found: ${tempOutput}`);
//       return res.status(500).json({
//         error: "Conversion failed",
//         details: "Temporary WAV file not generated",
//       });
//     }

//     // Probe source WAV properties and log
//     const { stdout: wavProbeOutput } = await execPromise(`/opt/homebrew/bin/ffprobe -i "${tempOutput}" -show_entries stream=sample_rate,bits_per_sample -v quiet -of json`);
//     const wavProbeData = JSON.parse(wavProbeOutput).streams[0];
//     console.log(`Source WAV - Sample Rate: ${wavProbeData.sample_rate / 1000} kHz, Bit Depth: ${wavProbeData.bits_per_sample} bits`);

//     // Verify WAV properties before conversion
//     const { stdout: probeOutput } = await execPromise(`/opt/homebrew/bin/ffprobe -i "${tempOutput}" -show_entries stream=sample_rate,channels,bits_per_sample -v quiet -of json`);
//     const probeData = JSON.parse(probeOutput).streams[0];
//     if (probeData.sample_rate !== 96000 || probeData.bits_per_sample !== 24) {
//       console.warn(`WAV format mismatch: expected 192kHz, 32-bit; got ${probeData.sample_rate}Hz, ${probeData.bits_per_sample}-bit`);
//     }

//     // Step 3: Run ffmpeg to convert WAV to MP4 with AAC at higher bitrate
//   const bitrate = "10000k"; // Increased to 1Mbps for higher quality
//   // const ffmpegCmd = `/opt/homebrew/bin/ffmpeg -y -i "${tempOutput}" -c:a aac -q:a 0 -ar 96000 -ac 2 -b:a ${bitrate} -vn "${finalOutput}"`;
//   const ffmpegCmd = `/opt/homebrew/bin/ffmpeg -y -i "${tempOutput}" -c:a aac -b:a ${bitrate} -ar 96000 -ac 2 -vn "${finalOutput}"`;

//     // Run ffmpeg
//     console.log(`▶️ Running ffmpeg: ${ffmpegCmd}`);
//     await execPromise(ffmpegCmd);

//     if (!fs.existsSync(finalOutput)) {
//       console.error(`Final MP4 file not found: ${finalOutput}`);
//       return res.status(500).json({
//         error: "Conversion failed",
//         details: "Final MP4 file not generated",
//       });
//     }

//     // Probe MP4 properties and log
//     const { stdout: mp4ProbeOutput } = await execPromise(`/opt/homebrew/bin/ffprobe -i "${finalOutput}" -show_entries stream=sample_rate,bit_rate -v quiet -of json`);
//     const mp4ProbeData = JSON.parse(mp4ProbeOutput).streams[0];
//     console.log(`Downloaded MP4 - Sample Rate: ${mp4ProbeData.sample_rate / 1000} kHz, Bitrate: ${Math.round(mp4ProbeData.bit_rate / 1000)} kbps`);

//     // Clean up temporary WAV file
//     console.log(`🗑️ Removing temporary file: ${tempOutput}`);
//     fs.unlinkSync(tempOutput);

//     console.log(`✅ MP4 saved to: ${finalOutput}`);

//     res.setHeader("Access-Control-Allow-Origin", "http://localhost:3000");
//     res.setHeader("Referrer-Policy", "no-referrer");

//     res.status(200).json({
//       filePath: finalOutput,
//       message: `MP4 saved using video title`,
//     });
//   } catch (err) {
//     console.error(`❌ Conversion error: ${err.message}`);
//     console.error(`❌ stderr: ${err.stderr || "No stderr"}`);

//     // Clean up temporary file if it exists
//     if (fs.existsSync(tempOutput)) {
//       console.log(`🗑️ Cleaning up failed conversion: ${tempOutput}`);
//       fs.unlinkSync(tempOutput);
//     }

//     return res.status(500).json({
//       error: "Conversion failed",
//       details: err.stderr || err.message,
//     });
//   }
// });

// // ✅ Catch-all for unmatched routes (optional)
// app.use((req, res) => {
//   res.status(404).send("Not found");
// });

// app.listen(PORT, () => {
//   console.log(`🚀 Server running at http://localhost:${PORT}`);
// });


// Convert route using video ID
app.post("/convert", async (req, res) => {
  const videoUrl = req.body.url;
  const format = req.body.format;
  const enhanceOptions = req.body.enhanceOptions || {}; // Optional object for reverb/widening

  console.log(`Convert request - URL: ${videoUrl}, Format: ${format}, Enhance Options: ${JSON.stringify(enhanceOptions)}`);

  if (!videoUrl || typeof videoUrl !== "string") {
    console.error("Invalid URL received:", videoUrl);
    return res.status(400).json({ error: "Missing or invalid URL" });
  }

  if (!format) {
    console.error("Missing format parameter");
    return res.status(400).json({ error: "Missing format parameter" });
  }

  const urlPattern = /^(https?:\/\/)(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\/.+$/;
  if (!urlPattern.test(videoUrl)) {
    console.error("URL does not match YouTube pattern:", videoUrl);
    return res.status(400).json({ error: "Invalid YouTube or YouTube Music URL", receivedUrl: videoUrl });
  }

  const downloadsDir = path.resolve(os.homedir(), "Downloads");
  const timestamp = Date.now();

  // Extract video ID from URL
  const idMatch = videoUrl.match(/(?:v=|\/)([0-9A-Za-z_-]{11})/);
  if (!idMatch) {
    console.error("Could not extract video ID from URL:", videoUrl);
    return res.status(400).json({ error: "Invalid YouTube URL format" });
  }
  const videoId = idMatch[1];

  const getTitleCmd = `/opt/homebrew/bin/yt-dlp --get-title "https://www.youtube.com/watch?v=${videoId}"`;
  let title;
  try {
    console.log(`▶️ Fetching title: ${getTitleCmd}`);
    const { stdout } = await execPromise(getTitleCmd);
    title = stdout.trim().replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '_').substring(0, 150);
    if (!title) {
      throw new Error("No title returned by yt-dlp");
    }
  } catch (err) {
    console.error(`❌ Failed to fetch title: ${err.message}`);
    title = `converted_${timestamp}`;
  }

  const tempOutput = path.join(downloadsDir, `${title}_temp.wav`);
  const tempVideoOutput = path.join(downloadsDir, `${title}_temp_video.mp4`);
  let finalOutput = path.join(downloadsDir, `${title}.${format}`);
  let counter = 1;
  let enhancedAudioOutput;

  // Handle duplicate filenames
  while (fs.existsSync(finalOutput)) {
    finalOutput = path.join(downloadsDir, `${title}_${counter}.${format}`);
    counter++;
    console.log(`Duplicate found, trying: ${finalOutput}`);
  }

  try {
    // Step 1: Extract audio using yt-dlp with video ID
    if (req.body.includeVideo === true) {
      ytDlpCmd = `/opt/homebrew/bin/yt-dlp \
        --no-playlist \
        --no-mtime \
        --add-metadata \
        --user-agent "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" \
        --restrict-filenames \
        --merge-output-format mp4 \
        -o "${tempVideoOutput}" \
        "https://www.youtube.com/watch?v=${videoId}"`;
      console.time("yt-dlp Duration");
      console.log(`▶️ Starting yt-dlp for video: ${ytDlpCmd}`);
      const { stdout: ytDlpOutput, stderr: ytDlpError } = await execPromise(ytDlpCmd, { timeout: 300000 });
      console.timeEnd("yt-dlp Duration");
      console.log(`✅ yt-dlp stdout: ${ytDlpOutput}`);
      if (ytDlpError) {
        console.error(`⚠️ yt-dlp stderr: ${ytDlpError}`);
      }
      if (!fs.existsSync(tempVideoOutput)) {
        throw new Error(`Temporary video file not found: ${tempVideoOutput}`);
      }

      // Extract audio from video for processing
      const audioExtractCmd = `/opt/homebrew/bin/ffmpeg -y -i "${tempVideoOutput}" -vn -acodec pcm_f32le -ar 96000 -ac 2 "${tempOutput}"`;
      console.log(`▶️ Extracting audio: ${audioExtractCmd}`);
      await execPromise(audioExtractCmd);
    } else {
      ytDlpCmd = `/opt/homebrew/bin/yt-dlp \
        --no-playlist \
        --no-mtime \
        --extract-audio \
        --add-metadata \
        --user-agent "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" \
        --restrict-filenames \
        --postprocessor-args "FFmpegExtractAudio:-c:a pcm_f32le -ar 384000 -sample_fmt s32 -ac 2" \
        --audio-format wav \
        -o "${tempOutput}" \
        "https://www.youtube.com/watch?v=${videoId}"`;
      console.time("yt-dlp Duration");
      console.log(`▶️ Starting yt-dlp: ${ytDlpCmd}`);
      const { stdout: ytDlpOutput, stderr: ytDlpError } = await execPromise(ytDlpCmd, { timeout: 300000 });
      console.timeEnd("yt-dlp Duration");
      console.log(`✅ yt-dlp stdout: ${ytDlpOutput}`);
      if (ytDlpError) {
        console.error(`⚠️ yt-dlp stderr: ${ytDlpError}`);
      }
    }

    if (!fs.existsSync(tempOutput)) {
      throw new Error(`Temporary WAV file not found: ${tempOutput}`);
    }

    // Step 2: Get before conversion stats
    const { stdout: beforeProbeOutput } = await execPromise(`/opt/homebrew/bin/ffprobe -i "${tempOutput}" -show_entries stream=sample_rate,bits_per_sample,bit_rate -v quiet -of json`);
    const beforeProbeData = JSON.parse(beforeProbeOutput).streams[0];
    const beforeSampleRate = beforeProbeData.sample_rate / 1000; // Convert to kHz
    const beforeBitRateKbps = parseInt(beforeProbeData.bit_rate) / 1000; // Convert to kbps
    const beforeBitDepth = beforeProbeData.bits_per_sample || "N/A";
    // console.log(`Before Conversion - Sample Rate: ${beforeSampleRate} kHz, Bitrate: ${beforeBitRateKbps} kbps, Bit Depth: ${beforeBitDepth}`);

    // Simple noise detection: Check for significant low-frequency (hum) or high-frequency (hiss) energy
    let noiseFilter = "";
    if (beforeProbeData.spectrum) {
      const spectrum = JSON.parse(beforeProbeData.spectrum);
      const lowFreqEnergy = spectrum.some(entry => entry.frequency < 100 && entry.amplitude > -40);
      const highFreqEnergy = spectrum.some(entry => entry.frequency > 8000 && entry.amplitude > -50);
      if (lowFreqEnergy || highFreqEnergy) {
        noiseFilter = ",afftdn=nr=1.0:nf=-20";
        console.log("Noise detected (hum or hiss), applying enhanced noise reduction");
      }
    }

    // Step 3: Convert using ffmpeg
    const eqFilter = "equalizer=f=250:t=q:w=1:g=2,equalizer=f=1000:t=q:w=0.5:g=2,equalizer=f=2000:t=q:w=1:g=2,equalizer=f=1200:t=q:w=0.3:g=4,equalizer=f=4000:t=q:w=1:g=2,equalizer=f=8000:t=q:w=1:g=-2"; // +2 dB for all, +2 dB for vocals (1200 Hz)
    const compLimitFilter = "volume=4,dynaudnorm=p=0.95:m=10,acompressor=ratio=8:threshold=-10dB:attack=5:release=50,alimiter=limit=0.1,loudnorm=I=-23:TP=-1:LRA=14"; // Master clipper and limiter
    const optionalEffects = enhanceOptions.reverb || enhanceOptions.widening ? ",areverb=wet_gain=-15dB:roomsize=0.9,extrastereo=m=0.9" : "";
    const fullAudioFilter = `${eqFilter},${compLimitFilter}${noiseFilter}${optionalEffects}`;

    const eqFilter2 = "equalizer=f=60:t=q:w=1.5:g=4,equalizer=f=250:t=q:w=1:g=4,equalizer=f=500:t=q:w=0.7:g=3,equalizer=f=1000:t=q:w=0.5:g=3,equalizer=f=1200:t=q:w=0.3:g=4,equalizer=f=4000:t=q:w=1:g=3,equalizer=f=8000:t=q:w=1:g=2";
    const compLimitFilter2 = "volume=8,dynaudnorm=p=0.95:m=10,acompressor=ratio=8:threshold=-10dB:attack=5:release=50,alimiter=limit=0.1,loudnorm=I=-16:TP=-1:LRA=11";
    const optionalEffects2 = enhanceOptions.reverb || enhanceOptions.widening ? ",areverb=wet_gain=-15dB:roomsize=0.9,extrastereo=m=0.9" : "";
    const fullAudioFilter2 = `${eqFilter2},${compLimitFilter2}${noiseFilter}${optionalEffects2}`;

    let ffmpegCmd;
    const bitrate = "4000k";
    if (format === "mp3") {
      console.log("Processing MP3 conversion")
      ffmpegCmd = `/opt/homebrew/bin/ffmpeg -y -i "${tempOutput}" -af "${fullAudioFilter2}" -c:a mp3 -b:a ${bitrate} -ar 48000 -ac 2 -sample_fmt s32p -f mp3 "${finalOutput}"`;
    } else if (format === "mp4") {
      // console.log("Processing MP4A conversion")
      // ffmpegCmd = `/opt/homebrew/bin/ffmpeg -y -i "${tempOutput}" -af "${fullAudioFilter}" -c:a aac -b:a ${bitrate} -ar 96000 -ac 2 -vn "${finalOutput}"`;
      if (req.body.includeVideo === true) {
        console.log("Processing MP4 conversion with video and enhanced audio");
        enhancedAudioOutput = path.join(downloadsDir, `${title}_enhanced_audio.wav`);
        const enhanceAudioCmd = `/opt/homebrew/bin/ffmpeg -y -i "${tempOutput}" -af "${fullAudioFilter}" -ar 384000 -sample_fmt s32 -c:a pcm_s32le -ac 2 "${enhancedAudioOutput}"`;
        console.log(`▶️ Enhancing audio: ${enhanceAudioCmd}`);
        await execPromise(enhanceAudioCmd);

        // ffmpegCmd = `/opt/homebrew/bin/ffmpeg -y -i "${tempVideoOutput}" -i "${enhancedAudioOutput}" -c:v copy -c:a aac -b:a ${bitrate} -ar 96000 -shortest "${finalOutput}"`;
        ffmpegCmd = `/opt/homebrew/bin/ffmpeg -y -i "${tempVideoOutput}" -i "${enhancedAudioOutput}" -c:v libx264 -preset medium -c:a aac -b:a ${bitrate} -ar 96000 -pix_fmt yuv420p -shortest "${finalOutput}"`;
      } else {
        console.log("Processing MP4 conversion with audio only");
        ffmpegCmd = `/opt/homebrew/bin/ffmpeg -y -i "${tempOutput}" -af "${fullAudioFilter2}" -c:a aac -b:a ${bitrate} -ar 96000 -ac 2 -vn "${finalOutput}"`;
      }
    } else if (format === "m4a") {
      console.log("Processing M4A conversion");
      ffmpegCmd = `/opt/homebrew/bin/ffmpeg -y -i "${tempOutput}" -af "${fullAudioFilter}" -c:a alac -ar 384000 -ac 2 -sample_fmt s32p -vn "${finalOutput}"`;
      // ffmpegCmd = `/opt/homebrew/bin/ffmpeg -y -i "${tempOutput}" -af "${fullAudioFilter}" -c:a aac -b:a ${bitrate} -ar 96000 -ac 2 -vn "${finalOutput}"`;
    } else if (format === "wav") {
      console.log("Processing WAV conversion");
      ffmpegCmd = `/opt/homebrew/bin/ffmpeg -y -i "${tempOutput}" -af "${fullAudioFilter2}" -ar 384000 -ac 2 -sample_fmt s32 -c:a pcm_s32le -vn "${finalOutput}"`;
    } else if (format === "flac") {
      console.log("Processing FLAC conversion");
      ffmpegCmd = `/opt/homebrew/bin/ffmpeg -y -i "${tempOutput}" -af "${fullAudioFilter}" -ar 384000 -ac 2 -sample_fmt s32 -c:a flac -vn "${finalOutput}"`;
    }

    console.time("ffmpeg Duration");
    console.log(`▶️ Starting ffmpeg: ${ffmpegCmd}`);
    const { stdout: ffmpegOutput, stderr: ffmpegError } = await execPromise(ffmpegCmd, { timeout: 300000 });
    console.timeEnd("ffmpeg Duration");
    console.log(`✅ ffmpeg stdout: ${ffmpegOutput}`);
    if (ffmpegError) {
      console.error(`⚠️ ffmpeg stderr: ${ffmpegError}`);
    }

    if (!fs.existsSync(finalOutput)) {
      throw new Error(`Final ${format} file not found: ${finalOutput}`);
    }

    // Step 4: Get after conversion stats
    const { stdout: afterProbeOutput } = await execPromise(`/opt/homebrew/bin/ffprobe -i "${finalOutput}" -show_entries stream=sample_rate,bits_per_sample,bit_rate -v quiet -of json`);
    const afterProbeData = JSON.parse(afterProbeOutput).streams[0];
    const afterSampleRate = afterProbeData.sample_rate / 1000;
    const afterBitRateKbps = parseInt(afterProbeData.bit_rate) / 1000;
    const afterBitDepth = afterProbeData.bits_per_sample || "N/A";
    console.log(`Before Conversion - Sample Rate: ${beforeSampleRate} kHz, Bitrate: ${beforeBitRateKbps} kbps, Bit Depth: ${beforeBitDepth}`);
    console.log(`After Conversion - Sample Rate: ${afterSampleRate} kHz, Bitrate: ${afterBitRateKbps} kbps, Bit Depth: ${afterBitDepth}`);

    // Step 5: Clean up
    console.log(`🗑️ Removing temporary file: ${tempOutput}`);
    fs.unlinkSync(tempOutput);
    if (fs.existsSync(tempVideoOutput)) {
      console.log(`🗑️ Removing temporary video file: ${tempVideoOutput}`);
      fs.unlinkSync(tempVideoOutput);
    }
    if (enhancedAudioOutput && fs.existsSync(enhancedAudioOutput)) {
      console.log(`🗑️ Removing enhanced audio file: ${enhancedAudioOutput}`);
      fs.unlinkSync(enhancedAudioOutput);
    }

    console.log(`✅ ${format.toUpperCase()} saved to: ${finalOutput}`);

    res.status(200).json({
      filePath: finalOutput,
      message: `${format.toUpperCase()} saved using video title`,
    });
  } catch (err) {
    console.error(`❌ Conversion error: ${err.message}`);
    console.error(`❌ Full error details: ${err.stderr || err.message}`);

    if (fs.existsSync(tempOutput)) {
      console.log(`🗑️ Cleaning up failed conversion: ${tempOutput}`);
      fs.unlinkSync(tempOutput);
    }
    if (fs.existsSync(tempVideoOutput)) {
      console.log(`🗑️ Cleaning up failed conversion: ${tempVideoOutput}`);
      fs.unlinkSync(tempVideoOutput);
    }
    if (fs.existsSync(finalOutput)) {
      console.log(`🗑️ Removing invalid file: ${finalOutput}`);
      fs.unlinkSync(finalOutput);
    }

    if (enhancedAudioOutput && fs.existsSync(enhancedAudioOutput)) {
      console.log(`🗑️ Cleaning up failed enhanced audio: ${enhancedAudioOutput}`);
      fs.unlinkSync(enhancedAudioOutput);
    }

    res.status(400).json({
      error: "Conversion failed",
      details: err.stderr || err.message,
    });
  }
});

app.use((req, res) => {
  res.status(404).send("Not found");
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
