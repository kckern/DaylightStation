/**
 * Weather Widget — current conditions + hourly forecast chart
 * @module 1_rendering/eink/widgets/WeatherWidget
 *
 * Expects data from /api/v1/home/weather:
 *   { current: { temp, feel, code, cloud, aqi, precip, pm2_5 }, hourly: [...] }
 *
 * Layout: top strip = current conditions, bottom = full-width hourly chart.
 *
 * IMPORTANT: Only uses the Spectra 6 palette (black, white, red, yellow, blue, green).
 * No grays — they will dither unpredictably on the e-ink panel.
 */

const WMO_CODES = {
  0: 'Clear sky',        1: 'Mainly clear',     2: 'Partly cloudy',    3: 'Overcast',
  45: 'Foggy',           48: 'Rime fog',         51: 'Light drizzle',   53: 'Drizzle',
  55: 'Dense drizzle',   61: 'Light rain',       63: 'Rain',            65: 'Heavy rain',
  71: 'Light snow',      73: 'Snow',             75: 'Heavy snow',      77: 'Snow grains',
  80: 'Light showers',   81: 'Showers',          82: 'Heavy showers',
  85: 'Light snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm',    96: 'T-storm w/ hail',  99: 'Severe thunderstorm',
};

function conditionColor(code, theme) {
  if (code === 0 || code === 1) return theme.yellow;   // clear/sunny → yellow
  if (code <= 3) return theme.fg;                       // cloudy → black
  if (code <= 48) return theme.fg;                      // fog → black
  if (code <= 55) return theme.blue;                    // drizzle → blue
  if (code <= 65) return theme.blue;                    // rain → blue
  if (code <= 77) return theme.blue;                    // snow → blue
  if (code <= 82) return theme.blue;                    // showers → blue
  return theme.red;                                     // thunderstorm → red
}

function aqiLabel(aqi) {
  if (aqi <= 50) return { text: 'Good', color: 'green' };
  if (aqi <= 100) return { text: 'Moderate', color: 'yellow' };
  if (aqi <= 150) return { text: 'Unhealthy (sens.)', color: 'red' };
  return { text: 'Unhealthy', color: 'red' };
}

function cToF(c) {
  return Math.round(c * 9 / 5 + 32);
}

