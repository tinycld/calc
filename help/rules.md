---
title: Spreadsheet rules
summary: React when someone comments on a spreadsheet, and add rows to a spreadsheet from a rule
tags: [rules, automation, comments, workflow]
order: 100
---

Spreadsheets take part in [automation rules](help://core:rules) through
comments, and through an action that adds a row to a spreadsheet.

## When a comment is added

The trigger **A comment is added to a spreadsheet** fires whenever anyone
comments on a workbook you can see — not only when *you* comment. Everyone with
access can build a rule on it, so the workbook's owner hears about a
colleague's comment.

Because sheet comments are attached to a cell, you can filter on the sheet, the
row and the column as well as the comment text and who wrote it. That makes it
possible to watch one region of a model — the assumptions block, say — and
ignore the rest.

## Recipes

**Watch the assumptions.** When a comment is added, if the sheet is `Inputs`,
send yourself a notification. Comments elsewhere in the workbook stay quiet.

**Track a specific model.** When a comment is added, if the spreadsheet is a
particular one, notify yourself — useful during a review cycle.

## Mentions are separate

To hear only when someone addresses *you*, use drive's **I'm mentioned in a
comment** trigger — it covers @-mentions in spreadsheets, documents and files
alike. This trigger is broader: every comment on every workbook you can reach.

## Add a row to a spreadsheet

The action **Add a row to a spreadsheet** writes one row for each time the
rule runs. Pick the spreadsheet, or type a name and select **New
spreadsheet** to make one. **Sheet** names the sheet; leave it empty for the
first sheet.

Each value goes under the header in row 1 with the same text. Case and
spaces at the ends do not matter. A value with no matching header gets a new
column at the end, so an empty sheet gets a header row on the first run. You
can move the columns around later; the next row still finds them by their
header.

The rule's owner must be able to edit the spreadsheet. When it is open, the
people editing see the row arrive. Answers that start with `=` are written as
text, not as formulas.

## What rules can't do yet

- **Reacting to cell changes.** Rules see comments, not edits. There's no "when
  this total goes over 1000" trigger — cell values aren't records a rule can
  watch.
- **Timing.** There's no way to say "if nobody has replied in two days" — rules
  react to things happening, not to time passing.
- **Replying.** A rule can notice a comment but cannot post one back.
