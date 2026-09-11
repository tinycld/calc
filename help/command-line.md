---
title: Calc from the command line
summary: Read, answer, and resolve spreadsheet comments from a terminal with the tinycld CLI.
tags: [cli, terminal, automation, comments, review]
order: 190
---

The `tinycld` command line tool includes a `calc` command group when the Calc
package is installed. To download the tool and log in, see
[Command line tool](help://core:command-line). Everything below assumes you
are logged in.

## What the command group covers

Comments, and only comments. Your workbooks are Drive files, so everything
else you might want from a terminal is already a `drive` command:

```
tinycld drive put budget.xlsx /         # upload a workbook
tinycld drive ls /                      # list your files
tinycld drive get /Budget.xlsx .        # download one
tinycld drive rm /Budget.xlsx           # delete one
```

Cell contents and formulas are edited in the app, not written from a shell.

## Reading comments

```
tinycld calc comments /Budget.xlsx          # open threads
tinycld calc comments /Budget.xlsx --all    # include resolved
```

`<path>` is a Drive path or `id:<record id>`, the same references `tinycld
drive` accepts.

Each comment shows the cell it is attached to in ordinary A1 notation, so the
output lines up with what you see in the app. Resolved threads are hidden by
default so what is left is what still needs an answer; the count of hidden
comments is reported so nothing disappears silently. Replies are shown
indented under the comment they answer.

## Adding and answering

```
tinycld calc comments /Budget.xlsx --cell B7 --sheet sheet1 --add "This looks off"
tinycld calc comments /Budget.xlsx --cell C10 --sheet sheet2 --add "Check the formula"
tinycld calc comments /Budget.xlsx --add "Fixed" --reply-to cmt123
```

A new comment anchors to one cell on one sheet, so `--add` needs both
`--cell` and `--sheet`; the command refuses to post without them.

`--cell` takes A1 notation and is case-insensitive, so `b7` and `B7` are the
same cell. `--sheet` takes the sheet's **id**, not the name shown on its tab.
Ids are `sheet1`, `sheet2`, … in the order the sheets were created, so the
first sheet of a workbook is always `sheet1`. A listing (`--json`) shows each
comment's `sheet_id`, which is the quickest way to find the id for a sheet
that already has comments.

Replies are one level deep: replying to a reply attaches your comment to the
same thread. A reply inherits its thread's cell and sheet, so `--cell` and
`--sheet` are not accepted with `--reply-to`.

## Resolving

```
tinycld calc comments /Budget.xlsx --resolve cmt123
tinycld calc comments /Budget.xlsx --reopen cmt123
```

Resolving applies to the whole thread, so it does not matter whether you name
the original comment or one of its replies.

See [Comments on cells](help://calc:comments) for how the same threads behave
in the app.

## Scripting

Every command accepts `--json` for stable, machine-readable output. The stored
row and column come through as numbers even though the table renders them as
A1. Both are **one-based**, the same way the grid labels them: column A is
`1`, column B is `2`, and row 1 is `1`. So a script can filter on a range:

```
tinycld calc comments /Budget.xlsx --json | jq '.[].body'
tinycld calc comments /Budget.xlsx --json | jq '[.[] | select(.col == 2)]'   # column B
```
