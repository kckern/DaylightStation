export class DailyReportImage {
  constructor({ reports, renderer = null, placeholder = placeholderPng }) { this.reports = reports; this.renderer = renderer; this.placeholder = placeholder; }
  async generate({ userId, date, reportLoaded = null }) {
    const report = await this.reports.execute({ userId, date });
    reportLoaded?.(report);
    return this.renderer?.renderDailyReport
      ? this.renderer.renderDailyReport(report)
      : this.placeholder();
  }
}
function placeholderPng() {
  return Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,10,73,68,65,84,120,156,99,0,1,0,0,5,0,1,13,10,45,180,0,0,0,0,73,69,78,68,174,66,96,130]);
}
