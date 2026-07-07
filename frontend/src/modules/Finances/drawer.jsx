import moment from "moment";
import React, { useState, useMemo, useEffect } from "react";
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import HighchartsTreeMap from "highcharts/modules/treemap";
import HC_More from "highcharts/highcharts-more";

HighchartsTreeMap(Highcharts);
HC_More(Highcharts); // waterfall chart type lives in highcharts-more — keep

import { TextInput } from '@mantine/core';
import { formatAsCurrency, formatCompactCurrency, PALETTE } from "./lib/format.mjs";
import { matchesTransactionFilter } from './lib/transactionFilter.mjs';
import { groupSmall } from './lib/groupSmall.mjs';
import { pressable } from './lib/a11y.mjs';
import { DaylightAPI } from '../../lib/api.mjs';
import { useFinanceReload } from './FinanceDataContext.jsx';

import externalIcon from "../../assets/icons/external.svg";

export function Drawer({ cellKey, transactions, periodData }) {

    const [sortConfig, setSortConfig] = useState({ key: "date", direction: 'descending' });
    const [transactionFilter, setTransactionFilter] = useState({});

    const handleSorting = (key) => {
        let direction = 'descending';
        if (sortConfig.key === key && sortConfig.direction === 'descending') {
            direction = 'ascending';
        }
        setSortConfig({ key, direction });
    };
    const getSortIcon = (key) => {
      if (sortConfig.key === key) {
        return sortConfig.direction === 'ascending' ? (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 4L4 12H20L12 4Z" fill="currentColor"/>
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 20L4 12H20L12 20Z" fill="currentColor"/>
          </svg>
        );
      }
      return null;
    };
    const sortedTransactions = [...transactions].sort((a, b) => {
      const parseValue = (value) => {
          if (typeof value === 'string') {
            //lowercast
            value = value.toLowerCase();
            const isDate = /date/i.test(sortConfig.key);
            if (isDate)  return moment(value).format('YYYYMMDD');

        const numericValue = parseFloat(value.replace(/[^0-9.-]+/g, ""));
        return isNaN(numericValue) ? value : numericValue;
          }
          return value;
      };

      const aValue = parseValue(a[sortConfig.key]);
      const bValue = parseValue(b[sortConfig.key]);

      if (aValue < bValue) return sortConfig.direction === 'ascending' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'ascending' ? 1 : -1;
      return 0;

    })

    .filter((transaction) => matchesTransactionFilter(transaction, transactionFilter));

    const [menuOpenId, setMenuOpenId] = useState(null);
    const [pairMode, setPairMode] = useState(null);
    const reload = useFinanceReload();
    const [pairDesc, setPairDesc] = useState('');
    const [pairNotice, setPairNotice] = useState(null);

    useEffect(() => {
      if (menuOpenId == null) return;
      const close = () => setMenuOpenId(null);
      document.addEventListener('click', close);
      return () => document.removeEventListener('click', close);
    }, [menuOpenId]);

    const handleRowClick = (transaction) => {
      if(!transaction.id) return;
        window.open(`https://www.buxfer.com/transactions?tids=${transaction.id}`, '_blank');
    };

    const handleStartPair = (transaction) => {
      setMenuOpenId(null);
      setPairNotice(null);
      setPairMode({ sourceTransaction: transaction });
    };

    const handleSelectPairTarget = async (targetTransaction) => {
      const source = pairMode.sourceTransaction;
      const isSourceExpense = source.expenseAmount > 0;
      const debit = isSourceExpense ? source.id : targetTransaction.id;
      const credit = isSourceExpense ? targetTransaction.id : source.id;
      const desc = pairDesc.trim() || `${source.description} \u2194 ${targetTransaction.description}`;

      try {
        await DaylightAPI('api/v1/finance/pairs', { debit, credit, desc }, 'POST');
        setPairMode(null);
        setPairDesc('');
        await reload();
        setPairNotice('Pair saved \u2014 amounts updated.');
      } catch (err) {
        setPairNotice(`Failed to create pair: ${err.message}`);
      }
    };

    const handleUnpair = async (transaction) => {
      setMenuOpenId(null);
      try {
        await DaylightAPI('api/v1/finance/pairs', { debit: transaction.id, credit: transaction.pairedWith }, 'DELETE');
        await reload();
        setPairNotice('Pair removed \u2014 amounts updated.');
      } catch (err) {
        setPairNotice(`Failed to unpair: ${err.message}`);
      }
    };

    const summary = sortedTransactions.reduce((acc, { expenseAmount }) => {
        acc.spent += expenseAmount > 0 ? expenseAmount : 0;
        acc.gained += expenseAmount < 0 ? -expenseAmount : 0;
        return acc;
    }, { spent: 0, gained: 0, net: 0 });

    summary.netspend = summary.spent - summary.gained;

    const unfilterButton = <button onClick={() => setTransactionFilter({})}>x</button>;

    return (
        <div className="budget-drawer">
            <DrawerChart transactions={transactions} cellKey={cellKey} periodData={periodData} setTransactionFilter={setTransactionFilter} />
            <DrawerSummary sortedTransactions={sortedTransactions} summary={summary} />
            <div className="budget-drawer-content">
              {transactionFilter.tags && <div>{unfilterButton} Filtering by tags: {transactionFilter.tags.join(", ")}</div>}
              {transactionFilter.description && <div>{unfilterButton} Filtering by description: {transactionFilter.description}</div>}
              {pairMode && (
                <div className="pair-banner">
                  <span>Select the offsetting transaction for: <strong>{pairMode.sourceTransaction.description}</strong></span>
                  <TextInput
                    size="xs"
                    placeholder="Pair description (optional)"
                    value={pairDesc}
                    onChange={(e) => setPairDesc(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button className="pair-banner-cancel" onClick={() => { setPairMode(null); setPairDesc(''); }}>Cancel</button>
                </div>
              )}
              {pairNotice && (
                <div className="pair-notice">
                  <span>{pairNotice}</span>
                  <button className="pair-notice-dismiss" onClick={() => setPairNotice(null)}>×</button>
                </div>
              )}
                <table className="transactions-table">
                <thead>
                    <tr>
                      <th onClick={() => handleSorting('date')}
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSorting('date'); } }}
                        aria-sort={sortConfig.key === 'date' ? sortConfig.direction : 'none'}>
                        Date {getSortIcon('date')}
                      </th>
                      <th onClick={() => handleSorting('accountName')}
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSorting('accountName'); } }}
                        aria-sort={sortConfig.key === 'accountName' ? sortConfig.direction : 'none'}>
                        Account {getSortIcon('accountName')}
                      </th>
                      <th onClick={() => handleSorting('amount')}
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSorting('amount'); } }}
                        aria-sort={sortConfig.key === 'amount' ? sortConfig.direction : 'none'}>
                        Amount {getSortIcon('amount')}
                      </th>
                      <th onClick={() => handleSorting('description')} className="th-left"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSorting('description'); } }}
                        aria-sort={sortConfig.key === 'description' ? sortConfig.direction : 'none'}>
                        Description {getSortIcon('description')}
                      </th>
                      <th onClick={() => handleSorting('tagNames')}
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSorting('tagNames'); } }}
                        aria-sort={sortConfig.key === 'tagNames' ? sortConfig.direction : 'none'}>
                        Tags {getSortIcon('tagNames')}
                      </th>
                      <th className="actions-th"></th>
                    </tr>
                  </thead>
                    <tbody>
                        {(() => {
                            let prevDate = null;
                            return sortedTransactions.map((transaction,i) => {
                               const guid = transaction.id || `${transaction.accountName}-${transaction.description}-${transaction.amount}-${i}`;
                                const currentDateFormatted = moment(transaction.date).format("MMM Do");
                                const displayDate = currentDateFormatted === prevDate ? "" : currentDateFormatted;
                                prevDate = currentDateFormatted;
                                const incomeTypes = ['income', 'investment sale', 'refund', 'dividend', 'interest'];
                                const isIncome = incomeTypes.includes(transaction.transactionType);
                                const amountLabel = 
                                  !isIncome 
                                  ? `$${transaction.amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}` 
                                  : `+$${Math.abs(transaction.amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
                                  const evenOdd = i % 2 === 0 ? "even" : "odd";
                                const pairedClass = transaction.paired ? ' paired' : '';
                                const rowClassName = (!isIncome ? `expense ${evenOdd}` : `income ${evenOdd}`) + pairedClass;
                                const memo = transaction.memo ? <span className="memo">{transaction.memo}</span> : null;
                                const pairBadge = transaction.paired ? <span className="pair-badge" title={transaction.pairDesc}>🔗</span> : null;
                                const hasId = !!transaction.id;
                                return (
                                    <tr key={guid} className={rowClassName + (pairMode ? ' pair-selectable' : '')}
                                      onClick={() => pairMode ? handleSelectPairTarget(transaction) : handleRowClick(transaction)}
                                      title={pairMode ? 'Select as offsetting transaction' : (hasId ? 'Open in Buxfer (new tab)' : undefined)}
                                      style={{ cursor: pairMode ? 'crosshair' : (hasId ? 'pointer' : 'default') }}
                                      tabIndex={0}
                                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (pairMode ? handleSelectPairTarget : handleRowClick)(transaction); } }}>
                                        <td className="date-col">{displayDate}</td>
                                        <td className="account-name-col">{transaction.accountName}</td>
                                        <td className="amount-col">{amountLabel}</td>
                                        <td className="description-col">
                                          {transaction.description}{memo}{pairBadge}
                                          {hasId && !pairMode && (
                                            <img src={externalIcon} alt="" aria-hidden="true"
                                              className="row-external-icon" />
                                          )}
                                        </td>
                                        <td className="tags-col">{transaction.tagNames?.join(", ")}</td>
                                        <td className="actions-col" onClick={(e) => e.stopPropagation()}>
                                          {hasId && !pairMode && (
                                            <div className="txn-menu-wrap">
                                              <button
                                                className="txn-menu-btn"
                                                onClick={() => setMenuOpenId(menuOpenId === transaction.id ? null : transaction.id)}
                                                aria-label="Transaction actions"
                                              >⋯</button>
                                              {menuOpenId === transaction.id && (
                                                <div className="txn-menu-dropdown">
                                                  {transaction.paired ? (
                                                    <button className="txn-menu-item" onClick={() => handleUnpair(transaction)}
                                                    >Unpair</button>
                                                  ) : (
                                                    <button className="txn-menu-item" onClick={() => handleStartPair(transaction)}
                                                    >Pair</button>
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </td>
                                    </tr>
                                );
                            });
                        })()}
                    </tbody>
                </table>
            </div>
        </div>
    );
}


function DrawerSummary({ sortedTransactions, summary }) {
  const MAX_LINKED_TIDS = 100; // Buxfer/browser URL length limit
  const linkedIds = sortedTransactions.map((tx) => tx.id).filter(Boolean).slice(0, MAX_LINKED_TIDS);

  return (
    <div className="budget-drawer-summary">
      {sortedTransactions.length > 0 && (
        <span>
          {sortedTransactions.length} Transactions{" "}
          {linkedIds.length > 0 && (
            <a
              target="_blank"
              title={linkedIds.length < sortedTransactions.length ? `Opens first ${MAX_LINKED_TIDS} in Buxfer` : 'Open in Buxfer'}
              href={`https://www.buxfer.com/transactions?tids=${linkedIds.join(",")}`}
            >
              <img
                src={externalIcon}
                alt="external link"
                className="external-link-icon"
              />
            </a>
          )}
        </span>
      )}
      {summary.spent > 0 && <span>Spent: {formatAsCurrency(summary.spent)}</span>}
      {summary.gained > 0 && <span>Credits: {formatAsCurrency(summary.gained)}</span>}
      {summary.spent > 0 && summary.gained > 0 && summary.netspend !== 0 && (
        <span>
          Net {summary.netspend < 0 ? "Gain" : "Spend"}:{" "}
          {formatAsCurrency(Math.abs(summary.netspend))}
        </span>
      )}
    </div>
  );
}

