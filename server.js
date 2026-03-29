const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const util = require('util');
require('dotenv').config();

const execAsync = util.promisify(exec);
const app = express();
const PORT = process.env.PORT || 3000;

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
[UPLOAD_DIR, OUTPUT_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

function cleanup(...files) {
  files.forEach(f => { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {} });
}

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/convert', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { targetFormat } = req.body;
  const inputPath = req.file.path;
  const baseName = path.basename(req.file.originalname, path.extname(req.file.originalname));
  const outputName = `${baseName}_converted.${targetFormat}`;
  const outputPath = path.join(OUTPUT_DIR, `${Date.now()}-${outputName}`);
  const inputExt = path.extname(req.file.originalname).toLowerCase().replace('.', '');
  try {
    await convert(inputPath, outputPath, inputExt, targetFormat);
    res.download(outputPath, outputName, (err) => {
      cleanup(inputPath, outputPath);
      if (err && !res.headersSent) res.status(500).json({ error: 'Download failed' });
    });
  } catch (err) {
    cleanup(inputPath, outputPath);
    console.error('Conversion error:', err.message);
    res.status(500).json({ error: err.message || 'Conversion failed' });
  }
});

// Also keep the resume optimizer endpoint
// app.post('/api/optimize', async (req, res) => {
//   try {
//     const axios = require('axios');
//     const { model, max_tokens, messages } = req.body;
//     if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: { message: 'ANTHROPIC_API_KEY not configured.' } });
//     const response = await axios.post('https://api.anthropic.com/v1/messages',
//       { model, max_tokens, messages },
//       { headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, timeout: 60000 }
//     );
//     res.json(response.data);
//   } catch (err) {
//     res.status(err.response?.status || 500).json({ error: { message: err.response?.data?.error?.message || err.message } });
//   }
// });

