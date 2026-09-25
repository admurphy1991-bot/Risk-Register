import fs from "node:fs/promises";
import path from "node:path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeightRule,
  ImageRun,
  LevelFormat,
  PageBreak,
  PageNumber,
  PageOrientation,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlignTable as VerticalAlign,
  type TableVerticalAlign,
  WidthType,
  type ITableCellBorders,
} from "docx";
import {
  CONSEQUENCE_LABELS,
  LEVEL_HEX,
  LIKELIHOOD_LABELS,
  LIKELIHOOD_DESCRIPTIONS,
  CONSEQUENCE_DESCRIPTIONS,
  ratingLabel,
  scoreLevel,
} from "@/lib/risk-scoring";
import { CONSULTATION_TEXT, PPE_OPTIONS, TA_STATUS_LABELS, type TaFull } from "@/lib/ta";

// Generates the TA/SWMS Word document in the layout of Sansom's own template:
// A4 landscape, project details table, plant/chemicals table, PPE row, the
// job-step table with colour-coded ratings, responsible persons, the worker
// sign-on register, completion sign-off, and the risk matrix for reference.

const PAGE_W = 16838; // A4 landscape width (DXA)
const MARGIN = 720;
const CONTENT_W = PAGE_W - MARGIN * 2; // 15398

const FONT = "Calibri";
const HEADING_FONT = "Century Gothic";
const GREY = "D9D9D9";
const PEACH = "F7C8AC";
const BLUE = "006EC0";

const LINE = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const ALL_BORDERS: ITableCellBorders = { top: LINE, bottom: LINE, left: LINE, right: LINE };
const NO_BORDERS: ITableCellBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE };

type RunOpts = { bold?: boolean; italics?: boolean; size?: number; color?: string; font?: string };

function run(text: string, o: RunOpts = {}) {
  return new TextRun({ text, bold: o.bold, italics: o.italics, size: o.size ?? 18, color: o.color, font: o.font ?? FONT });
}

function para(
  text: string,
  o: RunOpts & { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; after?: number; bullet?: boolean; keepNext?: boolean } = {}
) {
  return new Paragraph({
    alignment: o.align,
    keepNext: o.keepNext,
    keepLines: o.keepNext,
    spacing: { before: 0, after: o.after ?? 0 },
    numbering: o.bullet ? { reference: "bullets", level: 0 } : undefined,
    children: [run(text, o)],
  });
}

/** One paragraph per line; always at least one paragraph (cells can't be empty). */
function paras(lines: string[] | string, o: Parameters<typeof para>[1] = {}) {
  const arr = (Array.isArray(lines) ? lines : lines.split(/\r?\n/)).map((l) => l.trim()).filter(Boolean);
  return arr.length ? arr.map((l) => para(l, o)) : [para("", o)];
}

function cell(
  children: Paragraph[],
  o: { width: number; fill?: string; colSpan?: number; vAlign?: TableVerticalAlign; borders?: ITableCellBorders } = { width: 1000 }
) {
  return new TableCell({
    width: { size: o.width, type: WidthType.DXA },
    columnSpan: o.colSpan,
    verticalAlign: o.vAlign ?? VerticalAlign.TOP,
    shading: o.fill ? { type: ShadingType.CLEAR, color: "auto", fill: o.fill } : undefined,
    borders: o.borders ?? ALL_BORDERS,
    margins: { top: 50, bottom: 50, left: 90, right: 90 },
    children,
  });
}

function labelCell(text: string, width: number, fill = GREY, keepNext = false) {
  return cell(paras(text, { size: 18, keepNext }), { width, fill, vAlign: VerticalAlign.CENTER });
}

