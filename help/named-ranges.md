---
title: Named ranges
summary: Give meaningful names to cells, ranges, and constants
tags: [formula, named-range, name-manager]
order: 35
---

## What is a named range?

A *named range* is a label you attach to a cell, a range, or a constant value. Once defined, you can use the name in any formula instead of the underlying reference:

```
=Revenue - COGS          (instead of =Sheet1!A2:A10 - Sheet1!B2:B10)
=Subtotal * TaxRate      (instead of =D5 * 0.085)
```

This makes formulas easier to read, easier to audit, and safer to copy.

## To define a name

1. Select the cell or range you want to label.
2. Right-click → **Define name from selection…** (or **Data → Named ranges… → Add name**).
3. Type a name (e.g. `Revenue`) and click **Create**.

You can also type a new name directly into the **Name box** (left of the formula bar) while a range is selected and press **Enter** — Calc opens the manager pre-filled with the selection.

## To use a name in a formula

Type it like a function or cell reference:

```
=SUM(Revenue)
=AVERAGE(Q1Sales)
=100 * TaxRate
```

Calc's autocomplete suggests defined names alongside built-in functions while you type — names are labeled `Name` in the dropdown.

## Scoping

Each name belongs to either the **workbook** (visible everywhere) or one **sheet** (only resolvable in formulas on that sheet). The scope picker in the manager controls this. A sheet-scoped name with the same identifier as a workbook-global one *shadows* the global within that sheet — same rule as Excel and Sheets.

## Naming rules

- Must start with a letter or underscore.
- Can contain letters, digits, underscores, and periods.
- Cannot look like a cell reference (`Q4`, `YEAR2023`, `R4C5`).
- Must be unique within its scope (case-insensitive).

## Editing and deleting

Open **Data → Named ranges…** to see every defined name with its scope, expression, and current value. Use **Edit** to change any field or **Delete** to remove it.

Cells that depend on a deleted name show `#NAME?` — restore by Ctrl/⌘+Z or redefine the name.

## When sheets are renamed or deleted

- **Rename a sheet** → references inside named-range expressions are rewritten automatically.
- **Delete a sheet** → names scoped *to that sheet* are removed. Workbook-global names that reference the deleted sheet stay (cells show `#REF!`) so you can edit them to recover.

## Limits

- Named ranges use absolute references (`$A$1:$A$10`). Relative-ref names aren't supported — this matches Excel and Sheets.
- A name's expression can be a constant, a single cell, a range, or any formula valid in HyperFormula. Cross-sheet ranges work; multi-sheet (3D) ranges don't.
