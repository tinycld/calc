---
title: Formatting cells
summary: Number formats, fonts, colors, borders, and alignment
tags: [format, style, number-format, borders, color, font, alignment]
order: 40
---

## Text formatting

Select cells and apply formatting from the toolbar or the **Format → Text** menu. (On a narrow window, toolbar controls that don't fit fold into a **More** menu at the right end of the toolbar.)

- **Bold** — ⌘B
- **Italic** — ⌘I
- **Underline** — ⌘U
- **Strikethrough** — ⌘⇧X

Each toggle shows a check when active for the current selection.

## Font and font size

To change the font, select cells and pick a font from the **Font** menu in the toolbar. Each name is shown in its own font. A cell with no font set uses the workbook's default font, and the **Font** menu and size control show that font. An .xlsx file brings its own default font (for example, Arial 10 from Google Sheets or Calibri 11 from Excel). A workbook without one shows **Default**.

Use the font size control in the toolbar, or **Format → Font size**. Sizes are in points, as in Excel and Google Sheets.

A font that your device does not have is drawn in a similar font (for example, Calibri falls back to Carlito or the system sans-serif font).

## Text and fill color

The toolbar has a **text color** picker (the **A** with a colored underline) and a **fill color** picker (the paint-bucket). Both open a color grid plus a custom color input. Recent colors are remembered.

## Alignment

Set horizontal alignment from the toolbar or **Format → Alignment**: **Left**, **Center**, **Right**. A cell with no alignment set uses the spreadsheet default: text on the left, numbers and dates on the right, and TRUE/FALSE in the center.

To set vertical alignment, use the **Vertical align** menu in the toolbar: **Align top**, **Align middle**, or **Align bottom**. Cells align to the bottom by default.

## Borders

Open the borders picker in the toolbar to apply border presets — outline, inside, top/bottom/left/right, all, or none. Border style and color can be adjusted before applying.

## Number formats

**Format → Number** has presets for plain number, currency, percent, date, time, scientific, and more. The toolbar also has quick controls:

- **Currency** — formats the selection as currency.
- **Percent** — formats as a percentage (multiplies the display by 100).
- **Decimal stepper** — increase or decrease the number of displayed decimal places.

Number formats are display-only — the underlying value never changes.

## Merging cells

Select a rectangular range and open **Format → Merge cells**. The submenu offers:

- **Merge all** — combine the whole range into a single cell.
- **Merge horizontally** — merge each row of the range separately.
- **Merge vertically** — merge each column of the range separately.
- **Unmerge** — split the selected merged cells back into individual cells.

Only the top-left value of each merge is kept; other values in the merged area are discarded.

## Conditional formatting

Apply colors and styles based on each cell's value — see [Conditional formatting](help://calc:conditional-formatting).

## Clearing formatting

To strip all formatting from the selection but keep the values, press **⌘\\** or choose **Format → Clear formatting**.

## Links

To link a cell, select it and click **Insert link** in the toolbar. Type the address and press **Apply**. An address without `https://` gets it added. If the cell is empty, the address becomes its text.

When you select a linked cell, a small box under it shows the address. Click the address to open it, the pencil to change it, or the unlink icon to remove it. To remove a link from the dialog, clear the address and press **Apply**.

Links in an imported .xlsx file show as links, and links are saved into the downloaded .xlsx file.

## See also

- [Conditional formatting](help://calc:conditional-formatting)
- [Editing cells](help://calc:editing)
