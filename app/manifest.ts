import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SimplyTrack", short_name: "SimplyTrack",
    description: "Your private, local-first money workspace.",
    start_url: "/", scope: "/", display: "standalone",
    background_color: "#f7f8fa", theme_color: "#f7f8fa",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
