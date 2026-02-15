import fs from 'node:fs/promises';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

function clamp01(n) {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export async function stampSignedPdf({ originalPdfPath, outPdfPath, fieldsWithSignatures }) {
  const bytes = await fs.readFile(originalPdfPath);
  const pdfDoc = await PDFDocument.load(bytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Group by page
  const byPage = new Map();
  for (const row of fieldsWithSignatures) {
    if (!row.signature_id) continue;
    const pageIndex = row.page - 1;
    if (!byPage.has(pageIndex)) byPage.set(pageIndex, []);
    byPage.get(pageIndex).push(row);
  }

  for (const [pageIndex, rows] of byPage.entries()) {
    const page = pdfDoc.getPage(pageIndex);
    if (!page) continue;
    const { width: pageW, height: pageH } = page.getSize();

    for (const r of rows) {
      const x = clamp01(r.x) * pageW;
      const w = clamp01(r.w) * pageW;
      const h = clamp01(r.h) * pageH;
      const yTop = clamp01(r.y) * pageH;
      const y = pageH - yTop - h; // convert top-origin to bottom-origin

      if (r.signature_type === 'signature' && r.signature_png_path) {
        const pngBytes = await fs.readFile(r.signature_png_path);
        const img = await pdfDoc.embedPng(pngBytes);
        const scale = Math.min(w / img.width, h / img.height);
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        const drawX = x + (w - drawW) / 2;
        const drawY = y + (h - drawH) / 2;
        page.drawImage(img, { x: drawX, y: drawY, width: drawW, height: drawH });
      } else if (r.signature_type === 'text' && r.signature_text_value) {
        const text = String(r.signature_text_value).slice(0, 200);
        const fontSize = Math.max(8, Math.min(18, h * 0.7));
        page.drawText(text, {
          x: x + 2,
          y: y + (h - fontSize) / 2,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
          maxWidth: Math.max(10, w - 4)
        });
      }
    }
  }

  const outBytes = await pdfDoc.save();
  await fs.writeFile(outPdfPath, outBytes);
}

