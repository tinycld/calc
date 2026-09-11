---
title: Comments on cells
summary: Threaded discussions anchored to specific cells
tags: [comments, discussion, collaboration]
order: 120
---

## To add a comment

Right-click a cell (long-press on iPad) and choose **Comment**, or use the **Insert → Comment** option from the context menu. A small popover opens — type your message and press **Comment** to post.

Cells with comments are marked with a small triangle in the top-right corner.

## To view and reply

Click the triangle (or click the cell and choose **View comment** from the context menu) to open the thread. The popover shows the original comment, every reply, and a box to add your own reply. Comments are threaded — replies stay grouped under the root.

To see every thread in the workbook in one place, choose **View → Show comments**. A drawer lists the threads across all sheets; pick one to jump to its cell.

## Who can see comments

Comments follow the workbook's sharing. Everyone the workbook is shared with can read its threads and post their own — including people with the *commentor* role, who can't edit cells. The workbook's creator can always see its comments, whether or not they hold a share of their own. A suspended account loses access to comments along with everything else, even if its shares were never removed.

## Editing and deleting

Hover (or tap) your own comment and use the **⋯** menu:

- **Edit** — change the text.
- **Delete** — remove the comment. If you delete the root, the whole thread is removed.

You can only edit and delete your own comments. Others see your changes in real time.

## Resolving a thread

Click **Resolve** on the root comment to mark the thread as done. Resolved threads are hidden from the grid by default. Re-open the cell and choose **Show resolved comments** to bring them back.

## When you export to xlsx

Comments are written into the `.xlsx` file as classic cell notes (one note per thread, concatenating the messages). External apps see them, but the threading structure is flattened — a round-trip through Excel will collapse a thread into a single note.

## See also

- [Collaboration](help://calc:collaboration)
- [Editing cells](help://calc:editing)
