// 하루 기록 공유: 보고 있는 날의 기록을 이미지 한 장(PNG)으로 그려 공유 창으로.
// 날짜·합계(칼로리·탄단지·나트륨, 세부 영양) → 끼니별 음식(먹은 양, 영양성분, 조리면 재료)
import { EXTRAS, MEALS, sumNutrients, type Entry, type Nutrients } from "./db";
import { shareImage } from "./photoLibrary";

const W = 360; // 그리는 폭(논리 px). 3배로 그려서 1080px 이미지
const SCALE = 3;
const PAD = 20;
const FONT = '-apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';
const FG = "#111111";
const MUTED = "#6b6b6b";
const LINE = "#e3e3e0";
const CHIP = "#efefec";

const n0 = (v: number) => Math.round(v).toLocaleString();
const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString();

/** 음식 한 줄 밑에 붙는 영양성분 (탄·단·지·당·나트륨 + 아는 세부) */
function nutLine(n: Nutrients) {
  const parts = [`탄 ${n0(n.carb)}`, `단 ${n0(n.protein)}`, `지 ${n0(n.fat)}`];
  if (n.sugar != null) parts.push(`당 ${n0(n.sugar)}`);
  if (n.sodium != null) parts.push(`나트륨 ${n0(n.sodium)}mg`);
  for (const x of EXTRAS) if (x.key !== "sugar" && n[x.key] != null) parts.push(`${x.short} ${n1(n[x.key]!)}`);
  return parts.join(" · ");
}

/** 먹은 양: 재료 g이 모두 있으면 합, 하나짜리면 그 양 */
function amountOf(e: Entry) {
  if (e.items.length && e.items.every((i) => i.grams)) return `${n0(e.items.reduce((s, i) => s + (i.grams ?? 0), 0))}g`;
  return e.items.length === 1 ? e.items[0].amountText : "";
}

/** 글자를 폭에 맞춰 여러 줄로 */
function wrap(g: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const ch of text) {
    if (ch === "\n") { out.push(line); line = ""; continue; }
    const next = line + ch;
    if (g.measureText(next).width > width && line) {
      // 가능하면 띄어쓰기에서 자름
      const sp = line.lastIndexOf(" ");
      if (sp > 0) { out.push(line.slice(0, sp)); line = line.slice(sp + 1) + ch; }
      else { out.push(line); line = ch; }
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/** draw=false면 높이만 계산 */
function paint(g: CanvasRenderingContext2D, dateLabel: string, entries: Entry[], draw: boolean): number {
  const font = (size: number, bold = false) => { g.font = `${bold ? "700" : "400"} ${size}px ${FONT}`; };
  const text = (s: string, x: number, y: number, color = FG, align: CanvasTextAlign = "left") => {
    if (!draw) return;
    g.fillStyle = color;
    g.textAlign = align;
    g.fillText(s, x, y);
  };
  const rect = (x: number, y: number, w: number, h: number, color: string, r = 0) => {
    if (!draw) return;
    g.fillStyle = color;
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    g.fill();
  };
  g.textBaseline = "alphabetic";
  const right = W - PAD;
  const inner = W - PAD * 2;
  let y = PAD;

  // 날짜 · 하루 칼로리
  const total = sumNutrients(entries.map((e) => e.total));
  y += 20;
  font(18, true); text(dateLabel, PAD, y);
  font(14, true); text(`${n0(total.kcal)} kcal`, right, y, FG, "right");
  y += 10;
  rect(PAD, y, inner, 2, FG);
  y += 12;

  // 탄수 · 단백 · 지방 · 나트륨
  const chips: [string, string][] = [["탄수", `${n0(total.carb)}g`], ["단백", `${n0(total.protein)}g`], ["지방", `${n0(total.fat)}g`], ["나트륨", total.sodium != null ? `${n0(total.sodium)}mg` : "-"]];
  const cw = (inner - 12) / 4;
  chips.forEach(([label, v], i) => {
    const x = PAD + i * (cw + 4);
    rect(x, y, cw, 44, CHIP, 10);
    font(11); text(label, x + cw / 2, y + 17, MUTED, "center");
    font(14, true); text(v, x + cw / 2, y + 35, FG, "center");
  });
  y += 44;

  // 세부 영양 합계
  const ext = EXTRAS.filter((x) => total[x.key] != null).map((x) => `${x.label} ${n1(total[x.key]!)}g`);
  if (ext.length) {
    font(11.5);
    for (const l of wrap(g, ext.join(" · "), inner)) { y += 17; text(l, W / 2, y, MUTED, "center"); }
  }
  y += 6;

  // 끼니별
  for (const m of MEALS) {
    const list = entries.filter((e) => e.meal === m.key);
    if (!list.length) continue;
    y += 26;
    font(13, true);
    text(m.label, PAD, y);
    text(`${n0(sumNutrients(list.map((e) => e.total)).kcal)} kcal`, right, y, FG, "right");
    y += 6;
    for (const e of list) {
      rect(PAD, y, inner, 1, LINE);
      y += 18;
      const kcal = n0(e.total.kcal);
      font(13, true);
      const kw = g.measureText(kcal).width;
      // 이름 (길면 줄바꿈) + 먹은 양
      font(13);
      const name = `${e.place ? e.place + " " : ""}${e.title}`;
      const lines = wrap(g, name, inner - kw - 12);
      lines.forEach((l, i) => { if (i) y += 17; text(l, PAD, y); });
      font(13, true); text(kcal, right, y - (lines.length - 1) * 17, FG, "right");
      const amt = [amountOf(e), e.kind === "home" ? "조리" : ""].filter(Boolean).join(" · ");
      font(11);
      for (const l of [...(amt ? [amt] : []), ...wrap(g, nutLine(e.total), inner)]) { y += 15; text(l, PAD, y, MUTED); }
      // 재료 여러 개면 재료와 양
      if (e.items.length > 1) {
        const ing = "재료 " + e.items.map((i) => `${i.name}${i.grams ? ` ${n0(i.grams)}g` : i.amountText ? ` ${i.amountText}` : ""}`).join(" · ");
        for (const l of wrap(g, ing, inner)) { y += 15; text(l, PAD, y, MUTED); }
      }
      y += 8;
    }
  }
  y += 16;
  font(10); text("식단 기록", right, y, MUTED, "right");
  return y + PAD - 8;
}

export async function dayImage(dateLabel: string, entries: Entry[]): Promise<Blob> {
  const c = document.createElement("canvas");
  const g = c.getContext("2d")!;
  const h = paint(g, dateLabel, entries, false);
  c.width = W * SCALE;
  c.height = Math.ceil(h * SCALE);
  g.scale(SCALE, SCALE);
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, W, h);
  paint(g, dateLabel, entries, true);
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("이미지를 만들지 못했어요"))), "image/png"));
}

/** 공유 창으로. 분석 중·실패한 사진 기록은 뺌 */
export async function shareDay(date: string, dateLabel: string, entries: Entry[]) {
  const list = entries.filter((e) => !e.pending);
  if (!list.length) throw new Error("공유할 기록이 없어요");
  const blob = await dayImage(dateLabel, list);
  return shareImage(blob, `식단_${date}.png`);
}
