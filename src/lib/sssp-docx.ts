import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { CONSEQUENCE_LABELS, LIKELIHOOD_LABELS, LEVEL_HEX, scoreLevel } from "@/lib/risk-scoring";
import { riskControlStatements } from "@/lib/controls";
import { nzDate, type Chemical } from "@/lib/chemicals-shared";
import { NOTIFIABLE_WORKS, QUESTIONS, type AnswerOption, type SsspFull } from "@/lib/sssp-shared";

// Builds the SSSP Word document by filling Sansom's own master template
// (templates/sssp-template.docx — "SSSP Template - MASTER Concrete Repairs")
// rather than recreating it, so the output is the document H&S already know:
// the real checkboxes are ticked, the risk register is cut down to this
// job's risks, and the hazardous-substance tables list this job's products.
// To change the wording or layout, edit the template in Word and replace
// the file — the filler finds things by their text, not by position.

type El = Element;

export type SsspDocRisk = {
  id: string;
  title: string;
  description: string;
  inherentLikelihood: number | null;
  inherentConsequence: number | null;
  inherentScore: number | null;
  residualLikelihood: number | null;
  residualConsequence: number | null;
  residualScore: number | null;
  controls: { description: string }[];
};

export type SsspDocTa = { id: string; title: string; status: string; reviewedByName: string | null; reviewedAt: string | null };

const TEMPLATE = path.join(process.cwd(), /* turbopackIgnore: true */ "templates", "sssp-template.docx");
let templateCache: Buffer | null = null;

async function loadTemplate() {
  if (!templateCache) templateCache = await fs.readFile(TEMPLATE);
  return templateCache;
}

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const W14_NS = "http://schemas.microsoft.com/office/word/2010/wordml";

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------