function table(columnWidths: number[], rows: TableRow[]) {
  return new Table({
    width: { size: columnWidths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths,
    layout: TableLayoutType.FIXED,
    rows,
  });
}

function spacer(after = 160) {
  return new Paragraph({ spacing: { before: 0, after }, children: [] });
}

function heading(text: string, size = 28) {
  return new Paragraph({
    spacing: { before: 0, after: 160 },
    children: [new TextRun({ text, bold: true, size, font: HEADING_FONT })],
  });
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric" });
}

function ratingCell(score: number | null, width: number) {
  const level = scoreLevel(score);
  const colours = level ? LEVEL_HEX[level] : { fill: "FFFFFF", text: "000000" };
  return cell([para(ratingLabel(score), { align: AlignmentType.CENTER, bold: true, size: 18, color: colours.text })], {
    width,
    fill: level ? colours.fill : undefined,
    vAlign: VerticalAlign.CENTER,
  });
}

async function loadLogo(): Promise<Buffer | null> {
  try {
    return await fs.readFile(path.join(process.cwd(), "public", "sansom-logo.jpg"));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------

function projectDetails(ta: TaFull) {
  const W = [2500, 6400, 2200, 4298];
  const wide = W[1] + W[2] + W[3];
  const row = (l1: string, v1: string, l2: string, v2: string) =>
    new TableRow({
      children: [labelCell(l1, W[0]), cell(paras(v1), { width: W[1], vAlign: VerticalAlign.CENTER }), labelCell(l2, W[2]), cell(paras(v2), { width: W[3], vAlign: VerticalAlign.CENTER })],
    });
  const wideRow = (label: string, children: Paragraph[]) =>
    new TableRow({ children: [labelCell(label, W[0]), cell(children, { width: wide, colSpan: 3 })] });

  const projectName = [ta.jobNumber, ta.projectName].filter(Boolean).join(" - ");
  return table(W, [
    row("Project Name", projectName, "Date", formatDate(ta.taDate)),
    row("Location", ta.siteAddress, "Main Contractor", ta.mainContractor),
    row("Site Contact person", ta.siteContactName, "Site contact", ta.siteContactPhone),
    row("Sansom Contract Manager", ta.contractManager, "Sansom contact", ta.contractManagerPhone),
    wideRow("Work Type", paras(ta.workType)),
    wideRow("Overview of the work:", paras(ta.overview)),
    wideRow("Permits needed:", paras(ta.permits.length ? ta.permits : ["None identified"])),
    wideRow(
      "Legislation/codes/standards/ guidelines that must be complied with",
      ta.legislation.length ? ta.legislation.map((l) => para(l, { bullet: true })) : paras("")
    ),
    row("Prepared by", ta.preparedByName, "TA reference", `${ta.id} · ${TA_STATUS_LABELS[ta.status]}`),
  ]);
}

function plantAndChemicals(ta: TaFull) {
  const W = [4700, 3900, 300, 4300, 2198];
  const headerCell = (title: string, sub: string, width: number) =>
    cell(
      [
        new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 20, font: HEADING_FONT })] }),
        ...(sub ? [para(sub, { italics: true, size: 16 })] : []),
      ],
      { width, fill: PEACH, vAlign: VerticalAlign.CENTER }
    );
  const gap = (fill?: string) => cell([para("")], { width: W[2], borders: NO_BORDERS, fill });

  const n = Math.max(ta.plant.length, ta.chemicals.length, 3) + 2; // spare rows for site additions
  const rows = [
    new TableRow({
      tableHeader: true,
      children: [
        headerCell("Key Plant and Equipment for this Activity:", "(e.g. EWP / Crane / Forklift / etc)", W[0]),
        headerCell("Operator Requirements", "", W[1]),
        gap(),
        headerCell("Chemicals / Hazardous Substances to be Used:", "(e.g. Acids / Resins / etc)", W[3]),
        headerCell("SDS available:", "(on request / in SSSP)", W[4]),
      ],
    }),
  ];
  for (let i = 0; i < n; i++) {
    const p = ta.plant[i];
    const c = ta.chemicals[i];
    rows.push(
      new TableRow({
        height: { value: 380, rule: HeightRule.ATLEAST },
        children: [
          cell(paras(p?.item ?? ""), { width: W[0], vAlign: VerticalAlign.CENTER }),
          cell(paras(p?.operatorRequirements ?? "", { size: 16 }), { width: W[1], vAlign: VerticalAlign.CENTER }),
          gap(),
          cell(paras(c?.name ?? ""), { width: W[3], vAlign: VerticalAlign.CENTER }),
          cell(paras(c?.sds ?? "", { size: 16 }), { width: W[4], vAlign: VerticalAlign.CENTER }),
        ],
      })
    );
  }
  return table(W, rows);
}

