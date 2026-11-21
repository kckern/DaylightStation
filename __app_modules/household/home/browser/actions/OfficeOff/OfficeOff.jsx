import PowerOffAction from '../PowerOffAction.jsx';

export default function OfficeOff({ clear }) {
  return <PowerOffAction path="api/v1/home/office_tv/off" target="the office TV" clear={clear} />;
}
