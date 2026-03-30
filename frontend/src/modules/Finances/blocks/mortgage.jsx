import moment from "moment";
import { formatAsCurrency } from "../blocks";
import { Tabs, Badge, Table } from "@mantine/core";
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';





export function BudgetMortgage({ setDrawerContent, mortgage }) {
  const { accountId } = mortgage;
  const handleClick = ()=>{
    window.open(`https://www.buxfer.com/account?id=${accountId}`, "_blank");
  }

    return (
      <div className="budget-block">
      <h2 onClick={handleClick} style={{ cursor: 'pointer' }}>Mortgage</h2>
      <MortgageChart mortgage={mortgage} />
      </div>
    );
  }

  import { useMemo } from 'react';
  
  export default function MortgageChart({ mortgage }) {
    if (!mortgage?.amortization && !mortgage?.transactions) return null;

    const { months, pastData, cumulativeInterestData, futureSeries, maxY } = useMemo(() => {
      // 1. Build sawtooth pastData from amortization records.
      const pastData = (mortgage.amortization || []).flatMap(record => {
        const monthStart = moment(record.month, "YYYY-MM").valueOf();
        const monthEnd = moment(record.month, "YYYY-MM").endOf('month').valueOf();
        const peak = record.openingBalance + record.interestAccrued;
        return [
          [monthStart, peak],
          [monthEnd, record.closingBalance]
        ];
      });

      const cumulativeInterestData = (mortgage.amortization || []).map(record => {
        const ms = moment(record.month, "YYYY-MM").endOf('month').valueOf();
        return [ms, record.cumulativeInterest];
      });

      // 2. Determine last amortization month to avoid overlap with future series.
      const lastAmortMonth = mortgage.amortization?.length
        ? mortgage.amortization[mortgage.amortization.length - 1].month
        : null;

      // 3. Build a future series for each payment plan (only months after amortization).
      const futureSeries = mortgage.paymentPlans.map((plan) => {
        const data = plan.months
          .filter(({ month }) => !lastAmortMonth || month > lastAmortMonth)
          .map(({ month, endBalance }) => {
            const ms = moment(month, "YYYY-MM").valueOf();
            return [ms, endBalance];
          });

        return {
          name: plan.info.title || 'Plan',
          type: "line",
          data
        };
      });

      // 4. Compute xAxis bounds spanning amortization + future projections.
      const amortMonths = (mortgage.amortization || []).map(r => moment(r.month, "YYYY-MM"));
      const planEndMonths = mortgage.paymentPlans
        .map(({ info }) => moment(info.payoffDate, "MMMM YYYY"))
        .filter(m => m.isValid());
      const allMonths = [...amortMonths, ...planEndMonths].sort((a, b) => a.diff(b));
      const months = allMonths.length ? [allMonths[0], allMonths[allMonths.length - 1]] : [];

      // 5. Compute the maximum Y value for chart scaling (includes sawtooth peaks).
      const allPastValues = pastData.map(([_, y]) => y || 0);
      const allFutureValues = futureSeries.flatMap(s =>
        s.data.map(([_, y]) => y || 0)
      );
      const maxY = Math.max(...allPastValues, ...allFutureValues, 0);

      return { months, pastData, cumulativeInterestData, futureSeries, maxY };
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
      legend: { enabled: true, itemStyle: { color: '#ccc' } },
      xAxis: {
      type: "datetime",
      min: months[0].valueOf(),
      max: months[months.length - 1].valueOf(),
      tickInterval: 365.25 * 24 * 3600 * 1000, // one year
      minorTickInterval: 30 * 24 * 3600 * 1000,
      gridLineWidth: 1,
      minorGridLineWidth: 0.5,
      plotLines: [{
        color: '#ffffff55',
        width: 2,
        value: moment().valueOf(),
        dashStyle: 'Dash',
        label: { text: 'Today', style: { color: '#999' } }
      }]
      },
      yAxis: [
      {
        title: { text: null },
        max: maxY,
        tickInterval: 25000,
        labels: {
        formatter() {
          return `$${(this.value / 1000).toFixed(0)}k`;
        }
        },
        gridLineColor: "#e0e0e0",
      },
      {
        title: { text: null },
        opposite: true,
        labels: {
        formatter() {
          return `$${(this.value / 1000).toFixed(0)}k`;
        },
        style: { color: '#ff9800' }
        },
        gridLineWidth: 0,
      }
      ],
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
      {
        name: "Balance",
        type: "area",
        data: pastData,
        color: "#4c8ffc",
        fillOpacity: 0.3,
        yAxis: 0,
        zIndex: 1
      },
      {
        name: "Cumulative Interest",
        type: "area",
        data: cumulativeInterestData,
        color: "#ff9800",
        fillOpacity: 0.15,
        yAxis: 1,
        zIndex: 0
      },
      ...futureSeries.map((planSeries, idx) => ({
        ...planSeries,
        yAxis: 0,
        color: Highcharts.getOptions().colors[idx + 2] || "#2b2b2b",
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
      <td style={{ width: '20%', textAlign: 'right' }}>Avg Rent / Month:</td>
      <td style={{ width: '20%', textAlign: 'left' }}><b>{formatAsCurrency(monthlyRent, "K")}</b></td>
      <td style={{ width: '20%', textAlign: 'right' }}>Paid Off:</td>
      <td style={{ width: '20%', textAlign: 'left' }}><b>{(percentPaidOff * 100).toFixed(1)}%</b></td>
      </tr>
      <tr>
      <td style={{ width: '20%', textAlign: 'right' }}>Interest Paid:</td>
      <td style={{ width: '20%', textAlign: 'left' }}><b>{formatAsCurrency(totalInterestPaid, "K")}</b></td>
      <td style={{ width: '20%', textAlign: 'right' }}>Interest Ratio:</td>
      <td style={{ width: '20%', textAlign: 'left' }}><b>{totalPaid > 0 ? `${(totalInterestPaid / totalPaid * 100).toFixed(1)}%` : '0%'}</b></td>
      <td style={{ width: '20%', textAlign: 'right' }}></td>
      <td style={{ width: '20%', textAlign: 'left' }}></td>
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