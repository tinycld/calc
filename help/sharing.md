---
title: Sharing a spreadsheet
summary: Invite collaborators or hand out a link from inside the editor
tags: [share, permissions, collaboration, link]
order: 70
---

## Opening the share dialog

With a spreadsheet open, choose **File → Share**. The same dialog you'd see in Drive opens — you don't have to leave the editor to invite people or generate a link.

## Adding people from your org

Type a name or email in the **Add people** input. Matches from your org show up as you type. For each person you add, pick a role:

- **Viewer** — can open the spreadsheet and read it. Cannot edit, rename, move, or re-share.
- **Editor** — can edit cells, formulas, and structure, rename, move, and re-share.

Click **Send**. The spreadsheet appears in their **Shared with me** section in Drive within seconds.

## Generating a public link

To share with someone outside your org — or anyone without an account — use **Get link**. The dialog generates a tokenized URL of the form `https://<your-instance>/p/drive/share/<token>` that opens the spreadsheet directly, no sign-in required. You choose what the link grants:

- **Viewer** — read-only, no comments, no sign-in.
- **Commentor** — read-only, but the visitor can leave comments on cells after a one-time email verification (OTP).
- **Editor** — the visitor can edit cells after OTP verification. Their changes land in the same spreadsheet everyone else sees.

Copy the URL and send it however you like. You can revoke or change the role any time from the same dialog.

## Changing or removing access

Each collaborator is listed below the input with their current role. Switch their role with the dropdown, or remove their access — the change takes effect immediately and the spreadsheet disappears from their **Shared with me**.

## See also

- [Sharing files in Drive](help://drive:sharing)
- [Public share links](help://drive:public-links)
- [Collaborating in calc](help://calc:collaboration)
