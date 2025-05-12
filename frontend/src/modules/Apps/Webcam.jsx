import React, { useEffect, useRef, useState } from "react";

export default function WebcamApp() {
  const videoRef = useRef(null);

  // Store the discovered devices
  const [videoDevices, setVideoDevices] = useState([]);
  const [audioDevices, setAudioDevices] = useState([]);

  // Currently selected device IDs
  const [selectedVideoDevice, setSelectedVideoDevice] = useState(null);
  const [selectedAudioDevice, setSelectedAudioDevice] = useState(null);

  // Volume state
  const [volume, setVolume] = useState(0);

  // Refs to handle audio analysis resources
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);
  const animationIdRef = useRef(null);

  // ------------------------------------------------------------------
  // 1) On mount: Enumerate devices and pick defaults
  // ------------------------------------------------------------------
  useEffect(() => {
    const getDevices = async () => {
      try {
        const devicesList = await navigator.mediaDevices.enumerateDevices();
        const vidDevices = devicesList.filter(d => d.kind === "videoinput");
        const audDevices = devicesList.filter(d => d.kind === "audioinput");

        setVideoDevices(vidDevices);
        setAudioDevices(audDevices);
        if (vidDevices.length > 0) {
          setSelectedVideoDevice(vidDevices[0].deviceId);
        }
        if (audDevices.length > 0) {
          setSelectedAudioDevice(audDevices[0].deviceId);
        }
      } catch (error) {
        console.error("Error enumerating devices:", error);
      }
    };
    getDevices();
  }, []);

  // ------------------------------------------------------------------
  // 2) Whenever selectedVideoDevice or selectedAudioDevice changes:
  //    - stop old streams and analysis
  //    - start new stream and set up volume analysis
  // ------------------------------------------------------------------
  useEffect(() => {
    let localVideoStream;
    let localAudioStream;

    // Cleanup from a previous run
    const cleanup = () => {
      // Stop meter animation
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
        animationIdRef.current = null;
      }
      // Close old audio context, if any
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      // Stop any old video tracks
      if (videoRef.current && videoRef.current.srcObject) {
        videoRef.current.srcObject
          .getTracks()
          .forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }
    };

    const startWebcamAndMic = async () => {
      if (!selectedVideoDevice && !selectedAudioDevice) return;

      try {
        // 1) Acquire combined video+audio stream for local preview
        try {
          localVideoStream = await navigator.mediaDevices.getUserMedia({
            video: selectedVideoDevice
              ? {
                  deviceId: selectedVideoDevice,
                  width: { ideal: 1280 },
                  height: { ideal: 720 },
                }
              : true,
            audio: selectedAudioDevice
              ? { deviceId: selectedAudioDevice }
              : true,
          });
        } catch (error) {
          console.warn(
            "Error accessing selected devices, falling back to defaults:",
            error
          );
          try {
            localVideoStream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: true,
            });
          } catch (fallbackError) {
            console.error("Error accessing default devices:", fallbackError);
            alert(
              "Unable to access webcam or microphone. Please check your device settings."
            );
          }
        }

        // Attach to video element
        if (videoRef.current) {
          videoRef.current.srcObject = localVideoStream;
        }

        // 2) Acquire separate audio-only stream for volume analysis
        localAudioStream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: selectedAudioDevice },
        });

        // 3) Create fresh AudioContext + Analyser
        const AudioContextClass =
          window.AudioContext || window.webkitAudioContext;
        const audioContext = new AudioContextClass();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;

        // Connect source -> analyser
        const source = audioContext.createMediaStreamSource(localAudioStream);
        source.connect(analyser);

        // Save refs for cleanup
        audioContextRef.current = audioContext;
        analyserRef.current = analyser;
        dataArrayRef.current = new Uint8Array(analyser.fftSize);

        // 4) Start a loop to read volume
        const analyzeVolume = () => {
          analyser.getByteTimeDomainData(dataArrayRef.current);
          let sumSquares = 0;
          for (let i = 0; i < dataArrayRef.current.length; i++) {
            const val = (dataArrayRef.current[i] - 128) / 128; // center around zero
            sumSquares += val * val;
          }
          const rms = Math.sqrt(sumSquares / dataArrayRef.current.length);
          setVolume(rms);

          animationIdRef.current = requestAnimationFrame(analyzeVolume);
        };
        analyzeVolume();
      } catch (error) {
        console.error("Error accessing webcam/microphone:", error);
      }
    };

    // First clean up any old streams/contexts, then start new
    cleanup();
    startWebcamAndMic();

    // Final cleanup on unmount or re-run
    return () => {
      cleanup();
      if (localVideoStream) {
        localVideoStream.getTracks().forEach(t => t.stop());
      }
      if (localAudioStream) {
        localAudioStream.getTracks().forEach(t => t.stop());
      }
    };
  }, [selectedVideoDevice, selectedAudioDevice]);

  // ------------------------------------------------------------------
  // 3) Keyboard shortcuts to cycle devices
  //    - ArrowLeft/ArrowRight to cycle video devices
  //    - ArrowUp/ArrowDown/Space/Enter to cycle audio devices
  // ------------------------------------------------------------------
  useEffect(() => {
    const handleKeyDown = event => {
      // --- Cycle VIDEO (cameras) with ArrowLeft / ArrowRight
      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (videoDevices.length > 0 && selectedVideoDevice) {
          const currentIndex = videoDevices.findIndex(
            d => d.deviceId === selectedVideoDevice
          );
          const nextIndex = (currentIndex + 1) % videoDevices.length;
          setSelectedVideoDevice(videoDevices[nextIndex].deviceId);
        }
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (videoDevices.length > 0 && selectedVideoDevice) {
          const currentIndex = videoDevices.findIndex(
            d => d.deviceId === selectedVideoDevice
          );
          const prevIndex =
            (currentIndex - 1 + videoDevices.length) % videoDevices.length;
          setSelectedVideoDevice(videoDevices[prevIndex].deviceId);
        }
      }
      // --- Cycle AUDIO (mics) with ArrowUp/ArrowDown/Space/Enter
      else if (
        event.key === " " ||
        event.key === "Spacebar" ||
        event.key === "Enter" ||
        event.key === "ArrowDown"
      ) {
        event.preventDefault();
        if (audioDevices.length > 0 && selectedAudioDevice) {
          const currentIndex = audioDevices.findIndex(
            device => device.deviceId === selectedAudioDevice
          );
          const nextIndex = (currentIndex + 1) % audioDevices.length;
          setSelectedAudioDevice(audioDevices[nextIndex].deviceId);
        }
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (audioDevices.length > 0 && selectedAudioDevice) {
          const currentIndex = audioDevices.findIndex(
            device => device.deviceId === selectedAudioDevice
          );
          const prevIndex =
            (currentIndex - 1 + audioDevices.length) % audioDevices.length;
          setSelectedAudioDevice(audioDevices[prevIndex].deviceId);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [audioDevices, videoDevices, selectedAudioDevice, selectedVideoDevice]);

  // Meter conversion
  const volumePercentage = Math.min(volume * 1000, 100);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
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
          filter: "saturate(1.3) brightness(1.2)",
          height: "100%",
          transform: "scaleX(-1)" // Mirror video
        }}
      />
    </div>
  );
}