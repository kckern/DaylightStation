## Harvest Paychecks

1. Find the trinet Auth, update config.secret.yml

node backend/jobs/finance/payroll.mjs


# check budget template

open data/budget/budget.yml

## Harvest and Process Transactions and build budget


node backend/jobs/finance/budget.mjs



## find result in 

open data/budget/finances.yml

## raw transactions are at

open data/budget/transactions.yml