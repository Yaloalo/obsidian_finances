# Obsidian Finances Pipeline (`obsidian-finances`)

Monthly Cashflow & Expense Pipeline plugin for Obsidian using Markdown files (`finances/YYYY/MM/`) as the database backend.

## Features

- **4-Stage Cashflow Pipeline**:
  1. **Income**
  2. **Fixed Spending** (with `½` roommate 50/50 rent split calculator)
  3. **Semi-Fixed Outgoing** (solid category color wheels with always-red outer border showing the spent fraction)
  4. **What Is Left** (supports direct uncategorized minus expenses)
- **3 View Modes**:
  - `⚡ Quick & Left` (Default on Mobile): Instant 1-tap category pills + quick expense entry + What Is Left for Semi-Fixed Outgoings.
  - `🎡 All Wheels ↓`: Vertical single-column stack of all pipeline & category color wheels below each other.
  - `🖥 Pipeline` (Default on Desktop): Full 4-column side-by-side cashflow pipeline.
- **Markdown Database Backend (`finances/YYYY/MM/`)**:
  - Stores monthly state and human-readable Markdown tables in `finances/YYYY/MM/YYYY-MM-Overview.md` and `YYYY-MM-Expenses.md`.
  - Automatically carries over recurring Income, Fixed Outgoings, and Semi-Fixed Category budgets when navigating to a new month.

## Development

```bash
npm install
npm run build
```
