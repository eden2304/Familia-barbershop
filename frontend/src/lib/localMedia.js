const baseUrl = import.meta.env.BASE_URL || "/";

function withBaseUrl(fileName) {
  return new URL(fileName, window.location.origin + baseUrl).pathname;
}

export const LOCAL_BACKGROUND_VIDEO = withBaseUrl("backgroundVideo.mp4");

export const LOCAL_STORY_VIDEOS = [
  {
    id: "local-story-1",
    alt_text: "סטורי 1",
    image_url: withBaseUrl("video1.mp4"),
    video_url: withBaseUrl("video1.mp4"),
    full_url: withBaseUrl("video1.mp4"),
    url: withBaseUrl("video1.mp4"),
    order_index: 0,
    isLocal: true,
  },
  {
    id: "local-story-2",
    alt_text: "סטורי 2",
    image_url: withBaseUrl("video2.mp4"),
    video_url: withBaseUrl("video2.mp4"),
    full_url: withBaseUrl("video2.mp4"),
    url: withBaseUrl("video2.mp4"),
    order_index: 1,
    isLocal: true,
  },
  {
    id: "local-story-3",
    alt_text: "סטורי 3",
    image_url: withBaseUrl("video3.mp4"),
    video_url: withBaseUrl("video3.mp4"),
    full_url: withBaseUrl("video3.mp4"),
    url: withBaseUrl("video3.mp4"),
    order_index: 2,
    isLocal: true,
  },
  {
    id: "local-story-4",
    alt_text: "סטורי 4",
    image_url: withBaseUrl("video4.mp4"),
    video_url: withBaseUrl("video4.mp4"),
    full_url: withBaseUrl("video4.mp4"),
    url: withBaseUrl("video4.mp4"),
    order_index: 3,
    isLocal: true,
  },
  {
    id: "local-story-5",
    alt_text: "סטורי 5",
    image_url: withBaseUrl("video5.mp4"),
    video_url: withBaseUrl("video5.mp4"),
    full_url: withBaseUrl("video5.mp4"),
    url: withBaseUrl("video5.mp4"),
    order_index: 4,
    isLocal: true,
  },
  {
    id: "local-story-6",
    alt_text: "סטורי 6",
    image_url: withBaseUrl("video6.mp4"),
    video_url: withBaseUrl("video6.mp4"),
    full_url: withBaseUrl("video6.mp4"),
    url: withBaseUrl("video6.mp4"),
    order_index: 5,
    isLocal: true,
  },
];

export const LOCAL_BACKGROUND_VIDEO_ENTRY = {
  id: "local-background-video",
  video_url: LOCAL_BACKGROUND_VIDEO,
  image_url: LOCAL_BACKGROUND_VIDEO,
  full_url: LOCAL_BACKGROUND_VIDEO,
  url: LOCAL_BACKGROUND_VIDEO,
  is_active: true,
  isLocal: true,
};
