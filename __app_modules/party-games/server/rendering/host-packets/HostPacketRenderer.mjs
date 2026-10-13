import PDFDocument from 'pdfkit';

export class HostPacketRenderer {
  async render({ title = 'Party Games Host Packet', definition = {}, session = {} }) {
    return new Promise((resolve, reject) => {
      const document = new PDFDocument({ size: 'LETTER', margin: 50, info: { Title: title } }); const chunks = [];
      document.on('data', (chunk) => chunks.push(chunk)); document.on('error', reject); document.on('end', () => resolve(Buffer.concat(chunks)));
      document.fontSize(24).text(title); document.moveDown(.4).fontSize(10).fillColor('#555').text(`Session ${session.header?.session_id || ''}`); document.moveDown().fillColor('#000');
      if (Array.isArray(definition.challenges)) definition.challenges.forEach((challenge, index) => { document.fontSize(14).text(`${index + 1}. ${String(challenge.activity || 'activity').toUpperCase()}`); document.fontSize(12).text(challenge.prompt || ''); if (challenge.decoder?.text) document.fillColor('#666').text(`Decoder: ${challenge.decoder.text}`).fillColor('#000'); document.moveDown(.7); if (document.y > 700) document.addPage(); });
      else if (Array.isArray(definition.rounds)) definition.rounds.forEach((round) => { document.fontSize(16).text(round.name || 'Round'); for (const category of round.categories || []) { document.fontSize(12).text(category.name, { underline: true }); for (const clue of category.clues || []) document.fontSize(9).text(`${clue.value}: ${clue.clue} — ${clue.answer}`); document.moveDown(.4); } });
      else document.fontSize(12).text('No host-only prompts are required for this experience.');
      document.end();
    });
  }
}
