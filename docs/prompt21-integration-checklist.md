# Prompt 21 — Integration checklist

Manual verification after wiring role dashboards to `GET /api/user/my-tasks?month=YYYY-MM` and `PATCH /api/user/my-tasks/:itemId/:stageId`.

## (a) Create client → ContentItems generated

1. Log in as a **manager**, create a client with a package that includes at least one reel/static/carousel and a start date in the current month.
2. Confirm the calendar generation path runs (month lock / content items created).
3. In MongoDB or via an admin/manager calendar API, confirm **ContentItem** documents exist for that client and **month** `YYYY-MM`.

## (b) Urgent reels → urgent plan

1. Ensure at least one reel is generated with `plan: "urgent"` (per `calendarService` rules).
2. On the **strategist** dashboard, confirm that task row shows an **Urgent plan** badge and that Plan stage due dates match the compressed urgent workflow.

## (c) End date auto-set

1. After client creation, open the client record and confirm **endDate** is populated (or set by your client controller/calendar flow as designed).
2. Confirm generated **clientPostingDate** / stage due dates fall between client **startDate** and **endDate** where validation applies.

## (d) Capacity respected

1. With **UserCapacity** (or equivalent) configured for assignees, run generation that would overload a user.
2. Confirm the system either blocks, redistributes, or logs per your Prompt 17 capacity rules (no silent over-assignment if the product requirement is strict).

## (e) Rejection loop end-to-end

1. Complete **Plan → Shoot → Edit** (or **Plan → Work**) until an **Approval** stage is **submitted** and appears on the **manager** client team calendar.
2. **Reject** with a note; confirm the workflow returns the editor/designer stage to **in_progress** and the item **overallStatus** updates appropriately.
3. As that role, **submit** again; confirm a previously **rejected** approval stage resets to **planned** (per `updateMyTaskStatus` / manager flow) and can be approved again.
