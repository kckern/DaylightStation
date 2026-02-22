import BaseVideoCall from "../../../Input/VideoCall.jsx";
import "./VideoCall.scss";

export default function VideoCallApp({ param, clear }) {
  return <BaseVideoCall deviceId={param} clear={clear} />;
}
