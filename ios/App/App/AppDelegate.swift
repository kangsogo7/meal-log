import UIKit
import Capacitor
import WidgetKit
import AVFoundation

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
