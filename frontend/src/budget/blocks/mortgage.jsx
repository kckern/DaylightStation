import moment from "moment";
import { formatAsCurrency } from "../blocks";
import { Tabs, Badge, Table } from "@mantine/core";
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';

function calculateSummary(mortgage,plan) {
    const {title, subtitle, id, payments} = plan;
    const { openingBalance, monthlyPayment, interestRate, firstPaymentDate } = mortgage;
    let balance = openingBalance;
    let monthCursor = moment(firstPaymentDate);
    const events = [];
    let previousClosingBalance = balance;

    const rateChanges = plan.rates?.reduce((acc, { effectiveDate, rate, fee }) => {
        const effectiveMonth = moment(effectiveDate).format('YYYY-MM');
      return { ...acc, [effectiveMonth]: {rate,fee}};
    }, {}) || {};
    let effectiveRate = interestRate;
    while (balance > 0) {

        effectiveRate = rateChanges[monthCursor.format('YYYY-MM')]?.rate || effectiveRate;
        const fee = [rateChanges[monthCursor.format('YYYY-MM')]?.fee || 0];


        const event = {
            date: monthCursor.format('YYYY-MM'),
            openingBalance: previousClosingBalance,
            effectiveRate,
            accruedInterest: previousClosingBalance * effectiveRate / 12,
            payments: [monthlyPayment, ...fee].filter(Boolean),
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
            //totalPaid / totalYears
            annualBudget: events.reduce((acc, {payments}) => acc + payments.reduce((acc, val) => acc + val, 0), 0) / (events.length / 12)

        },
        ...plan
    };
}




export function BudgetMortgage({ setDrawerContent, mortgage }) {
    const paymentPlans = mortgage.paymentPlans.map(plan => calculateSummary(mortgage, plan));
  
  
    return (
      <div className="budget-block">
        <h2>Mortgage</h2>
        <div className="budget-block-content" style={{ display: 'flex', justifyContent: 'space-around', flexDirection: 'column' , alignItems: 'center'}}>
    
            <Tabs defaultValue={paymentPlans[0]?.id || ''} style={{ width: '90%' }}>
              <Tabs.List style={{ width: '90%' }}>
                {paymentPlans.map(plan => (
                  <Tabs.Tab key={plan.id} value={plan.id}>{plan.title}</Tabs.Tab>
                ))}
                 <Tabs.Tab key="chart" value="chart">Chart</Tabs.Tab>
              </Tabs.List>
              {paymentPlans.map(plan => (
                <Tabs.Panel key={plan.id} value={plan.id}>
                  <Table>
                    <tbody>
                      <tr>
                        <td>Total Payments</td>
                        <td style={{ textAlign: 'right' }}>{plan.summary?.totalPayments}</td>
                      </tr>
                      <tr>
                        <td>Total Paid</td>
                        <td style={{ textAlign: 'right' }}>{formatAsCurrency(plan.summary?.totalPaid)}</td>
                      </tr>
                      
                      <tr> <td>Total Extra Paid</td>  <td style={{ textAlign: 'right' }}>{formatAsCurrency(plan.summary?.totalExtraPaid)}</td> </tr>
                        <tr> <td>Total Interest</td>  <td style={{ textAlign: 'right' }}>{formatAsCurrency(plan.summary?.totalInterest)}</td> </tr>
                        <tr> <td>Years to Payoff</td>  <td style={{ textAlign: 'right' }}>{plan.summary?.totalYears}</td> </tr>
                        <tr> <td>Payoff Date</td>  <td style={{ textAlign: 'right' }}>{plan.summary?.payoffDate}</td> </tr>
                        <tr> <td>Annual Budget</td>  <td style={{ textAlign: 'right' }}>{formatAsCurrency(plan.summary?.annualBudget)}</td> </tr>
                        <tr> <td>Avg Monthly Interest</td>  <td style={{ textAlign: 'right' }}>{formatAsCurrency(plan.summary?.avgMonthlyInterest)}</td> </tr>
                        <tr> <td>Avg Monthly Equity</td>  <td style={{ textAlign: 'right' }}>{formatAsCurrency(plan.summary?.avgMonthlyEquity)}</td> </tr>
                        <tr> <td>Cost Per Dollar Saved</td>  <td style={{ textAlign: 'right' }}>{plan.savings?.costPerDollarSaved}</td> </tr>

                    </tbody>
                  </Table>
                </Tabs.Panel>
              ))}
                <Tabs.Panel key="chart" value="chart">
                    <HighchartsReact
                    highcharts={Highcharts}
                    options={mortageChartOptions(paymentPlans)}
                    />
                </Tabs.Panel>
            </Tabs>
            <button onClick={() => setDrawerContent({jsx:<MortgageDrawer paymentPlans={paymentPlans} />,meta:{
                            title: `Mortgage Payoff Scenarios`,
                        }})}>View Details</button>
        </div>
      </div>
    );
  }
  
  const mortageChartOptions = (paymentPlans) => {

    const baseline = paymentPlans.find(({id})=>id==='baseline');

    const chartOptions = {
        chart: {
            type: 'line',
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

    return chartOptions;

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
        const costPerDollarSaved = plan.savings.totalExtraPaid ? plan.summary.totalExtraPaid / plan.savings.totalSavings : 0;
        plan.savings['costPerDollarSaved'] = costPerDollarSaved ? `$${parseFloat(costPerDollarSaved).toFixed(2)}` : 0;
    });



    const summaryKeys = Object.keys(baseline.summary);
    const savingsKeys = Object.keys(baseline.savings);
    const colCount = paymentPlans.length;

    return <div className="mortgage-drawer">
                <table style={{width: '100%'}} className="mortgage-summary">
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
                {summaryKeys.map((key, i ) => (
                    <tr key={key} className={ i===0 ? 'first-row' : ''}>
                        <td className="summary-key" >{key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}</td>
                        {paymentPlans.map(({ summary }) => (
                            <td key={summary[key]} style={{ textAlign: 'right', width: `${100 / (colCount+1)}%`}} className="summary-cell"> 
                                {typeof summary[key] === 'number' ? formatAsCurrency(summary[key]) : summary[key]}
                            </td>
                        ))}
                    </tr>
                ))}
                <tr>
                <td style={{ backgroundColor: 'white'}}></td>
                <td style={{ backgroundColor: 'lightgray', border: "2px solid #555" , borderTop: "2px solid #555" }} />
                    <td colSpan={paymentPlans.length + 1} style={{ backgroundColor: 'lightgray', textAlign: 'center',  border: "2px solid #555", borderBottom: "2px solid #555" , borderTop: "2px solid #555" , fontWeight: 800 }}>
                        Savings vs. Baseline
                    </td>
                </tr>
                {savingsKeys.map((key,i) => (
                    <tr key={key} className={ i===savingsKeys.length-1 ? 'last-row' : ''}>
                        <td colSpan={2} className="summary-key">
                            {key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                        </td>
                        {paymentPlans.map(({ savings }, i) => (
                            i === 0 ? null : (
                                <td key={savings[key]} style={{ textAlign: 'right' }} className="summary-cell">
                                    {parseInt(savings[key]) === 0 ? '' : (typeof savings[key] === 'number' ? formatAsCurrency(savings[key]) : savings[key])}
                                </td>
                            )
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>


        <hr/>

            <HighchartsReact
            className="mortgage-chart"
            highcharts={Highcharts}
            options={mortageChartOptions(paymentPlans)}
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