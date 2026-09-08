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

## Locating an extra scan column

Read the relay's `/health` and `/recent` endpoints before restarting or flashing
it. `/recent` holds raw UART frames: a complete 32-column card has 64 bytes,
and a 33-column card has 66. The relay decodes each successive byte pair into
one mask; an extra `20 20` pair is already a blank column at the UART boundary.
Compare these frames with persisted raw scan history, keeping captures in
application data or a temporary directory outside the repository.

Compare repeated feeds of the affected card with other cards read during the
same period. A repeatable extra blank at one position while other cards retain
32 columns points toward the card's timing track or its interaction with the
optics. It does not establish whether the cause is a stray mark, damaged tick,
crease, or reader contamination. If an earlier 32-column scan agrees exactly
after omitting the extra pair in a forensic comparison, that further localizes
the change; never publish the shortened frame or use it to grade automatically.

On the paired-answer form, zero-based raw index 14 follows seven ID columns
and seven answer columns, so inspect the timing track near answer rows 8 and
33, including the neighboring gap. Preserve the original card and marks.
Compare with unused stock and follow the reader's cleaning instructions if
inspection supports cleaning. Any diagnostic feed needs an isolated capture
path: the normal relay publishes to the live grading bus, even when a scan is
intended only as a test. A software deploy cannot verify a physical repair;
verification requires a fresh 64-byte frame and stable repeated readings.

### Capturing a physical control without grading it

Schedule this with the person at the reader; changing the serial connection
temporarily takes live scanning out of service. Preserve the relay's `/recent`
capture and check its queue before touching the connection.

1. Disconnect the reader's RS-232 data cable from the relay. Connect that cable
   to a working USB **RS-232** adapter on a capture computer; a TTL UART adapter
   is not equivalent. This physical separation keeps every diagnostic byte out
   of the relay and its delivery queue. Simply disconnecting the relay's Wi-Fi
   does not isolate grading: queued scans are delivered when it reconnects.
2. Confirm the adapter's actual serial device, then run
   `python3 _extensions/omr-relay/tools/omr-listen.py <serial-device> <private-capture-directory>`.
   The existing tool downloads volatile `I00` mode at 9600 7E1 and streams bytes
   to a local file; it has no event-bus publisher. Keep the capture directory
   outside the repository. Wait for the mode acknowledgement before feeding.
3. Feed an unused stock card three times, then the preserved affected card
   three times, then the stock card again. Record the feed order alongside the
   capture. Do not erase, mark, trim, or clean the original card before this
   comparison. Exclude command acknowledgements from card-frame counts.
4. Decode the local capture with `omr-decode.py`. Compare complete frame lengths
   and the extra pair's position. A repeatable 66-byte affected card alongside
   64-byte controls isolates the card interaction; failure on controls calls
   for reader/transport inspection. Preserve raw bytes regardless of outcome.
5. Stop the capture and remove all diagnostic cards before reconnecting the
   normal serial path. A repeat live feed is unnecessary for this test and
   would enter the grading pipeline.

This procedure establishes the physical evidence without publishing a scan,
changing a grade, flashing firmware, or altering EEPROM settings. Any repair
and its repeat-control check remain a separately coordinated physical action.

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
