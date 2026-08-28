import moment from "moment";
import React, { useState, useMemo, useEffect, useCallback } from "react";
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import HighchartsTreeMap from "highcharts/modules/treemap";
import HC_More from "highcharts/highcharts-more";

HighchartsTreeMap(Highcharts);
HC_More(Highcharts); // waterfall chart type lives in highcharts-more — keep

import { TextInput } from '@mantine/core';
import { formatAsCurrency, formatCompactCurrency, PALETTE } from "./lib/format.mjs";
import { matchesTransactionFilter } from './lib/transactionFilter.mjs';
import { pressable } from './lib/a11y.mjs';
import { DaylightAPI } from '../../lib/api.mjs';
import { useFinanceReload } from './useFinanceReload.js';
import { buildTreemapData, buildDrillData } from './drawerCharts.js';

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

  const buildCrumbLabel = useCallback((point) => {
    const percentOfTop = (point.valueReal / grandTotal) * 100;
    if (point.drilldown) {
      return `${formatCompactCurrency(point.valueReal)} (${percentOfTop.toFixed(1)}%)`;
    }
    return point.name;
  }, [grandTotal]);

  const handleClick = useCallback((point, e) => {
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
  }, [drillSeries, topData, drillStack, crumbs, setTransactionFilter, buildCrumbLabel]);

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
  }), [topData, handleClick]);

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