function ppeRow(ta: TaFull) {
  const W = [2500, CONTENT_W - 2500];
  const selected = new Set(ta.ppe);
  const runs: TextRun[] = [];
  PPE_OPTIONS.forEach((p, i) => {
    runs.push(new TextRun({ text: selected.has(p.key) ? "☒" : "☐", font: "Segoe UI Symbol", size: 20 }));
    runs.push(run(` ${p.label}${i < PPE_OPTIONS.length - 1 ? "      " : ""}`, { size: 18, bold: selected.has(p.key) }));
  });
  return table(W, [
    new TableRow({
      children: [
        labelCell("PPE (AS REQUIRED)", W[0]),
        cell([new Paragraph({ spacing: { before: 40, after: 40 }, children: runs })], { width: W[1], vAlign: VerticalAlign.CENTER }),
      ],
    }),
  ]);
}

function jobSteps(ta: TaFull, riskTitles: Map<string, string>) {
  const W = [500, 2700, 3000, 1250, 6698, 1250];
  const head = (title: string, sub: string, width: number, colSpan?: number) =>
    cell([para(title, { bold: true, size: 18 }), ...(sub ? [para(sub, { size: 16 })] : [])], { width, fill: GREY, colSpan, vAlign: VerticalAlign.CENTER });

  const rows = [
    new TableRow({
      tableHeader: true,
      children: [
        head("JOB STEP", "(Describe the way the task is performed)", W[0] + W[1], 2),
        head("IDENTIFIED RISKS", "(What could result in harm)", W[2]),
        head("INITIAL RISK RATING", "", W[3]),
        head("CONTROL MEASURES", "(Describe what will be done to control the risk)", W[4]),
        head("RESIDUAL RISK RATING", "", W[5]),
      ],
    }),
  ];

  if (ta.steps.length === 0) {
    rows.push(new TableRow({ children: [cell(paras("No job steps recorded."), { width: CONTENT_W, colSpan: 6 })] }));
  }

  ta.steps.forEach((s, i) => {
    const refs = s.riskIds.map((id) => `${id} ${riskTitles.get(id) ?? ""}`.trim());
    rows.push(
      new TableRow({
        cantSplit: true,
        children: [
          cell([para(String(i + 1), { align: AlignmentType.CENTER, size: 18 })], { width: W[0], vAlign: VerticalAlign.CENTER }),
          cell(paras(s.description, { size: 18 }), { width: W[1], vAlign: VerticalAlign.CENTER }),
          cell(
            [
              ...paras(s.identifiedRisks, { size: 16 }),
              ...(refs.length ? [para(`Register: ${refs.join("; ")}`, { size: 13, color: "7F7F7F", italics: true })] : []),
            ],
            { width: W[2], vAlign: VerticalAlign.CENTER }
          ),
          ratingCell(s.initialScore, W[3]),
          cell(paras(s.controls.map((c) => c.text), { size: 16 }), { width: W[4], vAlign: VerticalAlign.CENTER }),
          ratingCell(s.residualScore, W[5]),
        ],
      })
    );
  });
  return table(W, rows);
}

