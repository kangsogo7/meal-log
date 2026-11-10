import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { addDays, EXTRAS, formatDate, MEALS, r1, sourceLabel, todayStr, type Item, type Meal, type Nutrients } from "../db";
import { kcalFromMacros } from "../nutrition";

let openLayers = 0;
let lockedY = 0;

/**
 * 창(시트·전체 화면)을 body 바로 아래에 그림.
 * 다른 창 안에서 열어도 그 창의 스크롤 영역에 갇히지 않고(아이폰), 나중에 연 창이 항상 위에 옴.
 * 마지막 창이 닫힐 때까지 뒤 화면을 지금 위치에 고정 (키보드가 떠도 뒤 화면이 밀려 내려가지 않게).
 */
function useLayer() {
  const [z] = useState(() => 20 + openLayers * 10);
  useEffect(() => {
    if (openLayers++ === 0) {
      lockedY = window.scrollY;
      document.body.style.top = `-${lockedY}px`;
      document.body.classList.add("no-scroll");
    }
    return () => {
      if (--openLayers === 0) {
        document.body.classList.remove("no-scroll");
        document.body.style.top = "";
        window.scrollTo(0, lockedY);
      }
    };
  }, []);
  return z;
}

/** tall: 내용(검색 결과 등)이 바뀌어도 창 높이가 출렁이지 않게 높이 고정 */
export function Sheet({ title, onClose, children, footer, tall, action }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; tall?: boolean; /** 제목 오른쪽, 닫기 버튼 앞 (즐겨찾기 별 등) */ action?: ReactNode }) {
  const z = useLayer();
  const [scrolled, setScrolled] = useState(false);
  return createPortal(
    <div className="sheet-backdrop" style={{ zIndex: z }} onClick={onClose}>
      <div className={`sheet ${tall ? "tall" : ""}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <header className={`sheet-head ${scrolled ? "scrolled" : ""}`}>
          <h2>{title}</h2>
          {action && <span className="sheet-action">{action}</span>}
          <button className="ghost" onClick={onClose} aria-label="닫기">✕</button>
        </header>
        <div className="sheet-body" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}>{children}</div>
        {footer && <footer className="sheet-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/** 화면 가운데 뜨는 팝업 (꼭 봐야 하는 확인·제안). 바깥을 눌러도 닫히지 않음 */
export function Dialog({ title, children, actions }: { title: string; children: ReactNode; actions: ReactNode }) {
  const z = useLayer();
  return createPortal(
    <div className="dialog-backdrop" style={{ zIndex: z }}>
      <div className="dialog" role="alertdialog" aria-label={title}>
        <h2>{title}</h2>
        <div className="dialog-body">{children}</div>
        <div className="dialog-actions">{actions}</div>
      </div>
    </div>,
    document.body,
  );
}

/** 화면 전체를 덮는 페이지 (음식 편집, 내 폴더 등) */
export function Screen({ title, left, right, footer, children }: { title: ReactNode; left: ReactNode; right?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  const z = useLayer();
  return createPortal(
    <div className="screen-page" style={{ zIndex: z }} role="dialog" aria-label={typeof title === "string" ? title : undefined}>
      <header className="screen-head">
        <div>{left}</div>
        <h2>{title}</h2>
        <div className="screen-right">{right}</div>
      </header>
      <div className="screen-body">{children}</div>
      {footer && <footer className="screen-foot">{footer}</footer>}
    </div>,
    document.body,
  );
}

/** 내용이 길어 스크롤이 생길 만한 창: 아래 팝업(Sheet) 대신 전체 화면. Sheet와 같은 모양으로 씀 (← 로 닫기) */
export function FullScreen({ title, onClose, children, footer, action }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; action?: ReactNode; tall?: boolean }) {
  return (
    <Screen left={<button className="icon-btn" onClick={onClose} aria-label="뒤로"><BackIcon /></button>} title={title} right={action} footer={footer}>
      {children}
    </Screen>
  );
}

/** 펼친 내용이 창 아래로 잘려 있으면, 그 창 안에서만 보일 만큼 부드럽게 올림 (이미 다 보이면 그대로) */
export function revealInSheet(el: Element | null | undefined) {
  const box = el?.closest(".sheet-body, .screen-body");
  if (!el || !box) return;
  const b = box.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const pad = 12;
  // 아래가 잘린 만큼 올리되, 카드가 창보다 크면 카드 위쪽이 보이는 데까지만
  const d = Math.min(r.bottom - b.bottom + pad, r.top - b.top - pad);
  if (d > 0) box.scrollBy({ top: d, behavior: "smooth" });
}

/** ◀ 날짜 오늘 ▶ (글자 길이와 상관없이 화살표 위치 고정) */
export function DateNav({ date, onChange }: { date: string; onChange: (d: string) => void }) {
  const isToday = date === todayStr();
  return (
    <header className="page-head date-nav">
      <button className="ghost" onClick={() => onChange(addDays(date, -1))} aria-label="이전 날">◀</button>
      <span aria-hidden />
      <DateButton className="date-label" value={date} onChange={onChange}>{formatDate(date)}</DateButton>
      <button className={`chip today-slot ${isToday ? "" : "show"}`} onClick={() => onChange(todayStr())} tabIndex={isToday ? -1 : 0}>오늘</button>
      <button className="ghost" onClick={() => onChange(addDays(date, 1))} aria-label="다음 날">▶</button>
    </header>
  );
}

const pad2 = (n: number) => String(n).padStart(2, "0");

const Chevron = ({ dir }: { dir: "left" | "right" | "down" | "up" }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={{ left: "M15 5l-7 7 7 7", right: "M9 5l7 7-7 7", down: "M5 9l7 7 7-7", up: "M5 15l7-7 7 7" }[dir]} />
  </svg>
);

/**
 * 앱 달력 (휴대폰 기본 달력은 앱 테마를 따르지 않음). 날짜를 고르고 ✓로 확정, 바깥을 누르면 취소.
 * 제목을 누르면 날짜 → 월 → 연도 목록 순으로. max 이후는 못 고름
 */
function DatePicker({ value, max, onPick, onClose }: { value: string; max?: string; onPick: (d: string) => void; onClose: () => void }) {
  const z = useLayer();
  const [picked, setPicked] = useState(value);
  const [mode, setMode] = useState<"days" | "months" | "years">("days");
  const [view, setView] = useState(() => {
    const [y, m] = value.split("-").map(Number);
    return { y, m };
  });
  const today = todayStr();
  const ym = (y: number, m: number) => `${y}-${pad2(m)}`;
  const move = (n: number) => setView(({ y, m }) => {
    if (mode !== "days") return { y: y + n * (mode === "years" ? 12 : 1), m };
    const d = new Date(y, m - 1 + n, 1);
    return { y: d.getFullYear(), m: d.getMonth() + 1 };
  });
  const blanks = new Date(view.y, view.m - 1, 1).getDay();
  const days = new Date(view.y, view.m, 0).getDate();
  // 연도 목록은 12년씩
  const firstYear = view.y - (view.y % 12);
  const canNext = !max || (
    mode === "years" ? firstYear + 11 < Number(max.slice(0, 4))
    : mode === "months" ? String(view.y) < max.slice(0, 4)
    : ym(view.y, view.m) < max.slice(0, 7)
  );
  const reset = () => {
    const [y, m] = today.split("-").map(Number);
    setPicked(today);
    setView({ y, m });
    setMode("days");
  };
  return createPortal(
    <div className="dialog-backdrop dp-backdrop" style={{ zIndex: z }} onClick={onClose}>
      <div className="dialog date-picker" role="dialog" aria-label="날짜 고르기" onClick={(e) => e.stopPropagation()}>
        <div className="dp-head">
          <button className="dp-title" onClick={() => setMode(mode === "days" ? "months" : mode === "months" ? "years" : "months")}>
            {mode === "years" ? `${firstYear}–${firstYear + 11}년` : mode === "months" ? `${view.y}년` : `${view.y}년 ${view.m}월`}
            <Chevron dir={mode === "days" ? "right" : mode === "months" ? "down" : "up"} />
          </button>
          <button className="dp-arrow" onClick={() => move(-1)} aria-label="이전"><Chevron dir="left" /></button>
          <button className="dp-arrow" onClick={() => move(1)} disabled={!canNext} aria-label="다음"><Chevron dir="right" /></button>
        </div>
        {mode === "years" ? (
          <div className="dp-months">
            {Array.from({ length: 12 }, (_, i) => firstYear + i).map((y) => (
              <button
                key={y}
                className={y === view.y ? "on" : ""}
                disabled={!!max && y > Number(max.slice(0, 4))}
                onClick={() => { setView({ y, m: view.m }); setMode("months"); }}
              >
                {y}년
              </button>
            ))}
          </div>
        ) : mode === "months" ? (
          <div className="dp-months">
            {Array.from({ length: 12 }, (_, i) => (
              <button
                key={i}
                className={i + 1 === view.m ? "on" : ""}
                disabled={!!max && ym(view.y, i + 1) > max.slice(0, 7)}
                onClick={() => { setView({ y: view.y, m: i + 1 }); setMode("days"); }}
              >
                {i + 1}월
              </button>
            ))}
          </div>
        ) : (
          <div className="dp-grid">
            {[..."일월화수목금토"].map((w) => <span key={w} className="dp-week">{w}</span>)}
            {Array.from({ length: blanks }, (_, i) => <span key={`b${i}`} />)}
            {Array.from({ length: days }, (_, i) => {
              const d = `${ym(view.y, view.m)}-${pad2(i + 1)}`;
              return (
                <button
                  key={d}
                  className={`dp-day ${d === picked ? "on" : ""} ${d === today ? "today" : ""}`}
                  disabled={!!max && d > max}
                  aria-pressed={d === picked}
                  onClick={() => setPicked(d)}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        )}
        <div className="dp-foot">
          <button className="dp-reset" onClick={reset}>재설정</button>
          <button className="dp-ok" onClick={() => { onPick(picked); onClose(); }} aria-label="확인">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7" /></svg>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 눌러서 앱 달력을 여는 날짜 버튼 */
export function DateButton({ value, max, onChange, className, children }: { value: string; max?: string; onChange: (d: string) => void; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open && <DatePicker value={value} max={max} onPick={onChange} onClose={() => setOpen(false)} />}
    </>
  );
}

export const EditIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="M13.5 6.5l4 4" /></svg>
);

/** 목록 줄 오른쪽 연필 아이콘 버튼 (체중 기록·영양제 목록 공통) */
export const EditButton = ({ onClick, label = "수정" }: { onClick: () => void; label?: string }) => (
  <button className="row-edit" onClick={onClick} aria-label={label}><EditIcon /></button>
);

export const BackIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M20 12H5M11 6l-6 6 6 6" />
  </svg>
);

/** 글자 입력칸 (앱 전체 공통). onChange는 입력한 글자를 바로 받음 */
export const TextInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & { value: string; onChange: (v: string) => void }>(
  function TextInput({ onChange, className, ...rest }, ref) {
    return <input ref={ref} {...rest} className={`field ${className ?? ""}`} onChange={(e) => onChange(e.target.value)} />;
  },
);

/**
 * 숫자 입력 (빈칸 허용).
 * 입력 중인 글자는 따로 들고 있어서, 칸을 비워도 부모가 0으로 저장한 값이 "0"으로 되살아나지 않음.
 * 칸을 누르면 전체 선택돼서 바로 새 숫자를 칠 수 있음.
 */
export function NumInput({
  value, onChange, placeholder, step = "any", className, decimals,
}: {
  value: number | null | undefined; onChange: (v: number | null) => void; placeholder?: string; step?: string; className?: string;
  /** 소수점 아래 최대 자릿수 (예: 1 → 150.5까지) */
  decimals?: number;
}) {
  const show = (v: number | null | undefined) => (v == null ? "" : String(Math.round(v * 10) / 10));
  const [text, setText] = useState(show(value));
  // 바깥에서 값이 바뀐 경우(양 조절 등)에만 화면 글자를 맞춤
  const prev = useRef(value);
  useEffect(() => {
    // 값이 "모름(비어 있음)"과 숫자 사이를 오간 경우(다른 음식을 고름)도 맞춤. 0과 빈칸은 숫자로 같아서 아래 비교로는 못 잡음
    const toggled = (prev.current == null) !== (value == null);
    prev.current = value;
    if (toggled || Math.abs(Number(text || 0) - (value ?? 0)) > 0.05) setText(show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      className={className}
      type="text"
      inputMode={step === "1" ? "numeric" : "decimal"}
      placeholder={placeholder}
      value={text}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        // 숫자와 소수점 하나만 허용, 앞에 붙은 0 제거 ("065" → "65", "0.5"는 유지)
        let t = e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1").replace(/^0+(?=\d)/, "");
        if (decimals === 0) t = t.replace(/\..*$/, "");
        else if (decimals != null) t = t.replace(new RegExp(`(\\.\\d{${decimals}})\\d+$`), "$1");
        if (t.startsWith(".")) t = "0" + t;
        setText(t);
        onChange(t === "" ? null : Number(t));
      }}
    />
  );
}

export function NutrientLine({ n }: { n: Nutrients }) {
  return (
    <span className="nline">
      <b>{Math.round(n.kcal)} kcal</b> · 탄 {fmt(n.carb)} · 단 {fmt(n.protein)} · 지 {fmt(n.fat)}
      {n.sodium ? ` · 나 ${Math.round(n.sodium).toLocaleString()}mg` : ""}
    </span>
  );
}
const fmt = (v: number) => `${Math.round(v * 10) / 10}g`;

/** 영양정보 출처 작은 표시 (식약처·포장지·AI 검색·AI 추정·내 기록·직접 입력) */
export const SrcTag = ({ label }: { label: string }) => <span className="src-tag">{label}</span>;

/** AI 답의 근거: 구글 검색에서 실제로 참고한 페이지. 없으면 추정이라고 밝힘 (모르면 아무것도 안 보임) */
export function SourceLinks({ sources }: { sources?: { title: string; uri: string }[] }) {
  if (!sources) return null;
  if (!sources.length) return <p className="muted small">검색에서 근거를 찾지 못해 AI가 추정한 값이에요.</p>;
  return (
    <p className="muted small src-links">
      AI가 참고한 곳:{" "}
      {sources.map((s, i) => (
        <span key={s.uri}>{i > 0 && " · "}<a href={s.uri} target="_blank" rel="noreferrer">{s.title}</a></span>
      ))}
    </p>
  );
}

/** 검색 결과 아래 안내 */
export const DataNote = () => <p className="muted small data-note">영양정보는 참고용이라 실제와 다를 수 있어요. 포장지 영양성분표가 가장 정확해요.</p>;

/** 영양성분 한눈에: 칼로리 크게 + 탄·단·지(색 점)·나트륨 칸 */
export function NutrientGrid({ n }: { n: Nutrients }) {
  const cell = (cls: string, label: string, value: string) => (
    <div className={`ng-cell ${cls}`}>
      <span className="ng-label"><i aria-hidden />{label}</span>
      <b>{value}</b>
    </div>
  );
  return (
    <div className="ngrid-sum">
      <div className="ng-kcal"><b>{Math.round(n.kcal).toLocaleString()}</b><span className="muted"> kcal</span></div>
      <div className="ng-cells">
        {cell("carb", "탄수화물", fmt(n.carb))}
        {cell("protein", "단백질", fmt(n.protein))}
        {cell("fat", "지방", fmt(n.fat))}
        {cell("sodium", "나트륨", `${Math.round(n.sodium ?? 0).toLocaleString()}mg`)}
      </div>
      <ExtrasList n={n} />
    </div>
  );
}

/** 구성 음식·식재료 카드 목록 (세트 상세, 기록 수정, 즐겨찾기 수정 공통). 아래 막대 = 전체 칼로리 중 그 음식 몫 */
export function PartsList({ label, parts, onPick }: {
  /** 없으면 "재료 N개" 줄을 숨김 */
  label?: string; parts: { name: string; place?: string; amount?: string; n: Nutrients; tag?: string }[];
  /** 누르면 그 재료를 고치는 화면으로 */
  onPick?: (i: number) => void;
}) {
  return (
    <>
      {label && <p className="muted small set-parts-head">{label} {parts.length}개</p>}
      <ul className="set-parts">
        {parts.map((p, i) => (
          <li key={i} className={onPick ? "pick" : undefined} onClick={onPick && (() => onPick(i))}>
            <div className="sp-main">
              <span className="sp-name">
                {p.place && <span className="muted">{p.place} </span>}
                <b>{p.name}</b>
                {p.tag && <SrcTag label={p.tag} />}
              </span>
              <span className="muted small">
                {[p.amount, `탄 ${Math.round(p.n.carb)} · 단 ${Math.round(p.n.protein)} · 지 ${Math.round(p.n.fat)}g`].filter(Boolean).join(" · ")}
              </span>
            </div>
            <b className="sp-kcal">{Math.round(p.n.kcal).toLocaleString()}<span className="muted"> kcal</span></b>
            {onPick && <span className="sp-chev" aria-hidden>›</span>}
          </li>
        ))}
      </ul>
    </>
  );
}

/** 재료들을 PartsList 줄로 */
export const itemParts = (items: Item[], withSource = false) =>
  items.map((i) => ({ name: i.name, amount: i.grams ? `${r1(i.grams)}g` : i.amountText, n: i.nutrients, tag: withSource ? sourceLabel(i) : undefined }));

/** 세부 영양(당류·식이섬유·포화·트랜스·불포화지방) 칸. 하나도 모르면 안 보임, 모르는 값은 — */
export function ExtrasList({ n, always = false }: { n: Nutrients; always?: boolean }) {
  if (!always && EXTRAS.every(({ key }) => n[key] == null)) return null;
  return (
    <dl className="extras">
      {EXTRAS.map(({ key, label }) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd>{n[key] != null ? fmt(n[key]!) : "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 접힌 상태에서 보이는 세부 영양 요약 ("당 5g · 포화 2g …") */
export const extrasSummary = (n: Nutrients) =>
  EXTRAS.filter(({ key }) => n[key] != null).map(({ key, short }) => `${short} ${fmt(n[key]!)}`).join(" · ");

/** 목표 대비 진행 막대 */
export function Progress({ label, value, target, unit, className }: { label: string; value: number; target?: number | null; unit: string; className?: string }) {
  const pct = target ? Math.min(100, (value / target) * 100) : 0;
  const over = !!target && value > target * 1.05;
  return (
    <div className={`progress-row ${className ?? ""}`}>
      <div className="progress-label">
        <span>{label}</span>
        <span className={over ? "over" : ""}>
          <b>{Math.round(value)}</b>
          {target ? ` / ${Math.round(target)}` : ""} {unit}
        </span>
      </div>
      <div className="progress"><div className={over ? "over" : ""} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

/** 탄단지·나트륨 편집. 칼로리는 탄단지를 고치면 자동으로 다시 계산(4/4/9)되고, 직접 고칠 수도 있음 */
export function NutrientEditor({ n, onChange }: { n: Nutrients; onChange: (n: Nutrients) => void }) {
  const field = (key: "carb" | "protein" | "fat", label: string) => (
    <label className="nfield">
      <span>{label} (g)</span>
      <NumInput
        value={n[key]}
        onChange={(v) => {
          const next = { ...n, [key]: v ?? 0 };
          onChange({ ...next, kcal: kcalFromMacros(next.carb, next.protein, next.fat) });
        }}
      />
    </label>
  );
  return (
    <div className="ngrid three">
      <label className="nfield">
        <span>칼로리</span>
        <NumInput value={Math.round(n.kcal)} onChange={(v) => onChange({ ...n, kcal: v ?? 0 })} step="1" />
      </label>
      {field("carb", "탄수화물")}
      {field("protein", "단백질")}
      {field("fat", "지방")}
      <label className="nfield">
        <span>나트륨 (mg)</span>
        <NumInput value={n.sodium ?? 0} onChange={(v) => onChange({ ...n, sodium: v ?? 0 })} step="1" />
      </label>
      <details className="extra-edit">
        <summary>
          세부 영양 <span className="muted small">{extrasSummary(n) || "당류·식이섬유·포화·트랜스·불포화지방"}</span>
        </summary>
        <div className="ngrid three">
          {EXTRAS.map(({ key, label }) => (
            <label key={key} className="nfield">
              <span>{label} (g)</span>
              <NumInput
                value={n[key] ?? null}
                placeholder="모름"
                decimals={1}
                onChange={(v) => {
                  const next = { ...n };
                  if (v == null) delete next[key];
                  else next[key] = v;
                  onChange(next);
                }}
              />
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}

/** − ×1.5 + : 기본 제공량의 배수를 0.5씩 조절 (최소 0.5) */
export function Stepper({ value, onChange }: { value: number; onChange: (k: number) => void }) {
  // 직접 g을 고쳐서 1.3배처럼 애매한 값이면 가까운 0.5 단위로 이동
  const up = Math.floor(value * 2 + 1e-6) / 2 + 0.5;
  const down = Math.max(0.5, Math.ceil(value * 2 - 1e-6) / 2 - 0.5);
  return (
    <div className="stepper">
      <button onClick={() => onChange(down)} disabled={value <= 0.5} aria-label="0.5배 줄이기">−</button>
      {/* 배수 직접 입력 (소수점 첫째 자리까지) */}
      <label className="stepper-value">
        <NumInput
          value={Math.round(value * 10) / 10}
          onChange={(v) => v != null && v > 0 && onChange(v)}
          decimals={1}
          className="stepper-input"
        />
      </label>
      <button onClick={() => onChange(up)} aria-label="0.5배 늘리기">+</button>
    </div>
  );
}

/** 왼쪽으로 밀면 삭제 버튼이 나오는 줄 */
export function SwipeRow({ children, onTap, onDelete }: { children: ReactNode; onTap: () => void; onDelete: () => void }) {
  const OPEN = -84;
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ px: number; py: number; x: number; horizontal: boolean | null } | null>(null);
  const moved = useRef(false);

  return (
    <div className="swipe-row">
      <button className="swipe-delete" onClick={onDelete} tabIndex={x === OPEN ? 0 : -1}>삭제</button>
      <div
        className="swipe-content"
        style={{ transform: `translateX(${x}px)`, transition: dragging ? "none" : "transform 0.2s" }}
        onPointerDown={(e) => {
          start.current = { px: e.clientX, py: e.clientY, x, horizontal: null };
          moved.current = false;
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s) return;
          const dx = e.clientX - s.px, dy = e.clientY - s.py;
          if (s.horizontal === null && Math.abs(dx) + Math.abs(dy) > 6) s.horizontal = Math.abs(dx) > Math.abs(dy);
          if (!s.horizontal) return;
          moved.current = true;
          setDragging(true);
          setX(Math.max(OPEN - 20, Math.min(0, s.x + dx)));
        }}
        onPointerUp={() => {
          if (start.current?.horizontal) setX((v) => (v < OPEN / 2 ? OPEN : 0));
          start.current = null;
          setDragging(false);
        }}
        onPointerCancel={() => {
          start.current = null;
          setDragging(false);
          setX((v) => (v < OPEN / 2 ? OPEN : 0));
        }}
        onClick={() => {
          if (moved.current) return;
          if (x !== 0) setX(0);
          else onTap();
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** 잠깐 보였다 사라지는 안내 (어느 화면에서든 호출) */
/** 아침·점심·간식·저녁 고르기 (기록·기록 수정·나도 기록하기 공통) */
export function MealSeg({ value, onChange }: { value: Meal; onChange: (m: Meal) => void }) {
  return (
    <div className="seg meal-seg">
      {MEALS.map((m) => (
        <button key={m.key} className={value === m.key ? "on" : ""} onClick={() => onChange(m.key)}><span className="meal-ic" aria-hidden>{m.icon}</span>{m.label}</button>
      ))}
    </div>
  );
}

/** 공통 버튼. kind: primary(주 버튼) · secondary(회색) · danger(지우기 등) */
export function Btn({ kind = "secondary", className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: "primary" | "secondary" | "danger" }) {
  return <button {...rest} className={`btn ${kind} ${className ?? ""}`} />;
}

/** 버튼 여러 개를 한 줄에 같은 폭으로 */
export const BtnRow = ({ children }: { children: ReactNode }) => <div className="btn-pair">{children}</div>;

/** 화면 제목 자리의 끼니 (☀️ 아침 기록 ▾). 누르면 끼니를 바꿀 수 있음 (식단 기록·기록 수정 공통) */
export function MealTitle({ meal, suffix = "", onChange }: { meal: Meal; suffix?: string; onChange: (m: Meal) => void }) {
  const [open, setOpen] = useState(false);
  const m = MEALS.find((x) => x.key === meal)!;
  return (
    <>
      <button className="meal-title" onClick={() => setOpen(true)} aria-label={`${m.label}${suffix}, 끼니 바꾸기`}>
        <span className="meal-ic" aria-hidden>{m.icon}</span>{m.label}{suffix}
        <Chevron dir="down" />
      </button>
      {open && (
        <Sheet title="끼니 바꾸기" onClose={() => setOpen(false)}>
          <div className="meal-pick">
            {MEALS.map((x) => (
              <button key={x.key} className={x.key === meal ? "on" : ""} onClick={() => { onChange(x.key); setOpen(false); }}>
                <span className="meal-ic" aria-hidden>{x.icon}</span>{x.label}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}

/** 잠깐 뜨는 알림. action을 주면 오른쪽에 버튼 (예: 되돌리기) */
export function flash(message: string, ms = 1500, action?: { label: string; run: () => void }) {
  document.querySelectorAll(".toast.flash").forEach((el) => el.remove());
  const el = document.createElement("div");
  el.className = "toast flash";
  el.textContent = message;
  if (action) {
    const b = document.createElement("button");
    b.className = "toast-action";
    b.textContent = action.label;
    b.addEventListener("click", () => action.run());
    el.appendChild(b);
  }
  // 눌러서 바로 닫기
  el.addEventListener("click", () => el.remove());
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="toast">{message}</div>;
}
