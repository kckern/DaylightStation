import './ClimateReadout.scss';

export default function ClimateReadout({ climate }) {
  if (!climate?.available) {
    return <div className="climate-readout climate-readout--unavailable">—</div>;
  }
  return (
    <div className="climate-readout">
      <div className="climate-readout__temp">
        {climate.tempF != null ? `${climate.tempF.toFixed(1)}°` : '—'}
      </div>
      {climate.humidityPct != null && (
        <div className="climate-readout__hum">{climate.humidityPct}% RH</div>
      )}
    </div>
  );
}
