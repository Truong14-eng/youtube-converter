import { useState } from "react";
import axios from "axios";
import './App.css';

function App() {
  const [url, setUrl] = useState("");
  const [filePath, setFilePath] = useState("");
  const [loading, setLoading] = useState(false);

  const handleConvert = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setFilePath("");

    try {
      const res = await axios.post("http://localhost:5050/convert", { url });
      setFilePath(res.data.filePath);
    } catch (err) {
      console.error(err);
      alert("Error converting video.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="body">
      <div className="bx-1">
        <h1 className="title">🎧 YouTube to MP3 Converter</h1>
        <div className="download">
          <input
            type="text"
            placeholder="Paste YouTube or YouTube Music URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="textbox"
          />
          <div className="btn">
            <button
              onClick={handleConvert}
              disabled={loading}
              className="submit-btn"
            >
              {loading ? "Converting..." : "Convert"}
            </button>
          </div>
          {filePath && (
            <div className="mt-4 text-green-700">
              ✅ MP3 saved to: <br />
              <code className="text-sm break-all">{filePath}</code>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
