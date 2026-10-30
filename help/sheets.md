---
title: Sheets
summary: Adding, renaming, coloring, hiding, freezing sheets, and showing gridlines
tags: [sheets, tabs, freeze, hidden, gridlines]
order: 60
---

## Adding a sheet

Click the **+** button at the left end of the sheet tab strip at the bottom of the workbook. A new blank sheet is appended.

## Renaming a sheet

Double-click the sheet tab, or right-click it and choose **Rename**. Type the new name and press **Enter**. Sheet names must be unique within the workbook.

## Reordering sheets

Drag a sheet tab left or right to change its position.

## Setting a tab color

Right-click a sheet tab and choose **Tab color**. Pick from the palette or type a hex value. The color appears as a thin band under the tab name and is saved into the `.xlsx` file.

## Hiding a sheet

Right-click a sheet tab and choose **Hide sheet**. The tab is removed from the strip but the sheet still exists — its data, formulas, and references from other sheets continue to work.

To show it again, open **View → Hidden sheets** and pick the sheet from the submenu. It reappears at its original position.

## Deleting a sheet

Right-click a sheet tab and choose **Delete sheet**. This permanently removes the sheet and its cells. Formulas elsewhere that reference it become `#REF!` errors. Undo (⌘Z) restores it.

## Freezing rows and columns

Freeze panes keep the top rows or left columns visible while scrolling the rest of the sheet. Use **View → Freeze**:

- **1 row** / **2 rows** — pin the top rows.
- **1 column** / **2 columns** — pin the left columns.
- **Up to selection** — pin everything above and to the left of the current selection.
- **Unfreeze** — clear all frozen panes.

## Showing or hiding gridlines

To hide the lines between cells on the current sheet, choose **View → Show → Gridlines**. Do the same again to show them. Each sheet keeps its own setting. A sheet imported from an .xlsx file with gridlines turned off opens with them hidden, and the setting is saved back into the downloaded .xlsx file. Borders that you add to cells still show when gridlines are hidden. Undo (⌘Z) reverses the change.

## See also

- [Editing cells](help://calc:editing)
- [Rows and columns](help://calc:rows-and-columns)
