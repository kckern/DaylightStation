// drawerCharts.js — pure chart-data builders for drawer.jsx's treemap and
// drilldown pie, split out so Fast Refresh can hot-reload the chart
// components on their own.
import { formatCompactCurrency } from "./lib/format.mjs";
import { groupSmall } from './lib/groupSmall.mjs';

export function buildTreemapData(transactions) {
  const pastelColors = [
    '#FFD1DC', '#E2F0CB', '#FFABAB', '#B5EAD7', '#81F5FF',
    '#E3B5A4', '#FFF9C4', '#DAD5DB', '#C4B6EF', '#FFB6C1',
    '#FF677D', '#F2F3F5', '#D1C4E9', '#80DEEA', '#FFCCBC',
    '#F48FB1', '#B39DDB', '#B2DFDB', '#FFCDD2', '#E1BEE7'
  ];
  const tagColorMap = {};
  let colorIndex = 0;

  // Map-based accumulation (was O(n²) acc.find). Values use expenseAmount
  // (signed spend) so refunds reduce their tag instead of producing negative
  // nodes Highcharts silently drops.
  const tags = new Map();
  for (const tx of transactions) {
    const [tag] = tx.tagNames || ['Other'];
    if (!tagColorMap[tag]) {
      tagColorMap[tag] = pastelColors[colorIndex % pastelColors.length];
      colorIndex++;
    }
    if (!tags.has(tag)) tags.set(tag, { total: 0, byDesc: new Map() });
    const entry = tags.get(tag);
    const amount = tx.expenseAmount ?? tx.amount ?? 0;
    entry.total += amount;
    const desc = tx.description || '(no description)';
    entry.byDesc.set(desc, (entry.byDesc.get(desc) || 0) + amount);
  }

  const data = [];
  for (const [tag, entry] of tags) {
    if (entry.total <= 0) continue; // fully-refunded tags can't render
    const children = [...entry.byDesc.entries()]
      .map(([name, value]) => ({ name, value }))
      .filter((c) => c.value > 0);

    // Keep the biggest descriptions covering 80% of the tag; fold the rest.
    const { kept, other } = groupSmall(children, { cumulativeShare: 0.8 });

    data.push({
      id: tag,
      name: tag,
      value: entry.total,
      color: tagColorMap[tag]
    });
    kept.forEach((c) => data.push({ id: `${tag}-${c.name}`, parent: tag, name: c.name, value: c.value, color: tagColorMap[tag] }));
    if (other) data.push({ id: `${tag}-Other`, parent: tag, name: 'Other', value: other.value, color: tagColorMap[tag] });
  }

  // Percent labels need the grand total of the KEPT parents.
  const grandTotal = data.filter((e) => !e.parent).reduce((s, e) => s + e.value, 0);
  for (const entry of data) {
    if (!entry.parent) {
      const pct = grandTotal > 0 ? Math.round((entry.value / grandTotal) * 100) : 0;
      entry.name = `${pct}% ${entry.id}
        <br/>$${Math.round(entry.value).toLocaleString()}`;
    }
  }
  return data;
}

const MAX_ITEMS = 10;

function safeGetTag(tx) {
  if (!tx || !Array.isArray(tx.tagNames) || !tx.tagNames[0]) return "Other";
  return tx.tagNames[0];
}

