import useSharedTakeRecorder from "../../shared/useTakeRecorder.js";
import { holdAudio } from "./cardLadderAudio.js";
// The card ladder's take recorder: the shared recorder, holding this program's audio lane while the mic is open.
export default function useTakeRecorder(opts = {}) { return useSharedTakeRecorder({ ...opts, holdAudio }); }
