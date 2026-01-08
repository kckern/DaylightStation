
### **Bug Bash Summary Report**

| Item # | Area | Severity | Summary |
| --- | --- | --- | --- |
| **01** | Visualization | Low | Chart dropout fill logic requires 2-min minimum threshold. |
| **02** | Playback | **High** | Volume persistence regression on reload/stall. |
| **03** | Performance | **High** | Significant FPS drop during Governance Warning (Blur Overlay). |
| **04** | Logic | **High** | Phantom Warnings appearing without offenders/data. |
| **05** | Logic | **High** | Challenges not triggering on governed videos. |
| **06** | Refactor | Medium | Consolidate Cycle/Jump Rope into "RPM Device" domain. |
| **07** | Navigation | Medium | Footer zoom-in navigation fails to seek video. |
| **08** | Logic | Medium | Jump rope counting logic resets; move to internal counting. |
| **09** | Voice/UI | **Critical** | Voice Memo UI inconsistency, memory leak loop, and mic meter fix. |

---

### **1. Playback & Performance**

#### **Item 02: Volume Persistence Regression**

The player is failing to honor user volume settings across session states.

* **Symptoms:**
* On page reload, the video reverts to default volume.
* If the video stalls and restarts, it reverts to default volume.
* **Workaround observed:** Opening the Volume UI triggers the player to "remember" and snap back to the correct user-set volume.


* **Root Cause Hypothesis:** The persistence wiring is disconnected during initialization but re-engages when the UI component mounts/interacts.

#### **Item 03: FPS Degradation (Governance State)**

Performance tanks specifically when the governance warning overlay is active.

* **Context:** Occurs when the "Blur Filter" overlay is applied.
* **Action:** Diagnose rendering pipeline for the blur filter; verified unrelated to log spam (which was previously fixed).

#### **Item 07: Footer Navigation / Zoom Mapping**

The zoomed-in sub-navigation on the player footer is broken.

* **Issue:** Clicking an item in the "zoomed-in" lower half of the footer does not advance the playhead to the corresponding timestamp.
* **Root Cause:** Mapping error between the zoom level coordinate system and the actual video timecode.

---

### **2. Logic & Data Integrity**

#### **Item 04: Phantom Governance Warnings**

The Warning UI appears without a valid trigger.

* **Symptoms:** Warning flashes for a second with no specific "offender" chip listed.
* **Data Check:** Users are within safe thresholds (not warm/cool), yet warning triggers.
* **Fix Requirement:** Implement guardrails. The UI should strictly check for an "offender" object in the Single Source of Truth before rendering the warning state.

#### **Item 05: Challenge Trigger Failure**

Regression in the gamification system.

* **Issue:** Challenges are completely absent during governed videos.
* **Requirement:** Restore wiring to the single source of truth to ensure challenges fire at defined (or random) intervals per policy.

#### **Item 08: Jump Rope Counting Logic**

The current integration relies too heavily on device data.

* **Issue:** Counter resets after 250 (device limit/rollover).
* **Fix:**
* Decouple display count from device count.
* Use device input only as a "heartbeat/tick" to signal a completed cycle.
* App side handles the accumulation of the total count.



---

### **3. Feature Refactors & Domain Modeling**

#### **Item 06: RPM Data Domain Consolidation**

Current data models treat Bicycles and Jump Ropes as disparate entities, leading to UI fragmentation. They should be unified under a "RPM Device" super-category.

* **New Architecture:**
* **Super Category:** RPM Device (Shared attribute: Rotations Per Minute).
* **Sub-classes:** Cycle, Jump Rope.


* **UI Implications:**
* Display grouped together in the same row.
* **Full Screen View:** Display "RPM" generic label instead of "Jump Count" (mentioned in Item 8 addendum).
* **Visual Overrides:** Cycles retain spinning dotted lines; Jump Ropes utilize specific visualizations but share the row container.



---

### **4. UI & Visualization**

#### **Item 01: Chart Dropout Visualization**

* **Issue:** Grey dotted lines (dropouts) are appearing for insignificant gaps.
* **Fix:** Enforce a **2-minute minimum threshold** for the grey dotted line style.
* *If gap < 2 mins:* Fill with the color of the dropout point.
* *If gap > 2 mins:* Use grey dotted line.



#### **Item 09: Voice Memo Overhaul**

This feature has three distinct sub-issues:

1. **UI Consistency:** The Fitness Player recorder UI does not match the Fitness Show recorder UI. These must be unified.
2. **Critical Bug (Infinite Loop):** Saving an item causes a "runaway loop," adding the entry to the registry repeatedly until an Out of Memory (OOM) crash occurs.
3. **Audio Meter:** The visualization is not sensitive enough (only bottom 2 bars light up).
> **Fix:** Implement a logarithmic function for the meter so the UI represents the full range of typical audio input levels.


