---
title: Copy, cut, and paste
summary: Moving and duplicating cells, including paste-special variants
tags: [clipboard, copy, paste, cut]
order: 70
---

## Basic copy / cut / paste

- **Copy** — ⌘C (or Edit → Copy).
- **Cut** — ⌘X (or Edit → Cut).
- **Paste** — ⌘V (or Edit → Paste).

Copy includes both the values and the formatting. Cut moves the cells — the source range is cleared once you paste.

After a cut, the source range gets a **marching-ants** dashed border that animates until you paste or press **Esc** to cancel.

## Paste special

When you only want part of what's on the clipboard, use a paste-special variant. Two are in **Edit → Paste special**; all four are in the cell's right-click menu (long-press on iPad) under **Paste special**, and every one has a shortcut:

- **Values only** (⌘⌥V) — paste just the computed values; formulas and formatting are dropped.
- **Format only** (⌘⇧V) — paste fonts, fills, borders, and number formats; cell values are untouched.
- **Formulas only** (⌘⌥⇧V, right-click menu) — paste the formula text; formatting is dropped.
- **Transposed** (⌘⌥T, right-click menu) — swap rows and columns. A 3-row × 2-column range becomes 2-row × 3-column.

## Format Painter toolbar button

The **Format painter** button in the toolbar (paintbrush icon, next to Undo and Redo; on a narrow window it may sit under the toolbar's **More** menu) copies the formatting of the selected cell and lets you apply it to another range without affecting values.

1. Select the cell whose formatting you want to copy.
2. Click the paintbrush button — the cursor changes to a crosshair-paintbrush to indicate paint mode.
3. Click a cell or drag across a range to stamp the formatting onto it. Paint mode exits automatically after one application.

This is equivalent to **Paste special → Format only**, but without going through the clipboard — useful when you want to reuse formatting from a cell without overwriting what is currently on the clipboard.

## Pasting from outside Calc

Calc accepts TSV (tab-separated) and HTML clipboard content from other apps — spreadsheets, web tables, plain text files. Each tab becomes a column break and each newline becomes a row break.

## Pasting CSV

Pasting a CSV-shaped block opens a small import dialog so you can pick the delimiter (comma, tab, semicolon, pipe) before the data lands in the grid.

## See also

- [CSV import and export](help://calc:csv-import-export)
- [Editing cells](help://calc:editing)
- [Keyboard shortcuts](help://calc:keyboard-shortcuts)
