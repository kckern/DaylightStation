import moment from "moment";
import React, { useState, useMemo, useEffect } from "react";
import Highcharts, { attr } from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import HighchartsTreeGraph from "highcharts/modules/treegraph";
import HighchartsDrilldown from "highcharts/modules/drilldown";
import HighchartsTreeMap from "highcharts/modules/treemap";

HighchartsTreeMap(Highcharts);
HighchartsTreeGraph(Highcharts);
HighchartsDrilldown(Highcharts);

import HC_More from "highcharts/highcharts-more";
HC_More(Highcharts);
import { formatAsCurrency } from "./blocks";

import externalIcon from "../../assets/icons/external.svg";;

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

      const keyToUse = sortConfig.key === 'amount' ? 'expenseAmount' : sortConfig.key;

      const aValue = parseValue(a[keyToUse]);
      const bValue = parseValue(b[keyToUse]);

      if (aValue < bValue) return sortConfig.direction === 'ascending' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'ascending' ? 1 : -1;
      return 0;

    })   
    
    .filter(transaction => {
          const { tags, description, label, bucket } = transactionFilter || {};
          let showMe = true;
          if(tags && !tags.some(tag => transaction.tagNames.includes(tag))) showMe = false;
          if(showMe && description && !transaction.description.includes(description)) showMe = false;
          if(showMe && label && transaction.label !== label) showMe = false;
          if(showMe && bucket && transaction.bucket !== bucket) showMe = false;
          return showMe;
        });

    const handleRowClick = (transaction) => {
      if(!transaction.id) return;
        window.open(`https://www.buxfer.com/transactions?tids=${transaction.id}`, '_blank');
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
                <table className="transactions-table">
                <thead>
                    <tr>
                      <th onClick={() => handleSorting('date')}>
                        Date {getSortIcon('date')}
                      </th>
                      <th onClick={() => handleSorting('accountName')}>
                        Account {getSortIcon('accountName')}
                      </th>
                      <th onClick={() => handleSorting('amount')}>
                        Amount {getSortIcon('amount')}
                      </th>
                      <th onClick={() => handleSorting('description')} style={{ textAlign: 'left' }}>
                        Description {getSortIcon('description')}
                      </th>
                      <th onClick={() => handleSorting('tagNames')}>
                        Tags {getSortIcon('tagNames')}
                      </th>
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
                                const rowClassName = !isIncome ? `expense ${evenOdd}` : `income ${evenOdd}`;
                                const memo = transaction.memo ? <span className="memo">{transaction.memo}</span> : null;
                                const hasId = !!transaction.id;
                                return (
                                    <tr key={guid} className={rowClassName} onClick={() => handleRowClick(transaction)}  style={{ cursor: hasId ? 'pointer' : 'default' }}>
                                        <td className="date-col">{displayDate}</td>
                                        <td className="account-name-col">{transaction.accountName}</td>
                                        <td className="amount-col">{amountLabel}</td>
                                        <td className="description-col">{transaction.description}{memo}</td>
                                        <td className="tags-col">{transaction.tagNames?.join(", ")}</td>
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

  return (
    <div className="budget-drawer-summary">
      {sortedTransactions.length > 0 && (
        <span>
          {sortedTransactions.length} Transactions{" "}
          <a
            target="_blank"
            href={`https://www.buxfer.com/transactions?tids=${sortedTransactions
              .map((tx) => tx.id)
              .join(",")}`}
          >
            <img
              src={externalIcon}
              alt="external link"
              style={{ width: "1em", height: "1em", marginBottom: "-0.2em" }}
            />
          </a>
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

}

function DrawerWaterFallChart({ periodData, setTransactionFilter }) {


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
    acc[0].sort((a, b) => a.y - b.y);
    acc[1].sort((a, b) => a.y - b.y);
    return acc;
  }, [[],[]]);

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
    { name: 'Income', isIntermediateSum: true, color: `#304529`  , filter: { bucket: "income" }},
    ... categoryCredits.sort((a, b) => a.y - b.y),
    ... categoryDebits.sort((a, b) => a.y - b.y),
    { name: 'Cash Flow', isIntermediateSum: true, color: `#660000` , filter: { bucket: "monthly" }},
    { name: 'Day-to-Day Spending', y: -dayToDaySum , color: `#432454`  , filter: { bucket: "day" }},
    { name: !isNegative  ? 'Surplus' : 'Deficit',   isSum: true, color: isNegative ? `#c1121f` : `#759c82`}
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
        formatter: function() { 
            return formatAsCurrency(Math.abs(this.value)); 
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
            color: 'rgba(255, 100, 0, 0.1)' // Light red color with some transparency
        }]
    },
    legend: { enabled: false },
    tooltip: { 
        formatter: function() {
            return `<b>${this.point.name}</b><br/>${formatAsCurrency(this.y)}<br/>${(Math.abs(this.y) / incomeSum * 100).toFixed(0)}% of income`;
        }, 
    },
    series: [{
      upColor: `#759c82`,
      color: `#c1121f`,
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

  return <div className="waterfall-chart">
                <HighchartsReact
                    highcharts={Highcharts}
                    options={options}
                />
  </div>

}
export function DrawerTreeMapChart({ transactions, setTransactionFilter }) {
  const pastelColors = [
    '#FFD1DC', '#E2F0CB', '#FFABAB', '#B5EAD7', '#81F5FF',
    '#E3B5A4', '#FFF9C4', '#DAD5DB', '#C4B6EF', '#FFB6C1',
    '#FF677D', '#F2F3F5', '#D1C4E9', '#80DEEA', '#FFCCBC',
    '#F48FB1', '#B39DDB', '#B2DFDB', '#FFCDD2', '#E1BEE7'
  ];

  const tagColorMap = {};
  let colorIndex = 0;

  // Prepare raw data
  const rawData = transactions.reduce((acc, tx) => {
    const { tagNames, description, amount } = tx;
    const [tag] = tagNames || ['Other'];
    if (!tagColorMap[tag]) {
      tagColorMap[tag] = pastelColors[colorIndex % pastelColors.length];
      colorIndex++;
    }
    let tagEntry = acc.find(e => e.id === tag);
    if (!tagEntry) {
      tagEntry = { id: tag, name: tag, value: 0, color: tagColorMap[tag] };
      acc.push(tagEntry);
    }
    tagEntry.value += amount;
    const descId = `${tag}-${description}`;
    let descEntry = acc.find(e => e.id === descId);
    if (!descEntry) {
      descEntry = { id: descId, parent: tag, name: description, value: 0, color: tagColorMap[tag] };
      acc.push(descEntry);
    }
    descEntry.value += amount;
    return acc;
  }, []);

  // Compute total for top-level entries
  const grandTotal = rawData
    .filter(e => !e.parent)
    .reduce((sum, e) => sum + e.value, 0);

  // Group children <= 20% into "Other"
  const processedData = rawData.reduce((result, entry) => {
    if (!entry.parent) {
      const parentValueRounded = Math.round(entry.value).toLocaleString();
      const parentPercent = Math.round((entry.value / grandTotal) * 100);
      const parentWithLabel = {
        ...entry,
        name: `${parentPercent}% ${entry.id}
        <br/>$${parentValueRounded}`
      };

      const children = rawData
        .filter(child => child.parent === entry.id)
        .sort((a, b) => b.value - a.value);

      const parentTotal = children.reduce((sum, c) => sum + c.value, 0);
      let accumulated = 0;
      const mainChildren = [];

      children.forEach(child => {
        if (accumulated / parentTotal < 0.8) {
          mainChildren.push(child);
          accumulated += child.value;
        }
      });

      const otherValue = parentTotal - accumulated;
      result.push(parentWithLabel);
      result.push(...mainChildren);
      if (otherValue > 0) {
        result.push({
          id: `${entry.id}-Other`,
          parent: entry.id,
          name: 'Other',
          value: otherValue,
          color: entry.color
        });
      }
    }
    return result;
  }, []);

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
        const val = Math.round(this.value);
        return `${this.name}`;
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

function formatCurrency(v) {
  return v >= 1000 ? `$${(v / 1000).toFixed(0)}K` : `$${Math.round(v)}`;
}

function buildDrillData(transactions) {
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

  const lvl1Majors = all.filter((x) => x.pctOfGrand >= 2);
  const lvl1Minors = all.filter((x) => x.pctOfGrand < 2);

  const top = lvl1Majors
    .map((x) => ({
      name: x.tag,
      y: parseFloat(x.pctOfGrand.toFixed(2)),
      pctOfGrand: x.pctOfGrand,
      valueReal: x.value,
      drilldown: null,
      txList: x.txList
    }))
    .sort((a, b) => b.y - a.y);

  if (lvl1Minors.length) {
    const sumPct = lvl1Minors.reduce((s, x) => s + x.pctOfGrand, 0);
    const sumVal = lvl1Minors.reduce((s, x) => s + x.value, 0);
    if (sumVal > 0) {
      const allMinorTx = lvl1Minors.reduce((acc, item) => acc.concat(item.txList || []), []);
      top.push({
        name: "Other",
        y: parseFloat(sumPct.toFixed(2)),
        pctOfGrand: sumPct,
        valueReal: sumVal,
        drilldown: "Other",
        txList: allMinorTx
      });
    }
  }

  if (top.length > MAX_ITEMS) {
    const excess = top.splice(MAX_ITEMS);
    const sumPct = excess.reduce((s, x) => s + x.pctOfGrand, 0);
    const sumVal = excess.reduce((s, x) => s + x.valueReal, 0);
    if (sumVal > 0) {
      const allExcessTx = excess.reduce((acc, item) => acc.concat(item.txList || []), []);
      top.push({
        name: "Other",
        y: parseFloat(sumPct.toFixed(2)),
        pctOfGrand: sumPct,
        valueReal: sumVal,
        drilldown: "Other",
        txList: allExcessTx
      });
    }
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

    const sorted = otherItems.slice().sort((a, b) => b.pctOfOther - a.pctOfOther);
    let cum = 0;
    let splitIndex = sorted.length;
    for (let i = 0; i < sorted.length; i++) {
      cum += sorted[i].pctOfOther;
      if (cum >= 90) {
        splitIndex = i + 1;
        break;
      }
    }
    const lvl2Majors = sorted.slice(0, splitIndex);
    const lvl2Minors = sorted.slice(splitIndex);

    if (lvl2Majors.length > 10) {
      const excess = lvl2Majors.splice(10);
      lvl2Minors.push(...excess);
    }

    const d2 = lvl2Majors
      .map((x) => ({
        name: x.tag,
        y: parseFloat(x.pctOfOther.toFixed(2)),
        pctOfGrand: x.pctOfGrand,
        valueReal: x.value,
        valueFormatted: formatCurrency(x.value),
        drilldown: null,
        txList: x.txList
      }))
      .sort((a, b) => b.y - a.y);

    if (lvl2Minors.length) {
      const sumPctOfOther = lvl2Minors.reduce((s, x) => s + x.pctOfOther, 0);
      const sumPctOfGrand = lvl2Minors.reduce((s, x) => s + x.pctOfGrand, 0);
      const sumVal2 = lvl2Minors.reduce((s, x) => s + x.value, 0);
      if (sumVal2 > 0) {
        const allMinor2Tx = lvl2Minors.reduce((acc, i) => acc.concat(i.txList || []), []);
        d2.push({
          name: "Other2",
          y: parseFloat(sumPctOfOther.toFixed(2)),
          pctOfGrand: sumPctOfGrand,
          valueReal: sumVal2,
          valueFormatted: formatCurrency(sumVal2),
          drilldown: "Other2",
          txList: allMinor2Tx
        });
      }
    }

    series.push({
      id: "Other",
      name: "Other breakdown",
      data: d2
    });

    const other2Entry = d2.find((item) => item.name === "Other2");
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
          valueFormatted: formatCurrency(value),
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

export function SpendingPieDrilldownChart({ transactions, setTransactionFilter, budgetKey }) {
  const [componentKey, setComponentKey] = useState(0);

  // Force a "nuke" rebuild of the component on transactions or budgetKey change.
  useEffect(() => {
    setComponentKey((prev) => prev + 1);
  }, [transactions, budgetKey]);

  const [drillStack, setDrillStack] = useState([transactions || []]);
  const [crumbs, setCrumbs] = useState([]);
  const [grandTotal, setGrandTotal] = useState(0);
  const getGrandTotal = () => { return grandTotal || 0; };
    

  // Re-initialize drillStack and crumb whenever the component is "nuked" and remounted.
  useEffect(() => {
    const { grandTotal } = buildDrillData(transactions || []);
    setGrandTotal(grandTotal);
    setDrillStack([transactions || []]);
    setCrumbs([`Total: ${formatCurrency(grandTotal)}`]);
  }, [componentKey, transactions]);

  const currentTransactions = drillStack[drillStack.length - 1];
  const { topData, drillSeries } = useMemo(() => buildDrillData(currentTransactions), [currentTransactions]);

  const buildCrumbLabel = (point) => {
    const percentOfTop = (point.valueReal / grandTotal) * 100;
    if (point.name === "Other") {
      return `${formatCurrency(point.valueReal)} (${percentOfTop.toFixed(1)}%)`;
    }
    return point.name;
  };

  const handleClick = (point,e) => {
    e.stopPropagation();
    e.preventDefault();
    if (point.name === "Other" || point.name === "Other2") {
      const subset = drillSeries.find((s) => s.id === point.name);
      if (subset) {
        const clickedData = topData.find((d) => d.name === point.name);
        const childTxList = clickedData && Array.isArray(clickedData.txList) ? clickedData.txList : [];
        if (point.name === "Other") {
          if (childTxList.length) {
            setDrillStack([...drillStack, childTxList]);
            setCrumbs([...crumbs, buildCrumbLabel(point)]);
          }
        } else {
          const d2Item = subset.data.find((d) => d.name === point.name);
          if (d2Item && Array.isArray(d2Item.txList) && d2Item.txList.length) {
            setDrillStack([...drillStack, d2Item.txList]);
            setCrumbs([...crumbs, buildCrumbLabel(point)]);
          } else if (childTxList.length) {
            setDrillStack([...drillStack, childTxList]);
            setCrumbs([...crumbs, buildCrumbLabel(point)]);
          }
        }
      }
    } else {
      setTransactionFilter(point.name);
    }
  };

  const chartOptions = {
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
        const amt = formatCurrency(p.valueReal || 0);
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
          valueFormatted: formatCurrency(pt.valueReal),
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
          valueFormatted: formatCurrency(pt.valueReal),
          drilldown: pt.drilldown
        }))
      }
    ]
  };

  function renderBreadcrumbs(handleBackClick) {
    return crumbs.map((c, i) => {
      const separator = i < crumbs.length - 1 ? " > " : "";

      return (
        <span key={i}>
          <span
        onClick={() => handleBackClick(i)}
        style={{
          fontWeight: i === crumbs.length - 1 ? "bold" : "normal",
          color: "black",
          textDecoration: "none",
          cursor: "pointer",
          backgroundColor: "#00000022",
          borderRadius: "4px",
          padding: "0 1ex",
        }}
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
    //max-width: 900px; margin: 0px auto; height:100%; display:flex; flex-direction: column
    <div key={componentKey} style={{ maxWidth: 900, margin: "0px auto", height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ textAlign: "center", padding: "0.5ex 0"}}>
        <span style={{ marginLeft: 10 }}>{renderBreadcrumbs(handleBackClick)}</span>
      </div>
      <HighchartsReact highcharts={Highcharts} options={chartOptions} />
    </div>
  );
}