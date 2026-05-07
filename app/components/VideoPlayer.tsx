"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

interface VideoPlayerProps {
  videoId: string;
  seekTo?: number | null;
  onSeekConsumed?: () => void;
}

export default function VideoPlayer({ videoId, seekTo, onSeekConsumed }: VideoPlayerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (seekTo !== null && seekTo !== undefined && isReady && iframeRef.current) {
      const src = `https://www.youtube.com/embed/${videoId}?enablejsapi=1&autoplay=1&start=${Math.floor(seekTo)}`;
      iframeRef.current.src = src;
      onSeekConsumed?.();
    }
  }, [seekTo, isReady, videoId, onSeekConsumed]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="relative w-full rounded-2xl overflow-hidden shadow-2xl bg-black"
      style={{ paddingTop: "56.25%" }}
    >
      <iframe
        ref={iframeRef}
        className="absolute inset-0 w-full h-full"
        src={`https://www.youtube.com/embed/${videoId}?enablejsapi=1`}
        title="Lecture Video"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        onLoad={() => setIsReady(true)}
      />
    </motion.div>
  );
}
