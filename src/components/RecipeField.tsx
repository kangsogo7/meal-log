// 조리 기록·자주 먹는 조리 음식의 "만드는 방법" 칸 (공용)
export function RecipeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label>만드는 방법
      <textarea rows={4} value={value} onChange={(ev) => onChange(ev.target.value)} placeholder="예: 닭가슴살을 굽고 채소와 함께 볶기" />
    </label>
  );
}
