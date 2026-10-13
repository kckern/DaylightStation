# Application modules

Browse by purpose, then work inside the application that owns the feature.

| Category | Applications |
| --- | --- |
| [Learning](learning/) | [School](learning/school/), [Piano](learning/piano/) |
| [Games](games/) | [Arcade](games/arcade/), [Chess](games/chess/), [Emulator](games/emulator/), [Party games](games/party-games/) |
| [Wellness](wellness/) | [Fitness](wellness/fitness/), [Health](wellness/health/), [Nutribot](wellness/nutribot/) |
| [Media](media/) | [Art](media/art/), [Feed](media/feed/), [Livestream](media/livestream/), [Media](media/media/), [NewsReporter](media/newsreporter/) |
| [Household](household/) | [Auto](household/auto/), [Camera](household/camera/), [Concierge](household/concierge/), [DoNow](household/donow/), [Home](household/home/), [HomeBot](household/homebot/), [Home Line](household/homeline/), [Screens](household/screens/) |
| [Personal](personal/) | [Calendar](personal/calendar/), [Gratitude](personal/gratitude/), [Journalist](personal/journalist/), [Life](personal/life/), [Lifelog](personal/lifelog/), [Weekly review](personal/weekly-review/) |
| [Money](money/) | [Economy](money/economy/), [Finance](money/finance/) |

Categories organize navigation. Each application retains its own public entries,
implementation, and tests. Its `server/`, `browser/`, `cli/`, `portable/`,
`satellites/`, and `seeds/` directories are present as needed.

Cross-application imports use declared public entries. Architecture checks enforce
private boundaries and reject dependency cycles, including between applications
in the same category. Reusable behavior belongs in `../__capabilities/`.

See the [contributor map](../__docs/reference/core/project-layout.md) for the
rest of the repository and the shared tooling.
