# Support tickets — improvement plan

Snapshot of where the feature stands today and a menu of concrete improvements grouped by the four areas you picked. Each item lists what it is, why it's worth doing, the rough size, and the files touched. Pick which ones you want me to ship and I'll implement those only.

## What already works (so we don't redo it)

CRUD with RBAC (admin / operator / tenant), inline staff controls (status / priority / assignee), per-message attachments with download, IMAP poll → ticket / message threading, mail templates for created / reply / assigned / new-admin, real-time WS events (`ticket_created`, `ticket_updated`, `ticket_message_added`), filtering by status / priority / assignee / tenant / source, dashboard widgets.

---

## A. Bugs & correctness (fix these regardless of what else we do)

### A1. Wrong priority sent in `ticket_assigned` mail — **bug, S**
`api/src/tickets/routes.ts:271` uses `data.priority ?? 'normal'` for the assignment notification, but `data.priority` is only set when the *current* PUT is changing the priority. Result: most assignment emails say priority "normal" regardless of the ticket's real priority. Fix: read `ticket.priority` (already SELECTed near line 240–242).

### A2. Tenant replies don't notify staff — **gap, S**
`POST /tickets/:id/messages` only sends mail when a *staff* member replies (`isStaff(req.user.role)`). When a tenant adds information to their own ticket, no one is notified. Effect: tickets sit unnoticed unless someone happens to look at the list. Fix: when the author is the requester (not staff), queue mail to the assignee (or all admins if unassigned).

### A3. PUT /tickets is not audit-logged — **gap, S**
Every other entity in the app writes to `audit_logs`. Status / priority / assignee changes on a ticket don't. Fix: call `writeAuditLog` after the UPDATE with old/new values. Same for create + delete (delete doesn't exist yet — out of scope unless we add it).

### A4. IMAP loses messages on transient failures — **bug, S**
`runImapSession` deletes the IMAP message immediately after `handleParsedEmail`. If `handleParsedEmail` succeeded but the DB transaction raised after the insert (e.g. broadcast hub down), the message is gone but the ticket may be inconsistent. Worse, there's an existing `pop3_seen_uids` table that is **completely unused** in the IMAP path. Fix: track processed `Message-ID` (already used for dedup) — but also catch errors *around* delete and skip-with-log, so a bad message doesn't poison the inbox. Optionally repurpose `pop3_seen_uids` → `imap_seen_message_ids`.

### A5. IMAP doesn't strip quoted history — **annoyance, M**
Every email reply concatenates the entire prior conversation as the new message body. After a few back-and-forths the thread becomes unreadable. Fix: detect and strip the common quote markers (`On <date>, <name> wrote:`, `-- ` signature delimiter, leading `>` lines) before insertion. Keep the original somewhere for audit (e.g. a `raw_body` column or a small attachment).

### A6. IMAP doesn't import attachments — **gap, M**
Inbound emails with PDFs / screenshots get their bodies stored but the attachments are lost. Fix: iterate `parsed.attachments`, save them to `UPLOAD_DIR/tickets/<id>/`, and insert `ticket_attachments` rows tied to the inbound message.

### A7. Dashboard fetches 200 tickets to count priorities — **perf, S**
`DashboardPage.tsx:68–74` pulls up to 200 open tickets just to do `reduce` on priority client-side. Fix: add a tiny `/tickets/stats` endpoint (or extend `/tickets` to support `aggregate=priority`) returning `{ open, by_priority: {...} }` from one SQL query.

### A8. `is_internal` typed as `number` — **type smell, S**
`web/src/api/client.ts:514` types it as `number` but the UI treats it as boolean. Mariadb's `TINYINT(1)` returns `0|1`. Trivial: keep it numeric on the wire but add a `Boolean(msg.is_internal)` narrowing where rendered, or change the type to `0 | 1`.

---

## B. Workflow features

