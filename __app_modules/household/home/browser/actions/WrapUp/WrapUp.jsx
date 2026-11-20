import PowerOffAction from '../PowerOffAction.jsx';

export default function WrapUp({ clear }) {
  return <PowerOffAction path="api/v1/home/tv/off" target="the living room TV" clear={clear} />;
}
