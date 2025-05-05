import { useState, useEffect, useRef } from "react";
import {
  DaylightAPI,
  DaylightHostPath,
  DaylightWebsocketSubscribe,
  DaylightWebsocketUnsubscribe
} from "../lib/api.mjs";
import "./AppContainer.scss";

export default function AppContainer({ open, clear }) {
  const app = open?.app || open.open || open;
  const param = open?.param || open.param || open;
  useEffect(
    () => {
      const handleKeyDown = event => {
        if (event.key === "Escape") {
          clear();
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => {
        window.removeEventListener("keydown", handleKeyDown);
      };
    },
    [clear]
  );

  if (app === "websocket") return <WebSocketApp path={param} />;
  if (app === "glympse") return <GlympseApp id={param} />;
  if (app === "keycode") return <KeyTestApp />;
  if (app === "art") return <ArtApp />;
  if (app === "webcam") return <WebcamApp />;
  if (app === "wrapup") return <WrapUp clear={clear} />;
  return (
    <div>
      <h2>App Container</h2>
      <pre>
        {JSON.stringify({ app, param, open }, null, 2)}
      </pre>
    </div>
  );
}


function WrapUp({ clear }) {
  useEffect(() => {
    DaylightAPI("exe/tv/off").then(()=>{
      //trigger escape key
      const event = new KeyboardEvent("keydown", { key: "Escape" });
      window.dispatchEvent(event);
      clear();
    });
  }, []);
  return null;
}


function ArtApp() {

  const url = DaylightHostPath() + "/data/img/art.jpg";
  return <div className="art-app">
    <img src={url} alt="Daylight Art" />
  </div>


}


function KeyTestApp() {
  const [keyCode, setKeyCode] = useState(null);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Enter") {
        openKeyCodeTest();
      }
      setKeyCode(event.keyCode);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const openKeyCodeTest = () => {
    const newWindow = window.open("https://www.toptal.com/developers/keycode", "_blank");
    if (newWindow) {
      newWindow.focus();
    } else {
      alert("Please allow popups for this website");
    }
  };

  return (
    <div>
      <h2>Key Test App</h2>
      <p>
        This is a test app to check the key codes of the keyboard.
        <br />
        <span>Press any key to see the key code</span>
        <br />
        {keyCode && <span>Key Code: {keyCode}</span>}
      </p>
    </div>
  );
}


function GlympseApp({id}){
  if(!id) return <div>Invalid Glympse ID</div>;
  const iframeRef = useRef(null);
  useEffect(() => {
    if (iframeRef.current) {
      iframeRef.current.src = `https://glympse.com/${id}`;
    }
  }, [id]);
  return (
    <div style={{ width: "100%", height: "100%" }}>
      <iframe
        style={{ 
          marginTop: "-50px", 
          marginLeft: "-50px", 
          width: "calc(100% + 100px)", 
          height: "calc(100% + 90px)" }}
        ref={iframeRef}
        title="Glympse"
        frameBorder="0"
        scrolling="no"
      />
    </div>
  );
}

function WebSocketApp({ path }) {
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    const handleNewMessage = message => {
      setMessages(prevMessages => [...prevMessages, message]);
    };

    DaylightWebsocketSubscribe(path, handleNewMessage);

    return () => {
      DaylightWebsocketUnsubscribe(path);
    };
  }, []);

  return (
    <div>
      <h3>WebSocket Messages</h3>
      {messages.length > 0
        ? messages.map((message, index) =>
            <div key={index}>
              {JSON.stringify(message)}
            </div>
          )
        : <p>No messages received yet.</p>}
    </div>
  );
}