function DrawerChart({ transactions, cellKey, periodData, setTransactionFilter }) {

  
  if(cellKey === 'fixed') return <DrawerWaterFallChart periodData={periodData} setTransactionFilter={setTransactionFilter} />;
  if(cellKey === 'month') return <DrawerWaterFallChart periodData={periodData} setTransactionFilter={setTransactionFilter} />;
  if(cellKey === 'day') return <DrawerTreeMapChart transactions={transactions} setTransactionFilter={setTransactionFilter} />;

  return null;
}

function DrawerWaterFallChart({ periodData, setTransactionFilter }) {

  const options = useMemo(() => {
  const {month} = periodData;

  const incomeSum = month.income;
  const dayToDaySum = month.dayToDaySpending;
  const [categoryCredits,categoryDebits] = Object.keys(month.monthlyCategories).map(cat => {
    const creddeb = [null,null];
    if(month.monthlyCategories[cat].credits > 0) creddeb[0] = { name: `+ ${cat}`, y: month.monthlyCategories[cat].credits, filter: { label: cat }};
    if(month.monthlyCategories[cat].debits > 0) creddeb[1] = { name: cat, y: -month.monthlyCategories[cat].debits, filter: { label: cat }};
    return creddeb;

  }).reduce((acc, val) => {
    const [credit, debit] = val;
    if(credit) acc[0].push(credit);
    if(debit) acc[1].push(debit);
    return acc;
  }, [[],[]]);
  categoryCredits.sort((a, b) => a.y - b.y);
  categoryDebits.sort((a, b) => a.y - b.y);

  const surplusValue = month.surplus;
  const isNegative = surplusValue < 0;  
  const maxValue = incomeSum + categoryCredits.reduce((acc, {y}) => acc + y, 0);
  
  const totalIncomeValue = month.incomeTransactions.reduce((acc, { amount }) => acc + amount, 0);
  const income = month.incomeTransactions.map(tx => ({
    name: tx.description || "Paycheck",
    y: tx.amount,
    filter: { description: tx.description }
  })).sort((a, b) => a.name.localeCompare(b.name) || b.y - a.y);

  const incomeNamesWithCounts = income.reduce((acc, { name, y }) => {
    if (!acc[name]) {
      acc[name] = { count: 0, amount: 0, percent: 0 };
    }
    acc[name].count += 1;
    acc[name].amount += Math.abs(y);
    acc[name].percent = (acc[name].amount / totalIncomeValue) * 100;
    return acc;
  }, {});

  const mergedIncome = income.reduce((acc, { name, y, filter }) => {
    const { count, percent } = incomeNamesWithCounts[name];
    if (count > 3 || (count > 1 && percent < 20)) {
      const existingEntry = acc.find(entry => entry.name === name);
      if (existingEntry) {
        existingEntry.y += y;
      } else {
        acc.push({ name, y, filter });
      }
    } else {
      acc.push({ name, y, filter });
    }
    return acc;
  }, []).sort((a, b) => b.y - a.y);


  const data = [
    ... mergedIncome,
    { name: 'Income', isIntermediateSum: true, color: PALETTE.income  , filter: { bucket: "income" }},
    ... categoryCredits.sort((a, b) => a.y - b.y),
    ... categoryDebits.sort((a, b) => a.y - b.y),
    { name: 'Cash Flow', isIntermediateSum: true, color: PALETTE.cashFlow , filter: { bucket: "monthly" }},
    { name: 'Day-to-Day Spending', y: -dayToDaySum , color: PALETTE.dayToDay  , filter: { bucket: "day" }},
    { name: !isNegative  ? 'Surplus' : 'Deficit',   isSum: true, color: isNegative ? PALETTE.over : PALETTE.gain}
  ];

  const options = {
    chart: { type: 'waterfall' },
    title: { text: '' },
    credits: { enabled: false },
    //no animtion
    plotOptions: {
      series: {
        animation: false
      }
    },
    xAxis: { type: 'category' },
    yAxis: {
        labels: {
            formatter: function () {
                return formatAsCurrency(Math.abs(this.value));
            }
        },
        title: { text: '' },
        min: Math.min(0, surplusValue),
        max: maxValue,
        plotLines: [{
            value: 0,
            color: 'black',
            width: 3,
            zIndex: 4
        }],
        plotBands: [{
            from: Math.min(0, surplusValue),
            to: 0,
            color: 'rgba(255, 100, 0, 0.1)'
        }]
    },
    legend: { enabled: false },
    tooltip: {
        formatter: function () {
            const pctLine = (this.y != null && incomeSum)
                ? `<br/>${(Math.abs(this.y) / incomeSum * 100).toFixed(0)}% of income`
                : '';
            return `<b>${this.point.name}</b><br/>${formatAsCurrency(this.y)}${pctLine}`;
        },
    },
    series: [{
      upColor: PALETTE.gain,
      color: PALETTE.over,
      data,
      dataLabels: { 
      enabled: true,
      style: {
          fontFamily: 'Roboto Condensed',
          fontSize: '0.8em',
          textOutline: '2px #00000077',
          color: '#FFFFFF'
      },
      formatter: function() {
        return formatAsCurrency(Math.abs(this.y));
      },    
    },
      pointPadding: 0,
      events: {
        click: function(event) {
          setTransactionFilter(event.point?.filter || {});
        }
      }
    }]
  };
  return options;
  }, [periodData, setTransactionFilter]);

  return <div className="waterfall-chart">
                <HighchartsReact
                    highcharts={Highcharts}
                    options={options}
                />
  </div>

}
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
      name: `${Math.round((entry.total) )}`, // placeholder — replaced below
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

