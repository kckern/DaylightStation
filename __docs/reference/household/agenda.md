# Household Agenda

Agenda organizes a recurring series into independent weekly plans. A series holds a weekly calendar and defaults; a plan has its own date, people, ordered activities, and draft or publication state. Copying a plan or creating one from defaults gives the new week its own identities and settings. Editing one week does not edit another.

Administrators use **Content → Agendas** to view this week and next week, edit a plan and its roster, and publish it. The plan editor stages changes until Save or Publish. Publish saves the draft first and checks activity setup. A revision conflict retains the local buffer for reload or reapplication. Named guests come from the shared people directory; anonymous guests are distinct plan-local entries. Display names and portraits are snapshots and can be refreshed explicitly.

Participant-aware activities can use everyone on the plan or an explicit ordered subset. The activity's registered editor owns its settings, such as Charades clue modes. Removing someone from a subset clears that person's associated settings. Only explicitly casual Charades definitions opt in through the Party Games consumer; competitive Charades and other mounted games retain their normal behavior without a binding. Existing participant bindings on ineligible targets fail validation.

A TV menu opens the published current plan or a dated plan. Past or future plans are previews; missing, draft, cancelled, or archived plans do not silently run another week. Participant-aware launches show the server's summary and available saved sessions before starting when confirmation is required. Returning from an activity refreshes the dated plan and restores the selected activity. An existing session retains its original participants and setup after later plan changes.

Canonical Agenda enablement and transfer of an existing legacy list are separate operations. The [migration runbook](../../runbooks/agenda-migration.md) describes the reviewed maintenance process and backout. The [participant launch contract](../../../__capabilities/content-catalog/docs/participant-launch.md) describes the shared extension points.