function chunkText(text, font, size, maxWidth) {
  const words = text.split(' ');
  const lines = []; let current = '';
  for (const w of words) {
    const test = current ? `${current} ${w}` : w;
    try {
      if (font.widthOfTextAtSize(test, size) > maxWidth) { if (current) lines.push(current); current = w; }
      else { current = test; }
    } catch { current = test; }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [text.substring(0, 80)];
}

async function convert(inputPath, outputPath, inputExt, targetFormat) {
  const imageExts = ['jpg','jpeg','png','gif','bmp','webp','tiff','tif'];

  // Image → PDF
  if (imageExts.includes(inputExt) && targetFormat === 'pdf') {
    const { PDFDocument } = require('pdf-lib');
    const sharp = require('sharp');
    const pdfDoc = await PDFDocument.create();
    const jpgBuf = await sharp(inputPath).jpeg({ quality: 95 }).toBuffer();
    const img = await pdfDoc.embedJpg(jpgBuf);
    const page = pdfDoc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    fs.writeFileSync(outputPath, await pdfDoc.save());
    return;
  }

  // Image → Image
  if (imageExts.includes(inputExt) && imageExts.includes(targetFormat)) {
    const sharp = require('sharp');
    const fmt = targetFormat === 'jpg' ? 'jpeg' : targetFormat;
    await sharp(inputPath)[fmt]({ quality: 95 }).toFile(outputPath);
    return;
  }

  // PDF → Image
  if (inputExt === 'pdf' && ['jpg','jpeg','png'].includes(targetFormat)) {
    const { fromPath } = require('pdf2pic');
    const conv = fromPath(inputPath, {
      density: 150, saveFilename: 'page', savePath: path.dirname(outputPath),
      format: targetFormat === 'jpg' ? 'jpeg' : targetFormat, width: 1200, height: 1600
    });
    const result = await conv(1);
    fs.renameSync(result.path, outputPath);
    return;
  }

  // DOCX → PDF (LibreOffice first, fallback to mammoth)
  if (['doc','docx'].includes(inputExt) && targetFormat === 'pdf') {
    try {
      await execAsync(`soffice --headless --convert-to pdf --outdir "${path.dirname(outputPath)}" "${inputPath}"`);
      const generated = path.join(path.dirname(outputPath), path.basename(inputPath, path.extname(inputPath)) + '.pdf');
      if (fs.existsSync(generated)) { fs.renameSync(generated, outputPath); return; }
    } catch {}
    const mammoth = require('mammoth');
    const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
    const result = await mammoth.extractRawText({ path: inputPath });
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    let page = pdfDoc.addPage([595, 842]); let y = 800;
    for (const line of result.value.split('\n')) {
      const chunks = chunkText(line || ' ', font, 11, 495);
      for (const chunk of chunks) {
        if (y < 60) { page = pdfDoc.addPage([595, 842]); y = 800; }
        page.drawText(chunk, { x: 50, y, size: 11, font, color: rgb(0,0,0) });
        y -= 16;
      }
    }
    fs.writeFileSync(outputPath, await pdfDoc.save());
    return;
  }

  // PDF → DOCX
  if (inputExt === 'pdf' && ['doc','docx'].includes(targetFormat)) {
    const pdfParse = require('pdf-parse');
    const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');
    const data = await pdfParse(fs.readFileSync(inputPath));
    const paragraphs = data.text.split('\n').filter(l => l.trim()).map(line => {
      const t = line.trim();
      const isH = t.length < 60 && t === t.toUpperCase() && t.length > 3;
      return new Paragraph({
        children: [new TextRun({ text: t, bold: isH, size: isH ? 26 : 22 })],
        heading: isH ? HeadingLevel.HEADING_2 : undefined,
        spacing: { after: 100 }
      });
    });
    const doc = new Document({ sections: [{ properties: {}, children: paragraphs }] });
    fs.writeFileSync(outputPath, await Packer.toBuffer(doc));
    return;
  }

  // PDF → TXT
  if (inputExt === 'pdf' && targetFormat === 'txt') {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(fs.readFileSync(inputPath));
    fs.writeFileSync(outputPath, data.text);
    return;
  }

  // TXT / MD → PDF
  if (['txt','md'].includes(inputExt) && targetFormat === 'pdf') {
    const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
    const text = fs.readFileSync(inputPath, 'utf8');
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    let page = pdfDoc.addPage([595, 842]); let y = 800;
    for (const line of text.split('\n')) {
      const chunks = chunkText(line || ' ', font, 11, 495);
      for (const chunk of chunks) {
        if (y < 60) { page = pdfDoc.addPage([595, 842]); y = 800; }
        page.drawText(chunk, { x: 50, y, size: 11, font, color: rgb(0,0,0) });
        y -= 16;
      }
    }
    fs.writeFileSync(outputPath, await pdfDoc.save());
    return;
  }

  // XLSX / CSV → PDF
  if (['xlsx','xls','csv'].includes(inputExt) && targetFormat === 'pdf') {
    const XLSX = require('xlsx');
    const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
    const wb = XLSX.readFile(inputPath);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    let page = pdfDoc.addPage([842, 595]); let y = 560;
    for (let r = 0; r < rows.length; r++) {
      if (y < 40) { page = pdfDoc.addPage([842, 595]); y = 560; }
      const row = rows[r]; const colW = Math.min(120, 762 / Math.max(row.length, 1));
      row.forEach((cell, c) => {
        page.drawText(String(cell ?? '').substring(0, 18), { x: 40 + c * colW, y, size: 9, font: r === 0 ? boldFont : font, color: rgb(0,0,0) });
      });
      if (r === 0) page.drawLine({ start: {x:40, y:y-3}, end: {x:800, y:y-3}, thickness: 0.5, color: rgb(0.5,0.5,0.5) });
      y -= 18;
    }
    fs.writeFileSync(outputPath, await pdfDoc.save());
    return;
  }

  // CSV ↔ XLSX
  if (inputExt === 'csv' && targetFormat === 'xlsx') {
    const XLSX = require('xlsx'); const wb = XLSX.readFile(inputPath); XLSX.writeFile(wb, outputPath); return;
  }
  if (['xlsx','xls'].includes(inputExt) && targetFormat === 'csv') {
    const XLSX = require('xlsx'); const wb = XLSX.readFile(inputPath);
    fs.writeFileSync(outputPath, XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]])); return;
  }

  throw new Error(`Conversion from .${inputExt} to .${targetFormat} is not supported yet.`);
}

app.listen(PORT, () => {
  console.log(`\n🚀 FileConvert + ResumeSync running on http://localhost:${PORT}\n`);
});
