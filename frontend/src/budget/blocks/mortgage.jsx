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

  export default function MortgageChart({ mortgage }) {
    if (!mortgage?.transactions) return null;
  
    const { date: startDate } = mortgage.transactions
      .sort((a, b) => moment(b.date).diff(moment(a.date)))
      .pop();
  
    const lastDate = mortgage.paymentPlans
      .map(({ info }) => moment(info.payoffDate))
      .sort((a, b) => a.diff(b))
      .pop();
  
    const months = [];
    const cursor = moment(startDate, "YYYY-MM");
    while (cursor.isBefore(lastDate)) {
      months.push(cursor.clone());
      cursor.add(1, "month");
    }
  
    const firstPlan = mortgage.paymentPlans[0];
    const pastData = [];
    const futureData = [];
  
    months.forEach(m => {
      const ms = m.valueOf();
      const t = mortgage.transactions.find(
        ({ date }) => moment(date).format("YYYY-MM") === m.format("YYYY-MM")
      );
      const rawBalance = t?.runningBalance ?? null;
      const pastBalance = rawBalance == null ? null : Math.abs(rawBalance);
  
      const planMonth = firstPlan.months.find(
        ({ month }) => month === m.format("YYYY-MM")
      );
      const futureBalance = planMonth?.endBalance ?? null;
  
      pastData.push([ms, pastBalance]);
      futureData.push([ms, futureBalance]);

    });
  
    const options = {
      chart: {
        backgroundColor: "transparent",
        style: { fontFamily: "sans-serif" }
      },
      title: { text: null },
      xAxis: {
        type: "datetime",
        min: months[0]?.valueOf(),
        max: months[months.length - 1]?.valueOf(),
        tickInterval: 365.25 * 24 * 3600 * 1000,
        minorTickInterval: 30 * 24 * 3600 * 1000,
        gridLineWidth: 1,
        minorGridLineWidth: 0.5
      },
      yAxis: {
        title: { text: null },
        max: Math.max(
            ...pastData.map(([_, y]) => y),
            ...futureData.map(([_, y]) => y)
            ),
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
      legend: { enabled: false },
      plotOptions: {
        series: {
          lineWidth: 2,
          marker: { enabled: false }
        }
      },
      series: [
        {
          name: "Past",
          type: "column",
          data: pastData,
          color: "#4c8ffc",
          zIndex: 1
        },
        {
          name: "Future",
          type: "line",
          data: futureData,
          color: "#2b2b2b",
          zIndex: 2
        }
      ]
    };
  
    return (
      <div>
        <HighchartsReact highcharts={Highcharts} options={options} />
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