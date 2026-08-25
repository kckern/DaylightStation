/**
 * The Rubik's Cube course source, as DATA rather than a file read at import.
 *
 * It used to be a colocated `course.yml` loaded with `fs.readFileSync` at
 * module scope, which put filesystem access in `3_applications` (`apps-no-fs`)
 * for content that is not household data at all: it is versioned with the code,
 * inside `backend/src`, and has always been read exactly once at import. A
 * static ES module expresses that honestly and removes the I/O entirely — no
 * adapter, no injection, and no ripple through the five modules that consume
 * the catalog's exported constants.
 *
 * Household-authored curriculum still lives in the data tree and is still read
 * through adapters; this is the compiled-in beginner course only.
 *
 * Generated from the retired `course.yml` with js-yaml — the same parser that
 * used to read it — so the shape is byte-for-byte what the catalog always saw.
 */
export const RUBIKS_CUBE_COURSE_SOURCE = Object.freeze({
    "schema": "school.rubiks-cube-course/v1",
    "id": "beginner-v1",
    "revision": 3,
    "title": "Rubik’s Cube Foundations",
    "sourceProvenance": {
      "method": "original, layered beginner course",
      "references": [
        "private-rubiks-cube-library"
      ]
    },
    "units": [
      {
        "id": "know-the-cube",
        "title": "Know the cube",
        "lessons": [
          {
            "id": "centres-and-pieces",
            "type": "demo",
            "title": "Centres",
            "edges": null,
            "and corners": null,
            "prompt": "Centres stay put. They tell you which colour belongs on each face.",
            "moves": [
              "R",
              "R'"
            ]
          },
          {
            "id": "read-notation",
            "type": "demo",
            "title": "Read cube notation",
            "prompt": "A letter names a face. A prime means turn it the other way.",
            "moves": [
              "R",
              "U",
              "R'",
              "U'"
            ]
          },
          {
            "id": "turn-practice",
            "type": "solve",
            "title": "Turn practice",
            "prompt": "Use the face buttons to return this little scramble to solved.",
            "seed": 101,
            "scrambleLength": 3,
            "goal": "solved"
          },
          {
            "id": "know-the-cube-quiz",
            "type": "quiz",
            "title": "Notation check",
            "prompt": "What does the letter R name?",
            "questions": [
              {
                "prompt": "What does the letter R name?",
                "options": [
                  "The right face",
                  "A red sticker",
                  "A reset",
                  "A row"
                ],
                "answer": 0
              },
              {
                "prompt": "Which symbol means turn a face counter-clockwise?",
                "options": [
                  "2",
                  "x",
                  "'",
                  "+"
                ],
                "answer": 2
              },
              {
                "prompt": "How many stickers are on a 3×3 cube?",
                "options": [
                  "27",
                  "36",
                  "54",
                  "48"
                ],
                "answer": 2
              },
              {
                "prompt": "What stays fixed and tells you each face colour?",
                "options": [
                  "Edges",
                  "Centres",
                  "Algorithms",
                  "Corners"
                ],
                "answer": 1
              },
              {
                "prompt": "What does a 2 after a move mean?",
                "options": [
                  "Turn it slowly",
                  "Undo it",
                  "Use two faces",
                  "Turn it twice"
                ],
                "answer": 3
              }
            ]
          }
        ]
      },
      {
        "id": "white-cross",
        "title": "Build the white cross",
        "lessons": [
          {
            "id": "cross-goal",
            "type": "demo",
            "title": "Meet the white cross",
            "prompt": "A cross edge must match white and the side centre.",
            "moves": [
              "F",
              "R",
              "F'",
              "R'"
            ]
          },
          {
            "id": "cross-edges",
            "type": "solve",
            "title": "Match cross edges",
            "prompt": "Build the white cross",
            "matching each side colour to its centre.": null,
            "seed": 201,
            "goal": "white-cross"
          },
          {
            "id": "cross-strategy",
            "type": "solve",
            "title": "Plan before turning",
            "prompt": "Make the white cross with patient",
            "deliberate turns.": null,
            "seed": 202,
            "goal": "white-cross"
          },
          {
            "id": "cross-challenge",
            "type": "challenge",
            "title": "White cross challenge",
            "prompt": "Build a correct white cross without a timer.",
            "seed": 203,
            "goal": "white-cross"
          },
          {
            "id": "white-cross-quiz",
            "type": "quiz",
            "title": "Cross check",
            "prompt": "What makes a white cross edge correct?",
            "questions": [
              {
                "prompt": "What makes a white cross edge correct?",
                "options": [
                  "It matches white and its side centre",
                  "It only has a white sticker",
                  "It sits beside any edge",
                  "It is in the middle layer"
                ],
                "answer": 0
              },
              {
                "prompt": "Which symbol means turn a face counter-clockwise?",
                "options": [
                  "2",
                  "x",
                  "'",
                  "+"
                ],
                "answer": 2
              },
              {
                "prompt": "How many stickers are on a 3×3 cube?",
                "options": [
                  "27",
                  "36",
                  "54",
                  "48"
                ],
                "answer": 2
              },
              {
                "prompt": "What stays fixed and tells you each face colour?",
                "options": [
                  "Edges",
                  "Centres",
                  "Algorithms",
                  "Corners"
                ],
                "answer": 1
              },
              {
                "prompt": "What does a 2 after a move mean?",
                "options": [
                  "Turn it slowly",
                  "Undo it",
                  "Use two faces",
                  "Turn it twice"
                ],
                "answer": 3
              }
            ]
          }
        ]
      },
      {
        "id": "white-corners",
        "title": "Finish the first layer",
        "lessons": [
          {
            "id": "right-trigger",
            "type": "demo",
            "title": "The right trigger",
            "prompt": "This short move pattern is one of your best tools.",
            "moves": [
              "R",
              "U",
              "R'",
              "U'"
            ]
          },
          {
            "id": "left-trigger",
            "type": "demo",
            "title": "The left trigger",
            "prompt": "The mirror image helps corners enter from the other side.",
            "moves": [
              "L'",
              "U'",
              "L",
              "U"
            ]
          },
          {
            "id": "corner-practice",
            "type": "solve",
            "title": "Insert a corner",
            "prompt": "Finish the complete white layer and match every side colour.",
            "seed": 301,
            "goal": "first-layer"
          },
          {
            "id": "first-layer-challenge",
            "type": "challenge",
            "title": "First-layer challenge",
            "prompt": "Use the triggers you just learned.",
            "seed": 302,
            "goal": "first-layer"
          },
          {
            "id": "white-corners-quiz",
            "type": "quiz",
            "title": "First-layer check",
            "prompt": "How many colours does a corner piece have?",
            "questions": [
              {
                "prompt": "How many colours does a corner piece have?",
                "options": [
                  "Two",
                  "Four",
                  "Three",
                  "One"
                ],
                "answer": 2
              }
            ]
          }
        ]
      },
      {
        "id": "middle-layer",
        "title": "Solve the middle layer",
        "lessons": [
          {
            "id": "middle-right",
            "type": "demo",
            "title": "Send an edge right",
            "prompt": "This sequence makes room",
            "then places an edge on the right.": null,
            "moves": [
              "U",
              "R",
              "U'",
              "R'",
              "U'",
              "F'",
              "U",
              "F"
            ]
          },
          {
            "id": "middle-left",
            "type": "demo",
            "title": "Send an edge left",
            "prompt": "This is the mirror sequence for an edge on the left.",
            "moves": [
              "U'",
              "L'",
              "U",
              "L",
              "U",
              "F",
              "U'",
              "F'"
            ]
          },
          {
            "id": "middle-layer-practice",
            "type": "solve",
            "title": "Middle-layer practice",
            "prompt": "Finish the first two layers with patient",
            "deliberate turns.": null,
            "seed": 401,
            "goal": "middle-layer"
          },
          {
            "id": "middle-layer-challenge",
            "type": "challenge",
            "title": "Middle-layer challenge",
            "prompt": "Complete the first two layers.",
            "seed": 402,
            "goal": "middle-layer"
          },
          {
            "id": "middle-layer-quiz",
            "type": "quiz",
            "title": "Middle-layer check",
            "prompt": "How do you choose a middle-layer insertion?",
            "questions": [
              {
                "prompt": "How do you choose a middle-layer insertion?",
                "options": [
                  "Choose left or right from the target centre",
                  "Always use the right algorithm",
                  "Turn the whole cube over",
                  "Use only double turns"
                ],
                "answer": 0
              }
            ]
          }
        ]
      },
      {
        "id": "yellow-face",
        "title": "Make the yellow face",
        "lessons": [
          {
            "id": "yellow-cross-algorithm",
            "type": "demo",
            "title": "Make a yellow cross",
            "prompt": "Use the same sequence to orient the top edges.",
            "moves": [
              "F",
              "R",
              "U",
              "R'",
              "U'",
              "F'"
            ]
          },
          {
            "id": "orient-corners",
            "type": "demo",
            "title": "Turn yellow corners up",
            "prompt": "A short repeated algorithm turns one corner at a time.",
            "moves": [
              "R",
              "U",
              "R'",
              "U",
              "R",
              "U2",
              "R'"
            ]
          },
          {
            "id": "yellow-face-practice",
            "type": "solve",
            "title": "Yellow-face practice",
            "prompt": "Make every top sticker yellow; side pieces can wait.",
            "seed": 501,
            "goal": "yellow-oriented"
          },
          {
            "id": "yellow-face-challenge",
            "type": "challenge",
            "title": "Yellow-face challenge",
            "prompt": "Make the yellow face without a timer.",
            "seed": 502,
            "goal": "yellow-oriented"
          },
          {
            "id": "yellow-face-quiz",
            "type": "quiz",
            "title": "Yellow-face check",
            "prompt": "What comes first on the yellow face?",
            "questions": [
              {
                "prompt": "What comes first on the yellow face?",
                "options": [
                  "Permute every edge",
                  "Orient the top colour",
                  "Break the cross",
                  "Turn the cube upside down"
                ],
                "answer": 1
              }
            ]
          }
        ]
      },
      {
        "id": "last-layer",
        "title": "Put the last layer in place",
        "lessons": [
          {
            "id": "position-corners",
            "type": "demo",
            "title": "Position the last corners",
            "prompt": "Now their colours point up; put the corners in their homes.",
            "moves": [
              "U",
              "R",
              "U'",
              "L'",
              "U",
              "R'",
              "U'",
              "L"
            ]
          },
          {
            "id": "position-edges",
            "type": "demo",
            "title": "Position the last edges",
            "prompt": "The final edge cycle brings the whole cube home.",
            "moves": [
              "R2",
              "U",
              "R",
              "U",
              "R'",
              "U'",
              "R'",
              "U'",
              "R'",
              "U",
              "R'"
            ]
          },
          {
            "id": "last-layer-practice",
            "type": "solve",
            "title": "Last-layer practice",
            "prompt": "Solve this final-layer scramble.",
            "seed": 601
          },
          {
            "id": "last-layer-challenge",
            "type": "challenge",
            "title": "Last-layer challenge",
            "prompt": "Complete the whole cube without a timer.",
            "seed": 602
          },
          {
            "id": "last-layer-quiz",
            "type": "quiz",
            "title": "Last-layer check",
            "prompt": "What is the useful last-layer order?",
            "questions": [
              {
                "prompt": "What is the useful last-layer order?",
                "options": [
                  "Position",
                  "then orient",
                  "Orient",
                  "then position",
                  "Scramble",
                  "then reset"
                ],
                "answer": 1
              }
            ]
          }
        ]
      },
      {
        "id": "complete-the-cube",
        "title": "Complete the cube",
        "lessons": [
          {
            "id": "guided-full-solve",
            "type": "solve",
            "title": "Guided full solve",
            "prompt": "Put every stage together with the hint ladder nearby.",
            "seed": 701
          },
          {
            "id": "fresh-full-solve",
            "type": "challenge",
            "title": "Fresh full solve",
            "prompt": "Solve a 20-move scramble. Time is a personal best",
            "never a gate.": null,
            "seed": 702,
            "scrambleLength": 20
          },
          {
            "id": "personal-best-replay",
            "type": "challenge",
            "title": "Try for a personal best",
            "prompt": "Try another complete solve at your own pace.",
            "seed": 703,
            "scrambleLength": 20
          },
          {
            "id": "final-quiz",
            "type": "quiz",
            "title": "Rubik’s Cube Foundations",
            "prompt": "What is the goal of this course?",
            "questions": [
              {
                "prompt": "What is the goal of this course?",
                "options": [
                  "A complete layer-by-layer solve",
                  "Memorize one random move",
                  "Only solve a white face",
                  "Finish in a fixed time"
                ],
                "answer": 0
              }
            ]
          }
        ]
      }
    ]
  });

export default RUBIKS_CUBE_COURSE_SOURCE;