export function DrawerTreeMapChart({ transactions, setTransactionFilter }) {
  const options = useMemo(() => {
  const processedData = buildTreemapData(transactions);

  const options = {
    chart: { type: 'treemap' },
    title: { text: '' },
    credits: { enabled: false },
    series: [{
      type: "treemap",
      layoutAlgorithm: "squarified",
      data: processedData,
      levels: [
        {
          level: 1,
          dataLabels: {
            enabled: true,
            align: "center",
            verticalAlign: "middle"
          }
        },
        {
          level: 2,
          dataLabels: {
            enabled: false
          }
        }
      ]
    }],
    tooltip: {
      useHTML: true,
      pointFormatter: function() {
        return `<b>${this.name}</b><br/>$${Math.round(this.value).toLocaleString()}`;
      }
    },
    plotOptions: {
      series: {
        animation: false,
        events: {
          click: function(event) {
            const level = event.point.node.level;
            setTransactionFilter(
              level === 1
                ? { tags: [event.point.id] }
                : { description: event.point.name }
            );
          }
        }
      }
    }
  };
  return options;
  }, [transactions, setTransactionFilter]);

  return (
    <div className="treemap-chart">
      <HighchartsReact
        highcharts={Highcharts}
        options={options}
      />
    </div>
  );
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

export function SpendingPieDrilldownChart({ transactions, setTransactionFilter }) {
  const [drillStack, setDrillStack] = useState([transactions || []]);
  const [crumbs, setCrumbs] = useState([]);
  const [grandTotal, setGrandTotal] = useState(0);

  // Re-initialize drillStack and crumbs whenever transactions change.
  useEffect(() => {
    const { grandTotal } = buildDrillData(transactions || []);
    setGrandTotal(grandTotal);
    setDrillStack([transactions || []]);
    setCrumbs([`Total: ${formatCompactCurrency(grandTotal)}`]);
  }, [transactions]);

  const currentTransactions = drillStack[drillStack.length - 1];
  const { topData, drillSeries } = useMemo(() => buildDrillData(currentTransactions), [currentTransactions]);

  const buildCrumbLabel = (point) => {
    const percentOfTop = (point.valueReal / grandTotal) * 100;
    if (point.drilldown) {
      return `${formatCompactCurrency(point.valueReal)} (${percentOfTop.toFixed(1)}%)`;
    }
    return point.name;
  };

  const handleClick = (point, e) => {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    const drillId = point.drilldown;
    if (drillId) {
      const subset = drillSeries.find((s) => s.id === drillId);
      if (!subset) return;
      // Level-1 "Other": its txList lives on the topData entry itself.
      // Level-2 "Other" (drilldown id "Other2"): its txList lives on the
      // folded point inside the "Other breakdown" series (level-2 data).
      const source = drillId === 'Other'
        ? topData.find((d) => d.drilldown === 'Other')
        : drillSeries.find((s) => s.id === 'Other')?.data.find((d) => d.drilldown === 'Other2');
      const txList = source?.txList || [];
      if (txList.length) {
        setDrillStack([...drillStack, txList]);
        setCrumbs([...crumbs, buildCrumbLabel(source)]);
      }
    } else {
      setTransactionFilter(point.name);
    }
  };

  const chartOptions = useMemo(() => ({
    chart: { type: "column", marginLeft: 20 },
    title: { text: "" },
    credits: { enabled: false },
    legend: { enabled: false },
    xAxis: {
      type: "category",
      labels: {
        rotation: -25,
        y: 15,
        x: 5,
        style: { fontSize: "14px", fontFamily: "Roboto Condensed, sans-serif" }
      }
    },
    yAxis: { title: null, labels: { enabled: false }, gridLineWidth: 0 },
    tooltip: {
      useHTML: true,
      backgroundColor: "#fff",
      borderColor: "#333",
      borderWidth: 1,
      style: { textAlign: "center" },
      followPointer: true,
      shared: false,
      formatter() {
        const p = this.point;
        const pct = (p.pctOfGrand || 0).toFixed(1) + "%";
        const amt = formatCompactCurrency(p.valueReal || 0);
        return `<div style="line-height:1.2"><strong>${pct}</strong><br/>${p.name}<br/><em>${amt}</em></div>`;
      }
    },
    plotOptions: {
      animation: false,
      series: {
        stickyTracking: false,
        states: { hover: { brightness: 0 } }
      },
      column: {
        cursor: "pointer",
        dataLabels: {
          enabled: true,
          format: "{point.valueFormatted}",
          style: {
            fontSize: "14px",
            fontFamily: "Roboto Condensed, sans-serif"
          }
        },
        point: {
          events: {
            mouseOver(e) {
              const chart = this.series.chart;
              const pieSeries = chart.series.find((s) => s?.type === "pie");
              if (pieSeries && pieSeries.data[this.index]) {
                pieSeries.data[this.index].setState("hover");
              }
              chart.tooltip.refresh(this, e);
            },
            mouseOut() {
              const chart = this.series.chart;
              const pieSeries = chart.series.find((s) => s?.type === "pie");
              if (pieSeries && pieSeries.data[this.index]) {
                pieSeries.data[this.index].setState();
              }
            },
            click(e) {
              handleClick(this,e);
            }
          }
        }
      },
      pie: {

        animation: false,
        center: ["85%", "20%"],
        size: "30%",
        showInLegend: false,
        dataLabels: { enabled: false },
        cursor: "pointer",
        point: {
          events: {
            mouseOver(e) {
              const chart = this.series.chart;
              this.setState("hover");
              const colSeries = chart.series.find((s) => s.type === "column");
              if (colSeries && colSeries.data[this.index]) {
                colSeries.data[this.index].setState("hover");
              }
              chart.tooltip.refresh(this, e);
            },
            mouseOut() {
              const chart = this.series.chart;
              this.setState();
              const colSeries = chart.series.find((s) => s.type === "column");
              if (colSeries && colSeries.data[this.index]) {
                colSeries.data[this.index].setState();
              }
            },
            click() {
              handleClick(this);
            }
          }
        }
      }
    },
    series: [
      {
        name: "Categories",
        type: "column",

      animation: false,
        colorByPoint: true,
        data: topData.map((pt) => ({
          name: pt.name,
          y: pt.valueReal,
          pctOfGrand: pt.pctOfGrand,
          valueReal: pt.valueReal,
          valueFormatted: formatCompactCurrency(pt.valueReal),
          drilldown: pt.drilldown
        }))
      },
      {
        name: "Categories",
        type: "pie",
        colorByPoint: true,
        data: topData.map((pt) => ({
          name: pt.name,
          y: pt.y,
          pctOfGrand: pt.pctOfGrand,
          valueReal: pt.valueReal,
          valueFormatted: formatCompactCurrency(pt.valueReal),
          drilldown: pt.drilldown
        }))
      }
    ]
  }), [topData, drillSeries, drillStack, crumbs, grandTotal, setTransactionFilter]);

  function renderBreadcrumbs(handleBackClick) {
    return crumbs.map((c, i) => {
      const separator = i < crumbs.length - 1 ? " > " : "";

      return (
        <span key={i}>
          <span
        {...pressable(() => handleBackClick(i), {
          className: i === crumbs.length - 1 ? 'drill-crumb drill-crumb--current' : 'drill-crumb'
        })}
          >
        {c}
          </span>
          {separator}
        </span>
      );
    });
  }

  const handleBackClick = (i) => {
    setDrillStack(drillStack.slice(0, i + 1));
    setCrumbs(crumbs.slice(0, i + 1));
  };

  return (
    <div className="drill-chart-wrap">
      <div className="drill-crumb-row">
        <span className="drill-crumbs">{renderBreadcrumbs(handleBackClick)}</span>
      </div>
      <HighchartsReact highcharts={Highcharts} options={chartOptions} />
    </div>
  );
}