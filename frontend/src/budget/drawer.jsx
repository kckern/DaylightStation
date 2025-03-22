import moment from "moment";
import React, { useState } from "react";
import Highcharts, { attr } from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import HighchartsTreeGraph from "highcharts/modules/treegraph";
import HighchartsTreeMap from "highcharts/modules/treemap";

HighchartsTreeMap(Highcharts);
HighchartsTreeGraph(Highcharts);

import HC_More from "highcharts/highcharts-more";
HC_More(Highcharts);
import { formatAsCurrency } from "./blocks";

import externalIcon from "../assets/icons/external.svg";;

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
            <div className="budget-drawer-summary">
                
                <span>{sortedTransactions.length} Transactions <a target="_blank" href={`https://www.buxfer.com/transactions?tids=${sortedTransactions.map(tx => tx.id).join(",")}`}>
                <img src={externalIcon} alt="external link" style={{ width: "1em", height: "1em", marginBottom: "-0.2em" }} />
                </a></span>  
                <span>Spent: {formatAsCurrency(summary.spent)}</span>
                <span>Credits: {formatAsCurrency(summary.gained)}</span>
                <span>Net {summary.netspend < 0 ? "Gain" : "Spend"}: {formatAsCurrency(Math.abs(summary.netspend))}</span>
            </div>
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
                                return (
                                    <tr key={guid} className={rowClassName} onClick={() => handleRowClick(transaction)} >
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

function DrawerChart({ transactions, cellKey, periodData, setTransactionFilter }) {

  
  if(cellKey === 'fixed') return <DrawerWaterFallChart periodData={periodData} setTransactionFilter={setTransactionFilter} />;
  if(cellKey === 'month') return <DrawerWaterFallChart periodData={periodData} setTransactionFilter={setTransactionFilter} />;
  if(cellKey === 'day') return <DrawerTreeMapChart transactions={transactions} setTransactionFilter={setTransactionFilter} />;

}

function DrawerWaterFallChart({ periodData, setTransactionFilter }) {


  console.log(periodData);
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
  
  const income = month.incomeTransactions.map(tx => ({name: tx.description || "Paycheck", y: tx.amount, filter: { description: tx.description }}))
  .sort((a, b) => a.name.localeCompare(b.name) || b.y - a.y);
  const data = [
    ... income,
    { name: 'Monthly Income', isIntermediateSum: true, color: `#304529`  , filter: { bucket: "income" }},
    ... categoryCredits.sort((a, b) => a.y - b.y),
    ... categoryDebits.sort((a, b) => a.y - b.y),
    { name: 'Monthly Cash Flow', isIntermediateSum: true, color: `#660000` , filter: { bucket: "monthly" }},
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
            return `<b>${this.point.name}</b><br/>${formatAsCurrency(this.y)}<br/>${(Math.abs(this.y) / incomeSum * 100).toFixed(0)}% of monthly income`;
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