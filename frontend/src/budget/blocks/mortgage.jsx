import moment from "moment";
import { formatAsCurrency } from "../blocks";
import { Tabs } from "@mantine/core";
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';

function calculateSummary(mortgage,plan) {
    const {title, subtitle, id, payments} = plan;
    const { openingBalance, monthlyPayment, interestRate, firstPaymentDate } = mortgage;
    let balance = openingBalance;
    let monthCursor = moment(firstPaymentDate);
    const events = [];
    let previousClosingBalance = balance;

    while (balance > 0) {
        const event = {
            date: monthCursor.format('YYYY-MM'),
            openingBalance: previousClosingBalance,
            accruedInterest: previousClosingBalance * interestRate / 12,
            payments: [monthlyPayment],
            closingBalance: null
        };
        
        // Find extra payments
        const regularExtra = payments.find(({ regular }) => regular && regular.includes(monthCursor.month() + 1)) || null;
        const fixedExtra = payments.find(({ fixed }) => fixed && fixed.includes(monthCursor.format('YYYY-MM'))) || null;
        if (regularExtra) event.payments.push(regularExtra.amount);
        if (fixedExtra) event.payments.push(fixedExtra.amount);

        // Calculate total payments
        const totalPayments = event.payments.reduce((acc, val) => acc + val, 0);

        // Adjust final payment if it exceeds the remaining balance
        if (event.openingBalance + event.accruedInterest < totalPayments) {
            const adjustedPayment = event.openingBalance + event.accruedInterest;
            event.payments = [adjustedPayment];
        }

        event.closingBalance = event.openingBalance + event.accruedInterest - event.payments.reduce((acc, val) => acc + val, 0);
        balance = event.closingBalance;
        previousClosingBalance = event.closingBalance;
        events.push(event);
        monthCursor = monthCursor.add(1, 'month');
    }

    const extraPaymentsFromEvents = events.reduce((acc, {payments}) => acc.concat(payments.slice(1)), []);
    const totalExtraPaid = extraPaymentsFromEvents.reduce((acc, val) => acc + val, 0);
    return {
        events: events,
        summary: {
            totalPaid: events.reduce((acc, {payments}) => acc + payments.reduce((acc, val) => acc + val, 0), 0),
            totalExtraPaid: totalExtraPaid,
            totalInterest: events.reduce((acc, {accruedInterest}) => acc + accruedInterest, 0),
            totalPayments: `${events.length}`,
            totalYears: parseFloat(events.length / 12).toFixed(2),
            avgMonthlyInterest: events.reduce((acc, {accruedInterest}) => acc + accruedInterest, 0) / events.length,
            avgMonthlyEquity: openingBalance / events.length,
            payoffDate: moment(events[events.length - 1].date).format('MMMM YYYY'),
            annualBudget: events.reduce((acc, {payments}) => acc + payments.reduce((acc, val) => acc + val, 0), 0) * 12,
            totalExtraPaid: events.reduce((acc, {payments}) => acc + payments.slice(1).reduce((acc, val) => acc + val, 0), 0),

        },
        ...plan
    };
}



  // BudgetMortgage.jsx
  export function BudgetMortgage({ setDrawerContent, mortgage }) {


    const paymentPlans = mortgage.paymentPlans.map(plan=>calculateSummary(mortgage,plan));

    return (
      <div className="budget-block">
        <h2>Mortgage</h2>
        <div className="budget-block-content">
          <button onClick={() => setDrawerContent({jsx:<MortgageDrawer paymentPlans={paymentPlans} />, meta:{
            title: 'Mortgage Forecast and Simulation',
          }})}>View Mortgage</button>
          <pre>
            {JSON.stringify(paymentPlans[1].summary, null, 2)}
          </pre>
        </div>
      </div>
    );
  }
  

  function MortgageDrawer({ paymentPlans }) {

    const baseline = paymentPlans.find(({id})=>id==='baseline');

    
    paymentPlans.forEach((plan) => {
        plan.savings = {
            monthsSaved: `${baseline.summary.totalPayments - plan.summary.totalPayments}`,
            percentSavings: `${parseFloat((1 - plan.summary.totalInterest / baseline.summary.totalInterest) * 100).toFixed()}%`,
            totalSavings: baseline.summary.totalInterest - plan.summary.totalInterest,
            totalExtraPaid:  plan.summary.totalExtraPaid - baseline.summary.totalExtraPaid,

        };
        const costPerDollarSaved = plan.savings.totalSavings ? plan.summary.totalExtraPaid / plan.savings.totalSavings : 0;
        plan.savings['costPerDollarSaved'] = costPerDollarSaved ? `$${parseFloat(plan.summary.totalExtraPaid / plan.savings.totalSavings).toFixed(2)}` : 0;
    });

    const chartOptions = {
        chart: {
            type: 'area',
        },
        credits: {
            enabled: false
        },
        title: {
            text: 'Mortgage Payoff Scenarios'
        },
        xAxis: {
            categories: baseline.events
                .map(({ date }) => {
                    const month = new Date(date).getMonth();
                    return moment(date).format("YYYY");
                }),
            gridLineWidth: 1.5, // Ensure grid lines are visible
            gridLineColor: '#44000055', // Make grid lines semi-transparent
            tickInterval: 12, // Show a label every 12 months, on January
            labels: {
                rotation: 0
            },
            tickPositioner: function () {
                const positions = [];
                const dataLength = this.categories.length;
                const firstDate = new Date(baseline.events[0].date);
                const firstYear = firstDate.getFullYear();
                const firstMonth = firstDate.getMonth();
                
                // Calculate the first January position
                let start = firstMonth === 0 ? 0 : 12 - firstMonth;
                
                for (let i = start; i < dataLength; i += 12) {
                    positions.push(i);
                }
                
                return positions;
            }
        },
        yAxis: {
            title: {
                text: ''
            },
            gridLineWidth: 0, // Remove grid lines on y-axis
            //max at starting balance, dont round up
            max: Math.ceil(baseline.events[0].openingBalance),

            labels: {
                formatter: function () {
                    // Debugging: Log the context and value
                    console.log('Formatter called with value:', this.value);
                    const formattedNumber = this.axis.defaultLabelFormatter.call(this).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
                    console.log('Formatted number:', formattedNumber);
                    return '$' + formattedNumber;
                }
            }
        },
        series: paymentPlans.map(plan => ({
            name: plan.title,
            data: plan.events.map(({closingBalance}) => closingBalance),
            // hide points
            marker: {
                enabled: false
            }
        }))
    };

    const summaryKeys = Object.keys(baseline.summary);
    const savingsKeys = Object.keys(baseline.savings);


    return <div className="mortgage-drawer">
                <table style={{width: '100%'}}>
            <thead>
                <tr>
                    <th></th>
                    {paymentPlans.map(plan => (
                        <th key={plan.title}>
                            <h3 style={{ margin: 0 }}
                            >{plan.title}</h3>
                            <small style={{ color: 'gray' }}><i>{plan.subtitle}</i></small>
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {summaryKeys.map((key) => (
                    <tr key={key}>
                        <td>{key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}</td>
                        {paymentPlans.map(({ summary }) => (
                            <td key={summary[key]}>
                                {typeof summary[key] === 'number' ? formatAsCurrency(summary[key]) : summary[key]}
                            </td>
                        ))}
                    </tr>
                ))}
                <tr>
                    <td colSpan={paymentPlans.length + 1} style={{ backgroundColor: 'lightgray', textAlign: 'center' }}>
                        Savings vs. Baseline
                    </td>
                </tr>
                {savingsKeys.map((key) => (
                    <tr key={key}>
                        <td>{key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}</td>
                        {paymentPlans.map(({ savings }) => (
                            <td key={savings[key]}>
                                {parseInt(savings[key]) === 0 ? '' : (typeof savings[key] === 'number' ? formatAsCurrency(savings[key]) : savings[key])}
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>


        <hr/>

            <HighchartsReact
            className="mortgage-chart"
            highcharts={Highcharts}
            options={chartOptions}
            />

        <hr/>
        <Tabs defaultValue="baseline" style={{display: 'flex', flexDirection: 'column', justifyContent: 'space-around'}}>
            <Tabs.List>
                {paymentPlans.map((plan)=>(<Tabs.Tab key={plan.id} value={plan.id}>{plan.title}</Tabs.Tab>))}
            </Tabs.List>
            {paymentPlans.map((plan)=>(<Tabs.Panel key={plan.id} value={plan.id}><MortgageTable events={plan.events}/></Tabs.Panel>))}
            </Tabs>
    </div>
  }


  function  MortgageTable ({events}) {


    return <table style={{width: '100%'}}>
    <thead>
        <tr>
            <th>Date</th>
            <th>Opening Balance</th>
            <th>Accrued Interest</th>
            <th>Payments</th>
            <th>Closing Balance</th>
        </tr>
    </thead>
    <tbody className="mortgage-table-body">
        {events.reduce((acc, {date, openingBalance, accruedInterest, payments, closingBalance}) => {
            // Add the main event row
            const paymentCount = payments.length;
            const extraPaymentAmount = paymentCount > 1 ? payments.slice(1).reduce((acc, val) => acc + val, 0) : 0;
            const balanceAfterFirstPayment =closingBalance + extraPaymentAmount;
            acc.push(   
                <tr key={`${date}-main`}>
                    <td>{date}</td>
                    <td>{formatAsCurrency(openingBalance)}</td>
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
                        <td></td>
                        <td></td>
                        <td></td>
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