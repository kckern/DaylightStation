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
                                    <tr key={transaction.id+i} className={rowClassName} onClick={() => handleRowClick(transaction)} >
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
  .sort((b, a) => a.y - b.y);
  const data = [
    ... income.sort((a, b) => a.name - b.name),
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

function DrawerTreeMapChart({ transactions, setTransactionFilter }) {
  const data = transactions.reduce((acc, tx) => {
    const { tagNames, description, amount } = tx;
    const [tag] = tagNames || ['Other'];
    const color = '#' + (Math.random() * 0xFFFFFF << 0).toString(16);
    
    let tagEntry = acc.find(entry => entry.id === tag);
    
    if (!tagEntry) {
        tagEntry = { id: tag, name: tag, value: 0, color: color };
        acc.push(tagEntry);
    }

    tagEntry.value += amount;

    let descEntry = acc.find(child => child.id === `${tag}-${description}`);
    
    if (!descEntry) {
        descEntry = { id: `${tag}-${description}`, parent: tag, name: description, value: amount };
        acc.push(descEntry);
    } else {
        descEntry.value += amount;
    }
    
    return acc;
}, []);

// Group by tags and include only top 4 descriptions
const groupedData = data.reduce((result, entry) => {
    if (!entry.parent) { // Check if it's a tag entry
        const children = data
            .filter(child => child.parent === entry.id)
            .sort((a, b) => b.value - a.value);
        
        const topChildren = children.slice(0, 4);
        const otherChildrenValue = children.slice(4).reduce((sum, child) => sum + child.value, 0);
        
        result.push(entry);
        result.push(...topChildren);
        
        if (otherChildrenValue > 0) {
            result.push({ id: `${entry.id}-Other`, parent: entry.id, name: 'Other', value: otherChildrenValue });
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
      data: groupedData,
      levels: [
        {
          level: 1,
          dataLabels: {
            enabled: true,
            align: "left",
            verticalAlign: "top"
          }
        },
        {
          level: 2,
          dataLabels: {
            enabled: true,
            align: "center",
            verticalAlign: "middle"
          }
        }
      ]
    }],
    tooltip: { 
      useHTML: true, 
      pointFormatter: function() {
        return `The total spent on <b>${this.name}</b> is <b>${formatAsCurrency(this.value)}</b>`;
      }
    },
    plotOptions: {
      series: { 
        animation: false,
        events: { 
          click: function(event) {
            const level = event.point.node.level;
            setTransactionFilter(level === 1 ? { tags: [event.point.id] } : { description: event.point.name });
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