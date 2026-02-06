import React from "react";


export function convertVersesToScriptureData(verses) {
  // This array will hold the final structured blocks
  const blocks = [];

  // Helper to create a new block
  const createBlock = (elementType) => {
    return {
      e: elementType,      // "p", "blockquote", "h4", etc.
      verse_ids: [],       // Which verse IDs are part of this block
      verses: [],          // The verse numbers (e.g., "1", "2", etc.)
      contents: []         // Array of { line: string, indent: boolean } objects
    };
  };

  // Active block that we're currently adding content to
  let currentBlock = null;

  // Pushes the currentBlock into blocks (if it has content) and resets it
  const finalizeBlock = () => {
    if (currentBlock && currentBlock.contents.length > 0) {
      blocks.push(currentBlock);
    }
    currentBlock = null;
  };

  verses.forEach((verse) => {
    const { verse_id, verse: verseNumber, format, headings, text } = verse;

    // If there is a heading, that becomes its own block (h4)
    if (headings) {
      const {heading,summary,background, headnote} = headings;
      // Close out any existing block first
      finalizeBlock();
      if(background) blocks.push({  e: "p",  className: "background", contents: [{ line: background}] });
      if(summary) blocks.push({  e: "p",  className: "summary", contents: [{ line: summary}] });
      if(heading) blocks.push({  e: "h4",  heading});
      if(headnote) blocks.push({  e: "p",  className: "headnote", contents: [{ line: headnote}] });
    }

    // Decide if the new verse belongs to a "blockquote" (poetry) or a "p" (prose)
    const isPoetry = (format === "poetry");

    // If the block doesn't exist yet, or the format changed (poetry <--> prose), finalize and start a new block
    if (
      !currentBlock ||
      (isPoetry && currentBlock.e !== "blockquote") ||
      (!isPoetry && currentBlock.e !== "p")
    ) {
      finalizeBlock();
      currentBlock = createBlock(isPoetry ? "blockquote" : "p");
    }

    // Record which verse IDs and numbers belong to this block
    currentBlock.verse_ids.push(verse_id);
    if (verseNumber) {
      currentBlock.verses.push(verseNumber);
    }

    // Split the text by recognized markers
    const tokens = text.split(/(§¶|¶|▼|◄|\/|_)/);
    let currentLineText = "";
    let currentLineIndent = false;

    const processLine = (line) => {
      // Handle line processing here if needed
      line = line.trim().replace(/｢\d+｣/g, "");
      // make uppercase whole word small caps
      line = line.replace(/｟(.*?)｠/g, (_, match) => ` ${match.toUpperCase()}`);
      return line;
    }

    // Helper to push the current line into the block, then reset
    const pushCurrentLine = () => {
      if (currentLineText.trim().length > 0) {
        currentBlock.contents.push({
          // Strip out bracketed references like ｢367｣
          line: processLine(currentLineText),
          indent: currentLineIndent
        });
      }
      currentLineText = "";
      currentLineIndent = false;
    };

    tokens.forEach((token) => {
      switch (token) {
        // Paragraph markers
        case "§¶":
        case "¶":
          pushCurrentLine();
          // If we're currently in a paragraph block, finalize it
          if (currentBlock.e === "p") {
            finalizeBlock();
            currentBlock = createBlock("p");
            // Verse associations carry on for subsequent text in the same verse,
            // but we keep the same block since it's still "prose"
            currentBlock.verse_ids.push(verse_id);
            if (verseNumber) {
              currentBlock.verses.push(verseNumber);
            }
          }
          break;

        // Switch to poetry
        case "▼":
          pushCurrentLine();
          if (currentBlock.e !== "blockquote") {
            finalizeBlock();
            currentBlock = createBlock("blockquote");
            currentBlock.verse_ids.push(verse_id);
            if (verseNumber) {
              currentBlock.verses.push(verseNumber);
            }
          }
          break;

        // Return to prose
        case "◄":
          pushCurrentLine();
          if (currentBlock.e !== "p") {
            finalizeBlock();
            currentBlock = createBlock("p");
            currentBlock.verse_ids.push(verse_id);
            if (verseNumber) {
              currentBlock.verses.push(verseNumber);
            }
          }
          break;

        // Poetry line break
        case "/":
          pushCurrentLine();
          break;

        // Indent
        case "_":
          currentLineIndent = true;
          break;

        // Default text
        default:
          currentLineText += token;
          break;
      }
    });

    // Push any remaining text in this verse
    pushCurrentLine();
  });

  // Finalize any leftover block at the end
  finalizeBlock();

  return blocks;
}



export function scriptureDataToJSX(blocks) {
  return (
    <div className="scriptures">
      {blocks.map((block, index) => {
        const { e, heading, className, contents, verses } = block;

        // Decide how to render based on the “e” property
        switch (e) {
          case "h4":
            return (
              <h4 key={index} className="heading">
                {heading.replace(/｢\d+｣/g, "")}
              </h4>
            );

          case "p":
            return (
              <p key={index} className={className || "verse"}>
                {verses && <span className="verse-number">{verses?.[0]}</span>}
                {contents?.map((c, cIndex) => {
                  // Each entry is { line: string, indent: boolean }
                  const style = c.indent ? { marginLeft: "2em" } : {};
                  return (
                    <React.Fragment key={cIndex}>
                      <span style={style} className="verse-text">{c.line}{" "}</span>
                    </React.Fragment>
                  );
                })}
              </p>
            );

          case "blockquote":
            return (
              <blockquote key={index}>
                {contents?.map((c, cIndex) => {
                  // Each entry is { line: string, indent: boolean }
                  const style = c.indent ? { marginLeft: "2em" } : {};
                  return (
                    <React.Fragment key={cIndex}>
                      <span style={style} className="verse-text">{c.line}</span>
                      <br />
                    </React.Fragment>
                  );
                })}
              </blockquote>
            );

          default:
            // Fallback - unknown block types
            return (
              <div key={index}>
                {contents?.map((c, cIndex) => {
                  const style = c.indent ? { marginLeft: "2em" } : {};
                  return (
                    <React.Fragment key={cIndex}>
                      <span style={style}>{c.line}</span>{" "}
                    </React.Fragment>
                  );
                })}
              </div>
            );
        }
      })}
    </div>
  );
}
