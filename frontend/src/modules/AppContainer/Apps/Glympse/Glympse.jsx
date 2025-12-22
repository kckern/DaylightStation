import { useEffect, useRef } from "react";
import "./Glympse.scss";

export default function GlympseApp({ id }) {
  if (!id) return <div className="glympse-app">Invalid Glympse ID</div>;

  const iframeRef = useRef(null);

  useEffect(() => {
    if (iframeRef.current) {
      iframeRef.current.src = `https://glympse.com/${id}`;
    }
  }, [id]);

  return (
    <div className="glympse-app">
      <iframe
        style={{
          marginTop: "-50px",
          marginLeft: "-50px",
          width: "calc(100% + 100px)",
          height: "calc(100% + 90px)",
        }}
        ref={iframeRef}
        title="Glympse"
        frameBorder="0"
        scrolling="no"
      />
    </div>
  );
}
