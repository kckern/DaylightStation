import moment from "moment";
import { formatAsCurrency } from "../blocks";
import { Tabs, Badge, Table, Select, TextInput, Tooltip } from "@mantine/core";
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
    <div className="budget-block" style={{ display: 'flex', flexDirection: 'column' }}>
      <h2 onClick={handleTitleClick} style={{ cursor: 'pointer', flexShrink: 0 }}>Mortgage</h2>
      <div
        onClick={() => openDrawer('amortization')}
        style={{ cursor: 'pointer', flex: 1, minHeight: 0, overflow: 'hidden' }}
      >
        <MortgageChart mortgage={mortgage} />
      </div>
    </div>
  );
}

  export default function MortgageChart({ mortgage, zoomable = false }) {
    if (!mortgage?.amortization && !mortgage?.transactions) return null;

    const { months, pastData, cumulativeInterestData, futureSeries, maxY, monthTicks, yearLines } = useMemo(() => {
      const todayMs = moment().valueOf();
      const amort = mortgage.amortization || [];

      // 1. Build sawtooth pastData using each record's actual asOfDate (not
      // its calendar-month label, which is the lender's billing-cycle name and
      // typically lags the actual data date by ~1 month). Each record spans
      // from the previous record's asOfDate to its own asOfDate, with a peak
      // mid-period for accrued interest. The last record's end is capped at
      // Today — past line never extends into the future.
      const recordEndMs = (record) => record.asOfDate
        ? moment(record.asOfDate).valueOf()
        : moment(record.month, "YYYY-MM").endOf('month').valueOf();

      const pastData = amort.flatMap((record, i, arr) => {
        const prev = arr[i - 1];
        const periodStart = prev
          ? recordEndMs(prev)
          : moment(record.month, "YYYY-MM").startOf('month').valueOf();
        let periodEnd = recordEndMs(record);
        if (i === arr.length - 1 && periodEnd > todayMs) periodEnd = todayMs;
        const midPeriod = (periodStart + periodEnd) / 2;
        return [
          [periodStart, record.openingBalance],
          [midPeriod, record.openingBalance + record.interestAccrued],
          [periodEnd, record.closingBalance]
        ];
      });

      const cumulativeInterestData = amort.map((record, i, arr) => {
        let endMs = recordEndMs(record);
        if (i === arr.length - 1 && endMs > todayMs) endMs = todayMs;
        return [endMs, record.cumulativeInterest];
      });

      // 2. Determine last amortization month to avoid overlap with future series.
      const lastAmortMonth = mortgage.amortization?.length
        ? mortgage.amortization[mortgage.amortization.length - 1].month
        : null;

      // 3. Build a future series for each payment plan.
      // First point anchors at TODAY with the first projection month's
      // startBalance (= currentBalance), joining seamlessly to the past
      // line's capped endpoint. Subsequent points are month-END endBalances.
      // For the final payoff month: the calculator caps the last payment to
      // not overpay, so the loan zeroes out PART-WAY through that month.
      // Plotting endBalance=0 at calendar month-end would create a flat tail
      // (artificial bend). Instead, interpolate the payoff date within the
      // month based on (partial last payment / full prior payment).
      const futureSeries = mortgage.paymentPlans.map((plan) => {
        const data = [];
        if (plan.months.length > 0) {
          data.push([todayMs, plan.months[0].startBalance]);
        }
        plan.months.forEach((m, idx, arr) => {
          const monthStart = moment(m.month, "YYYY-MM").valueOf();
          const monthEnd = moment(m.month, "YYYY-MM").endOf('month').valueOf();
          const isLast = idx === arr.length - 1;
          const isPaidOff = isLast && m.endBalance < 1;
          let plotMs;
          if (isPaidOff && idx > 0) {
            const fullPayment = arr[idx - 1].amountPaid || m.amountPaid || 1;
            const fraction = Math.min(1, Math.max(0, m.amountPaid / fullPayment));
            plotMs = monthStart + (monthEnd - monthStart) * fraction;
          } else {
            plotMs = monthEnd;
          }
          if (plotMs > todayMs) data.push([plotMs, m.endBalance]);
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

      // 5. Calendar-aligned tick positions. Highcharts' default `tickInterval`
      // anchors at axis-min and uses fixed-day arithmetic (365.25 / 30), which
      // drifts off calendar boundaries. Compute month-1st positions directly
      // so the year boundaries (Jan-1) overlap exactly with monthly grid lines.
      const monthTicks = [];
      const yearLines = [];
      if (allMonths.length) {
        const cursor = allMonths[0].clone().startOf('month');
        const end = allMonths[allMonths.length - 1].clone().endOf('month');
        while (cursor.isSameOrBefore(end)) {
          monthTicks.push(cursor.valueOf());
          if (cursor.month() === 0) yearLines.push(cursor.valueOf());
          cursor.add(1, 'month');
        }
      }

      // 6. Compute the maximum Y value for chart scaling (includes sawtooth peaks).
      const allPastValues = pastData.map(([_, y]) => y || 0);
      const allFutureValues = futureSeries.flatMap(s =>
        s.data.map(([_, y]) => y || 0)
      );
      const maxY = Math.max(...allPastValues, ...allFutureValues, 0);

      // 7. Tag the very last past-line point with a data label showing the
      // current balance. Convert from [x, y] tuple to point-object form so
      // Highcharts attaches the label only to that one point. (Done AFTER
      // maxY to avoid breaking the array-destructure in step 6.) The label
      // floats up into the empty space above the line, in dark text for
      // readability against the light chart background.
      if (pastData.length > 0) {
        const [lastX, lastY] = pastData[pastData.length - 1];
        pastData[pastData.length - 1] = {
          x: lastX,
          y: lastY,
          dataLabels: {
            enabled: true,
            align: 'left',
            verticalAlign: 'bottom',
            x: 8,
            y: -8,
            formatter() {
              return `<b>$${(this.y / 1000).toFixed(1)}k</b>`;
            },
            style: {
              color: '#1f2937',
              fontSize: '13px',
              fontWeight: 'bold',
              textOutline: 'none'
            }
          }
        };
      }

      return { months, pastData, cumulativeInterestData, futureSeries, maxY, monthTicks, yearLines };
    }, [mortgage]);
  
    // Early-exit if we have no months at all:
    if (!months.length) return null;
  
    // Build a Highcharts options object with multiple series: one area for the "Past"
    // plus one line per payment plan.
    const options = {
      chart: {
      backgroundColor: "transparent",
      style: { fontFamily: "sans-serif" },
      spacingBottom: 12,
      zoomType: zoomable ? 'x' : undefined,
      panning: zoomable ? { enabled: true, type: 'x' } : undefined,
      panKey: zoomable ? 'shift' : undefined,
      },
      credits: { enabled: false },
      ...(zoomable && { resetZoomButton: { theme: { fill: '#333', stroke: '#555', style: { color: '#ccc' } } } }),
      title: { text: null },
      legend: { enabled: false },
      tooltip: { xDateFormat: '%b %Y' },
      xAxis: {
      type: "datetime",
      min: months[0].valueOf(),
      max: months[months.length - 1].valueOf(),
      // Calendar-aligned tick positions — every month-1st. Year boundaries
      // (Jan-1) are drawn as plotLines on top, so the prominent year markers
      // fall exactly on a month gridline (no drift).
      tickPositions: monthTicks,
      gridLineWidth: 0.5,
      gridLineColor: "#dcdcdc",
      minorTicks: false,
      labels: {
        formatter() {
          return moment(this.value).month() === 0
            ? moment(this.value).format('YYYY')
            : '';
        },
        rotation: -45,
        style: { color: '#666', fontSize: '10px' }
      },
      plotLines: [
        ...yearLines.map(t => ({
          color: '#888',
          width: 1.25,
          value: t,
          zIndex: 3
        })),
        {
          color: '#dc2626',
          width: 2,
          value: moment().valueOf(),
          dashStyle: 'ShortDash',
          zIndex: 5,
          label: {
            text: 'Today',
            rotation: 0,
            align: 'left',
            x: 4,
            y: 12,
            style: { color: '#dc2626', fontWeight: 'bold', fontSize: '11px' }
          }
        }
      ]
      },
      yAxis: {
        title: { text: null },
        min: 0,
        max: maxY,
        startOnTick: false,
        endOnTick: false,
        tickInterval: 100000,
        minorTickInterval: 25000,
        labels: {
          formatter() {
            return `$${(this.value / 1000).toFixed(0)}k`;
          },
          style: { color: '#999' }
        },
        gridLineColor: "#888",
        minorGridLineColor: "#dcdcdc",
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

    const { totalPaid,totalPrincipalPaid,totalInterestPaid,monthlyRent,monthlyEquity,percentPaidOff,balance,mortgageStartValue } = mortgage;
    // Historical plan gives total expected interest based on actual payment pace
    const historicalPlan = mortgage.paymentPlans?.find(p => p.info.id === 'historical') || mortgage.paymentPlans?.[0];
    const totalExpectedInterest = (historicalPlan?.info?.totalInterest || 0) + totalInterestPaid;
    const totalExpectedCost = mortgageStartValue + totalExpectedInterest;
    const principalPctOff = mortgageStartValue > 0 ? (totalPrincipalPaid / mortgageStartValue * 100) : 0;
    const totalPctOff = totalExpectedCost > 0 ? (totalPaid / totalExpectedCost * 100) : 0;



    // Layout: flexbox column. Summary grid takes its natural height; the chart
    // fills the remaining space. `min-height: 0` is critical — without it, the
    // chart's intrinsic Highcharts size (~400px) wins over the flex constraint
    // and the chart overflows the budget-block container, pushing the x-axis
    // labels outside the visible area.
    const wrapperStyle = zoomable
      ? { width: '100%' }
      : { height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' };
    const chartContainerStyle = zoomable
      ? { width: '100%', height: '350px' }
      : { width: '100%', flex: 1, minHeight: 0 };

    return (
      <div style={wrapperStyle}>
      <div className="mortgage-summary-grid" style={{ flexShrink: 0 }}>
        {/* Row 1: headline numbers — Balance / Paid / Principal / Interest / Equity-per-month */}
        <Tooltip label="Current outstanding principal balance, anchored to Buxfer's most recent cached balance (post-statement activity bridges from the latest statement)." multiline w={280} withArrow>
          <div><span>Balance</span><b>{formatAsCurrency(balance, "K")}</b></div>
        </Tooltip>
        <Tooltip label="Total cash paid into the mortgage to date — principal + interest + escrow combined." multiline w={260} withArrow>
          <div><span>Paid</span><b>{formatAsCurrency(totalPaid, "K")}</b></div>
        </Tooltip>
        <Tooltip label="Total principal paid down so far — equity you've built in the home through loan paydown alone (excludes appreciation)." multiline w={280} withArrow>
          <div><span>Principal</span><b>{formatAsCurrency(totalPrincipalPaid, "K")}</b></div>
        </Tooltip>
        <Tooltip label="Total interest paid to the lender so far — the cost of borrowing, gone forever." multiline w={260} withArrow>
          <div><span>Interest</span><b style={{ color: '#ff9800' }}>{formatAsCurrency(totalInterestPaid, "K")}</b></div>
        </Tooltip>
        <Tooltip label="Average monthly principal paydown across the loan's lifetime so far — your equity-building rate per month." multiline w={280} withArrow>
          <div><span>Equity/mo</span><b>{formatAsCurrency(monthlyEquity, "K")}</b></div>
        </Tooltip>

        {/* Row 2: companion ratios/totals — Total Cost / Total % / Principal % / Int. Ratio / Rent-per-month */}
        <Tooltip label="Original principal + total interest projected over the life of the loan at the historical payment pace. Your eventual all-in cost if you keep paying as you have been." multiline w={300} withArrow>
          <div><span>Total Cost</span><b style={{ color: '#888' }}>{formatAsCurrency(totalExpectedCost, "K")}</b></div>
        </Tooltip>
        <Tooltip label="Share of the projected lifetime cost (principal + interest) that's been paid so far. Compare with Principal % — gap between them is the interest you've front-loaded." multiline w={320} withArrow>
          <div><span>Total %</span><b>{totalPctOff.toFixed(1)}%</b></div>
        </Tooltip>
        <Tooltip label="Share of the original principal that's been paid off. Hits 100% when the loan is paid in full." multiline w={280} withArrow>
          <div><span>Principal %</span><b>{principalPctOff.toFixed(1)}%</b></div>
        </Tooltip>
        <Tooltip label="Share of every dollar paid that went to interest (vs principal). Lower is better — extra principal payments push this number down." multiline w={300} withArrow>
          <div><span>Int. Ratio</span><b>{totalPaid > 0 ? `${(totalInterestPaid / totalPaid * 100).toFixed(1)}%` : '0%'}</b></div>
        </Tooltip>
        <Tooltip label="Average monthly interest paid across the loan's lifetime so far — the rough equivalent of monthly rent (the price of borrowing the money)." multiline w={300} withArrow>
          <div><span>Rent/mo</span><b>{formatAsCurrency(monthlyRent, "K")}</b></div>
        </Tooltip>
      </div>
      <div style={chartContainerStyle}>
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