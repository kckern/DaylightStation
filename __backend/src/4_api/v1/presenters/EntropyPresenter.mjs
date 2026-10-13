/** Frozen public entropy item projection retained from EntropyItem.toJSON(). */
export function presentEntropyItem(item) {
  return {
    id: item.source,
    source: item.source,
    name: item.name,
    icon: item.icon,
    status: item.status,
    value: item.value,
    label: item.label,
    lastUpdate: item.lastUpdate,
    url: item.url,
    weight: item.weight,
  };
}

export function presentEntropyReport(report) {
  return { ...report, items: (report.items || []).map(presentEntropyItem) };
}
