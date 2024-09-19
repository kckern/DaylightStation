import moment from "moment";
import React, { useState } from "react";

const formatAsCurrency = (amount) => `$${amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

export function Drawer({ setDrawerContent, header, transactions }) {
    const [sortConfig, setSortConfig] = useState({ key: "date", direction: 'descending' });

    const handleSorting = (key) => {
        let direction = 'ascending';
        if (sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
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
        if (a[sortConfig.key] < b[sortConfig.key]) return sortConfig.direction === 'ascending' ? -1 : 1;
        if (a[sortConfig.key] > b[sortConfig.key]) return sortConfig.direction === 'ascending' ? 1 : -1;
        return 0;
    });

    const handleRowClick = (transaction) => {
        window.open(`https://www.buxfer.com/transactions?tids=${transaction.id}`, '_blank');
    };

    const summary = transactions.reduce((acc, { expenseAmount }) => {
        acc.spent += expenseAmount > 0 ? expenseAmount : 0;
        acc.gained += expenseAmount < 0 ? -expenseAmount : 0;
        return acc;
    }, { spent: 0, gained: 0, net: 0 });

    summary.netspend = summary.spent - summary.gained;

    return (
        <div className="budget-drawer">
            <div className="budget-drawer-header">
                <h3>
                    <a target="_blank" href={`https://www.buxfer.com/transactions?tids=${transactions.map(tx => tx.id).join(",")}`}>
                        {transactions.length} Transactions
                    </a>
                </h3>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Spent: {formatAsCurrency(summary.spent)}</span>
                <span>Credits: {formatAsCurrency(summary.gained)}</span>
                <span>Net Spend: {formatAsCurrency(summary.netspend)}</span>
            </div>
            <div className="budget-drawer-content">
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
                      <th onClick={() => handleSorting('description')}>
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
                            return sortedTransactions.map(transaction => {
                                const currentDateFormatted = moment(transaction.date).format("MMM Do");
                                const displayDate = currentDateFormatted === prevDate ? "" : currentDateFormatted;
                                prevDate = currentDateFormatted;
                                const incomeTypes = ['income', 'investment sale', 'refund', 'dividend', 'interest'];
                                const isIncome = incomeTypes.includes(transaction.transactionType);
                                const amountLabel = 
                                  !isIncome 
                                  ? `$${transaction.amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}` 
                                  : `+$${Math.abs(transaction.amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
                                const rowClassName = !isIncome ? "expense" : "income";
                                return (
                                    <tr key={transaction.id} className={rowClassName} onClick={() => handleRowClick(transaction)}>
                                        <td className="date-col">{displayDate}</td>
                                        <td className="account-name-col">{transaction.accountName}</td>
                                        <td className="amount-col">{amountLabel}</td>
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