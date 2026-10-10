function safeFilename(value, fallback = 'report') {
  const cleaned = String(value || fallback)
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || fallback;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Creates a real OOXML Word document (.docx) containing an RTL table.
 * `rows` and `headers` must already contain display-ready strings.
 */
export async function downloadRtlTableDocx({
  filename = 'report.docx',
  title = 'گزارش',
  subtitle = '',
  headers = [],
  rows = [],
  summary = [],
}) {
  const {
    AlignmentType,
    BorderStyle,
    Document,
    Packer,
    PageOrientation,
    Paragraph,
    ShadingType,
    Table,
    TableCell,
    TableRow,
    TextRun,
    VerticalAlign,
    WidthType,
  } = await import('docx');

  const borders = {
    top: { style: BorderStyle.SINGLE, size: 1, color: 'D8DEE3' },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: 'D8DEE3' },
    left: { style: BorderStyle.SINGLE, size: 1, color: 'D8DEE3' },
    right: { style: BorderStyle.SINGLE, size: 1, color: 'D8DEE3' },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'EDF0F2' },
    insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'EDF0F2' },
  };

  const paragraph = (value, options = {}) => new Paragraph({
    alignment: options.center ? AlignmentType.CENTER : AlignmentType.RIGHT,
    bidirectional: true,
    spacing: { before: 0, after: 0, line: 260 },
    children: [new TextRun({
      text: String(value ?? '—'),
      bold: Boolean(options.bold),
      color: options.color || '1B2126',
      size: options.size || 18,
      font: 'Tahoma',
      rightToLeft: true,
    })],
  });

  const cell = (value, options = {}) => new TableCell({
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 90, bottom: 90, left: 80, right: 80 },
    shading: options.header
      ? { type: ShadingType.CLEAR, fill: '10243D', color: 'FFFFFF' }
      : options.alternate
        ? { type: ShadingType.CLEAR, fill: 'FAFAFA', color: 'AUTO' }
        : undefined,
    children: [paragraph(value, {
      bold: options.header,
      color: options.header ? 'FFFFFF' : '1B2126',
      center: options.center,
      size: options.header ? 18 : 17,
    })],
  });

  const tableRows = [
    new TableRow({
      tableHeader: true,
      cantSplit: true,
      children: headers.map((header) => cell(header, { header: true, center: true })),
    }),
    ...rows.map((row, rowIndex) => new TableRow({
      cantSplit: true,
      children: row.map((value, columnIndex) => cell(value, {
        alternate: rowIndex % 2 === 1,
        center: columnIndex === 0,
      })),
    })),
  ];

  const children = [
    paragraph(title, { bold: true, center: true, size: 30 }),
  ];
  if (subtitle) {
    children.push(paragraph(subtitle, { center: true, size: 19, color: '5B6670' }));
  }
  children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
  children.push(new Table({
    rows: tableRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    visuallyRightToLeft: true,
    borders,
  }));
  if (summary.length) {
    children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
    summary.forEach((line) => children.push(paragraph(line, { bold: true, size: 19 })));
  }

  const report = new Document({
    creator: 'اتوماسیون آریامن',
    title,
    description: subtitle,
    styles: {
      default: {
        document: {
          run: { font: 'Tahoma', size: 18, rightToLeft: true },
          paragraph: { alignment: AlignmentType.RIGHT, bidirectional: true },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          size: { orientation: PageOrientation.LANDSCAPE },
          margin: { top: 720, right: 720, bottom: 720, left: 720 },
        },
      },
      children,
    }],
  });

  const blob = await Packer.toBlob(report);
  const baseName = safeFilename(String(filename).replace(/\.docx$/i, ''), 'report');
  downloadBlob(blob, `${baseName}.docx`);
}
