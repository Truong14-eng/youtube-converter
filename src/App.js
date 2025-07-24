import { useState, useEffect, useRef } from "react";
import axios from "axios";
import './App.css';

function App() {
  const [url, setUrl] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [filePath, setFilePath] = useState("");
  const [loading, setLoading] = useState(false);
  const [isUrl, setIsUrl] = useState(false);
  const [closing, setClosing] = useState(false);
  const [convertingVideos, setConvertingVideos] = useState(new Set());
  const [notifications, setNotifications] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const loaderRef = useRef(null);
  const fetchTimeoutRef = useRef(null);


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
      setPage(1);
      setHasMore(true);
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
    setLoading(true);
    setSearchResults([]);
    setPage(1);
    setHasMore(true);
    setClosing(false);

    try {
      if (isUrl) {
        await handleConvert(url);
      } else {
        await fetchSearchResults(1);
      }
    } catch (err) {
      console.error("Submit error:", err);
      alert(`Error: ${err.response?.data?.details || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Fetch search results for a given page
  const fetchSearchResults = async (pageNum, retryCount = 0) => {
    console.log(`Fetching page ${pageNum}, hasMore: ${hasMore}, loading: ${loading}`);
    try {
      const response = await axios.post("http://localhost:5050/search", { query: url, page: pageNum });
      const seenIds = new Set(searchResults.map(video => video.id));
      const newResults = response.data.results.filter(video => 
        video.url && 
        video.thumbnail && 
        checkIsUrl(video.url) && 
        !video.thumbnail.includes("placehold.co") && 
        !seenIds.has(video.id)
      );
      console.log(`Search results for page ${pageNum}: ${newResults.length} new videos`);
      setSearchResults(prev => pageNum === 1 ? newResults : [...prev, ...newResults]);
      setHasMore(newResults.length > 0);
      if (newResults.length === 0 && retryCount < 2) {
        console.log(`No new results for page ${pageNum}, retrying (${retryCount + 1}/2)...`);
        setTimeout(() => fetchSearchResults(pageNum, retryCount + 1), 1000);
      } else if (newResults.length === 0) {
        alert("No more search results found.");
      }
    } catch (err) {
      console.error("Search error:", err);
      if (retryCount < 2) {
        console.log(`Retrying page ${pageNum} (${retryCount + 1}/2)...`);
        setTimeout(() => fetchSearchResults(pageNum, retryCount + 1), 1000);
      } else {
        alert(`Error fetching search results: ${err.response?.data?.details || err.message}`);
        setHasMore(false);
      }
    } finally {
      setLoading(false);
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
    } catch (err) {
      console.error("Convert error:", err);
      alert(`Error converting video: ${err.response?.data?.details || err.message}${err.response?.data?.receivedUrl ? ` (URL: ${err.response?.data?.receivedUrl})` : ''}`);
      setNotifications(prev => prev.filter(n => n.id !== notificationId));
    } finally {
      setLoading(false);
      setConvertingVideos(prev => {
        const newSet = new Set(prev);
        if (videoId) newSet.delete(videoId);
        return newSet;
      })};
  };

  // Infinite scroll effect with debounce
  useEffect(() => {
    if (!hasMore || isUrl || !url.trim()) {
      console.log("Infinite scroll disabled:", { hasMore, isUrl, url: url.trim() });
      return;
    }

    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && !loading) {
          console.log("Loader intersected, triggering page increment");
          if (fetchTimeoutRef.current) {
            clearTimeout(fetchTimeoutRef.current);
          }
          fetchTimeoutRef.current = setTimeout(() => {
            setPage(prev => {
              console.log(`Incrementing page to ${prev + 1}`);
              return prev + 1;
            });
          }, 200); // Reduced debounce to 200ms
        }
      },
      { threshold: 1.0, rootMargin: '200px' } // Ensure loader is fully visible
    );

    if (loaderRef.current) {
      console.log("Observing loader element");
      observer.observe(loaderRef.current);
    }

    return () => {
      if (loaderRef.current) {
        console.log("Unobserving loader element");
        observer.unobserve(loaderRef.current);
      }
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current);
      }
    };
  }, [hasMore, loading, isUrl, url]);

  // Fetch more results when page changes
  useEffect(() => {
    if (page > 1 && !isUrl && url.trim() && hasMore) {
      console.log(`Page changed to ${page}, fetching results`);
      setLoading(true);
      fetchSearchResults(page);
    }
  }, [page]);

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
          <h1 className="title">🎧 Hi-Res audio converter</h1>
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
                  disabled={loading}
                  className="submit-btn"
                >
                  {loading ? (isUrl ? "Converting..." : "Searching...") : (isUrl ? "Convert" : "Search")}
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
            {searchResults.map((video, index) => (
              <li
                key={`${video.id}-${index}`}
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
          {hasMore && (
            <div ref={loaderRef} className="loading-more">
              Loading more...
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
