# OMR scan integrity

The 50-question form has 32 scan columns: seven identity columns and 25 paired
answer columns. Both decoding paths reject any other column count before
grading. Blank answer columns are legitimate and are not removed automatically.

Correctly sized incremental scans are compared with accepted marks for the same
card. Within each 25-row bank, offsets of one or two positions in either direction
require six matching prior answers, three distinct mark patterns, at least 80%
agreement and four more matches than at the original positions. This comparison
uses measured marks, never the answer key. New answers and small revisions are
allowed; sparse scans retain evidence for omitted rows. Reallocated rows are
excluded by their allocation owner. Suspect scans never replace the baseline.

Baselines persist in application data under the print artifact store's
`scan-alignment` directory. Unvalidated historical scans are not imported as
trusted baselines. First scans have structural protection only; sparse or
repetitive marks cannot establish alignment confidently. Personal incident
evidence and grading records belong in application data, not this repository.

The school session is authoritative for assignment completion. Allocation
`satisfied` describes scan coverage; it must not suppress a session still awaiting
review. Rescans report pending review from the session review queue. A generic
no-result response does not claim the assignment is complete. Grade corrections
notify the agenda and completion projection to refresh their authoritative reads.

An older machine grade may lack its passing threshold. A correction pins the
configured threshold on its annotation while preserving the original grade.
An existing machine threshold always wins over current configuration.

Laser printing defaults to duplex, including direct adapter use. Constructor
defaults and explicit per-job overrides reach the raster page headers. Regression
tests inspect the transmitted duplex byte rather than only mocked options.