const children = (el: Node, tag: string): El[] => {
  const out: El[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1 && (n as El).nodeName === tag) out.push(n as El);
  return out;
};
const all = (el: Document | El, tag: string): El[] => Array.from(el.getElementsByTagName(tag));
const first = (el: El, tag: string): El | null => el.getElementsByTagName(tag)[0] ?? null;
const textOf = (el: El): string => all(el, "w:t").map((t) => t.textContent ?? "").join("");
const norm = (s: string) => s.replace(/[–—]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();

/** Cells of a row, including cells wrapped in a content control. */
function cellsOf(tr: El): El[] {
  const out: El[] = [];
  for (let n = tr.firstChild; n; n = n.nextSibling) {
    if (n.nodeType !== 1) continue;
    const e = n as El;
    if (e.nodeName === "w:tc") out.push(e);
    else if (e.nodeName === "w:sdt") out.push(...all(e, "w:tc"));
  }
  return out;
}

function el(doc: Document, tag: string, attrs: Record<string, string> = {}) {
  const e = doc.createElementNS(W_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttributeNS(W_NS, k, v);
  return e;
}

function makeRun(doc: Document, text: string, rPr: El | null) {
  const r = el(doc, "w:r");
  if (rPr) r.appendChild(rPr.cloneNode(true));
  const t = el(doc, "w:t");
  t.setAttribute("xml:space", "preserve");
  t.appendChild(doc.createTextNode(text));
  r.appendChild(t);
  return r;
}

/** Replaces a paragraph's runs with text, keeping its formatting. */
function setParagraphText(p: El, text: string) {
  const doc = p.ownerDocument!;
  const firstRun = first(p, "w:r");
  const rPr = firstRun ? children(firstRun, "w:rPr")[0] ?? null : null;
  for (const n of Array.from(p.childNodes)) if (n.nodeName !== "w:pPr") p.removeChild(n);
  if (rPr) {
    const style = children(rPr, "w:rStyle")[0];
    if (style && /placeholder/i.test(style.getAttribute("w:val") || "")) rPr.removeChild(style);
  }
  p.appendChild(makeRun(doc, text, rPr));
}

/** Sets a table cell to one paragraph per line, keeping the cell's formatting. */
function setCellText(tc: El, text: string | string[]) {
  const lines = (Array.isArray(text) ? text : text.split("\n")).map((l) => l.trimEnd());
  const paras = children(tc, "w:p");
  const proto = paras[0];
  if (!proto) return;
  for (const p of paras.slice(1)) tc.removeChild(p);
  // Drop nested content (e.g. content controls) other than the first paragraph.
  for (const n of Array.from(tc.childNodes)) if (n.nodeType === 1 && n !== proto && n.nodeName !== "w:tcPr") tc.removeChild(n);
  const list = lines.length ? lines : [""];
  setParagraphText(proto, list[0]);
  let prev: El = proto;
  for (const line of list.slice(1)) {
    const p = proto.cloneNode(true) as El;
    setParagraphText(p, line);
    tc.insertBefore(p, prev.nextSibling);
    prev = p;
  }
}

function setCellShading(tc: El, fillHex: string) {
  const doc = tc.ownerDocument!;
  let tcPr = children(tc, "w:tcPr")[0];
  if (!tcPr) {
    tcPr = el(doc, "w:tcPr");
    tc.insertBefore(tcPr, tc.firstChild);
  }
  let shd = children(tcPr, "w:shd")[0];
  if (!shd) {
    shd = el(doc, "w:shd");
    tcPr.appendChild(shd);
  }
  shd.setAttribute("w:val", "clear");
  shd.setAttribute("w:color", "auto");
  shd.setAttribute("w:fill", fillHex);
  shd.removeAttribute("w:themeFill");
  shd.removeAttribute("w:themeFillShade");
  shd.removeAttribute("w:themeFillTint");
}

function setCellTextColor(tc: El, hex: string, bold = true) {
  for (const r of all(tc, "w:r")) {
    let rPr = children(r, "w:rPr")[0];
    if (!rPr) {
      rPr = el(tc.ownerDocument!, "w:rPr");
      r.insertBefore(rPr, r.firstChild);
    }
    for (const c of children(rPr, "w:color")) rPr.removeChild(c);
    const color = el(tc.ownerDocument!, "w:color");
    color.setAttribute("w:val", hex);
    rPr.appendChild(color);
    if (bold && !children(rPr, "w:b").length) rPr.insertBefore(el(tc.ownerDocument!, "w:b"), rPr.firstChild);
  }
}

// Checkbox content controls (☐ / ☒) and the label that follows each one.
type Checkbox = { sdt: El; label: string };

function checkboxesIn(scope: El): Checkbox[] {
  const out: Checkbox[] = [];
  for (const sdt of all(scope, "w:sdt")) {
    if (!sdt.getElementsByTagName("w14:checkbox").length) continue;
    let label = "";
    for (let n = sdt.nextSibling; n; n = n.nextSibling) {
      if (n.nodeType !== 1) continue;
      const e = n as El;
      if (e.nodeName === "w:sdt" && e.getElementsByTagName("w14:checkbox").length) break;
      label += textOf(e);
    }
    out.push({ sdt, label: label.trim() });
  }
  return out;
}

function setCheckbox(sdt: El, checked: boolean) {
  const c = sdt.getElementsByTagName("w14:checked")[0];
  if (c) c.setAttributeNS(W14_NS, "w14:val", checked ? "1" : "0");
  const content = children(sdt, "w:sdtContent")[0];
  const t = content ? first(content, "w:t") : null;
  if (t) t.textContent = checked ? "☒" : "☐";
}

const OPTION_CHECKBOX_LABEL: Record<AnswerOption, string> = { yes: "yes", na: "n/a", before: "before starting", weekly: "weekly", daily: "daily" };

/** Ticks exactly the checkbox labelled for `answer` within a row. */
function answerRow(tr: El, answer: AnswerOption | null | undefined) {
  if (!answer) return;
  const want = OPTION_CHECKBOX_LABEL[answer];
  for (const cb of checkboxesIn(tr)) setCheckbox(cb.sdt, norm(cb.label) === want);
}

// Where each question lives in the template: row first-cell text (startsWith)
// or a phrase anywhere in the row.
const QUESTION_ROWS: Record<string, { cell0?: string; has?: string }> = {
  daily_prestart: { has: "Daily Pre-Start Assessment" },
  weekly_toolbox: { has: "Weekly Toolbox Meeting - held" },
  weekly_inspection: { has: "Weekly Site Safety Inspection - completed" },
  qa: { has: "Quality assurance is completed" },
  sign_in: { has: "sign in and sign out" },
  ppe: { cell0: "Personal Protective Equipment" },
  parking: { cell0: "Parking" },
  smoking: { cell0: "Smoking" },
  behaviour: { cell0: "Behaviour" },
  hygiene: { cell0: "Hygiene" },
  first_aid: { cell0: "First Aid Supplies" },
  subcontractors: { has: "Subcontractors to PCBU 2" },
  notifiable: { has: "There will be notifiable works" },
  worksafe_notified: { has: "WorkSafe has been notified" },
  notification_attached: { has: "A copy of the notification" },
  ta_required: { has: "Task Analyses are required" },
  ta_copies: { has: "Copies of these have been provided" },
  erp_provided: { has: "Emergency Response Plans have also" },
  hazardous_products: { has: "There will be hazardous products" },
  hazardous_recorded: { has: "recorded on the hazardous substances register" },
  sds_provided: { has: "safety data sheets have been provided" },
  hazard_register: { has: "A hazard register for our activities" },
  comm_toolbox: { cell0: "Toolbox talks" },
  comm_project_prestart: { cell0: "Project pre-start briefings" },
  comm_daily_prestart: { cell0: "Daily pre-start briefings" },
  comm_progress: { cell0: "Progress meetings" },
  comm_pack_down: { cell0: "Pack down check list" },
  insp_prestart: { cell0: "Pre-start site inspection" },
  insp_site: { cell0: "Site inspection" },
  insp_mewp: { cell0: "MEWP" },
  insp_harness: { cell0: "Harness, ropes" },
  staff_card: { has: "current site safety card" },
  staff_inducted: { has: "will be inducted on site" },
  staff_competent: { has: "suitably qualified" },
  staff_register: { has: "competency register is attached" },
  env_plan: { has: "environmental plan required" },
  env_dust: { has: "Will dust, fumes" },
  env_noise: { has: "Will noise be generated" },
  env_water: { has: "dirty water" },
};

const rating = (labels: string[], v: number | null) => (v ? `${labels[v - 1]} (${v})` : "");
const band = (score: number | null) => {
  const level = scoreLevel(score);
  return level ? `${level} ${score}` : "";
};

// ---------------------------------------------------------------------------

export async function buildSsspDocx(
  s: SsspFull,
  ctx: { risks: SsspDocRisk[]; chemicals: Chemical[]; tas: SsspDocTa[] }
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(await loadTemplate());
  const xml = await zip.file("word/document.xml")!.async("string");
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const d = s.data;
  const tables = all(doc, "w:tbl");
  const rowsOf = (t: El) => children(t, "w:tr");
  const findTable = (startsWith: string) => tables.find((t) => norm(textOf(rowsOf(t)[0] ?? t)).startsWith(norm(startsWith)));
  const allRows = tables.flatMap(rowsOf);

  const jobName = s.projectName || "[Job name]";
  const jobNumber = s.jobNumber || "[Job number]";

  // --- M-Files job name / number fields (cover and sign-off page) ---------
  for (const t of all(doc, "w:t")) {
    if (t.textContent === "[CostCon: Job Name]") t.textContent = jobName;
    else if (t.textContent === "[CostCon: Job Number]") t.textContent = jobNumber;
  }

  // --- Name boxes on the Project Information page --------------------------
  const boxNames: [RegExp, string][] = [
    [/^project manager/i, d.projectManager],
    [/^site supervisor/i, d.contacts.siteSupervisor],
    [/^1st\s*aider/i, d.contacts.firstAider],
  ];
  for (const box of all(doc, "w:txbxContent")) {
    const txt = textOf(box);
    const match = boxNames.find(([re]) => re.test(txt));
    if (!match) continue;
    const nameRun = all(box, "w:t").find((t) => /Louis Joubert/.test(t.textContent || ""));
    if (nameRun) nameRun.textContent = match[1] || "TBC";
  }

  // --- 1. Project information ----------------------------------------------
  const info = findTable("Date:");
  if (info) {
    const [r0, r1, r2] = rowsOf(info);
    const c0 = cellsOf(r0), c1 = cellsOf(r1), c2 = cellsOf(r2);
    setCellText(c0[1], nzDate(d.ssspDate));
    setCellText(c0[3], s.siteAddress);
    setCellText(c1[1], [s.mainContractor, d.clientContactName && `Contact: ${d.clientContactName}`].filter(Boolean).join("\n"));
    setCellText(c1[3], d.clientContactPhone);
    setCellText(c2[1], d.projectManager);
    setCellText(c2[3], d.projectManagerPhone);
  }

  // Work types grid
  const wanted = new Set(d.workTypes.map(norm));
  const workTable = tables.find((t) => /work type\(s\)/i.test(textOf(t)) && checkboxesIn(t).some((c) => /baffle/i.test(c.label)));
  if (workTable) for (const cb of checkboxesIn(workTable)) setCheckbox(cb.sdt, wanted.has(norm(cb.label)));

  // YES / N/A and frequency answers
  for (const q of QUESTIONS) {
    const loc = QUESTION_ROWS[q.id];
    if (!loc) continue;
    const row = allRows.find((tr) => {
      if (!checkboxesIn(tr).length) return false;
      if (loc.cell0) return norm(textOf(cellsOf(tr)[0] ?? tr)).startsWith(norm(loc.cell0));
      return textOf(tr).includes(loc.has!);
    });
    if (row) answerRow(row, d.answers[q.id]);
  }

  // --- 2. General information ------------------------------------------------
  const general = findTable("General Information");
  if (general) {
    for (const tr of rowsOf(general)) {
      const cells = cellsOf(tr);
      const label = norm(textOf(cells[0] ?? tr));
      if (label === "date" && cells[1]) setCellText(cells[1], nzDate(d.ssspDate));
      if (label === "project/site" && cells[1]) {
        setCellText(cells[1], [[jobNumber, jobName].join(" – "), s.siteAddress, d.scope && `Scope: ${d.scope}`].filter(Boolean) as string[]);
      }
      if (label === "sub-contracted works" && cells[1]) setCellText(cells[1], d.subcontractedWorks || "None");
    }
  }

  // Environmental control details sit in the row after each question.
  for (const [qid, key] of [["env_dust", "dust"], ["env_noise", "noise"], ["env_water", "water"]] as const) {
    const loc = QUESTION_ROWS[qid];
    const row = allRows.find((tr) => textOf(tr).includes(loc.has!));
    const next = row?.nextSibling;
    let nextRow = next as El | null;
    while (nextRow && nextRow.nodeType !== 1) nextRow = nextRow.nextSibling as El | null;
    if (!nextRow || nextRow.nodeName !== "w:tr") continue;
    const cells = cellsOf(nextRow);
    const text = d.answers[qid] === "yes" ? d.controls[key] : d.answers[qid] === "na" ? "N/A" : d.controls[key];
    if (cells[1]) setCellText(cells[1], text || "");
  }

  // --- 6. Risk register -------------------------------------------------------
  const register = findTable("Risk ID");
  if (register) {
    const rows = rowsOf(register);
    const dataRows = rows.slice(2);
    const byNumber = new Map(dataRows.map((r) => [parseInt(textOf(cellsOf(r)[0]).trim(), 10), r]));
    const proto = dataRows[0];
    for (const risk of ctx.risks) {
      const num = /^TAC-(\d+)$/.exec(risk.id)?.[1];
      const source = (num && byNumber.get(parseInt(num, 10))) || proto;
      const row = source.cloneNode(true) as El;
      const c = cellsOf(row);
      const statements = riskControlStatements(risk.controls);
      setCellText(c[0], num ? num.padStart(3, "0") : risk.id);
      setCellText(c[1], risk.title);
      setCellText(c[2], risk.description);
      setCellText(c[3], (risk.inherentScore ?? 0) >= 15 ? "Yes" : "No");
      setCellText(c[4], rating(LIKELIHOOD_LABELS, risk.inherentLikelihood));
      setCellText(c[5], rating(CONSEQUENCE_LABELS, risk.inherentConsequence));
      setCellText(c[6], band(risk.inherentScore));
      setCellText(c[7], statements.length ? statements.map((x) => (/[.!?]$/.test(x) ? x : `${x}.`)) : [""]);
      setCellText(c[8], rating(LIKELIHOOD_LABELS, risk.residualLikelihood));
      setCellText(c[9], rating(CONSEQUENCE_LABELS, risk.residualConsequence));
      setCellText(c[10], band(risk.residualScore));
      for (const [i, score] of [[6, risk.inherentScore], [10, risk.residualScore]] as const) {
        const level = scoreLevel(score);
        if (level) {
          setCellShading(c[i], LEVEL_HEX[level].fill);
          setCellTextColor(c[i], LEVEL_HEX[level].text);
        }
      }
      register.appendChild(row);
    }
    for (const r of dataRows) register.removeChild(r);
  }

  // --- 8. Emergency contacts --------------------------------------------------
  const contactsTable = findTable("Emergency - Fire/Police/Ambulance");
  if (contactsTable) {
    const cm = [
      [d.contacts.contractsManager1 || d.projectManager, d.contacts.contractsManager1Phone || (d.contacts.contractsManager1 ? "" : d.projectManagerPhone)],
      [d.contacts.contractsManager2, d.contacts.contractsManager2Phone],
    ];
    let cmIndex = 0;
    for (const tr of rowsOf(contactsTable)) {
      const cells = cellsOf(tr);
      if (cells.length < 2) continue;
      const label = textOf(cells[0]);
      const fill = (name: string, phone: string, role: string) => {
        if (!name) return;
        setCellText(cells[0], `${name} (${role})`);
        setCellText(cells[1], phone || "");
      };
      if (/Insert Name \(Director\)/i.test(label)) fill(d.contacts.director, d.contacts.directorPhone, "Director");
      else if (/Insert Name \(Contracts Manager\)/i.test(label)) {
        const [n, p] = cm[cmIndex++] ?? ["", ""];
        fill(n, p, "Contracts Manager");
      } else if (/Insert Name \(Site Supervisor\)/i.test(label)) fill(d.contacts.siteSupervisor, d.contacts.siteSupervisorPhone, "Site Supervisor");
      else if (/Insert Name \(Site 1st Aider\)/i.test(label)) fill(d.contacts.firstAider, d.contacts.firstAiderPhone, "Site 1st Aider");
      else if (/Hospital A&E/i.test(label) && d.emergency.hospital && !/auckland city|grafton/i.test(d.emergency.hospital)) {
        setCellText(cells[0], `${d.emergency.hospital} – emergency department`);
        setCellText(cells[1], d.emergency.hospitalPhone || "");
      }
    }
  }

  // Evacuation plan — assembly point
  if (d.emergency.assemblyPoint) {
    const p = all(doc, "w:p").find((x) => /designated assembly point/i.test(textOf(x)));
    if (p) setParagraphText(p, `At the Site’s designated assembly point: ${d.emergency.assemblyPoint}`);
  }

  // --- 9. Emergency response plan --------------------------------------------
  const erp = findTable("Type of Emergency");
  if (erp) {
    const rows = rowsOf(erp);
    const set = (ri: number, ci: number, v: string) => {
      const c = cellsOf(rows[ri])?.[ci];
      if (c && v) setCellText(c, v);
    };
    set(0, 1, d.emergency.emergencyType);
    set(0, 3, d.emergency.location || s.siteAddress);
    set(1, 1, d.emergency.workActivity);
    set(1, 3, s.mainContractor);
    set(2, 1, d.emergency.rescueMethod);
    set(2, 3, d.emergency.equipment);
    const medical = rows.find((r) => /For medical attention/i.test(textOf(r)));
    if (medical && d.emergency.hospital) {
      setCellText(cellsOf(medical)[0], `For medical attention: ${d.emergency.hospital}${d.emergency.hospitalPhone ? ` ${d.emergency.hospitalPhone}` : ""}`);
    }
  }

  // --- 10. Notification of particular hazardous work --------------------------
  const notification = findTable("Notification is to be completed");
  if (notification && d.answers.notifiable === "yes") {
    const want = d.notifiableWorks.map((w) => norm(w).slice(0, 24));
    for (const cb of checkboxesIn(notification)) {
      const l = norm(cb.label);
      if (want.some((w) => l.startsWith(w))) setCheckbox(cb.sdt, true);
      if (l.startsWith("other") && d.notifiableOther) {
        setCheckbox(cb.sdt, true);
        const p = cb.sdt.parentNode as El;
        p.appendChild(makeRun(doc, ` ${d.notifiableOther}`, null));
      }
      if (l === "contractor") setCheckbox(cb.sdt, true);
    }
    const rows = rowsOf(notification);
    const addrIdx = rows.findIndex((r) => /Address of worksite/i.test(textOf(r)));
    for (const [i, r] of rows.entries()) {
      const cells = cellsOf(r);
      const t0 = norm(textOf(cells[0] ?? r));
      if (i === addrIdx + 1 && cells[0] && !t0) setCellText(cells[0], s.siteAddress);
      if (t0.startsWith("principal/employer") && cells[0]) setCellText(cells[0], `Principal/Employer: ${s.mainContractor}`);
      if (t0.startsWith("brief description of work") && cells[0]) setCellText(cells[0], `Brief description of work: ${d.scope}`);
      const t1 = norm(textOf(cells[1] ?? r));
      if (t1 === "business name:" && cells[1]) setCellText(cells[1], "Business name: Sansom Concrete Repairs Ltd");
      if (t1 === "address:" && cells[1]) setCellText(cells[1], "Address: P O Box 9446, Newmarket, Auckland 1149");
    }
  }

  // --- 13. Hazardous substance register ---------------------------------------
  const substances = findTable("Substance");
  if (substances && ctx.chemicals.length) {
    const rows = rowsOf(substances);
    const proto = rows[1];
    const blanks = rows.slice(1);
    for (const chem of ctx.chemicals) {
      const row = proto.cloneNode(true) as El;
      const c = cellsOf(row);
      setCellText(c[0], chem.productName);
      setCellText(c[1], chem.unNumber === "Not Classified" ? "N/C" : chem.unNumber);
      setCellText(c[2], chem.sdsFilename || chem.hasSdsFile ? "Yes" : "No");
      substances.appendChild(row);
    }
    for (const r of blanks) substances.removeChild(r);
  }

  // --- 14. Safety data information --------------------------------------------
  const sdsTable = findTable("Record ID");
  if (sdsTable && ctx.chemicals.length) {
    const rows = rowsOf(sdsTable);
    const proto = rows[1];
    const blanks = rows.slice(1);
    for (const chem of ctx.chemicals) {
      const row = proto.cloneNode(true) as El;
      const c = cellsOf(row);
      const values = [
        chem.id,
        chem.status,
        chem.productName,
        chem.unNumber,
        nzDate(chem.sdsDate),
        nzDate(chem.sdsExpiry),
        chem.classification,
        chem.hazards.join(", "),
        chem.sdsFilename || chem.hasSdsFile ? "Yes" : "No",
      ];
      values.forEach((v, i) => c[i] && setCellText(c[i], v || ""));
      sdsTable.appendChild(row);
    }
    for (const r of blanks) sdsTable.removeChild(r);
  }

  // --- 21. Reviewed task analysis ---------------------------------------------
  const taHeading = all(doc, "w:p").find((p) => norm(textOf(p)) === "reviewed task analysis");
  if (taHeading) {
    const lines = ctx.tas.length
      ? ctx.tas.map(
          (t) =>
            `${t.id} – ${t.title} (${t.status}${t.reviewedByName ? `, reviewed by ${t.reviewedByName}${t.reviewedAt ? ` on ${nzDate(t.reviewedAt.slice(0, 10))}` : ""}` : ""})`
        )
      : ["No task analyses linked to this SSSP yet — attach the reviewed TA(s) for this job."];
    let after: Node = taHeading;
    for (const line of [ctx.tas.length ? "Task analyses for this job (from the Sansom Risk Register):" : "", ...lines].filter(Boolean)) {
      const p = el(doc, "w:p");
      p.appendChild(makeRun(doc, line, null));
      taHeading.parentNode!.insertBefore(p, after.nextSibling);
      after = p;
    }
  }

  // --- 23. Sign off page --------------------------------------------------------
  const signOff = findTable("Project Information");
  if (signOff) {
    const rows = rowsOf(signOff);
    const fillSdtRow = (label: string, value: string, occurrence = 0) => {
      const matches = rows.filter((r) => norm(textOf(cellsOf(r)[0] ?? r)) === norm(label));
      const row = matches[occurrence];
      if (!row || !value) return;
      const sdt = all(row, "w:sdt")[0];
      if (sdt) {
        const pr = children(sdt, "w:sdtPr")[0];
        const ph = pr ? children(pr, "w:showingPlcHdr")[0] : null;
        if (ph) pr.removeChild(ph);
        const p = all(sdt, "w:p")[0];
        if (p) setParagraphText(p, value);
      } else {
        const c = cellsOf(row)[1];
        if (c) setCellText(c, value);
      }
    };
    fillSdtRow("Start Date", nzDate(d.startDate));
    fillSdtRow("End Date", nzDate(d.endDate));
    fillSdtRow("Business Name", s.mainContractor, 0);
  }

  // --- Save --------------------------------------------------------------------
  zip.file("word/document.xml", new XMLSerializer().serializeToString(doc));
  const custom = zip.file("docProps/custom.xml");
  if (custom) {
    const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const c = (await custom.async("string")).replace("[CostCon: Job Name]", esc(jobName)).replace("[CostCon: Job Number]", esc(jobNumber));
    zip.file("docProps/custom.xml", c);
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export function ssspDocxFilename(s: SsspFull) {
  const base = [s.jobNumber, s.projectName].filter(Boolean).join(" - ") || s.id;
  return `SSSP - ${base}`.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 150) + ".docx";
}

export { NOTIFIABLE_WORKS };
