### 🎨 UI, Styling, & Animation

#### 1. RPM Device Styling Inconsistency in Sidebar

* **Current Behavior:** RPM devices render correctly in Fullscreen view but look broken ("terrible") when rendered inside the Sidebar.
* **Expected Behavior:** The Sidebar view should share the exact same styling as the Fullscreen view. While the scale/size can differ, the visual elements and CSS styling must be identical.
* **Technical Note:** Check if the Sidebar view is using overrides that need to be removed. Ensure both views utilize the same JSX/CSS components.

#### 2. Visible Scroll Bars on Fitness Show

* **Current Behavior:** A scroll bar is visible on the right side of the "Fitness Show" panel.
* **Expected Behavior:** Scroll bars should never be visible anywhere in the application.
* **Constraint:** This is a strictly touch-interface device; scrolling is handled via touch-drag logic. CSS should be updated globally to hide scrollbars in all panels and subcomponents.

#### 3. Low Frame Rate Animation on Footer Thumbnails

* **Current Behavior:** The footer thumbnails (perimeter frame and spark) update on a specific tick rate (approx. 1 second), causing a "choppy" visual effect.
* **Expected Behavior:** The movement should be fluid.
* **Implementation Suggestion:** Add CSS keyframe animation to interpolate the positions between ticks (in-betweens). Reference the implementation used for User Avatars/Gauges for similar smoothness.

---

### 👆 Interaction & Core Architecture

#### 4. Runaway Touch Events (Fullscreen Trigger Sensitivity)

* **Current Behavior:** Pressing a thumbnail to open "Fitness Player" from "Fitness Show" immediately triggers a second event on the video screen, inadvertently sending the player into Fullscreen mode.
* **Cause:** The finger is still "down" when the UI switches, and the new UI layer (Video Player) accepts the existing touch input as a new click.
* **Fix:** Implement a "One Event Per Touch" rule or a `touchend` requirement. The UI should not accept an interaction on the new layer until the finger is released and pressed again.
* **Note:** This behavior has also been observed in the Music Player.

#### 5. Inconsistent Sidebar Architecture (Chart App)

* **Current Behavior:**
* Opening **Chart App** from *Fitness Plugins Menu* = No Sidebar.
* Opening **Chart App** from *Nav Footer* = Includes Sidebar (better UI).


* **Requirement:** Review the Sidebar architecture. It appears currently bound to the "Fitness Player."
* **Fix:** Refactor Sidebar to be a common, reusable UI element that can be attached to any app or plugin (not just the Player). Define explicit logic for which plugins should inherit the Sidebar.

---

### 🎙️ Feature: Voice Memo

#### 6. Voice Memo Visibility Logic

* **Current Behavior:** The Voice Memo button exists in "Fitness Show," but pressing it does nothing. It only works/appears when inside the "Fitness Player."
* **Expected Behavior:** Voice Memo must be globally invocable. It should function immediately when triggered from "Fitness Show" or any other part of the app.
* **Technical Note:** Check the z-index or layer logic; the modal may be bound specifically to the Player view hierarchy.

#### 7. Transcription Context Injection (AI)

* **Current Behavior:** Transcription struggles with specific entities (e.g., transcribing "UV" as "Ultraviolet" instead of the show "YUVI") and family names.
* **Improvement:** Inject dynamic context into the AI prompt based on the current session.
* **Context to Append:**
* Currently/Recently played Show and Episode titles.
* Family Member names (from Household Config).
* Users currently in the session.



#### 8. Media Resume on Modal Close

* **Current Behavior:** When the Voice Memo modal is closed/finished, the previous media (Music or Video) remains paused.
* **Expected Behavior:** If media was playing prior to the Voice Memo trigger, it should auto-resume immediately upon the modal closing.

---

### 📉 Stability & Performance

#### 9. Chart App Memory Leak

* **Current Behavior:** Leaving the **Chart App** open for a duration and returning causes the browser/webview to crash or freeze, requiring a reboot.
* **Action:**
* Review recent Git history (check if this was addressed in a previous build).
* Profile the Chart App for unclosed listeners or memory leaks.


