import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GalleryImage } from "@/api/entities"; // ← זה ה-export אצלך
import { X } from "lucide-react";

export default function VideoGallery() {
  const [videos, setVideos] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    const fetchVideos = async () => {
      try {
        // אותו API כמו אצלך, רק דרך ה-index
        const galleryData = await GalleryImage.list({ signal: controller.signal });
        if (!controller.signal.aborted) {
          setVideos(Array.isArray(galleryData) ? galleryData : []);
        }
      } catch (error) {
        if (error?.name !== 'AbortError') {
          console.error("Error fetching gallery videos:", error);
        }
        if (!controller.signal.aborted) {
          setVideos([]);
        }
      }
    };

    fetchVideos();
    return () => controller.abort();
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
            const src = video.video_url || video.url || video.image_url || "";
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
                      preload="metadata"
                  />
                  <div className="absolute bottom-2 right-2 w-8 h-8 bg-black/50 rounded-full flex items-center justify-center border-2 border-white">
                    <img
                        src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/7a0e19259_logo.png"
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
                    className="relative w-full max-w-sm aspect-[9/16]"
                    onClick={(e) => e.stopPropagation()}
                >
                  <video
                      className="w-full h-full object-contain rounded-2xl"
                      src={selectedVideo.video_url || selectedVideo.url || selectedVideo.image_url}
                      autoPlay
                      controls
                      loop
                  />
                  <button
                      onClick={() => setSelectedVideo(null)}
                      className="absolute -top-10 right-0 text-white bg-black/50 rounded-full p-2"
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
