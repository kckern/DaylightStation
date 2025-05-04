import moment from "moment";
import { formatAsCurrency } from "../blocks";
import { Tabs, Badge, Table } from "@mantine/core";
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';





export function BudgetMortgage({ setDrawerContent, mortgage }) {

    return (
      <div className="budget-block">
        <h2>Mortgage</h2>
        <MortgageChart mortgage={mortgage} />
      </div>
    );
  }

  import { useMemo } from 'react';
  
  export default function MortgageChart({ mortgage }) {
    if (!mortgage?.transactions) return null;
  
    const { months, pastData, futureSeries, maxY } = useMemo(() => {
      // 1. Identify the earliest transaction date.
      const { date: startDate } =
        mortgage.transactions
          .sort((a, b) => moment(b.date).diff(moment(a.date)))
          .pop() || {};
  
      // 2. Identify the latest payoff date among plans.
      const lastDate = mortgage.paymentPlans
        .map(({ info }) => moment(info.payoffDate))
        .sort((a, b) => a.diff(b))
        .pop();
  
      // If for some reason these are not valid, return empty placeholders.
      if (!startDate || !lastDate) {
        return {
          months: [],
          pastData: [],
          futureSeries: [],
          maxY: 0
        };
      }
  
      // 3. Build a month-by-month array from startDate to lastDate.
      const months = [];
      const cursor = moment(startDate, "YYYY-MM");
      while (cursor.isBefore(lastDate)) {
        months.push(cursor.clone());
        cursor.add(1, "month");
      }
  
      // 4. Build the pastData by matching each month to a transaction.
      const pastData = months.map(m => {
        const ms = m.valueOf();
        const matchingTransaction = mortgage.transactions.find(
          ({ date }) => moment(date).format("YYYY-MM") === m.format("YYYY-MM")
        );
        // Note that we flip runningBalance to a positive value:
        const rawBalance = matchingTransaction?.runningBalance ?? null;
        const value = rawBalance == null ? null : Math.abs(rawBalance);
        return [ms, value];
      });
  
      // 5. Build a future series for each payment plan. Each plan gets its own line.
      const futureSeries = mortgage.paymentPlans.map((plan, index) => {
        const data = months.map(m => {
          const ms = m.valueOf();
          const planMonth = plan.months.find(
            ({ month }) => month === m.format("YYYY-MM")
          );
          const futureBalance = planMonth?.startBalance ?? null;
          return [ms, futureBalance];
        });
  
        return {
          // Optionally include plan.info.planName or some other label:
          name: plan.info.planName ? plan.info.planName : `Plan ${index + 1}`,
          type: "line",
          data
        };
      });
  
      // 6. Compute the maximum Y value for chart scaling.
      //    In addition to the past data, consider all future lines.
      const allPastValues = pastData.map(([_, y]) => y || 0);
      const allFutureValues = futureSeries.flatMap(s =>
        s.data.map(([_, y]) => y || 0)
      );
      const maxY = Math.max(...allPastValues, ...allFutureValues, 0);
  
      return { months, pastData, futureSeries, maxY };
    }, [mortgage]);
  
    // Early-exit if we have no months at all:
    if (!months.length) return null;
  
    // Build a Highcharts options object with multiple series: one area for the "Past"
    // plus one line per payment plan.
    const options = {
      chart: {
      backgroundColor: "transparent",
      style: { fontFamily: "sans-serif", marginBottom: '2rem' },  
      },
      credits: { enabled: false },
      title: { text: null },
      legend: { enabled: false }, // Disable the legend
      xAxis: {
      type: "datetime",
      min: months[0].valueOf(),
      max: months[months.length - 1].valueOf(),
      tickInterval: 365.25 * 24 * 3600 * 1000, // one year
      minorTickInterval: 30 * 24 * 3600 * 1000,
      gridLineWidth: 1,
      minorGridLineWidth: 0.5
      },
      yAxis: {
      title: { text: null },
      max: maxY,
      tickInterval: 25000,
      labels: {
        formatter() {
        return `$${(this.value / 1000).toFixed(0)}k`;
        }
      },
      gridLineColor: "#e0e0e0",
      minorGridLineColor: "#f0f0f0",
      minorTickInterval: "auto"
      },
      plotOptions: {
      series: {
        lineWidth: 2,
        marker: { enabled: false }
      },
      column: {
        pointPadding: 0.1,
        borderWidth: 0
      }
      },
      series: [
      // Past balance (area)
      {
        name: "Past",
        type: "area",
        data: pastData,
        color: "#4c8ffc",
        zIndex: 1
      },
      // Spread out each plan’s future data as a separate line
      ...futureSeries.map((planSeries, idx) => ({
        ...planSeries,
        color: Highcharts.getOptions().colors[idx] || "#2b2b2b",
        zIndex: 2 + idx
      }))
      ]
    };

    const { totalPaid,totalPrincipalPaid,totalInterestPaid,monthlyRent,monthlyEquity,percentPaidOff,balance } = mortgage;



    
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', height: '100%' }}>
      <table style={{ width: '95%'}} className="mortgage-summary">
      <tbody>
      <tr>
      <td style={{ width: '20%', textAlign: 'right' }}>Paid:</td>
      <td style={{ width: '20%', textAlign: 'left' }}><b>{formatAsCurrency(totalPaid, "K")}</b></td>
      <td style={{ width: '20%', textAlign: 'right' }}>Principal Paid:</td>
      <td style={{ width: '20%', textAlign: 'left' }}><b>{formatAsCurrency(totalPrincipalPaid, "K")}</b></td>
      <td style={{ width: '20%', textAlign: 'right' }}>Avg Equity / Month:</td>
      <td style={{ width: '20%', textAlign: 'left' }}><b>{formatAsCurrency(monthlyEquity, "K")}</b></td>
      </tr>
      <tr>
      <td style={{ width: '20%', textAlign: 'right' }}>Balance:</td>
      <td style={{ width: '20%', textAlign: 'left' }}><b>{formatAsCurrency(-balance, "K")}</b></td>
      <td style={{ width: '20%', textAlign: 'right' }}>Interest Paid:</td>
      <td style={{ width: '20%', textAlign: 'left' }}><b>{formatAsCurrency(totalInterestPaid, "K")}</b></td>
      <td style={{ width: '20%', textAlign: 'right' }}>Avg Rent / Month:</td>
      <td style={{ width: '20%', textAlign: 'left' }}><b>{formatAsCurrency(monthlyRent, "K")}</b></td>
      </tr>
      </tbody>
      </table>
      <div style={{ flexGrow: 1, width: '100%', overflow: 'hidden' }}>
      <HighchartsReact
      highcharts={Highcharts}
      options={options}
      containerProps={{ style: { width: '100%', height: 'calc(100% - 2rem)' } }}
      />
      </div>
      </div>
    );
  }

  function MortgageDrawer({ paymentPlans }) {

    return <pre>
        {JSON.stringify(paymentPlans, null, 2)}
    </pre>
  }


  function  MortgageTable ({events}) {


    return <table style={{width: '100%'}} className="mortgage-table">
    <thead>
        <tr>
            <th>Date</th>
            <th>Opening Balance</th>
            <th>Interest Rate</th>
            <th>Accrued Interest</th>
            <th>Payments</th>
            <th>Closing Balance</th>
        </tr>
    </thead>
    <tbody className="mortgage-table-body">
        {events.reduce((acc, {date, openingBalance, effectiveRate, accruedInterest, payments, closingBalance}) => {
            // Add the main event row
            const paymentCount = payments.length;
            const extraPaymentAmount = paymentCount > 1 ? payments.slice(1).reduce((acc, val) => acc + val, 0) : 0;
            const balanceAfterFirstPayment =closingBalance + extraPaymentAmount;
            const month = moment(date).format('MMMM');
            const className = month === 'January' ? 'new-year' : '';

            acc.push(   
                <tr key={`${date}-main`} className={className}>
                    <td style={{textAlign: 'right'}} ><Badge  color="gray">{moment(date).format('MMMM YYYY')}</Badge></td>
                    <td>{formatAsCurrency(openingBalance)}</td>
                    <td style={{textAlign: 'center'}}
                    ><Badge>{(effectiveRate * 100).toFixed(2)}%</Badge></td>
                    <td>{formatAsCurrency(accruedInterest)}</td>
                    <td>{payments.length > 0 ? formatAsCurrency(payments[0]) : ''}</td>
                    <td>{formatAsCurrency(balanceAfterFirstPayment)}</td>
                </tr>
            );
            
            // Add rows for additional payments
            let runningBalance = balanceAfterFirstPayment;
            for (let i = 1; i < payments.length; i++) {
                const thisClosingBalance = runningBalance - payments[i];
                acc.push(
                    <tr key={`${date}-payment-${i}`}>
                        <td colSpan={4}/>
                        <td>{formatAsCurrency(payments[i])}</td>
                        <td>{formatAsCurrency(thisClosingBalance)}</td>
                    </tr>
                );
                runningBalance = thisClosingBalance;
            }
        
        
            return acc;
        }, [])}
    </tbody>
</table>
  }