import { useState, useEffect } from "react";
import axios from "axios";
import './App.css';

function App() {
  const [url, setUrl] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [filePath, setFilePath] = useState("");
  const [loading, setLoading] = useState(false);
  const [isUrl, setIsUrl] = useState(false);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [closing, setClosing] = useState(false);
  const [convertingVideos, setConvertingVideos] = useState(new Set());
  const [notifications, setNotifications] = useState([]);


  // Check if input is a URL
  const checkIsUrl = (value) => {
    const urlPattern = /^(https?:\/\/)(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\/.+$/;
    return urlPattern.test(value);
  };

  // Generate unique ID for notifications
  const generateNotificationId = () => {
    return Math.random().toString(36).substr(2, 9);
  };

  // Handle input change
  const handleInputChange = (e) => {
    const value = e.target.value;
    setUrl(value);
    setIsUrl(checkIsUrl(value));
    if (!value.trim()) {
      setSearchResults([]);
    }
  };

  // Handle Enter key press
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && url.trim()) {
      handleSearch();
    }
  };

  // Search YouTube videos
  const handleSearch = async () => {
    if (!url.trim()) return;
    setLoadingSearch(true);
    setFilePath("");
    setSearchResults([]);
    setClosing(false);

    if (isUrl) {
      await handleConvert(url);
    } else {
      try {
        const response = await axios.post("http://localhost:5050/search", { query: url });
        if (response.data.results.length === 0) {
          alert("No valid search results found. Try a different query.");
        }
        console.log("Search results:", response.data.results); // Debug log
        setSearchResults(response.data.results.filter(video => video.url && video.thumbnail && checkIsUrl(video.url) &&
          !video.thumbnail.includes("placehold.co")));
      } catch (err) {
        console.error("Search error:", err);
        alert(`Error searching videos: ${err.response?.data?.details || err.message}`);
      } finally {
        setLoadingSearch(false);
      }
    }
  };

  // Handle convert for a specific video
  const handleConvert = async (videoUrl, videoId = null) => {
    if (!videoUrl || typeof videoUrl !== "string") {
      console.error("Invalid video URL:", videoUrl);
      alert(`Invalid video URL: ${videoUrl === undefined ? "URL is undefined" : "URL is invalid"}`);
      setLoading(false);
      setConvertingVideos(prev => {
        const newSet = new Set(prev);
        if (videoId) newSet.delete(videoId);
        return newSet;
      });
      setClosing(true);
      setTimeout(() => {
        setClosing(false);
      }, 300);
      setNotifications(prev => prev.filter(n => n.videoUrl !== videoUrl));
      return;
    }
    console.log("Converting URL:", videoUrl);
    const notificationId = generateNotificationId();
    setNotifications(prev => [...prev, { id: notificationId, videoUrl, isLoading: true }]);
    if (videoId) {
      setConvertingVideos(prev => new Set([...prev, videoId]));
    } else {
      setLoading(true);
    }
    setFilePath("");
    setClosing(false);

    try {
      const res = await axios.post("http://localhost:5050/convert", { url: videoUrl });
      setNotifications(prev => prev.map(n =>
        n.id === notificationId ? { ...n, isLoading: false, filePath: res.data.filePath } : n
      ));
      setLoading(false);
      setConvertingVideos(prev => {
        const newSet = new Set(prev);
        if (videoId) newSet.delete(videoId);
        return newSet;
      });
    } catch (err) {
      console.error(err);
      alert(`Error converting video: ${err.response?.data?.details || err.message}${err.response?.data?.receivedUrl ? ` (URL: ${err.response?.data?.receivedUrl})` : ''}`);
      setLoading(false);
      setConvertingVideos(prev => {
        const newSet = new Set(prev);
        if (videoId) newSet.delete(videoId);
        return newSet;
      });
      setClosing(true);
      setTimeout(() => {
        setClosing(false);
      }, 300);
      setNotifications(prev => prev.filter(n => n.id !== notificationId));
    }
  };

  // Auto-dismiss pop-up after 5 seconds for success message
  useEffect(() => {
    const successNotifications = notifications.filter(n => !n.isLoading && n.filePath);
    if (successNotifications.length > 0) {
      const timers = successNotifications.map(n => {
        const timer = setTimeout(() => {
          setNotifications(prev => prev.map(notification =>
            notification.id === n.id ? { ...notification, closing: true } : notification
          ));
          setTimeout(() => {
            setNotifications(prev => prev.filter(notification => notification.id !== n.id));
          }, 300); // Match slideOut animation duration
        }, 5000);
        return timer;
      });
      return () => timers.forEach(timer => clearTimeout(timer));
    }
  }, [notifications]);

  return (
    <div className="body">
      <div className="header">
        <div className="bx-1">
          <h1 className="title">🎧 YouTube to MP3 Converter</h1>
          <div className="download">
            <input
              type="text"
              placeholder="Paste YouTube or YouTube Music URL"
              value={url}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              className="textbox"
            />
            <div className="btn">
              {url.trim() && (
                <button
                  onClick={handleSearch}
                  disabled={loadingSearch}
                  className="submit-btn"
                >
                  {loadingSearch ? (isUrl ? "Converting..." : "Searching...") : (isUrl ? "Convert" : "Search")}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      {notifications.length > 0 && (
        <div className="popup-overlay">
          {notifications.map((notification, index) => (
            <div
              key={notification.id}
              className={`popup ${notification.filePath ? 'success' : ''} ${notification.closing ? 'closing' : ''}`}
              style={{ top: `${20 + index * 90}px` }}
            >
              {notification.isLoading ? (
                <>
                  <div className="loading-bar">
                    <div className="loading-bar-progress"></div>
                  </div>
                  <p className='converting'>Converting...</p>
                </>
              ) : (
                <>
                  <span className="checkmark">✅</span>
                  <p>MP3 saved to:</p>
                  <code className="text-sm break-all">{notification.filePath}</code>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {searchResults.length > 0 && (
        <div className="search-body">
          <h2 className="search-body-title">Search Results</h2>
          <ul className="result-list">
            {searchResults.map((video) => (
              <li
                key={video.id}
                className="flex items-center space-x-4 p-2 border rounded"
              >
                <div className="section">
                  <img
                    src={video.thumbnail}
                    alt={video.title}
                    className="thumbnail"
                    onError={(e) => {
                      e.target.src = "https://placehold.co/120x90?text=No+Thumbnail";
                      e.target.alt = "No thumbnail available";
                    }}
                  />
                  <div className="info">
                    <div className="result-info">
                      <h3 className="video-title">{video.title}</h3>
                      <p className="video-channel">{video.channel}</p>
                    </div>
                    <button
                      onClick={() => handleConvert(video.url, video.id)}
                      disabled={convertingVideos.has(video.id)}
                      className="result-submit-btn"
                    >
                      {convertingVideos.has(video.id) ? "Converting..." : "Convert"}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default App;
