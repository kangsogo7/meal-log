import UIKit
import Capacitor
import WidgetKit
import AVFoundation
import Photos
import PhotosUI
import HealthKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

// ---------- 홈 화면 위젯 연결 ----------
// 앱(웹 코드) ↔ 위젯: 같은 App Group 저장소에 오늘 상태(state)와 위젯에서 누른 것(pending)을 둠

let widgetAppGroup = "group.com.kangsogo7.mealmanager"

/** 웹 코드의 registerPlugin("WidgetBridge")와 연결 (안드로이드와 같은 이름·함수) */
@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takePending", returnType: CAPPluginReturnPromise),
    ]
    private var store: UserDefaults? { UserDefaults(suiteName: widgetAppGroup) }

    /** 오늘 상태 저장 후 위젯 다시 그리기. 위젯에서 눌렀는데 앱이 아직 못 가져간 물은 더해서 저장 */
    @objc func update(_ call: CAPPluginCall) {
        var state = call.getString("state") ?? ""
        if let data = state.data(using: .utf8),
           var obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           var water = obj["water"] as? [String: Any],
           let date = obj["date"] as? String {
            let extra = pendingList()
                .filter { ($0["type"] as? String) == "water" && ($0["date"] as? String) == date }
                .reduce(0.0) { $0 + (($1["ml"] as? NSNumber)?.doubleValue ?? 0) }
            if extra > 0 {
                water["ml"] = ((water["ml"] as? NSNumber)?.doubleValue ?? 0) + extra
                obj["water"] = water
                if let out = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: out, encoding: .utf8) { state = s }
            }
        }
        store?.set(state, forKey: "state")
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    /** 위젯에서 누른 것들을 넘기고 비움 */
    @objc func takePending(_ call: CAPPluginCall) {
        let raw = store?.string(forKey: "pending") ?? "[]"
        store?.set("[]", forKey: "pending")
        call.resolve(["actions": raw])
    }

    private func pendingList() -> [[String: Any]] {
        guard let data = (store?.string(forKey: "pending") ?? "[]").data(using: .utf8) else { return [] }
        return (try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]) ?? []
    }
}

/** 앱 화면: Capacitor 기본 화면에 위젯 연결·바코드 플러그인을 붙임 */
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(WidgetBridgePlugin())
        bridge?.registerPluginInstance(BarcodeScanPlugin())
        bridge?.registerPluginInstance(PhotoLibraryPlugin())
        bridge?.registerPluginInstance(MoveRingPlugin())
    }
}

// ---------- 피트니스 앱 '움직이기'(활동 링) 칼로리 ----------
// 웹 코드의 registerPlugin("MoveRing"). 건강 앱의 '활동 에너지'에는 다른 앱으로 기록한 운동 칼로리가 빠질 수 있어서,
// 건강 앱 '활동' 카드·피트니스 앱과 같은 숫자인 활동 링 값을 읽음. { days: [{ date: "2026-11-19", kcal }] }
@objc(MoveRingPlugin)
public class MoveRingPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MoveRingPlugin"
    public let jsName = "MoveRing"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
    ]
    private let store = HKHealthStore()

    @objc func read(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["days": []])
            return
        }
        let days = max(1, min(call.getInt("days") ?? 14, 90))
        store.requestAuthorization(toShare: nil, read: [HKObjectType.activitySummaryType()]) { _, _ in
            let cal = Calendar.current
            let now = Date()
            guard let start = cal.date(byAdding: .day, value: -(days - 1), to: cal.startOfDay(for: now)) else {
                call.resolve(["days": []])
                return
            }
            var from = cal.dateComponents([.era, .year, .month, .day], from: start)
            from.calendar = cal
            var to = cal.dateComponents([.era, .year, .month, .day], from: now)
            to.calendar = cal
            let query = HKActivitySummaryQuery(predicate: HKQuery.predicate(forActivitySummariesBetweenStart: from, end: to)) { _, summaries, _ in
                let list: [[String: Any]] = (summaries ?? []).compactMap { sum in
                    let c = sum.dateComponents(for: cal)
                    guard let y = c.year, let m = c.month, let d = c.day else { return nil }
                    return ["date": String(format: "%04d-%02d-%02d", y, m, d), "kcal": sum.activeEnergyBurned.doubleValue(for: .kilocalorie())]
                }
                call.resolve(["days": list])
            }
            self.store.execute(query)
        }
    }
}