export function draw(ctx, box, data, theme) {
  const { x, y, w, h } = box;
  const weather = data?.weather;

  if (!weather?.current) {
    ctx.fillStyle = theme.fg;
    ctx.font = '28px DejaVu Sans';
    ctx.textBaseline = 'top';
    ctx.fillText('No weather data', x + 20, y + 20);
    return;
  }

  const cur = weather.current;
  const condition = WMO_CODES[cur.code] || `Code ${cur.code}`;
  const tempF = cToF(cur.temp);
  const feelsF = cToF(cur.feel);
  const pad = 40;

  ctx.save();

  // ═══════════════════════════════════════════════════════
  // TOP SECTION: Current conditions (fixed height ~280px)
  // ═══════════════════════════════════════════════════════
  const topH = 280;

  // ── Left: Big temperature + condition ──
  ctx.fillStyle = theme.fg;
  ctx.font = 'bold 120px DejaVu Sans';
  ctx.textBaseline = 'top';
  ctx.fillText(`${tempF}\u00B0`, x + pad, y + 20);

  // Condition with color accent
  const condColor = conditionColor(cur.code, theme);
  ctx.fillStyle = condColor;
  ctx.font = 'bold 44px DejaVu Sans';
  ctx.fillText(condition, x + pad, y + 160);

  // Feels-like (use blue for secondary temp)
  ctx.font = '32px DejaVu Sans';
  ctx.fillStyle = theme.blue;
  ctx.fillText(`Feels like ${feelsF}\u00B0F`, x + pad, y + 218);

  // ── Right: AQI badge + stats ──
  const statsX = x + w - 420;

  // AQI badge
  const aqi = Math.round(cur.aqi || 0);
  const aqiInfo = aqiLabel(aqi);
  const badgeColor = theme[aqiInfo.color] || theme.green;

  ctx.fillStyle = badgeColor;
  const badgeW = 180;
  const badgeH = 60;
  const badgeX = statsX;
  const badgeY = y + 30;
  roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 12);
  ctx.fill();

  // Badge text — black on yellow, white on green/red
  ctx.fillStyle = (aqiInfo.color === 'yellow') ? theme.fg : theme.bg;
  ctx.font = 'bold 28px DejaVu Sans';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`AQI ${aqi}`, badgeX + badgeW / 2, badgeY + badgeH / 2);
  ctx.textAlign = 'left';

  // AQI description (same color as badge)
  ctx.fillStyle = badgeColor;
  ctx.font = 'bold 24px DejaVu Sans';
  ctx.textBaseline = 'top';
  ctx.fillText(aqiInfo.text, badgeX + badgeW + 16, badgeY + 16);

  // Cloud cover
  ctx.fillStyle = theme.fg;
  ctx.font = '30px DejaVu Sans';
  ctx.textBaseline = 'top';
  ctx.fillText(`Cloud cover: ${cur.cloud}%`, statsX, y + 112);

  // Precipitation (blue)
  if (cur.precip > 0) {
    ctx.fillStyle = theme.blue;
    ctx.fillText(`Precip: ${cur.precip.toFixed(1)} mm`, statsX, y + 156);
  } else {
    ctx.fillStyle = theme.fg;
    ctx.fillText(`No precipitation`, statsX, y + 156);
  }

  // PM2.5 (red if elevated, green if good)
  if (cur.pm2_5 != null) {
    ctx.fillStyle = cur.pm2_5 > 12 ? theme.red : theme.green;
    ctx.font = '26px DejaVu Sans';
    ctx.fillText(`PM2.5: ${cur.pm2_5.toFixed(1)} \u00B5g/m\u00B3`, statsX, y + 204);
  }

  // ── Divider (solid black, not gray) ──
  const divY = y + topH;
  ctx.strokeStyle = theme.fg;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + pad, divY);
  ctx.lineTo(x + w - pad, divY);
  ctx.stroke();

  // ═══════════════════════════════════════════════════════
  // BOTTOM SECTION: Hourly forecast chart (full width)
  // ═══════════════════════════════════════════════════════
  const hourly = weather.hourly || [];
  const nowUnix = Math.floor(Date.now() / 1000);
  const upcoming = hourly.filter(h => h.unix >= nowUnix).slice(0, 12);
  const hours = upcoming.length > 0 ? upcoming : hourly.slice(0, 12);

  if (hours.length === 0) {
    ctx.restore();
    return;
  }

  // Chart geometry
  const leftMargin = 90;   // room for Y-axis labels
  const rightMargin = 40;
  const chartX = x + leftMargin;
  const chartW = w - leftMargin - rightMargin;
  const chartTop = divY + 70;
  const chartBottom = y + h - 90;
  const chartH = chartBottom - chartTop;

  // Section label
  ctx.fillStyle = theme.fg;
  ctx.font = 'bold 30px DejaVu Sans';
  ctx.textBaseline = 'top';
  ctx.fillText('Hourly Forecast', x + pad, divY + 20);

  const colW = chartW / hours.length;
  const temps = hours.map(h => cToF(h.temp));

  // Uniform gridlines every 2°F, snapped to even numbers
  const dataMin = Math.min(...temps);
  const dataMax = Math.max(...temps);
  const gridStep = 2;
  const gridMin = Math.floor(dataMin / gridStep) * gridStep;
  const gridMax = Math.ceil(dataMax / gridStep) * gridStep;
  const gridRange = Math.max(gridMax - gridMin, gridStep);

  // ── Horizontal gridlines (uniform 2°F spacing) ──
  const gridCount = gridRange / gridStep;
  for (let i = 0; i <= gridCount; i++) {
    const gTemp = gridMax - i * gridStep;
    const gy = chartTop + (i / gridCount) * chartH;

    ctx.strokeStyle = theme.fg;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 8]);
    ctx.beginPath();
    ctx.moveTo(chartX, gy);
    ctx.lineTo(chartX + chartW, gy);
    ctx.stroke();
    ctx.setLineDash([]);

    // Y-axis label
    ctx.fillStyle = theme.fg;
    ctx.font = '22px DejaVu Sans';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${gTemp}\u00B0`, chartX - 12, gy);
  }

  // ── Precipitation bars (blue, solid — no alpha on e-ink) ──
  for (let i = 0; i < hours.length; i++) {
    const hr = hours[i];
    if (hr.precip > 0) {
      const cx = chartX + i * colW + colW / 2;
      const precipH = Math.min(hr.precip * 15, chartH * 0.7);
      ctx.fillStyle = theme.blue;
      ctx.globalAlpha = 0.3;
      ctx.fillRect(cx - colW * 0.3, chartBottom - precipH, colW * 0.6, precipH);
      ctx.globalAlpha = 1;
    }
  }

  // ── Compute data points ──
  const points = [];
  for (let i = 0; i < hours.length; i++) {
    const t = temps[i];
    const cx = chartX + i * colW + colW / 2;
    const normalized = (t - gridMin) / gridRange;
    const dotY = chartBottom - normalized * chartH;
    points.push({ cx, dotY, t });
  }

  // ── Connecting line (black) ──
  ctx.strokeStyle = theme.fg;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    if (i === 0) ctx.moveTo(points[i].cx, points[i].dotY);
    else ctx.lineTo(points[i].cx, points[i].dotY);
  }
  ctx.stroke();

  // ── Dots + labels ──
  for (let i = 0; i < hours.length; i++) {
    const { cx, dotY, t } = points[i];
    const hr = hours[i];

    // Dot — colored by weather condition
    const dotColor = conditionColor(hr.code, theme);
    ctx.beginPath();
    ctx.arc(cx, dotY, 8, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.fill();
    ctx.strokeStyle = theme.fg;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Temp label — always above dot, but enforce minimum distance from chart edges
    // If dot is near the bottom, push label higher so it doesn't collide with hour labels
    ctx.fillStyle = theme.fg;
    ctx.font = 'bold 24px DejaVu Sans';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const labelY = Math.min(dotY - 16, chartBottom - 50);
    ctx.fillText(`${t}\u00B0`, cx, labelY);

    // Hour label below chart
    const hour = new Date(hr.unix * 1000);
    const hLabel = hour.getHours() % 12 || 12;
    const ampm = hour.getHours() >= 12 ? 'p' : 'a';
    ctx.fillStyle = theme.fg;
    ctx.font = '24px DejaVu Sans';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`${hLabel}${ampm}`, cx, chartBottom + 12);

    // Precip amount (blue, below hour label)
    if (hr.precip >= 0.5) {
      ctx.fillStyle = theme.blue;
      ctx.font = 'bold 20px DejaVu Sans';
      ctx.fillText(`${hr.precip.toFixed(1)}`, cx, chartBottom + 42);
    }
  }

  ctx.restore();
}

function roundRect(ctx, rx, ry, rw, rh, r) {
  ctx.beginPath();
  ctx.moveTo(rx + r, ry);
  ctx.lineTo(rx + rw - r, ry);
  ctx.arcTo(rx + rw, ry, rx + rw, ry + r, r);
  ctx.lineTo(rx + rw, ry + rh - r);
  ctx.arcTo(rx + rw, ry + rh, rx + rw - r, ry + rh, r);
  ctx.lineTo(rx + r, ry + rh);
  ctx.arcTo(rx, ry + rh, rx, ry + rh - r, r);
  ctx.lineTo(rx, ry + r);
  ctx.arcTo(rx, ry, rx + r, ry, r);
  ctx.closePath();
}