export function buildDrillData(transactions) {
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return { topData: [], drillSeries: [], grandTotal: 0 };
  }
  let grandTotal = 0;
  const byTag = {};
  transactions.forEach((tx) => {
    const tag = safeGetTag(tx);
    const amount = Number(tx?.amount) || 0;
    byTag[tag] = (byTag[tag] || 0) + amount;
    grandTotal += amount;
  });

  if (grandTotal === 0) {
    return { topData: [], drillSeries: [], grandTotal: 0 };
  }
  const all = Object.entries(byTag).map(([tag, value]) => ({
    tag,
    value,
    pctOfGrand: (value / grandTotal) * 100,
    txList: transactions.filter((t) => safeGetTag(t) === tag)
  }));

  const { kept: lvl1Kept, other: lvl1Other } = groupSmall(all, { minShare: 0.02, maxItems: MAX_ITEMS });

  const top = lvl1Kept
    .map((x) => ({
      name: x.tag,
      y: parseFloat(x.pctOfGrand.toFixed(2)),
      pctOfGrand: x.pctOfGrand,
      valueReal: x.value,
      drilldown: null,
      txList: x.txList
    }))
    .sort((a, b) => b.y - a.y);

  if (lvl1Other) {
    const sumPct = lvl1Other.items.reduce((s, x) => s + x.pctOfGrand, 0);
    const sumVal = lvl1Other.value;
    const allMinorTx = lvl1Other.items.reduce((acc, item) => acc.concat(item.txList || []), []);
    top.push({
      name: "Other",
      y: parseFloat(sumPct.toFixed(2)),
      pctOfGrand: sumPct,
      valueReal: sumVal,
      drilldown: "Other",
      txList: allMinorTx
    });
  }

  const series = [];
  const otherEntry = top.find((x) => x.name === "Other");
  if (otherEntry && Array.isArray(otherEntry.txList) && otherEntry.txList.length > 0) {
    const otherVal = otherEntry.valueReal;
    const groupedMinorByTag = {};
    otherEntry.txList.forEach((tx) => {
      const tag = safeGetTag(tx);
      const amt = Number(tx.amount) || 0;
      groupedMinorByTag[tag] = (groupedMinorByTag[tag] || 0) + amt;
    });

    const otherItems = Object.entries(groupedMinorByTag).map(([tag, value]) => ({
      tag,
      value,
      pctOfGrand: (value / grandTotal) * 100,
      pctOfOther: (value / otherVal) * 100,
      txList: otherEntry.txList.filter((t) => safeGetTag(t) === tag)
    }));

    const { kept: lvl2Kept, other: lvl2Other } = groupSmall(otherItems, { cumulativeShare: 0.9, maxItems: 10 });

    const d2 = lvl2Kept
      .map((x) => ({
        name: x.tag,
        y: parseFloat(x.pctOfOther.toFixed(2)),
        pctOfGrand: x.pctOfGrand,
        valueReal: x.value,
        valueFormatted: formatCompactCurrency(x.value),
        drilldown: null,
        txList: x.txList
      }))
      .sort((a, b) => b.y - a.y);

    if (lvl2Other) {
      const sumPctOfOther = lvl2Other.items.reduce((s, x) => s + x.pctOfOther, 0);
      const sumPctOfGrand = lvl2Other.items.reduce((s, x) => s + x.pctOfGrand, 0);
      const sumVal2 = lvl2Other.value;
      const allMinor2Tx = lvl2Other.items.reduce((acc, i) => acc.concat(i.txList || []), []);
      // Display name is "Other" (audit 4.2 — "Other2" must never leak to the
      // user); the drilldown id stays "Other2" so level-3 lookup below can
      // find this folded entry unambiguously.
      d2.push({
        name: "Other",
        y: parseFloat(sumPctOfOther.toFixed(2)),
        pctOfGrand: sumPctOfGrand,
        valueReal: sumVal2,
        valueFormatted: formatCompactCurrency(sumVal2),
        drilldown: "Other2",
        txList: allMinor2Tx
      });
    }

    series.push({
      id: "Other",
      name: "Other breakdown",
      data: d2
    });

    const other2Entry = d2.find((item) => item.drilldown === "Other2");
    if (other2Entry && Array.isArray(other2Entry.txList) && other2Entry.txList.length > 0) {
      const other2Val = other2Entry.valueReal;
      if (other2Val > 0) {
        const d3ByTag = {};
        other2Entry.txList.forEach((tx) => {
          const tag = safeGetTag(tx);
          const amt = Number(tx.amount) || 0;
          d3ByTag[tag] = (d3ByTag[tag] || 0) + amt;
        });
        const d3Items = Object.entries(d3ByTag).map(([tag, value]) => ({
          name: tag,
          y: parseFloat(((value / other2Val) * 100).toFixed(2)),
          pctOfGrand: (value / grandTotal) * 100,
          valueReal: value,
          valueFormatted: formatCompactCurrency(value),
          drilldown: null
        }));
        d3Items.sort((a, b) => b.y - a.y);
        series.push({
          id: "Other2",
          name: "Other2 breakdown",
          data: d3Items
        });
      } else {
        series.push({
          id: "Other2",
          name: "Other2 breakdown",
          data: []
        });
      }
    }
  }

  return { topData: top, drillSeries: series, grandTotal };
}
