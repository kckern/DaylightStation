import moment from "moment";
import React, { useEffect, useState } from "react";


const formatAsCurrency = (amount) => {
  return `$${amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
};

export function Drawer({ setDrawerContent, header, transactions }) {

    const handleRowClick = (transaction) => {
      // Open the transaction in a new tab, see a tag
      window.open(`https://www.buxfer.com/transactions?tids=${transaction.id}`, '_blank');
    };


    const summary = transactions.reduce((acc, transaction) => {
      const { expenseAmount } = transaction;
      acc.spent += expenseAmount > 0 ? expenseAmount : 0;
      acc.gained += expenseAmount < 0 ? -expenseAmount : 0;
      return acc; // Ensure the accumulator is returned
    }, { spent: 0, gained: 0, net: 0 });
    
    summary.netspend = summary.spent - summary.gained ;

    return (
        <div className="budget-drawer">
            <div className="budget-drawer-header">
                <h2>{header}</h2>
                <h3>
                    <a target="_blank" href={`https://www.buxfer.com/transactions?tids=${transactions.map(transaction => transaction.id).join(",")}`}>
                    {transactions.length} Transactions
                    </a>
                </h3>
                <button onClick={() => setDrawerContent(null)}>Close</button>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>
                Spent: {formatAsCurrency(summary.spent)}
              </span>
              <span>
                Credits: {formatAsCurrency(summary.gained)}
              </span>
              <span>
                Net Spend: {formatAsCurrency(summary.netspend)}
              </span>
            </div>
            <div className="budget-drawer-content">
                <table className="transactions-table">
                <thead>
                    <tr>
                    <th>Date</th>
                    <th>Account</th>
                    <th>Amount</th>
                    <th>Description</th>
                    <th>Tags</th>
                    </tr>
                </thead>
                <tbody>
                  {(() => {
                    let prevDate = null;
                    return transactions.map(transaction => {
                      const currentDateFormatted = moment(transaction.date).format("MMM Do");
                      const displayDate = currentDateFormatted === prevDate ? "" : currentDateFormatted;
                      prevDate = currentDateFormatted; // Update prevDate for the next iteration
                      const transactionType = transaction.transactionType;

                      const incomeTypes = ['income', 'investment sale','refund','dividend','interest'];
                      const isIncome = incomeTypes.includes(transactionType);

                      const amountLabel = !isIncome 
                        ? `$${transaction.amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}` 
                        : `+$${Math.abs(transaction.amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
                      const rowClassName = !isIncome ? "expense" : "income";
                      return (
                        <tr key={transaction.id} className={rowClassName} onClick={() => handleRowClick(transaction)}>
                          <td className="date-col">{displayDate}</td>
                          <td className="account-name-col">{transaction.accountName}</td>
                          <td className="amount-col">
                              {amountLabel}
                          </td>
                          <td className="description-col">{transaction.description}</td>
                          <td className="tags-col">{transaction.tagNames.join(", ")}</td>
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