import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { LOCAL_STORY_VIDEOS } from "@/lib/localMedia";

export default function VideoGallery() {
  const [videos, setVideos] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState(null);
    const touchStartYRef = useRef(null);
    const selectedVideoRef = useRef(null);

    useEffect(() => {
        if (!selectedVideo) {
            touchStartYRef.current = null;
            return undefined;
        }

        const handleWheel = (event) => {
            if (Math.abs(event.deltaY) > 0) {
                setSelectedVideo(null);
            }
        };

        const handleTouchStart = (event) => {
            const touch = event.touches[0];
            touchStartYRef.current = touch?.clientY ?? null;
        };

        const handleTouchMove = (event) => {
            if (touchStartYRef.current === null) return;
            const touch = event.touches[0];
            if (!touch) return;
            const deltaY = touch.clientY - touchStartYRef.current;
            if (Math.abs(deltaY) > 15) {
                setSelectedVideo(null);
                touchStartYRef.current = null;
            }
        };

        const handleTouchEnd = () => {
            touchStartYRef.current = null;
        };

        window.addEventListener("wheel", handleWheel, { passive: true });
        window.addEventListener("touchstart", handleTouchStart, { passive: true });
        window.addEventListener("touchmove", handleTouchMove, { passive: true });
        window.addEventListener("touchend", handleTouchEnd);

        return () => {
            window.removeEventListener("wheel", handleWheel);
            window.removeEventListener("touchstart", handleTouchStart);
            window.removeEventListener("touchmove", handleTouchMove);
            window.removeEventListener("touchend", handleTouchEnd);
        };
    }, [selectedVideo]);

    useEffect(() => {
        if (!selectedVideoRef.current) return;
        const videoEl = selectedVideoRef.current;
        const playOnOpen = async () => {
            try {
                await videoEl.play();
            } catch (error) {
                console.warn("Autoplay prevented:", error);
            }
        };
        playOnOpen();
    }, [selectedVideo]);

  useEffect(() => {
    setVideos(LOCAL_STORY_VIDEOS);
  }, []);

  if (videos.length === 0) {
    return (
        <div className="w-full h-24 flex items-center justify-center text-gray-500">
          <p>טוען סרטונים...</p>
        </div>
    );
  }

  return (
      <div className="w-full">
        <div className="flex overflow-x-auto gap-3 py-2 scrollbar-hide">
          {videos.map((video, index) => {
            const src = video.image_url || video.imageUrl || video.video_url || video.videoUrl || video.url || "";
            return (
                <motion.div
                    key={video.id || index}
                    className="relative flex-shrink-0 w-32 h-52 rounded-2xl overflow-hidden bg-gray-900 shadow-lg cursor-pointer"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.5, delay: index * 0.1 }}
                    onClick={() => setSelectedVideo(video)}
                >
                  <video
                      className="w-full h-full object-cover"
                      src={src}
                      autoPlay
                      loop
                      muted
                      playsInline
                      preload="auto"
                  />
                  <div className="absolute bottom-2 right-2 w-8 h-8 bg-black/50 rounded-full flex items-center justify-center border-2 border-white">
                    <img
                        src="/logo.png"
                        alt="logo"
                        className="w-5 h-5 object-contain"
                    />
                  </div>
                </motion.div>
            );
          })}
        </div>

        <AnimatePresence>
          {selectedVideo && (
              <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
                  onClick={() => setSelectedVideo(null)}
              >
                <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    className="relative w-[70vw] max-w-xs max-h-[70vh] aspect-[9/16]"
                    onClick={(e) => e.stopPropagation()}
                >
                  <video
                      ref={selectedVideoRef}
                      className="w-full h-full object-contain rounded-2xl"
                      src={
                        selectedVideo.full_url
                        || selectedVideo.fullUrl
                        || selectedVideo.image_url
                        || selectedVideo.imageUrl
                        || selectedVideo.video_url
                        || selectedVideo.videoUrl
                        || selectedVideo.url
                      }
                      autoPlay
                      muted
                      controls
                      loop
                      playsInline
                  />
                  <button
                      onClick={() => setSelectedVideo(null)}
                      className="absolute top-3 right-3 text-white bg-black/60 hover:bg-black/80 rounded-full p-2"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </motion.div>
              </motion.div>
          )}
        </AnimatePresence>
      </div>
  );
}