### B1. System messages on status / priority / assignee changes — **M**
When a staff member resolves or reassigns a ticket, no record appears in the thread. Add an "event" message kind: `kind ENUM('reply','internal','event')` (or repurpose `is_internal` + a new `event_type` column). The thread shows entries like *"Alice changed status from open → in_progress"*. Visible to requester for status/priority, hidden for internal-only events. Pairs naturally with **A3** (audit logging).

### B2. Tags / labels on tickets — **M**
A `ticket_labels` table mapping ticket → label (the `labels` table already exists in the schema, used elsewhere). Filter tickets by label. Useful to mark categories like "billing", "DNSSEC", "DNS-leak", "duplicate". Touches: migration, GET/POST `/tickets/:id/labels`, filter in `GET /tickets`, badge UI on list + detail.

### B3. Canned responses — **M**
A staff user can pick from a small library of saved replies. Implementation: `canned_responses (id, title, body, locale, scope)` where scope is `personal` / `team`. UI: dropdown above reply textarea inserts the body. Touches: migration, two CRUD routes, dropdown in `TicketDetailPage`.

### B4. First-response & resolution time (SLA-light) — **M**
Add `first_response_at` and `resolved_at` columns to `support_tickets`. Set `first_response_at` on the first staff reply. Set `resolved_at` when status moves to `closed`. Display elapsed time on the list. No SLA breach alerts in v1 — just visibility. Pairs with **B1**.

### B5. Auto-close stale "waiting" tickets — **S**
Worker job that, daily, sets tickets stuck in `waiting` for >7 days to `closed` and posts a system message. Scope-bounded by reusing the existing worker poll loop.

### B6. Merge / mark-as-duplicate — **M**
Staff action on a ticket: "Mark as duplicate of #N". Closes this ticket, moves all messages + attachments under the target, posts a system message on both. New table `ticket_links (id, src_id, dst_id, kind ENUM('duplicate','related'))` — or just denormalize via a `merged_into` column on `support_tickets`. The simpler `merged_into` column is recommended.

### B7. Bulk actions on list — **M**
Checkboxes on each row, then "Close selected", "Assign to…", "Add label…". Reuse the existing bulk-job infrastructure pattern for the actual mutations? Probably overkill — for tickets, an immediate batch SQL update is fine since rows are small and there's no rendering pipeline.

---

## C. Search & filtering

### C1. Full-text search across message bodies — **M, recommended**
Today `?search=…` only LIKE-matches subject / requester email / requester name. Often the user remembers a phrase from the body. Fix: add a `FULLTEXT(body)` index to `ticket_messages`, then in the LIST query, `OR EXISTS (SELECT 1 FROM ticket_messages m WHERE m.ticket_id = t.id AND MATCH(m.body) AGAINST(? IN NATURAL LANGUAGE MODE))`. Keep the existing LIKE on subject/requester for short tokens that don't make a fulltext match.

### C2. "Needs my reply" quick filter — **S**
A button that filters to `status IN ('open','in_progress','waiting') AND last_message_author_role = 'requester' AND assigned_to = me`. Implement via a `last_author_role` column updated on insert (cheap denorm), or via a sub-select on demand (simpler, slightly slower). Sub-select is fine at current scale.

### C3. "Mine" filter & default sort — **S**
One-click filter for `assigned_to = me`. Plus persist sort: today the API only orders by `updated_at DESC`. Add `sort=priority|updated|created` and a `dir=asc|desc` param. The list page already has filter persistence via `usePersistedFilters('tickets', …)` — reuse that for the new filter.

### C4. Saved views — **L** (skip unless you really want it)
Like the bulk-job presets pattern: per-user saved filter combinations with a name. Not worth doing until C1/C2 land.

---

## D. UX polish

### D1. Markdown rendering of message bodies — **S**
Bodies are stored as plain text and rendered with `white-space: pre-wrap`. Render with a minimal Markdown lib (`marked` + `DOMPurify`) so bullet points, code blocks and links work. Inbound email plain text already mostly looks fine; this just helps the staff-replying-from-portal case. Add a tiny formatting toolbar (B/I/code/link) above the textarea.

