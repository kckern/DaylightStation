import React, { useEffect, useRef, useMemo, useState } from "react";
import { useMediaDevices } from "./hooks/useMediaDevices";
import { useWebcamStream } from "./hooks/useWebcamStream";
import { useVolumeMeter } from "./hooks/useVolumeMeter";
import { DaylightAPI } from "../../lib/api.mjs";
import getLogger from "../../lib/logging/Logger.js";

export default function WebcamApp() {
  // Fetch input preferences from device config
  const [inputPrefs, setInputPrefs] = useState({});
  useEffect(() => {
    DaylightAPI('api/v1/device/config')
      .then(config => {
        // Collect input preferences from all devices
        const devices = config?.devices || config || {};
        for (const dev of Object.values(devices)) {
          if (dev.input) {
            setInputPrefs(dev.input);
            break;
          }
        }
      })
      .catch(() => {});
  }, []);

  const {
    videoDevices,
    audioDevices,
    selectedVideoDevice,
    selectedAudioDevice,
    cycleVideoDevice,
    cycleAudioDevice
  } = useMediaDevices({
    preferredCameraPattern: inputPrefs.preferred_camera,
    preferredMicPattern: inputPrefs.preferred_mic,
  });

  const { videoRef, stream, error: videoError } = useWebcamStream(selectedVideoDevice, selectedAudioDevice);
  const { volume } = useVolumeMeter(stream);

  const logger = useMemo(() => getLogger().child({ component: 'WebcamApp' }), []);

  // --- Auto-cycle audio device on sustained silence ---
  const volumeRef = useRef(0);
  volumeRef.current = volume;
  const silenceStartRef = useRef(null);
  const triedDevicesRef = useRef(new Set());
  const confirmedRef = useRef(false);

  // Reset when device list changes (plug/unplug)
  useEffect(() => {
    confirmedRef.current = false;
    triedDevicesRef.current = new Set();
    silenceStartRef.current = null;
  }, [audioDevices.length]);

  // Poll volume and cycle to next audio device after 5s of silence
  useEffect(() => {
    if (audioDevices.length <= 1 || !selectedAudioDevice) return;

    // Fresh silence window for newly selected device
    silenceStartRef.current = null;

    const SILENCE_THRESHOLD_MS = 5000;

    const interval = setInterval(() => {
      if (confirmedRef.current) return;
      if (triedDevicesRef.current.size >= audioDevices.length) return;

      if (volumeRef.current > 0) {
        confirmedRef.current = true;
        silenceStartRef.current = null;
        logger.info('audio-device-confirmed', {
          device: selectedAudioDevice?.slice(0, 8),
        });
        return;
      }

      if (!silenceStartRef.current) {
        silenceStartRef.current = Date.now();
        return;
      }

      if (Date.now() - silenceStartRef.current >= SILENCE_THRESHOLD_MS) {
        triedDevicesRef.current.add(selectedAudioDevice);
        silenceStartRef.current = null;
        logger.info('auto-cycle-audio-silence', {
          silentDevice: selectedAudioDevice?.slice(0, 8),
          tried: triedDevicesRef.current.size,
          total: audioDevices.length,
        });
        cycleAudioDevice('next');
      }
    }, 500);

    return () => clearInterval(interval);
  }, [audioDevices, selectedAudioDevice, cycleAudioDevice, logger]);

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
  const volumePercentage = Math.min(volume * 100, 100);

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
          objectFit: "cover",
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
