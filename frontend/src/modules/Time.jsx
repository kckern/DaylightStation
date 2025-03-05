
import React from 'react';
import './Time.scss';

// function component for the animated flipping card
const AnimatedCard = ({ animation, digit }) => {
  return (
    <div className={`flipCard ${animation}`}>
      <span>{digit}</span>
    </div>
  );
};

// function component for the static (upper/lower) card
const StaticCard = ({ position, digit }) => {
  return (
    <div className={position}>
      <span>{digit}</span>
    </div>
  );
};

// Reusable flip container for hours, minutes, and seconds
const FlipUnitContainer = ({ digit, shuffle, unit }) => {
  // assign digit values and determine previous digit
  let currentDigit = digit;
  let previousDigit = digit - 1;

  // For minutes and seconds, roll over from -1 to 59;
  // for hours (in 12-hour mode) roll over from 1 to 12.
  if (unit !== 'hours') {
    previousDigit = previousDigit === -1 ? 59 : previousDigit;
  } else {
    previousDigit = previousDigit === 0 ? 12 : previousDigit;
  }

  // add leading zero if needed (only for minutes and seconds)
  if (unit !== 'hours') {
    if (currentDigit < 10) {
      currentDigit = `0${currentDigit}`;
    }
    if (previousDigit < 10) {
      previousDigit = `0${previousDigit}`;
    }
  }

  // decide which digit gets animated depending on the shuffle value
  const digit1 = shuffle ? previousDigit : currentDigit;
  const digit2 = !shuffle ? previousDigit : currentDigit;

  // define animations for each card
  const animation1 = shuffle ? 'fold' : 'unfold';
  const animation2 = !shuffle ? 'fold' : 'unfold';

  return (
    <div className="flipUnitContainer">
      <StaticCard position="upperCard" digit={currentDigit} />
      <StaticCard position="lowerCard" digit={previousDigit} />
      <AnimatedCard digit={digit1} animation={animation1} />
      <AnimatedCard digit={digit2} animation={animation2} />
    </div>
  );
};

// New component for the AM/PM panel
const AmPmPanel = ({ ampm, shuffle }) => {
  // For the flip effect, the "previous" value is simply the opposite.
  const previousAmPm = ampm === 'AM' ? 'PM' : 'AM';
  const card1 = shuffle ? previousAmPm : ampm;
  const card2 = !shuffle ? previousAmPm : ampm;
  const animation1 = shuffle ? 'fold' : 'unfold';
  const animation2 = !shuffle ? 'fold' : 'unfold';

  return (
    <div className="flipUnitContainer">
      <StaticCard position="upperCard" digit={ampm} />
      <StaticCard position="lowerCard" digit={previousAmPm} />
      <AnimatedCard digit={card1} animation={animation1} />
      <AnimatedCard digit={card2} animation={animation2} />
    </div>
  );
};

// class component for the Flip Clock
class FlipClock extends React.Component {
  constructor(props) {
    super(props);
    // initialize using the current date/time in 12-hour format
    const now = new Date();
    const hours24 = now.getHours();
    const hours12 = (hours24 % 12) || 12;
    this.state = {
      hours: hours12,
      hoursShuffle: true,
      minutes: now.getMinutes(),
      minutesShuffle: true,
      seconds: now.getSeconds(),
      secondsShuffle: true,
      ampm: hours24 >= 12 ? 'PM' : 'AM',
      ampmShuffle: true,
    };
  }

  componentDidMount() {
    this.timerID = setInterval(() => this.updateTime(), 1000);
  }

  componentWillUnmount() {
    clearInterval(this.timerID);
  }

  updateTime() {
    // get a new Date instance
    const time = new Date();
    const hours24 = time.getHours();
    const minutes = time.getMinutes();
    const seconds = time.getSeconds();

    // Convert to 12-hour format: 0 becomes 12, others modulo 12.
    const hours12 = (hours24 % 12) || 12;
    const newAMPM = hours24 >= 12 ? 'PM' : 'AM';

    // Update hours (and AM/PM if changed)
    if (hours12 !== this.state.hours) {
      const hoursShuffle = !this.state.hoursShuffle;
      // If AM/PM has changed then toggle the flip animation for that panel too.
      const ampmShuffle =
        newAMPM !== this.state.ampm ? !this.state.ampmShuffle : this.state.ampmShuffle;
      this.setState({
        hours: hours12,
        hoursShuffle,
        ampm: newAMPM,
        ampmShuffle,
      });
    }
    // Update minutes if changed
    if (minutes !== this.state.minutes) {
      const minutesShuffle = !this.state.minutesShuffle;
      this.setState({
        minutes,
        minutesShuffle,
      });
    }
    // Update seconds if changed
    if (seconds !== this.state.seconds) {
      const secondsShuffle = !this.state.secondsShuffle;
      this.setState({
        seconds,
        secondsShuffle,
      });
    }
  }

  render() {
    // Destructure state
    const {
      hours,
      minutes,
      seconds,
      hoursShuffle,
      minutesShuffle,
      secondsShuffle,
      ampm,
      ampmShuffle,
    } = this.state;

    return (
      <div className="flipClock">
        <FlipUnitContainer unit="hours" digit={hours} shuffle={hoursShuffle} />
        <FlipUnitContainer unit="minutes" digit={minutes} shuffle={minutesShuffle} />
        <FlipUnitContainer unit="seconds" digit={seconds} shuffle={secondsShuffle} />
        <AmPmPanel ampm={ampm} shuffle={ampmShuffle} />
      </div>
    );
  }
}

// Main exported function component
export default function Time() {
  return (
    <div>
      <FlipClock />
    </div>
  );
}
