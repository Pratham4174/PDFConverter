const { IncomingForm } = require('formidable');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');
const XLSX = require('xlsx');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { fields, fileBuffer, originalName } = await parseForm(req);
    const targetFormat = Array.isArray(fields.targetFormat) ? fields.targetFormat[0] : fields.targetFormat;
    const inputExt = originalName.split('.').pop().toLowerCase();
    const baseName = originalName.replace(/\.[^.]+$/, '');
    const imageExts = ['jpg','jpeg','png','gif','bmp','webp','tiff','tif'];

    let outputBuffer, mimeType = 'application/octet-stream';

    // Image → PDF
    if (imageExts.includes(inputExt) && targetFormat === 'pdf') {
      const pdfDoc = await PDFDocument.create();
      let img;
      try { img = ['jpg','jpeg'].includes(inputExt) ? await pdfDoc.embedJpg(fileBuffer) : await pdfDoc.embedPng(fileBuffer); }
      catch { img = await pdfDoc.embedJpg(fileBuffer); }
      const page = pdfDoc.addPage([img.width, img.height]);
      page.drawImage(img, { x:0, y:0, width:img.width, height:img.height });
      outputBuffer = Buffer.from(await pdfDoc.save());
      mimeType = 'application/pdf';
    }
    // PDF → DOCX
    else if (inputExt === 'pdf' && ['doc','docx'].includes(targetFormat)) {
      const data = await pdfParse(fileBuffer);
      const paragraphs = data.text.split('\n').filter(l=>l.trim()).map(line => {
        const t = line.trim();
        const isH = t.length < 60 && t === t.toUpperCase() && t.length > 3;
        return new Paragraph({ children:[new TextRun({text:t, bold:isH, size:isH?26:22})], heading:isH?HeadingLevel.HEADING_2:undefined, spacing:{after:100} });
      });
      const doc = new Document({ sections:[{ properties:{}, children:paragraphs }] });
      outputBuffer = await Packer.toBuffer(doc);
      mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    // PDF → TXT
    else if (inputExt === 'pdf' && targetFormat === 'txt') {
      const data = await pdfParse(fileBuffer);
      outputBuffer = Buffer.from(data.text, 'utf8');
      mimeType = 'text/plain';
    }
    // DOCX → PDF
    else if (['doc','docx'].includes(inputExt) && targetFormat === 'pdf') {
      const result = await mammoth.extractRawText({ buffer: fileBuffer });
      outputBuffer = await textToPdfBuffer(result.value);
      mimeType = 'application/pdf';
    }
    // TXT / MD → PDF
    else if (['txt','md'].includes(inputExt) && targetFormat === 'pdf') {
      outputBuffer = await textToPdfBuffer(fileBuffer.toString('utf8'));
      mimeType = 'application/pdf';
    }
    // XLSX / CSV → PDF
    else if (['xlsx','xls','csv'].includes(inputExt) && targetFormat === 'pdf') {
      const wb = XLSX.read(fileBuffer, { type:'buffer' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header:1 });
      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      let page = pdfDoc.addPage([842,595]); let y = 560;
      for (let r=0; r<rows.length; r++) {
        if (y<40){ page=pdfDoc.addPage([842,595]); y=560; }
        const row=rows[r]; const colW=Math.min(120,762/Math.max(row.length,1));
        row.forEach((cell,c)=>page.drawText(String(cell??'').substring(0,18),{x:40+c*colW,y,size:9,font:r===0?boldFont:font,color:rgb(0,0,0)}));
        if(r===0) page.drawLine({start:{x:40,y:y-3},end:{x:800,y:y-3},thickness:0.5,color:rgb(0.5,0.5,0.5)});
        y-=18;
      }
      outputBuffer = Buffer.from(await pdfDoc.save());
      mimeType = 'application/pdf';
    }
    // CSV → XLSX
    else if (inputExt==='csv' && targetFormat==='xlsx') {
      const wb = XLSX.read(fileBuffer, {type:'buffer'});
      outputBuffer = XLSX.write(wb, {type:'buffer', bookType:'xlsx'});
      mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }
    // XLSX → CSV
    else if (['xlsx','xls'].includes(inputExt) && targetFormat==='csv') {
      const wb = XLSX.read(fileBuffer, {type:'buffer'});
      outputBuffer = Buffer.from(XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]), 'utf8');
      mimeType = 'text/csv';
    }
    else {
      return res.status(400).json({ error:`Conversion from .${inputExt} to .${targetFormat} is not supported.` });
    }

    const outputName = `${baseName}_converted.${targetFormat}`;
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${outputName}"`);
    res.setHeader('Content-Length', outputBuffer.length);
    return res.status(200).send(outputBuffer);

  } catch (err) {
    console.error('Convert error:', err);
    return res.status(500).json({ error: err.message || 'Conversion failed' });
  }
};

module.exports.config = { api: { bodyParser: false, responseLimit: '50mb' } };

// Parse multipart form → returns buffer in memory
function parseForm(req) {
  return new Promise((resolve, reject) => {
    let fileBuffer = null, originalName = 'file', fields = {};
    const form = new IncomingForm({ maxFileSize: 50*1024*1024 });
    form.on('field', (name, val) => { fields[name] = val; });
    form.on('file', (name, file) => { originalName = file.originalFilename || file.name || 'file'; });
    form.on('fileBegin', (name, file) => {
      const chunks = [];
      file._writeStream = {
        write(chunk){ chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk)); },
        end(){ fileBuffer = Buffer.concat(chunks); },
        destroy(){}
      };
    });
    form.on('error', reject);
    form.on('end', () => resolve({ fields, fileBuffer, originalName }));
    form.parse(req);
  });
}

async function textToPdfBuffer(text) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  let page = pdfDoc.addPage([595, 842]); let y = 800;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim(); if (!line){ y-=6; continue; }
    const isHeader = /^[A-Z][A-Z\s&\/\-]{3,}$/.test(line);
    const isBullet = /^[•\-\*]\s/.test(line);
    const f = isHeader ? boldFont : font;
    const sz = isHeader ? 9 : 11;
    if (isHeader) {
      y-=4;
      page.drawRectangle({x:44,y:y-10,width:507,height:16,color:rgb(0.94,0.96,0.98)});
      page.drawText(line,{x:50,y,size:sz,font:boldFont,color:rgb(0.1,0.1,0.18)});
      page.drawLine({start:{x:50,y:y-3},end:{x:545,y:y-3},thickness:0.75,color:rgb(0.15,0.39,0.92)});
      y-=16; continue;
    }
    const displayLine = isBullet?'• '+line.replace(/^[•\-\*]\s/,''):line;
    const chunks = chunkText(displayLine, f, sz, 495);
    for (const chunk of chunks) {
      if (y<60){ page=pdfDoc.addPage([595,842]); y=800; }
      page.drawText(chunk,{x:50,y,size:sz,font:f,color:rgb(0.12,0.16,0.22)});
      y-=16;
    }
  }
  return Buffer.from(await pdfDoc.save());
}

function chunkText(text, font, size, maxWidth) {
  const words=text.split(' '); const lines=[]; let current='';
  for (const w of words) {
    const test=current?`${current} ${w}`:w;
    try { if(font.widthOfTextAtSize(test,size)>maxWidth){if(current)lines.push(current);current=w;}else{current=test;} }
    catch { current=test; }
  }
  if(current)lines.push(current);
  return lines.length?lines:[text.substring(0,80)];
}
