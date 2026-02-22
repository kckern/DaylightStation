import BaseVideoCall from "../../../Input/VideoCall.jsx";
import "./VideoCall.scss";

export default function VideoCallApp({ device, clear }) {
  return <BaseVideoCall deviceId={device} clear={clear} />;
}
