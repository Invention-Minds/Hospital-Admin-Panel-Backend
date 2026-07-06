import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

/**
 * Shared JMRH letterhead/footer helpers for pdfkit reports.
 *
 * The hospital's PDF template (the estimation form) carries the header band +
 * footer band + watermark, so we paint it as a full-page background. If the
 * asset is unavailable at runtime, we fall back to a clean text letterhead so
 * generation never fails.
 *
 * Mechanism copied verbatim (in behaviour) from lama-dama's generateReportPdf
 * so it can never create blank/extra pages.
 */

export const HOSPITAL_NAME =
  "Jayadev Memorial Rashtrotthana Hospital & Research Centre";

/** Body content starts below the template's header band. */
export const CONTENT_TOP = 120;

const BACKGROUND_IMAGE_PATH = path.join(
  __dirname,
  "../../assets/JMRH Estimation Form.png"
);

/**
 * Paint the JMRH letterhead on the current page, register a repaint on every
 * new page, and position the cursor below the header band (doc.y = CONTENT_TOP).
 * Falls back to a text letterhead if the template asset is missing.
 */
export const applyJmrhLetterhead = (doc: PDFKit.PDFDocument): void => {
  const hasLetterhead = fs.existsSync(BACKGROUND_IMAGE_PATH);
  const LEFT = doc.page.margins.left;
  const RIGHT = doc.page.width - doc.page.margins.right;
  const CONTENT_WIDTH = RIGHT - LEFT;

  const drawLetterhead = (): void => {
    if (hasLetterhead) {
      doc.image(BACKGROUND_IMAGE_PATH, 0, 0, {
        width: doc.page.width,
        height: doc.page.height,
      });
      doc.y = CONTENT_TOP; // start body below the template header band
    } else {
      doc.save();
      doc
        .fontSize(15)
        .font("Helvetica-Bold")
        .fillColor("black")
        .text(HOSPITAL_NAME, LEFT, 50, {
          width: CONTENT_WIDTH,
          align: "center",
        });
      const ruleY = doc.y + 4;
      doc
        .moveTo(LEFT, ruleY)
        .lineTo(RIGHT, ruleY)
        .lineWidth(1)
        .strokeColor("#999")
        .stroke();
      doc.restore();
      doc.y = ruleY + 10;
    }
  };

  // Re-paint the letterhead on every new page so multi-page reports stay branded.
  doc.on("pageAdded", drawLetterhead);
  drawLetterhead();
};

/**
 * Draw a per-page footer on every buffered page: thin rule, hospital name
 * (left), "Page i of N" (right), and a generated timestamp.
 *
 * SAFE footer: removes the pageAdded letterhead listener and zeroes the bottom
 * margin while writing so footer text positioned below the normal content area
 * never auto-adds a (blank, branded) page. Requires bufferPages: true.
 */
export const drawJmrhFooter = (
  doc: PDFKit.PDFDocument,
  generatedAt: Date
): void => {
  // Stop re-painting the letterhead before drawing footers: writing in the
  // bottom-margin zone must NOT trigger new (blank, branded) pages.
  doc.removeAllListeners("pageAdded");

  const LEFT = doc.page.margins.left;
  const RIGHT = doc.page.width - doc.page.margins.right;
  const CONTENT_WIDTH = RIGHT - LEFT;
  const footerStamp = `Generated: ${generatedAt.toLocaleString()}`;

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    // Zero the bottom margin while drawing so footer text positioned below the
    // normal content area doesn't auto-add a page. Restore afterwards.
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const footerY = doc.page.height - 40;
    doc
      .lineWidth(0.5)
      .strokeColor("#cccccc")
      .moveTo(LEFT, footerY)
      .lineTo(RIGHT, footerY)
      .stroke();
    doc.fontSize(8).font("Helvetica").fillColor("#888");
    doc.text(HOSPITAL_NAME, LEFT, footerY + 5, {
      width: CONTENT_WIDTH * 0.65,
      align: "left",
      lineBreak: false,
    });
    doc.text(`Page ${i + 1} of ${range.count}`, RIGHT - 120, footerY + 5, {
      width: 120,
      align: "right",
      lineBreak: false,
    });
    doc.text(footerStamp, LEFT, footerY + 16, {
      width: CONTENT_WIDTH,
      align: "left",
      lineBreak: false,
    });
    doc.fillColor("black");
    doc.page.margins.bottom = savedBottom;
  }
};