export  function WebcamApp() {
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
      // Close old audio context if any
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      // Stop any old video tracks
      if (videoRef.current && videoRef.current.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }
    };

    const startWebcamAndMic = async () => {
      if (!selectedVideoDevice && !selectedAudioDevice) return;

      try {
        //  1) Acquire combined stream for video (and audio) for preview
        //     (You can also split them, but combined is often simpler.)
        localVideoStream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: selectedVideoDevice, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: { deviceId: selectedAudioDevice }
        });

        // Attach to video element
        if (videoRef.current) {
          videoRef.current.srcObject = localVideoStream;
        }

        //  2) Acquire separate audio-only stream for volume analysis
        //     (Alternatively, you could reuse localVideoStream’s audio tracks,
        //      but sometimes a separate capture is clearer.)
        localAudioStream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: selectedAudioDevice }
        });

        //  3) Create fresh AudioContext + Analyser
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const audioContext = new AudioContextClass();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;

        // Connect source -> analyser
        const source = audioContext.createMediaStreamSource(localAudioStream);
        source.connect(analyser);

        // Store these in refs so we can clean them up later
        audioContextRef.current = audioContext;
        analyserRef.current = analyser;
        dataArrayRef.current = new Uint8Array(analyser.fftSize);

        //  4) Kick off a loop to read the volume
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
  // 3) Spacebar/Enter to cycle through audio devices
  // ------------------------------------------------------------------
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === " " || event.key === "Spacebar" || event.key === "Enter" || event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      if (audioDevices.length > 0 && selectedAudioDevice) {
        const currentIndex = audioDevices.findIndex(
        (device) => device.deviceId === selectedAudioDevice
        );
        const nextIndex = (currentIndex + 1) % audioDevices.length;
        setSelectedAudioDevice(audioDevices[nextIndex].deviceId);
      }

      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      if (audioDevices.length > 0 && selectedAudioDevice) {
        const currentIndex = audioDevices.findIndex(
        (device) => device.deviceId === selectedAudioDevice
        );
        const prevIndex = (currentIndex - 1 + audioDevices.length) % audioDevices.length;
        setSelectedAudioDevice(audioDevices[prevIndex].deviceId);
      }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [audioDevices, selectedAudioDevice]);

  // Meter conversion
  const volumePercentage = Math.min(volume * 1000, 100);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  if(false) return <pre>
  {JSON.stringify({ volume, volumePercentage }, null, 2)}
  <div>
    {videoDevices.map((device, index) => (
      <div
        key={index}
        style={{
          color: selectedVideoDevice === device.deviceId ? "green" : "grey",
        }}
      >
        <strong>Camera {index + 1}:</strong> {device.label || `Device ${index + 1}`}
        {selectedVideoDevice === device.deviceId ? " 🎥" : ""}
      </div>
    ))}
    {audioDevices.map((device, index) => (
      <div
        key={index}
        style={{
          color: selectedAudioDevice === device.deviceId ? "green" : "grey",
        }}
      >
        <strong>Mic {index + 1}:</strong> {device.label || `Device ${index + 1}`}
        {selectedAudioDevice === device.deviceId ? " 🎤" : ""}
      </div>
    ))}
  </div>
</pre>

  return (
    <div
      style={{
        width: "calc(100% - 2rem)",
        height: "calc(100% - 2rem)",
        position: "relative",
        padding: "3rem",
        margin: "1rem",
        boxSizing: "border-box",
      }}
    >
      {/* Debug info */}
      
      {/* Volume Meter */}
      <div
        style={{
          textAlign: "center",
          marginTop: "20px",
          position: "absolute",
          left: 0,
          width: "100%",
          height: "100%",
          bottom: 0,
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
            zIndex: 1,
          }}
        >
          <div
            style={{
              width: `${volumePercentage}%`,
              height: "100%",
              borderRadius: "5px",
              backgroundColor: "green",
              transition: "width 0.1s",
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
          //fade edges
          boxShadow: "0 0 20px rgba(0, 0, 0, 0.5)",
          filter: "saturate(1.3) brightness(1.2)",
          height: "100%",
          transform: "scaleX(-1)", // Mirror video
        }}
      />
    </div>
  );
}


