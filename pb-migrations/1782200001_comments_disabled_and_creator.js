/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
// Two corrections to calc_comments' access rules — the same pair text_comments
// needed, for the same reasons. See text's 1782200000. (This file is
// 1782200001 because materialized migration filenames must be globally unique
// across packages; it originally shared text's timestamp and broke the
// generator. Idempotent, so DBs that applied it under the old name are fine.)
//
// 1. EXCLUDE SUSPENDED USERS. No calc_comments rule carries
//    `@request.auth.disabled != true`, and the Go gate never runs for
//    /api/collections/*_comments, so a disabled user with surviving
//    drive_shares rows could still list, view and create comments over REST.
//
// 2. HONOUR THE DOCUMENT'S CREATOR. 1719000000's comment claims these rules
//    "mirror drive_items access", but drive_items reads
//    `created_by ?= @request.auth.id || <has-share>` and these carried only
//    the share half — so a creator with no share row of their own saw zero
//    comments on a document they could otherwise edit. The claim is now true.
//
// The share predicate stays membership-only, with no role test, so a
// commentor keeps the ability to comment — the whole point of that role.
migrate(
    app => {
        const enabled = '@request.auth.disabled != true'
        const authed = '@request.auth.id != ""'
        const isDocCreator = 'drive_item.created_by ?= @request.auth.id'
        const hasShare = 'drive_item.drive_shares_via_item.user ?= @request.auth.id'
        const reachesDoc = `(${isDocCreator} || ${hasShare})`
        const isAuthor = 'author = @request.auth.id'

        const col = app.findCollectionByNameOrId('calc_comments')
        col.listRule = `${authed} && ${enabled} && ${reachesDoc}`
        col.viewRule = `${authed} && ${enabled} && ${reachesDoc}`
        col.createRule = `${authed} && ${enabled} && ${reachesDoc} && ${isAuthor}`
        col.updateRule = `${authed} && ${enabled} && ${isAuthor}`
        col.deleteRule = `${authed} && ${enabled} && ${isAuthor}`
        app.save(col)
    },
    app => {
        // Restore 1719000000's rules verbatim, both gaps included.
        const col = app.findCollectionByNameOrId('calc_comments')
        col.listRule =
            '@request.auth.id != "" && drive_item.drive_shares_via_item.user ?= @request.auth.id'
        col.viewRule =
            '@request.auth.id != "" && drive_item.drive_shares_via_item.user ?= @request.auth.id'
        col.createRule =
            '@request.auth.id != "" && drive_item.drive_shares_via_item.user ?= @request.auth.id && author = @request.auth.id'
        col.updateRule = '@request.auth.id != "" && author = @request.auth.id'
        col.deleteRule = '@request.auth.id != "" && author = @request.auth.id'
        app.save(col)
    }
)