// ---------- 바코드 찍기 ----------
// 웹 코드의 registerPlugin("BarcodeScan")과 연결 (안드로이드와 같은 이름·함수). 찍으면 { code }, 닫으면 {}

@objc(BarcodeScanPlugin)
public class BarcodeScanPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BarcodeScanPlugin"
    public let jsName = "BarcodeScan"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise),
    ]

    @objc func scan(_ call: CAPPluginCall) {
        AVCaptureDevice.requestAccess(for: .video) { ok in
            DispatchQueue.main.async {
                guard ok else {
                    call.reject("카메라 권한이 없어요. 설정 → 식단 기록 → 카메라를 켜 주세요.")
                    return
                }
                let vc = ScannerViewController()
                vc.onDone = { code in
                    if let code { call.resolve(["code": code]) } else { call.resolve([:]) }
                }
                vc.modalPresentationStyle = .fullScreen
                self.bridge?.viewController?.present(vc, animated: true)
            }
        }
    }
}

/** 전체 화면 카메라. 바코드가 보이면 바로 닫고 숫자를 넘김 */
class ScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onDone: ((String?) -> Void)?
    private let session = AVCaptureSession()
    private var finished = false
    private var failed = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else {
            failed = true
            return
        }
        session.addInput(input)
        let output = AVCaptureMetadataOutput()
        if session.canAddOutput(output) {
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = [.ean13, .ean8, .upce, .code128].filter { output.availableMetadataObjectTypes.contains($0) }
        }
        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        preview.frame = view.bounds
        view.layer.addSublayer(preview)

        let hint = UILabel()
        hint.text = "바코드를 화면 가운데에 맞춰 주세요"
        hint.textColor = .white
        hint.font = .systemFont(ofSize: 15, weight: .medium)
        hint.textAlignment = .center
        hint.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(hint)

        let close = UIButton(type: .system)
        close.setTitle("닫기", for: .normal)
        close.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        close.setTitleColor(.white, for: .normal)
        close.translatesAutoresizingMaskIntoConstraints = false
        close.addTarget(self, action: #selector(cancel), for: .touchUpInside)
        view.addSubview(close)

        NSLayoutConstraint.activate([
            hint.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            hint.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -90),
            close.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            close.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -24),
            close.widthAnchor.constraint(equalToConstant: 120),
            close.heightAnchor.constraint(equalToConstant: 48),
        ])
        DispatchQueue.global(qos: .userInitiated).async { self.session.startRunning() }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if failed { finish(nil) }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        view.layer.sublayers?.compactMap { $0 as? AVCaptureVideoPreviewLayer }.forEach { $0.frame = view.bounds }
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard let code = (metadataObjects.first as? AVMetadataMachineReadableCodeObject)?.stringValue else { return }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        // UPC-A는 EAN-13 앞에 0이 붙어 나옴 → 데이터베이스 표기(12자리)로
        finish(code.count == 13 && code.hasPrefix("0") ? String(code.dropFirst()) : code)
    }

    @objc private func cancel() { finish(nil) }

    private func finish(_ code: String?) {
        if finished { return }
        finished = true
        session.stopRunning()
        let done = onDone
        onDone = nil
        dismiss(animated: true) { done?(code) }
    }
}

// ---------- 앱 안 사진앨범 ----------
// 웹 코드의 registerPlugin("PhotoLibrary")와 연결 (안드로이드와 같은 이름·함수).
// 최근 사진 목록(작은 미리보기 base64 JPEG)과 고른 사진 원본을 넘김

