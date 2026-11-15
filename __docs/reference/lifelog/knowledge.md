# Lifelog knowledge

The knowledge subsystem records user-stated open loops with quoted journal evidence. It is separate from the read-only lifelog archive. The domain foundation is implemented; persistence, runtime integration and production activation are separate steps. No existing debrief uses the foundation until composition explicitly supplies the knowledge ports.

Only verified user messages can authorize committed proposals. Historical user rows can be inspected in a preview that cannot be committed. Quotes match their cited message after Unicode NFC and whitespace normalization; paraphrases are not evidence. The proposal vocabulary permits opening, touching and closing loops, candidate people and candidate aliases. It cannot delete, merge, confirm itself or loosen user pins. Sensitive proposals wait for review and default to never asking.

Question choice is deterministic, with at most two independent morning questions and five opt-in quiz candidates. Eligibility begins after the due date, uses local calendar days, normally observes a seven-day cooldown and never repeats within three days. Acknowledged deliveries alone count as asks; a 36-hour reply window prevents a new delivery being treated as immediately ignored. Two unanswered asks or two skips retire a loop. Three ignored morning dates trigger fourteen-day weekend-only backoff. Healthy empty selections remain empty.

Dates are interpreted against the original entry's local date. For example, an explicit Monday on a Monday means the next Monday, while today stays on the entry date. Unsupported date phrases remain uninferred for review. All domain operations receive explicit time and timezone; model output never supplies the clock or selection order.

Direct user decisions are distinct from model proposals: a verified application-level reply may change a pinned status while recording the edit and preserving the pin. Model proposals and sweeps cannot do that. Storage and delivery authority must enforce identity and acknowledged-message binding before invoking these transitions.
