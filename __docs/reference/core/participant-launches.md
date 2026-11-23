# Participant launches (agenda activities on a screen)

An agenda row such as FHE's Charades starts a *participant-aware* activity: the
plan's people go into the game. This page is the contract for how that works on
a screen. Code: `__capabilities/content-catalog/server/application/participants/`,
`__app_modules/household/agenda/`, `frontend/src/composition/participants/`,
`__app_modules/games/party-games/server/application/participants/`.

## Two surfaces

| Surface | Who | Sign-in | Can |
|---|---|---|---|
| Screen (TV, kiosk) | the household | **never** | show an agenda, start or resume its activities |
| Admin | a grown-up | required | edit series, plans, rosters, activity setup |

Screens never sign in. The list routes and `/api/v1/participant-launches/*`
take `householdViewerFor` (`__backend/src/4_api/utils/participantHttp.mjs`): a
signed-in caller keeps their own identity; otherwise the household is the
viewer, with the authority the network already grants (`networkTrustResolver`).
Admin and migration routes use `viewerFor(req, householdId, true)` and still
require sign-in.

## Names and photos: one source

A named person's name and photo come from the household directory
(`PeopleDirectory`), never from a copy saved in the plan. The label is
household-scoped: `group_label` first ("Dad", "Mom"), then `display_name`, then
`name`, the same precedence as `HouseholdUserProjection.resolveDisplayName`.
A plan's saved `display` is used only for anonymous slots. A person with no saved
avatar still shows their own portrait (`/static/img/users/<id>`).

## Starting and resuming

Starting an activity draws nothing of its own: no review screen, no resume
picker, no loading box. The activity's title card is the first thing on screen.

- If a game for this plan row is **engaged**, it resumes.
- Otherwise a new game starts.

A game is engaged only when all hold (`isEngagedGame`):

1. unfinished (`active` or `suspended`);
2. at least two clues played, by two different performers;
3. exactly tonight's people.

Opening a game and leaving, or testing one clue, is browsing: the next start is
a new game. Launch records are kept per week's plan, so a game from another week
never comes back.

A dialog appears only for an error, a revision conflict, or an activity whose
setup asks for confirmation (`autostart` off); it must be fully usable with a
D-pad remote.
