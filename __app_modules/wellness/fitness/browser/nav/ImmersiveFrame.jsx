import React from 'react';
import { useFitnessSelector } from "../context/FitnessContext.jsx";
import { FitnessFrame } from "../player/frames/index.js";

/**
 * The app shell's frame, with the navigation rail also hidden while an activity
 * has asked for the whole screen (`immersive` in the fitness context, set by the
 * cycle game during a race). Without a provider, or with `immersive` false, it is
 * exactly FitnessFrame. FitnessFrame itself stays a pure layout shell.
 */
const ImmersiveFrame = ({ hideNav = false, ...props }) => {
  // Selector, not the whole context: the frame wraps the app and must not
  // re-render on every sensor update just to read one flag.
  const immersive = useFitnessSelector((c) => Boolean(c?.immersive));
  return <FitnessFrame {...props} hideNav={hideNav || immersive} />;
};

export default ImmersiveFrame;
