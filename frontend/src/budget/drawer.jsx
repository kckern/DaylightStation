import moment from "moment";
import React, { useEffect, useState } from "react";

export function Drawer({ setDrawerContent, header, transactions }) {

    console.log(transactions);
    //[ { "id": 206558574, "description": "US Treasury Services", "date": "2024-04-15", "type": "expense", "transactionType": "expense", "amount": 2.2, "expenseAmount": 2.2, "accountId": 732539, "accountName": "Fidelity", "tags": "Utilities", "tagNames": [ "Utilities" ], "status": "cleared", "isFutureDated": false, "isPending": false }, { "id": 206558568, "description": "Amazon Web Services", "date": "2024-04-15", "type": "expense", "transactionType": "expense", "amount": 268.72, "expenseAmount": 268.72, "accountId": 732539, "accountName": "Fidelity", "tags": "Utilities", "tagNames": [ "Utilities" ], "status": "cleared", "isFutureDated": false, "isPending": false }, { "id": 206558574, "description": "US Treasury Services", "date": "2024-04-15", "type": "expense", "transactionType": "expense", "amount": 2.2, "expenseAmount": 2.2, "accountId": 732539, "accountName": "Fidelity", "tags": "Utilities", "tagNames": [ "Utilities" ], "status": "cleared", "isFutureDated": false, "isPending": false }, { "id": 206558568, "description": "Amazon Web Services", "date": "2024-04-15", "type": "expense", "transactionType": "expense", "amount": 268.72, "expenseAmount": 268.72, "accountId": 732539, "accountName": "Fidelity", "tags": "Utilities", "tagNames": [ "Utilities" ], "status": "cleared", "isFutureDated": false, "isPending": false } ]

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
            
                  return (
                    <tr key={transaction.id}>
                      <td className="date-col">{displayDate}</td>
                      <td className="account-name-col">{transaction.accountName}</td>
                      <td className="amount-col">
                        <a className="transaction-link" target="_blank" rel="noopener noreferrer" href={`https://www.buxfer.com/transactions?tids=${transaction.id}`}>
                          {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(transaction.amount)}
                        </a>
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