### D2. Drag-and-drop & paste-to-attach — **S**
The reply form already has a hidden file input. Add a `dragover/drop` handler on the form and a `paste` handler on the textarea (`e.clipboardData.files`). Both push to the same `setFiles` state. Major UX win for screenshots.

### D3. Auto-quote previous message — **S**
When clicking "Reply", prefill the textarea with `> ` quoted lines from the previous message. Optional toggle to remove. Mirrors what every email client does and reads well alongside D1.

### D4. Sticky reply form & keyboard shortcuts — **S**
Sticky-bottom reply form on long threads (already short pages today, but threads with 30+ messages will scroll). Plus `r` to focus reply, `i` to toggle internal note, `Cmd-Enter` to submit. Optional but very cheap.

### D5. Show ticket number in window title — **XS**
Current title is "Support Tickets" everywhere. Make detail page title `#${id} — ${subject}`. One-liner via the existing `usePageTitle` hook.

### D6. Ticket reply preview / formatting — **S** (only if D1 lands)
Tab between Edit / Preview when composing a markdown reply.

---

## E. Notifications & email

### E1. In-app notification bell — **L**
Reusable for ticket events + zone deploy events + delegation events. New `notifications` table, WS-pushed. Not a small change — defer unless you want the broader notifications scaffolding.

### E2. Mute per ticket — **S**
Per-user-per-ticket "mute" toggle so an assignee can stop receiving mail on a chatty ticket. New table `ticket_mutes (user_id, ticket_id)`. Check before queueing mail in routes.ts. Pairs with E1 but works without it.

### E3. Daily digest for assignees — **M**
One scheduled job per morning emails each assignee a list of their open tickets, sorted by priority + age. Reuses the worker scheduler. Useful immediately even without E1/E2.

### E4. Better email reply parsing — **M, recommended**
See A5. Strips quoted history, signatures (lines after `\n-- \n`), forwarded headers. Keeps the cleaned body in `body`, optionally stores raw in a new column for debugging. Massively improves the staff reading experience. The `mailparser` lib already gives us `parsed.text` which is reasonable; a small `cleanReply()` helper covers the rest.

### E5. Reply via email captures HTML formatting — **M**
Currently HTML-only emails get `replace(/<[^>]+>/g, '')` which strips entities and structure. Use `mailparser`'s `textAsHtml` or render a sanitized HTML version into a separate column and prefer it in the UI. Skip if D1 isn't shipping (no HTML rendering on the read side anyway).

---

## My recommendation: a focused first pass

If you want a "small wins bundle" that ships in one PR and meaningfully improves the feature, I'd do:

**Bugs:** A1, A2, A3, A4, A7, A8
**Workflow:** B1 (system messages — natural pair with A3)
**Search:** C1 (full-text), C2 (needs reply)
**UX:** D2 (drag/paste), D3 (auto-quote), D5 (page title)
**Email:** E4 (clean reply parsing)

That's eleven small-to-medium items, no schema moves except: `support_tickets` gains `first_response_at`/`resolved_at` (deferred unless you want B4), `ticket_messages` gains a `kind` column (or repurposes `is_internal`) and a FULLTEXT index. One migration file (008_tickets_phase2.sql).

If you want **everything important**, add B2 (labels), B6 (merge), D1 (markdown), E2 (mute), E3 (digest). That doubles the size but is still a coherent week of work.

If you want **just one thing**, ship C1 — it's the single biggest perceived improvement for daily users.

---

**Tell me which items to do** (e.g. "A1, A2, A3, A4, A7, B1, C1, D2, D3, D5, E4" or "your recommended first pass" or "everything in A plus C1") and I'll implement them end-to-end with migration, API, worker, web, i18n, and a verification pass.