function responsibilities(ta: TaFull) {
  const W = [5000, CONTENT_W - 5000];
  const reviewStatus =
    ta.status === "approved" || ta.status === "closed"
      ? `Approved by ${ta.reviewedByName ?? "H&S"} on ${formatDate(ta.reviewedAt)}${ta.reviewComment ? ` — ${ta.reviewComment}` : ""}`
      : ta.status === "changes_requested"
        ? `Changes requested by ${ta.reviewedByName ?? "H&S"} on ${formatDate(ta.reviewedAt)}${ta.reviewComment ? ` — ${ta.reviewComment}` : ""}`
        : ta.status === "submitted"
          ? `Submitted ${formatDate(ta.submittedAt)} — awaiting H&S review`
          : "Draft — not yet submitted for H&S review";
  const row = (label: string, value: string) =>
    new TableRow({ children: [labelCell(label, W[0]), cell(paras(value), { width: W[1], vAlign: VerticalAlign.CENTER })] });
  return table(W, [
    row("Person(s) Responsible for ensuring compliance with TA", ta.responsibleCompliance),
    row("Person(s) Responsible for reviewing the TA/Date", ta.responsibleReview),
    row("Review date:", ta.reviewFrequency),
    row("H&S review", reviewStatus),
  ]);
}

function signOn() {
  const W = [3300, 3300, 1099, 3300, 3300, 1099];
  const head = ["Worker Name:", "Worker Signature:", "Date:", "Worker Name:", "Worker Signature:", "Date:"];
  const rows = [
    new TableRow({
      tableHeader: true,
      children: head.map((h, i) => cell([para(h, { bold: true })], { width: W[i], fill: GREY, vAlign: VerticalAlign.CENTER })),
    }),
  ];
  for (let r = 0; r < 12; r++) {
    rows.push(new TableRow({ height: { value: 440, rule: HeightRule.ATLEAST }, children: W.map((w) => cell([para("")], { width: w })) }));
  }
  return table(W, rows);
}

function completionSignOff() {
  const W = [3000, 4699, 3000, 4699];
  // keepNext on every row but the last keeps this small table on one page.
  const blankRow = (a: string, b: string, keepNext = true) =>
    new TableRow({
      cantSplit: true,
      height: { value: 520, rule: HeightRule.ATLEAST },
      children: [
        labelCell(a, W[0], GREY, keepNext),
        cell([para("", { keepNext })], { width: W[1] }),
        labelCell(b, W[2], GREY, keepNext),
        cell([para("", { keepNext })], { width: W[3] }),
      ],
    });
  return table(W, [
    new TableRow({
      cantSplit: true,
      children: [
        cell([para(CONSULTATION_TEXT.completion, { bold: true, size: 20, keepNext: true }), para(CONSULTATION_TEXT.completionSub, { size: 16, keepNext: true })], {
          width: CONTENT_W,
          colSpan: 4,
          fill: GREY,
        }),
      ],
    }),
    blankRow("Client Name and Surname", "Project Manager"),
    blankRow("Date", "Date"),
    blankRow("Signature", "Signature", false),
  ]);
}

function riskMatrix() {
  const W = [3400, 2399, 2399, 2400, 2400, 2400];
  const rows = [
    new TableRow({
      children: [
        cell([para("Likelihood ↓ / Consequence →", { bold: true, color: "FFFFFF" })], { width: W[0], fill: BLUE, vAlign: VerticalAlign.CENTER }),
        ...CONSEQUENCE_LABELS.map((label, i) =>
          cell([para(`${label} (${i + 1})`, { bold: true, color: "FFFFFF", align: AlignmentType.CENTER }), para(CONSEQUENCE_DESCRIPTIONS[i], { size: 13, color: "FFFFFF", align: AlignmentType.CENTER })], {
            width: W[i + 1],
            fill: BLUE,
            vAlign: VerticalAlign.CENTER,
          })
        ),
      ],
    }),
  ];
  for (let l = 5; l >= 1; l--) {
    rows.push(
      new TableRow({
        height: { value: 620, rule: HeightRule.ATLEAST },
        children: [
          cell([para(`${LIKELIHOOD_LABELS[l - 1]} (${l})`, { bold: true }), para(LIKELIHOOD_DESCRIPTIONS[l - 1], { size: 14 })], {
            width: W[0],
            fill: GREY,
            vAlign: VerticalAlign.CENTER,
          }),
          ...[1, 2, 3, 4, 5].map((c) => {
            const score = l * c;
            const level = scoreLevel(score)!;
            return cell([para(ratingLabel(score), { bold: true, align: AlignmentType.CENTER, color: LEVEL_HEX[level].text })], {
              width: W[c],
              fill: LEVEL_HEX[level].fill,
              vAlign: VerticalAlign.CENTER,
            });
          }),
        ],
      })
    );
  }
  return table(W, rows);
}

