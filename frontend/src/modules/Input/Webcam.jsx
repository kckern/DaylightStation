import React, { useEffect } from "react";
import { useMediaDevices } from "./hooks/useMediaDevices";
import { useWebcamStream } from "./hooks/useWebcamStream";
import { useVolumeMeter } from "./hooks/useVolumeMeter";

export default function WebcamApp() {
  const {
    videoDevices,
    audioDevices,
    selectedVideoDevice,
    selectedAudioDevice,
    cycleVideoDevice,
    cycleAudioDevice
  } = useMediaDevices();

  const { videoRef, error: videoError } = useWebcamStream(selectedVideoDevice, selectedAudioDevice);
  const { volume } = useVolumeMeter(selectedAudioDevice);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = event => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        cycleVideoDevice('next');
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        cycleVideoDevice('prev');
      } else if (
        event.key === " " ||
        event.key === "Spacebar" ||
        event.key === "Enter" ||
        event.key === "ArrowDown"
      ) {
        event.preventDefault();
        cycleAudioDevice('next');
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        cycleAudioDevice('prev');
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [cycleVideoDevice, cycleAudioDevice]);

  // Meter conversion
  const volumePercentage = Math.min(volume * 1000, 100);

  return (
    <div
      style={{
        width: "calc(100% - 2rem)",
        height: "calc(100% - 2rem)",
        position: "relative",
        padding: "3rem",
        margin: "1rem",
        boxSizing: "border-box"
      }}
    >
      {/* Floating labels for the currently selected camera & mic */}
      <div
        style={{
          position: "absolute",
          bottom: 10,
          left: '50%',
          width: "20rem",
          textAlign: "center",
          marginLeft: "-10rem",
          color: "white",
          backgroundColor: "rgba(0,0,0,0.5)",
          padding: "6px 8px",
          borderRadius: 4,
          zIndex: 10
        }}
      >
        <div>
          Camera:{" "}
          {
            videoDevices.find(d => d.deviceId === selectedVideoDevice)
              ?.label || "No camera"
          }
        </div>
        <div>
          Mic:{" "}
          {
            audioDevices.find(d => d.deviceId === selectedAudioDevice)
              ?.label || "No microphone"
          }
        </div>
      </div>

      {/* Volume Meter */}
      <div
        style={{
          textAlign: "center",
          marginTop: "20px",
          position: "absolute",
          left: 0,
          width: "100%",
          height: "100%",
          bottom: 0
        }}
      >
        <div
          style={{
            opacity: 0.8,
            display: "inline-block",
            borderRadius: "5px",
            width: "300px",
            height: "20px",
            backgroundColor: "#ddd",
            position: "relative",
            zIndex: 1
          }}
        >
          <div
            style={{
              width: `${volumePercentage}%`,
              height: "100%",
              borderRadius: "5px",
              backgroundColor: "green",
              transition: "width 0.1s"
            }}
          />
        </div>
      </div>

      {/* Video Preview */}
      <video
        ref={videoRef}
        autoPlay
        muted
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          borderRadius: "50%",
          objectFit: "cover",
          boxShadow: "0 0 20px rgba(0, 0, 0, 0.5)",
          filter: "saturate(2) contrast(1.2) brightness(1.2)",
          height: "100%",
          transform: "scaleX(-1)" // Mirror video
        }}
      />
      {videoError && (
        <div style={{ position: 'absolute', top: 10, left: 10, color: 'red', background: 'rgba(0,0,0,0.7)', padding: 5 }}>
          Error: {videoError.message}
        </div>
      )}
    </div>
  );
}
