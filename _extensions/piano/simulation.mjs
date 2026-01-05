#!/usr/bin/env node
/**
 * MIDI Simulator - Sends simulated piano events to test the Piano Visualizer
 *
 * Usage:
 *   node scripts/midi-simulator.mjs                    # Interactive mode
 *   node scripts/midi-simulator.mjs --demo             # Auto-play demo sequence
 *   node scripts/midi-simulator.mjs --random           # Random notes continuously
 *   node scripts/midi-simulator.mjs --host 10.0.0.10   # Custom host
 */

import WebSocket from 'ws';
import readline from 'readline';

// Configuration
const args = process.argv.slice(2);
const HOST = args.includes('--host') ? args[args.indexOf('--host') + 1] : 'localhost';
const PORT = args.includes('--port') ? args[args.indexOf('--port') + 1] : 3112;
const WS_URL = `ws://${HOST}:${PORT}/ws`;

// MIDI note helpers
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiNoteToName = (note) => `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;

// Session state
let sessionId = null;
let noteCount = 0;
let sessionStartTime = null;

// Create WebSocket connection
let ws = null;

function connect() {
  return new Promise((resolve, reject) => {
    console.log(`Connecting to ${WS_URL}...`);
    ws = new WebSocket(WS_URL);

    ws.on('open', () => {
      console.log('Connected to DaylightStation WebSocket');
      resolve(ws);
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err.message);
      reject(err);
    });

    ws.on('close', () => {
      console.log('WebSocket connection closed');
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'bus_ack') {
        console.log('Subscribed to topics:', msg.currentSubscriptions);
      }
    });
  });
}

function getTimestamp() {
  return new Date().toISOString();
}

function send(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// Message generators
function sessionStart() {
  sessionId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  sessionStartTime = Date.now();
  noteCount = 0;

  const msg = {
    topic: 'midi',
    source: 'piano',
    type: 'session',
    timestamp: getTimestamp(),
    sessionId,
    data: {
      event: 'session_start',
      sessionId,
      device: 'MIDI Simulator'
    }
  };
  send(msg);
  console.log(`Session started: ${sessionId}`);
}

function sessionEnd() {
  if (!sessionId) {
    console.log('No active session');
    return;
  }

  const duration = (Date.now() - sessionStartTime) / 1000;
  const msg = {
    topic: 'midi',
    source: 'piano',
    type: 'session',
    timestamp: getTimestamp(),
    sessionId,
    data: {
      event: 'session_end',
      sessionId,
      duration: Math.round(duration * 100) / 100,
      noteCount,
      filePath: `simulator/${sessionId}.mid`
    }
  };
  send(msg);
  console.log(`Session ended: ${noteCount} notes in ${duration.toFixed(1)}s`);
  sessionId = null;
}

function noteOn(note, velocity = 80) {
  if (!sessionId) sessionStart();
  noteCount++;

  const msg = {
    topic: 'midi',
    source: 'piano',
    type: 'note',
    timestamp: getTimestamp(),
    sessionId,
    data: {
      event: 'note_on',
      note,
      noteName: midiNoteToName(note),
      velocity,
      channel: 0
    }
  };
  send(msg);
  console.log(`Note ON:  ${midiNoteToName(note).padEnd(4)} (${note}) vel=${velocity}`);
}

function noteOff(note) {
  const msg = {
    topic: 'midi',
    source: 'piano',
    type: 'note',
    timestamp: getTimestamp(),
    sessionId,
    data: {
      event: 'note_off',
      note,
      noteName: midiNoteToName(note),
      velocity: 0,
      channel: 0
    }
  };
  send(msg);
  console.log(`Note OFF: ${midiNoteToName(note).padEnd(4)} (${note})`);
}

function sustain(value) {
  const msg = {
    topic: 'midi',
    source: 'piano',
    type: 'control',
    timestamp: getTimestamp(),
    sessionId,
    data: {
      event: 'control_change',
      control: 64,
      controlName: 'sustain',
      value,
      channel: 0
    }
  };
  send(msg);
  console.log(`Sustain: ${value >= 64 ? 'ON' : 'OFF'} (${value})`);
}

// Demo sequences
async function playNote(note, duration = 300, velocity = 80) {
  noteOn(note, velocity);
  await sleep(duration);
  noteOff(note);
}

async function playChord(notes, duration = 500, velocity = 70) {
  notes.forEach(n => noteOn(n, velocity));
  await sleep(duration);
  notes.forEach(n => noteOff(n));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// C major scale
async function demoScale() {
  console.log('\n--- Playing C Major Scale ---');
  sessionStart();
  await sleep(200);

  const scale = [60, 62, 64, 65, 67, 69, 71, 72]; // C4 to C5
  for (const note of scale) {
    await playNote(note, 250, 70 + Math.floor(Math.random() * 30));
    await sleep(50);
  }

  // Descend
  for (const note of scale.reverse()) {
    await playNote(note, 250, 60 + Math.floor(Math.random() * 30));
    await sleep(50);
  }

  await sleep(500);
  sessionEnd();
}

// Simple melody
async function demoMelody() {
  console.log('\n--- Playing Simple Melody ---');
  sessionStart();
  await sleep(200);

  // "Mary Had a Little Lamb" in C
  const melody = [
    { note: 64, dur: 300 }, // E
    { note: 62, dur: 300 }, // D
    { note: 60, dur: 300 }, // C
    { note: 62, dur: 300 }, // D
    { note: 64, dur: 300 }, // E
    { note: 64, dur: 300 }, // E
    { note: 64, dur: 600 }, // E (hold)
    { note: 62, dur: 300 }, // D
    { note: 62, dur: 300 }, // D
    { note: 62, dur: 600 }, // D (hold)
    { note: 64, dur: 300 }, // E
    { note: 67, dur: 300 }, // G
    { note: 67, dur: 600 }, // G (hold)
  ];

  for (const { note, dur } of melody) {
    await playNote(note, dur, 75);
    await sleep(50);
  }

  await sleep(500);
  sessionEnd();
}

// Chords demo
async function demoChords() {
  console.log('\n--- Playing Chord Progression ---');
  sessionStart();
  await sleep(200);

  sustain(127);
  await sleep(100);

  // C - G - Am - F progression
  const chords = [
    [60, 64, 67],       // C major
    [55, 59, 62, 67],   // G major
    [57, 60, 64, 69],   // A minor
    [53, 57, 60, 65],   // F major
  ];

  for (const chord of chords) {
    await playChord(chord, 800, 65);
    await sleep(200);
  }

  sustain(0);
  await sleep(500);
  sessionEnd();
}

// Random notes
async function randomMode() {
  console.log('\n--- Random Mode (Ctrl+C to stop) ---');
  sessionStart();

  const activeNotes = new Set();

  while (true) {
    // Random note in piano range
    const note = 40 + Math.floor(Math.random() * 48); // C2 to C6
    const velocity = 50 + Math.floor(Math.random() * 77);

    // Randomly turn on or off
    if (activeNotes.has(note) || activeNotes.size > 5) {
      // Turn off a random active note
      if (activeNotes.size > 0) {
        const offNote = Array.from(activeNotes)[Math.floor(Math.random() * activeNotes.size)];
        noteOff(offNote);
        activeNotes.delete(offNote);
      }
    } else {
      noteOn(note, velocity);
      activeNotes.add(note);
    }

    await sleep(100 + Math.random() * 200);
  }
}

// Interactive mode
async function interactiveMode() {
  console.log('\n--- Interactive Mode ---');
  console.log('Commands:');
  console.log('  s       - Start session');
  console.log('  e       - End session');
  console.log('  60-80   - Play note (MIDI number, e.g., 60 = C4)');
  console.log('  c4, d5  - Play note by name');
  console.log('  chord   - Play C major chord');
  console.log('  sus on  - Sustain pedal on');
  console.log('  sus off - Sustain pedal off');
  console.log('  scale   - Play C major scale');
  console.log('  melody  - Play simple melody');
  console.log('  chords  - Play chord progression');
  console.log('  q       - Quit');
  console.log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const noteNameToMidi = (name) => {
    const match = name.toUpperCase().match(/^([A-G]#?)(\d)$/);
    if (!match) return null;
    const noteIndex = NOTE_NAMES.indexOf(match[1]);
    const octave = parseInt(match[2]);
    return (octave + 1) * 12 + noteIndex;
  };

  rl.on('line', async (input) => {
    const cmd = input.trim().toLowerCase();

    if (cmd === 'q') {
      if (sessionId) sessionEnd();
      rl.close();
      ws.close();
      process.exit(0);
    } else if (cmd === 's') {
      sessionStart();
    } else if (cmd === 'e') {
      sessionEnd();
    } else if (cmd === 'chord') {
      await playChord([60, 64, 67], 500);
    } else if (cmd === 'sus on') {
      sustain(127);
    } else if (cmd === 'sus off') {
      sustain(0);
    } else if (cmd === 'scale') {
      await demoScale();
    } else if (cmd === 'melody') {
      await demoMelody();
    } else if (cmd === 'chords') {
      await demoChords();
    } else if (/^\d+$/.test(cmd)) {
      const note = parseInt(cmd);
      if (note >= 21 && note <= 108) {
        await playNote(note, 300);
      } else {
        console.log('Note must be 21-108');
      }
    } else if (/^[a-g]#?\d$/i.test(cmd)) {
      const note = noteNameToMidi(cmd);
      if (note) {
        await playNote(note, 300);
      }
    } else if (cmd) {
      console.log('Unknown command:', cmd);
    }
  });
}

// Main
async function main() {
  try {
    await connect();

    if (args.includes('--demo')) {
      await demoScale();
      await sleep(1000);
      await demoMelody();
      await sleep(1000);
      await demoChords();
      ws.close();
    } else if (args.includes('--random')) {
      await randomMode();
    } else {
      await interactiveMode();
    }
  } catch (err) {
    console.error('Failed to connect:', err.message);
    process.exit(1);
  }
}

main();