// ---------------------------------------------------------------------------

export async function buildTaDocx(ta: TaFull, riskTitles: Map<string, string>): Promise<Buffer> {
  const logo = await loadLogo();
  const jobLine = [ta.jobNumber, ta.projectName].filter(Boolean).join(" - ") || ta.id;

  const header = new Header({
    children: [
      table([CONTENT_W - 3600, 3600], [
        new TableRow({
          children: [
            cell([para(jobLine, { size: 16, color: "595959" })], { width: CONTENT_W - 3600, borders: NO_BORDERS, vAlign: VerticalAlign.BOTTOM }),
            cell(
              [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: logo ? [new ImageRun({ type: "jpg", data: logo, transformation: { width: 200, height: 33 } })] : [run("SANSOM", { bold: true, size: 28 })],
                }),
              ],
              { width: 3600, borders: NO_BORDERS }
            ),
          ],
        }),
      ]),
    ],
  });

  const footer = new Footer({
    children: [
      new Paragraph({
        children: [
          run(`${ta.id} · ${TA_STATUS_LABELS[ta.status]} · Generated ${formatDate(new Date().toISOString())} from the Sansom Risk Register`, { size: 14, color: "7F7F7F" }),
          run("\tPage ", { size: 14, color: "7F7F7F" }),
          new TextRun({ children: [PageNumber.CURRENT], size: 14, color: "7F7F7F", font: FONT }),
          run(" of ", { size: 14, color: "7F7F7F" }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 14, color: "7F7F7F", font: FONT }),
        ],
        tabStops: [{ type: "right", position: CONTENT_W }],
      }),
    ],
  });

  const doc = new Document({
    creator: "Sansom Risk Register",
    title: `TA/SWMS ${jobLine}`,
    styles: { default: { document: { run: { font: FONT, size: 18 } } } },
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 280, hanging: 200 } } } }],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE },
            margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN, header: 360, footer: 360 },
          },
        },
        headers: { default: header },
        footers: { default: footer },
        children: [
          heading("TASK ANALYSIS / SWMS", 32),
          projectDetails(ta),
          spacer(120),
          para(CONSULTATION_TEXT.hierarchy, { italics: true, size: 16 }),
          spacer(200),
          plantAndChemicals(ta),
          spacer(200),
          ppeRow(ta),
          new Paragraph({ children: [new PageBreak()] }),
          jobSteps(ta, riskTitles),
          spacer(200),
          responsibilities(ta),
          new Paragraph({ children: [new PageBreak()] }),
          heading(CONSULTATION_TEXT.heading, 24),
          para(CONSULTATION_TEXT.acknowledgement, { size: 18, after: 80 }),
          para(CONSULTATION_TEXT.allWorkers, { size: 18, bold: true, after: 160 }),
          signOn(),
          spacer(80),
          para(CONSULTATION_TEXT.additional, { italics: true, size: 16, after: 200, keepNext: true }),
          completionSignOff(),
          new Paragraph({ children: [new PageBreak()] }),
          heading("RISK ASSESSMENT MATRIX", 24),
          riskMatrix(),
          spacer(120),
          para("Risk rating = Likelihood × Consequence.  Low 1–3 · Moderate 4–6 · High 8–12 · Critical 15–25.", { size: 16, italics: true }),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

export function taDocxFilename(ta: Pick<TaFull, "id" | "jobNumber" | "projectName">) {
  const base = ["TA-SWMS", ta.jobNumber, ta.projectName].filter(Boolean).join(" ") || ta.id;
  return `${base.replace(/[^\w.\- ]+/g, "").replace(/\s+/g, " ").trim().slice(0, 120)}.docx`;
}
