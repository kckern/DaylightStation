import moment from "moment";
import { formatAsCurrency } from "../blocks";
import { Tabs, Badge, Table, Select, TextInput } from "@mantine/core";
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import { useState, useMemo } from 'react';



export function BudgetMortgage({ setDrawerContent, mortgage }) {
  const { accountId } = mortgage;

  const openDrawer = (tab = 'amortization') => {
    setDrawerContent({
      meta: { title: 'Mortgage Details' },
      jsx: <MortgageDrawer mortgage={mortgage} defaultTab={tab} />
    });
  };

  const handleTitleClick = () => {
    window.open(`https://www.buxfer.com/account?id=${accountId}`, "_blank");
  };

  return (
    <div className="budget-block">
      <h2 onClick={handleTitleClick} style={{ cursor: 'pointer' }}>Mortgage</h2>
      <div onClick={() => openDrawer('amortization')} style={{ cursor: 'pointer' }}>
        <MortgageChart mortgage={mortgage} />
      </div>
    </div>
  );
}

  export default function MortgageChart({ mortgage, zoomable = false }) {
    if (!mortgage?.amortization && !mortgage?.transactions) return null;

    const { months, pastData, cumulativeInterestData, futureSeries, maxY } = useMemo(() => {
      // 1. Build sawtooth pastData from amortization records.
      // Three points per month: opening → interest peak → payment trough
      const pastData = (mortgage.amortization || []).flatMap(record => {
        const monthStart = moment(record.month, "YYYY-MM").valueOf();
        const midMonth = moment(record.month, "YYYY-MM").date(15).valueOf();
        const monthEnd = moment(record.month, "YYYY-MM").endOf('month').valueOf();
        return [
          [monthStart, record.openingBalance],
          [midMonth, record.openingBalance + record.interestAccrued],
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

      // 3. Build a future series for each payment plan.
      // Projections now start from the month after the last amortization month,
      // using the reconciled closing balance — so the first startBalance matches exactly.
      const futureSeries = mortgage.paymentPlans.map((plan) => {
        const data = plan.months.map(({ month, startBalance, endBalance }) => {
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
      style: { fontFamily: "sans-serif" },
      zoomType: zoomable ? 'x' : undefined,
      panning: zoomable ? { enabled: true, type: 'x' } : undefined,
      panKey: zoomable ? 'shift' : undefined,
      },
      credits: { enabled: false },
      ...(zoomable && { resetZoomButton: { theme: { fill: '#333', stroke: '#555', style: { color: '#ccc' } } } }),
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
      labels: {
        rotation: -45,
        style: { color: '#999', fontSize: '10px' }
      },
      plotLines: [{
        color: '#ffffff55',
        width: 2,
        value: moment().valueOf(),
        dashStyle: 'Dash',
        label: { text: 'Today', style: { color: '#999' } }
      }]
      },
      yAxis: {
        title: { text: null },
        max: maxY,
        tickInterval: 25000,
        labels: {
          formatter() {
            return `$${(this.value / 1000).toFixed(0)}k`;
          },
          style: { color: '#999' }
        },
        gridLineColor: "#444",
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
      {
        name: "Balance",
        type: "area",
        data: pastData,
        color: "#4c8ffc",
        fillOpacity: 0.3,
        zIndex: 1
      },
      {
        name: "Cumulative Interest",
        type: "area",
        data: cumulativeInterestData,
        color: "#ff9800",
        fillOpacity: 0.25,
        zIndex: 0
      },
      ...futureSeries.map((planSeries, idx) => ({
        ...planSeries,
        color: Highcharts.getOptions().colors[idx + 2] || "#2b2b2b",
        zIndex: 2 + idx
      }))
      ]
    };

    const { totalPaid,totalPrincipalPaid,totalInterestPaid,monthlyRent,monthlyEquity,percentPaidOff,balance } = mortgage;



    
    // In the dashboard grid: budget-block is ~50vh, h2 is ~2rem, summary is ~3.5rem
    // In the drawer: zoomable mode uses a fixed 350px height
    const chartHeight = zoomable ? '350px' : 'calc(100% - 4rem)';

    return (
      <div style={{ height: '100%', overflow: 'hidden' }}>
      <div className="mortgage-summary-grid">
        <div><span>Paid</span><b>{formatAsCurrency(totalPaid, "K")}</b></div>
        <div><span>Balance</span><b>{formatAsCurrency(-balance, "K")}</b></div>
        <div><span>Principal</span><b>{formatAsCurrency(totalPrincipalPaid, "K")}</b></div>
        <div><span>Interest</span><b style={{ color: '#ff9800' }}>{formatAsCurrency(totalInterestPaid, "K")}</b></div>
        <div><span>Equity/mo</span><b>{formatAsCurrency(monthlyEquity, "K")}</b></div>
        <div><span>Rent/mo</span><b>{formatAsCurrency(monthlyRent, "K")}</b></div>
        <div><span>Paid Off</span><b>{(percentPaidOff * 100).toFixed(1)}%</b></div>
        <div><span>Int. Ratio</span><b>{totalPaid > 0 ? `${(totalInterestPaid / totalPaid * 100).toFixed(1)}%` : '0%'}</b></div>
      </div>
      <div style={{ width: '100%', height: chartHeight }}>
      <HighchartsReact
      highcharts={Highcharts}
      options={options}
      containerProps={{ style: { width: '100%', height: '100%' } }}
      />
      </div>
      </div>
    );
  }

  function MortgageDrawer({ mortgage, defaultTab = 'amortization' }) {
    const [selectedPlanId, setSelectedPlanId] = useState(
      mortgage.paymentPlans[0]?.info?.id || null
    );

    const selectedPlan = mortgage.paymentPlans.find(p => p.info.id === selectedPlanId);

    const lastAmortMonth = mortgage.amortization?.length
      ? mortgage.amortization[mortgage.amortization.length - 1].month
      : null;

    const futureMonths = selectedPlan?.months
      .filter(m => !lastAmortMonth || m.month > lastAmortMonth)
      .map(m => ({
        month: m.month,
        effectiveRate: mortgage.interestRate,
        openingBalance: m.startBalance,
        interestAccrued: m.interestAccrued,
        payments: m.payments,
        totalPaid: m.amountPaid,
        principalPaid: m.amountPaid - m.interestAccrued,
        closingBalance: m.endBalance,
        cumulativeInterest: null,
        isFuture: true
      })) || [];

    const combinedMonths = [
      ...(mortgage.amortization || []).map(m => ({ ...m, isFuture: false })),
      ...futureMonths
    ];

    return (
      <div>
      <div style={{ width: '100%', marginBottom: '1rem' }}>
        <MortgageChart mortgage={mortgage} zoomable />
      </div>
      <Tabs defaultValue={defaultTab}>
        <Tabs.List>
          <Tabs.Tab value="amortization">Amortization</Tabs.Tab>
          <Tabs.Tab value="comparison">Plan Comparison</Tabs.Tab>
          <Tabs.Tab value="costOfCapital">Cost of Capital</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="amortization" pt="md">
          <div style={{ marginBottom: '1rem' }}>
            <Select
              label="Payment Plan"
              data={mortgage.paymentPlans.map(p => ({ value: p.info.id, label: p.info.title }))}
              value={selectedPlanId}
              onChange={setSelectedPlanId}
              style={{ maxWidth: 300 }}
            />
          </div>
          <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            <AmortizationTable months={combinedMonths} />
          </div>
        </Tabs.Panel>

        <Tabs.Panel value="comparison" pt="md">
          <PlanComparisonTable paymentPlans={mortgage.paymentPlans} />
        </Tabs.Panel>

        <Tabs.Panel value="costOfCapital" pt="md">
          <CostOfCapitalCalculator mortgage={mortgage} />
        </Tabs.Panel>
      </Tabs>
      </div>
    );
  }

  function AmortizationTable({ months }) {
    return (
      <table style={{ width: '100%' }} className="mortgage-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Opening Balance</th>
            <th>Interest</th>
            <th>Payments</th>
            <th>Closing Balance</th>
            <th>Cumulative Interest</th>
          </tr>
        </thead>
        <tbody className="mortgage-table-body">
          {months.map((record) => {
            const monthLabel = moment(record.month, 'YYYY-MM').format('MMMM YYYY');
            const isJanuary = record.month.endsWith('-01');
            const className = [
              isJanuary ? 'new-year' : '',
              record.isFuture ? 'future-month' : ''
            ].filter(Boolean).join(' ');

            const rows = [];
            rows.push(
              <tr key={`${record.month}-main`} className={className}>
                <td style={{ textAlign: 'right' }}>
                  <Badge color={record.isFuture ? 'blue' : 'gray'}>{monthLabel}</Badge>
                </td>
                <td>{formatAsCurrency(record.openingBalance)}</td>
                <td style={{ color: record.isFuture ? '#ff6b6b' : '#c00' }}>{formatAsCurrency(record.interestAccrued)}</td>
                <td>{record.payments?.length > 0 ? formatAsCurrency(record.payments[0]) : ''}</td>
                <td>{formatAsCurrency(record.closingBalance)}</td>
                <td>{record.cumulativeInterest != null ? formatAsCurrency(record.cumulativeInterest) : ''}</td>
              </tr>
            );

            if (record.payments?.length > 1) {
              let runningBal = record.openingBalance + record.interestAccrued - record.payments[0];
              for (let i = 1; i < record.payments.length; i++) {
                runningBal -= record.payments[i];
                rows.push(
                  <tr key={`${record.month}-payment-${i}`}>
                    <td colSpan={3} />
                    <td>{formatAsCurrency(record.payments[i])}</td>
                    <td>{formatAsCurrency(runningBal)}</td>
                    <td />
                  </tr>
                );
              }
            }

            return rows;
          })}
        </tbody>
      </table>
    );
  }

  function PlanComparisonTable({ paymentPlans }) {
    const maxInterest = Math.max(...paymentPlans.map(p => p.info.totalInterest));

    return (
      <table style={{ width: '100%' }} className="mortgage-table">
        <thead>
          <tr>
            <th>Plan</th>
            <th>Payoff Date</th>
            <th>Total Paid</th>
            <th>Total Interest</th>
            <th>Interest Saved</th>
            <th>Monthly Budget</th>
          </tr>
        </thead>
        <tbody className="mortgage-table-body">
          {paymentPlans.map((plan) => {
            const { info } = plan;
            const saved = maxInterest - info.totalInterest;
            return (
              <tr key={info.id}>
                <td>
                  <b>{info.title}</b>
                  {info.subtitle && <div style={{ fontSize: '0.8em', color: '#888' }}>{info.subtitle}</div>}
                </td>
                <td>{info.payoffDate}</td>
                <td>{formatAsCurrency(info.totalPaid, "K")}</td>
                <td>{formatAsCurrency(info.totalInterest, "K")}</td>
                <td style={{ color: saved > 0 ? '#4caf50' : 'inherit' }}>
                  {saved > 0 ? formatAsCurrency(saved, "K") : '—'}
                </td>
                <td>{formatAsCurrency(info.annualBudget / 12)}/mo</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  function CostOfCapitalCalculator({ mortgage }) {
    const [amount, setAmount] = useState(1000);
    const commonAmounts = [1000, 5000, 10000, 25000, 50000];

    const calculateCost = (extraAmount, plan) => {
      const currentBalance = mortgage.balance;
      const rate = mortgage.interestRate;

      const baseInterest = plan.info.totalInterest;
      const baseMonths = plan.info.totalPayments;

      let balance = currentBalance + extraAmount;
      let totalInterest = 0;
      let months = 0;
      const monthlyRate = rate / 12;

      while (balance > 0.01 && months < 1000) {
        const interest = balance * monthlyRate;
        totalInterest += interest;
        balance += interest;

        let payment = plan.months[months]?.amountPaid || plan.months[plan.months.length - 1]?.amountPaid || 0;
        if (payment > balance) payment = balance;
        balance -= payment;
        months++;
      }

      const additionalInterest = Math.round((totalInterest - baseInterest) * 100) / 100;
      const trueCost = extraAmount + additionalInterest;
      const multiplier = trueCost / extraAmount;
      const delayMonths = months - baseMonths;

      return { additionalInterest, trueCost, multiplier, delayMonths };
    };

    return (
      <div>
        <div style={{ marginBottom: '1.5rem' }}>
          <TextInput
            label="Amount to evaluate"
            type="number"
            value={amount}
            onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
            leftSection="$"
            style={{ maxWidth: 200 }}
          />
        </div>

        {mortgage.paymentPlans.map(plan => {
          const cost = calculateCost(amount, plan);
          return (
            <div key={plan.info.id} style={{
              marginBottom: '1rem',
              padding: '1rem',
              border: '1px solid #333',
              borderRadius: '8px'
            }}>
              <div style={{ fontSize: '1.2em', marginBottom: '0.5rem' }}>
                <b>{formatAsCurrency(amount)}</b> spent today costs you{' '}
                <b style={{ color: '#ff9800' }}>{formatAsCurrency(cost.trueCost)}</b>
                <span style={{ color: '#888', marginLeft: '0.5rem' }}>({plan.info.title})</span>
              </div>
              <table style={{ width: '100%', maxWidth: 400 }}>
                <tbody>
                  <tr>
                    <td style={{ color: '#888' }}>Additional interest:</td>
                    <td style={{ color: '#c00' }}>{formatAsCurrency(cost.additionalInterest)}</td>
                  </tr>
                  <tr>
                    <td style={{ color: '#888' }}>Cost multiplier:</td>
                    <td>{cost.multiplier.toFixed(3)}×</td>
                  </tr>
                  <tr>
                    <td style={{ color: '#888' }}>Payoff delay:</td>
                    <td>+{cost.delayMonths} month{cost.delayMonths !== 1 ? 's' : ''}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })}

        <h3 style={{ marginTop: '2rem' }}>Quick Reference</h3>
        <table style={{ width: '100%' }} className="mortgage-table">
          <thead>
            <tr>
              <th>Amount</th>
              {mortgage.paymentPlans.map(p => (
                <th key={p.info.id}>{p.info.title}</th>
              ))}
            </tr>
          </thead>
          <tbody className="mortgage-table-body">
            {commonAmounts.map(amt => (
              <tr key={amt}>
                <td>{formatAsCurrency(amt)}</td>
                {mortgage.paymentPlans.map(plan => {
                  const cost = calculateCost(amt, plan);
                  return (
                    <td key={plan.info.id}>
                      +{formatAsCurrency(cost.additionalInterest)}{' '}
                      <span style={{ color: '#888' }}>({cost.multiplier.toFixed(2)}×)</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }