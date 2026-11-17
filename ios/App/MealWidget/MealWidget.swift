// 아이폰 홈 화면 위젯 4가지: 오늘 칼로리 · 물(+1잔) · 오늘 식단 · 챌린지
// 앱이 App Group 저장소에 넣어 둔 오늘 상태(state)를 그림. 앱을 열 때·기록이 바뀔 때 앱이 새로 넣어 줌.
// 물 +1잔은 앱을 열지 않고 위젯 안에서 더하고, 앱이 열리면 기록에 반영(pending)됨.
import AppIntents
import SwiftUI
import WidgetKit

let appGroup = "group.com.kangsogo7.mealmanager"
let accent = Color(red: 0.43, green: 0.63, blue: 0.12)

// ---------- 앱이 넣어 주는 상태 (src/widgets.ts의 pushWidgets와 같은 모양) ----------

struct WWater: Codable { var ml: Double; var goalMl: Double; var cupMl: Double }
struct WMeal: Codable { var key: String; var label: String; var kcal: Double }
struct WMember: Codable { var name: String; var me: Bool; var done: Int; var passed: Int; var today: Bool? }
struct WChallenge: Codable { var name: String; var phase: String; var members: [WMember] }
struct WState: Codable {
    var date: String
    var water: WWater
    var kcal: Double
    var kcalGoal: Double?
    var protein: Double?
    var proteinGoal: Double?
    var meals: [WMeal]
    var challenge: WChallenge?
}

enum Store {
    static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

    static func today() -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date())
    }

    /** 저장된 상태. 날짜가 지났으면 오늘 기록은 0으로 */
    static func load() -> WState? {
        guard let raw = defaults?.string(forKey: "state"), let data = raw.data(using: .utf8),
              var s = try? JSONDecoder().decode(WState.self, from: data) else { return nil }
        let t = today()
        if s.date != t {
            s.date = t
            s.water.ml = 0
            s.kcal = 0
            s.protein = 0
            s.meals = s.meals.map { var m = $0; m.kcal = 0; return m }
        }
        return s
    }

    static func save(_ s: WState) {
        guard let data = try? JSONEncoder().encode(s), let raw = String(data: data, encoding: .utf8) else { return }
        defaults?.set(raw, forKey: "state")
    }

    /** 물 한 잔: 위젯 숫자를 바로 올리고, 앱이 열릴 때 기록하도록 쌓아 둠 */
    static func addWater() {
        guard var s = load() else { return }
        let cup = s.water.cupMl
        s.water.ml += cup
        save(s)
        var list: [[String: Any]] = []
        if let data = (defaults?.string(forKey: "pending") ?? "[]").data(using: .utf8) {
            list = (try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]) ?? []
        }
        list.append(["type": "water", "date": s.date, "ml": cup])
        if let out = try? JSONSerialization.data(withJSONObject: list), let raw = String(data: out, encoding: .utf8) {
            defaults?.set(raw, forKey: "pending")
        }
    }
}

struct AddWaterIntent: AppIntent {
    static var title: LocalizedStringResource = "물 한 잔 기록"
    func perform() async throws -> some IntentResult {
        Store.addWater()
        return .result()
    }
}

// ---------- 타임라인: 지금 상태 한 장, 자정에 다시 (날짜가 바뀌면 0부터) ----------

struct DayEntry: TimelineEntry {
    let date: Date
    let state: WState?
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> DayEntry { DayEntry(date: Date(), state: nil) }
    func getSnapshot(in context: Context, completion: @escaping (DayEntry) -> Void) {
        completion(DayEntry(date: Date(), state: Store.load()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<DayEntry>) -> Void) {
        let next = Calendar.current.startOfDay(for: Date().addingTimeInterval(24 * 60 * 60))
        completion(Timeline(entries: [DayEntry(date: Date(), state: Store.load())], policy: .after(next)))
    }
}

// ---------- 화면 ----------

let openApp = URL(string: "meallog://open")!
func n(_ v: Double) -> String { Int(v.rounded()).formatted() }

struct Bar: View {
    let value: Double
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.secondary.opacity(0.2))
                Capsule().fill(accent).frame(width: g.size.width * min(max(value, 0), 1))
            }
        }
        .frame(height: 8)
    }
}

struct Empty: View {
    let title: String
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption2).foregroundStyle(.secondary)
            Spacer(minLength: 0)
            Text("앱을 한 번 열어 주세요").font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct KcalView: View {
    let s: WState?
    var body: some View {
        if let s {
            VStack(alignment: .leading, spacing: 6) {
                Text("오늘 칼로리").font(.caption2).foregroundStyle(.secondary)
                Text(n(s.kcal)).font(.system(size: 26, weight: .bold)).lineLimit(1).minimumScaleFactor(0.6)
                Text(s.kcalGoal.map { "/ \(n($0)) kcal" } ?? "kcal").font(.caption2).foregroundStyle(.secondary)
                Spacer(minLength: 0)
                if let g = s.kcalGoal, g > 0 { Bar(value: s.kcal / g) }
                if let p = s.protein, let pg = s.proteinGoal {
                    Text(pg - p > 0 ? "단백질 \(n(pg - p))g 남음" : "단백질 목표 채움").font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        } else {
            Empty(title: "오늘 칼로리")
        }
    }
}

struct WaterView: View {
    let s: WState?
    var body: some View {
        if let s {
            VStack(alignment: .leading, spacing: 6) {
                Text("물").font(.caption2).foregroundStyle(.secondary)
                Text(n(s.water.ml)).font(.system(size: 26, weight: .bold)).lineLimit(1).minimumScaleFactor(0.6)
                Text("/ \(n(s.water.goalMl)) ml").font(.caption2).foregroundStyle(.secondary)
                Spacer(minLength: 0)
                Button(intent: AddWaterIntent()) {
                    Text("+ 1잔").font(.subheadline.bold()).frame(maxWidth: .infinity, minHeight: 40)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.background)
                .background(Color.primary, in: RoundedRectangle(cornerRadius: 12))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        } else {
            Empty(title: "물")
        }
    }
}

struct MealsView: View {
    let s: WState?
    var body: some View {
        if let s {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline) {
                    Text("오늘 식단").font(.subheadline.bold())
                    Spacer()
                    Text(s.kcalGoal.map { "\(n(s.kcal)) / \(n($0)) kcal" } ?? "\(n(s.kcal)) kcal").font(.caption2).foregroundStyle(.secondary)
                }
                HStack(spacing: 8) {
                    ForEach(s.meals, id: \.key) { m in
                        Link(destination: URL(string: "meallog://add?meal=\(m.key)")!) {
                            VStack(spacing: 6) {
                                Text(m.label).font(.subheadline.bold())
                                Text(m.kcal > 0 ? n(m.kcal) : "+ 기록").font(.caption2).foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .background(RoundedRectangle(cornerRadius: 12).fill(m.kcal > 0 ? Color.secondary.opacity(0.12) : Color.clear))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .strokeBorder(Color.secondary.opacity(m.kcal > 0 ? 0 : 0.5), style: StrokeStyle(lineWidth: 1, dash: [4]))
                            )
                        }
                    }
                }
            }
        } else {
            Empty(title: "오늘 식단")
        }
    }
}

struct ChallengeView: View {
    let s: WState?
    var body: some View {
        if let c = s?.challenge {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline) {
                    Text(c.name).font(.subheadline.bold()).lineLimit(1)
                    Spacer()
                    Text(c.phase).font(.caption2).foregroundStyle(.secondary)
                }
                ForEach(Array(c.members.prefix(3).enumerated()), id: \.offset) { _, m in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(m.me ? "\(m.name) · 나" : m.name).font(.caption).lineLimit(1)
                            Spacer()
                            Text("\(m.done) / \(m.passed)일" + (m.today.map { $0 ? " · 오늘 달성" : " · 오늘 아직" } ?? ""))
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                        Bar(value: m.passed > 0 ? Double(m.done) / Double(m.passed) : 0)
                    }
                }
                Spacer(minLength: 0)
            }
        } else if s == nil {
            Empty(title: "챌린지")
        } else {
            VStack(alignment: .leading, spacing: 6) {
                Text("챌린지").font(.subheadline.bold())
                Spacer(minLength: 0)
                Text("진행 중인 챌린지가 없어요").font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

// ---------- 위젯 ----------

struct KcalWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "kcal", provider: Provider()) { e in
            KcalView(s: e.state).widgetURL(openApp).containerBackground(.background, for: .widget)
        }
        .configurationDisplayName("오늘 칼로리")
        .description("먹은 칼로리와 남은 단백질")
        .supportedFamilies([.systemSmall])
    }
}

struct WaterWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "water", provider: Provider()) { e in
            WaterView(s: e.state).widgetURL(openApp).containerBackground(.background, for: .widget)
        }
        .configurationDisplayName("물")
        .description("+1잔은 앱을 열지 않고 기록돼요")
        .supportedFamilies([.systemSmall])
    }
}

struct MealsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "meals", provider: Provider()) { e in
            MealsView(s: e.state).widgetURL(openApp).containerBackground(.background, for: .widget)
        }
        .configurationDisplayName("오늘 식단")
        .description("끼니를 누르면 그 끼니 기록 화면")
        .supportedFamilies([.systemMedium])
    }
}

struct ChallengeWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "challenge", provider: Provider()) { e in
            ChallengeView(s: e.state).widgetURL(openApp).containerBackground(.background, for: .widget)
        }
        .configurationDisplayName("챌린지")
        .description("그룹 챌린지 현황 (앱을 열 때 새로 받아 와요)")
        .supportedFamilies([.systemMedium])
    }
}

@main
struct MealWidgets: WidgetBundle {
    var body: some Widget {
        KcalWidget()
        WaterWidget()
        MealsWidget()
        ChallengeWidget()
    }
}