@objc(PhotoLibraryPlugin)
public class PhotoLibraryPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PhotoLibraryPlugin"
    public let jsName = "PhotoLibrary"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "access", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "more", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "full", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
    ]
    private var assets: PHFetchResult<PHAsset>?

    private func fetch() -> PHFetchResult<PHAsset> {
        let o = PHFetchOptions()
        o.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        return PHAsset.fetchAssets(with: .image, options: o)
    }

    private func name(_ s: PHAuthorizationStatus) -> String {
        switch s {
        case .authorized: return "full"
        case .limited: return "limited"
        default: return "denied"
        }
    }

    /** 권한 확인 (처음이면 물어봄): full / limited / denied */
    @objc func access(_ call: CAPPluginCall) {
        PHPhotoLibrary.requestAuthorization(for: .readWrite) { s in
            self.assets = nil
            call.resolve(["status": self.name(s)])
        }
    }

    /** "선택한 사진만"일 때 사진 더 고르기 */
    @objc func more(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let vc = self.bridge?.viewController, PHPhotoLibrary.authorizationStatus(for: .readWrite) == .limited {
                PHPhotoLibrary.shared().presentLimitedLibraryPicker(from: vc) { _ in
                    self.assets = nil
                    call.resolve(["status": self.name(PHPhotoLibrary.authorizationStatus(for: .readWrite))])
                }
            } else {
                call.resolve(["status": self.name(PHPhotoLibrary.authorizationStatus(for: .readWrite))])
            }
        }
    }

    @objc func list(_ call: CAPPluginCall) {
        let offset = call.getInt("offset") ?? 0
        let limit = call.getInt("limit") ?? 40
        DispatchQueue.global(qos: .userInitiated).async {
            if offset == 0 || self.assets == nil { self.assets = self.fetch() }
            guard let r = self.assets else { call.resolve(["items": [[String: Any]](), "total": 0]); return }
            let opt = PHImageRequestOptions()
            opt.isSynchronous = true
            opt.deliveryMode = .highQualityFormat
            opt.resizeMode = .fast
            opt.isNetworkAccessAllowed = true
            var items: [[String: Any]] = []
            let end = min(r.count, offset + limit)
            if offset < end {
                for i in offset..<end {
                    let a = r.object(at: i)
                    var b64 = ""
                    PHImageManager.default().requestImage(for: a, targetSize: CGSize(width: 240, height: 240), contentMode: .aspectFill, options: opt) { img, _ in
                        if let d = img?.jpegData(compressionQuality: 0.7) { b64 = d.base64EncodedString() }
                    }
                    if !b64.isEmpty { items.append(["id": a.localIdentifier, "thumb": b64]) }
                }
            }
            call.resolve(["items": items, "total": r.count])
        }
    }

    /** base64 JPEG를 앨범에 그대로 저장 (추가 전용 권한) */
    @objc func save(_ call: CAPPluginCall) {
        guard let b64 = call.getString("data"), let data = Data(base64Encoded: b64) else {
            call.reject("사진이 비어 있어요")
            return
        }
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { s in
            guard s == .authorized || s == .limited else {
                call.reject("사진 저장 권한이 없어요. 설정 → 식단 기록 → 사진에서 허용해 주세요.")
                return
            }
            PHPhotoLibrary.shared().performChanges({
                PHAssetCreationRequest.forAsset().addResource(with: .photo, data: data, options: nil)
            }) { ok, err in
                if ok { call.resolve() } else { call.reject(err?.localizedDescription ?? "저장하지 못했어요") }
            }
        }
    }

    @objc func full(_ call: CAPPluginCall) {
        guard let id = call.getString("id"),
              let a = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject else {
            call.reject("사진을 찾지 못했어요")
            return
        }
        let side = CGFloat(call.getInt("max") ?? 2048)
        DispatchQueue.global(qos: .userInitiated).async {
            let opt = PHImageRequestOptions()
            opt.isSynchronous = true
            opt.deliveryMode = .highQualityFormat
            opt.isNetworkAccessAllowed = true
            var out: String?
            PHImageManager.default().requestImage(for: a, targetSize: CGSize(width: side, height: side), contentMode: .aspectFit, options: opt) { img, _ in
                if let d = img?.jpegData(compressionQuality: 0.9) { out = d.base64EncodedString() }
            }
            if let out { call.resolve(["data": out]) } else { call.reject("사진을 열지 못했어요") }
        }
    }
}
