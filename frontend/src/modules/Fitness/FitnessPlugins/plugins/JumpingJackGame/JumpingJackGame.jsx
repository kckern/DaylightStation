import React, { useState, useEffect, useRef } from 'react';
import useFitnessPlugin from '../../useFitnessPlugin';
import { Webcam } from '../../../components/FitnessWebcam.jsx';
import './JumpingJackGame.scss';

const JumpingJackGame = ({ mode, onClose, config, onMount }) => {
  const {
    sessionId,
    registerLifecycle
  } = useFitnessPlugin('jumping_jack_game');

  const [score, setScore] = useState(0);
  const [gameState, setGameState] = useState('ready'); // ready, playing, finished
  const [timeLeft, setTimeLeft] = useState(30);
  
  useEffect(() => {
    onMount?.();
  }, [onMount]);

  useEffect(() => {
    registerLifecycle({
      onPause: () => setGameState(prev => prev === 'playing' ? 'paused' : prev),
      onResume: () => setGameState(prev => prev === 'paused' ? 'playing' : prev),
      onSessionEnd: () => setGameState('finished')
    });
  }, [registerLifecycle]);

  useEffect(() => {
    let timer;
    if (gameState === 'playing' && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            setGameState('finished');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [gameState, timeLeft]);

  const handleStart = () => {
    setScore(0);
    setTimeLeft(30);
    setGameState('playing');
  };

  // Mock motion detection for now - click to jump
  const handleJump = () => {
    if (gameState === 'playing') {
      setScore(s => s + 1);
    }
  };

  return (
    <div className={`jumping-jack-game mode-${mode}`}>
      <div className="game-header">
        <h3>Jumping Jacks</h3>
        <div className="timer">{timeLeft}s</div>
      </div>
      
      <div className="game-viewport" onClick={handleJump}>
        <Webcam className="game-cam" enabled={true} />
        
        <div className="game-overlay">
          <div className="score-display">
            <span className="score-label">JUMPS</span>
            <span className="score-value">{score}</span>
          </div>
          
          {gameState === 'ready' && (
            <div className="game-message">
              <button onClick={handleStart}>START</button>
            </div>
          )}
          
          {gameState === 'finished' && (
            <div className="game-message">
              <h4>TIME'S UP!</h4>
              <p>Final Score: {score}</p>
              <button onClick={handleStart}>PLAY AGAIN</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default JumpingJackGame;
