// "현미밥 200g", "계란 2개", "올리브유 1큰술" 같은 줄을 이름/양으로 나누기

export interface ParsedLine {
  text: string;
  name: string;
  amountText: string;
  grams: number | null; // 그램으로 바로 알 수 있으면 값, 아니면 null
}

// 그램으로 바로 바꿀 수 있는 단위 (대략값)
const UNIT_GRAMS: Record<string, number> = {
  g: 1, 그램: 1, kg: 1000, ml: 1, l: 1000, 리터: 1000,
  큰술: 15, 큰스푼: 15, 밥숟가락: 15, 작은술: 5, 티스푼: 5, 컵: 200,
};

// "개/장/공기" 같은 단위의 흔한 식재료 1단위 무게 (AI 없이도 계산되도록)
const PIECE_GRAMS: [RegExp, number][] = [
  [/계란|달걀/, 50],
  [/메추리알/, 10],
  [/밥/, 210], // 1공기
  [/식빵/, 35],
  [/바나나/, 120],
  [/사과/, 250],
  [/귤/, 80],
  [/고구마|감자/, 150],
  [/양파/, 200],
  [/토마토/, 200],
  [/방울토마토/, 15],
  [/두부/, 300], // 1모
  [/슬라이스치즈|치즈/, 20],
  [/^김$|조미김|김밥용김/, 2], // 1장
  [/마늘/, 5], // 1쪽
  [/만두/, 30],
  [/프로틴|단백질 ?파우더/, 30], // 1스쿱
];
const PIECE_UNITS = new Set(["개", "알", "장", "공기", "모", "쪽", "조각", "스쿱", "덩이"]);

export function parseLine(raw: string): ParsedLine | null {
  const text = raw.trim().replace(/^[-•·*]\s*/, "");
  if (!text) return null;
  // "반모", "한 공기", "두 개" → 숫자로
  const normalized = text.replace(/\s(반|한|두|세|네|다섯)\s*(개|모|공기|그릇|컵|큰술|작은술|장|쪽|알|조각|스쿱|봉지|팩|마리|인분|줌)$/,(_, w: string, u: string) =>
    ` ${({ 반: "0.5", 한: "1", 두: "2", 세: "3", 네: "4", 다섯: "5" } as Record<string, string>)[w]}${u}`);
  const pinch = normalized.match(/^(.*?)\s*(약간|조금|한꼬집|적당량|적당히)$/);
  if (pinch?.[1]) return { text, name: pinch[1], amountText: pinch[2], grams: 2 };
  const m = normalized.match(/^(.*?)\s*(\d+(?:\.\d+)?(?:\/\d+)?)\s*([a-zA-Z가-힣]*)\s*$/);
  if (!m || !m[1]) return { text, name: text, amountText: "", grams: null };

  const name = m[1].trim();
  const [a, b] = m[2].split("/").map(Number);
  const qty = b ? a / b : a;
  const unit = m[3].toLowerCase();
  const amountText = `${m[2]}${m[3]}`;

  if (!unit) return { text, name, amountText: `${m[2]}g`, grams: qty }; // 숫자만 있으면 g
  let per: number | undefined = UNIT_GRAMS[unit];
  if (!per && PIECE_UNITS.has(unit)) per = [...PIECE_GRAMS].reverse().find(([re]) => re.test(name))?.[1];
  return { text, name, amountText, grams: per ? qty * per : null };
}

export function parseLines(input: string): ParsedLine[] {
  return input
    .split(/[\n,]+/)
    .map(parseLine)
    .filter((x): x is ParsedLine => !!x);
}
