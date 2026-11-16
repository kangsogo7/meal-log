// Firebase 앱·로그인 초기화 (그룹 공유와 AI 호출 서버가 같이 씀)
// 이 파일은 그룹 탭이나 AI 서버를 쓸 때만 불러옴 (Firebase 코드가 커서 앱 첫 로딩에 넣지 않음)
import { initializeApp } from "firebase/app";
import { Capacitor } from "@capacitor/core";
import { getAuth, indexedDBLocalPersistence, initializeAuth } from "firebase/auth";

// 공개용 설정값 (앱 코드에 들어가도 되는 값. 실제 접근 권한은 firestore.rules로 막음)
export const app = initializeApp({
  apiKey: "AIzaSyDRBppRnGQnyUQP5-Adb5FAWMka6HEyd6k",
  authDomain: "meal-log-f1b13.firebaseapp.com",
  projectId: "meal-log-f1b13",
  storageBucket: "meal-log-f1b13.firebasestorage.app",
  messagingSenderId: "749252526635",
  appId: "1:749252526635:web:aa821dc0c90802b6e2606e",
});
// 아이폰 앱(WKWebView)에서는 getAuth가 로그인 상태를 영영 알려 주지 않아 그룹 탭이 멈춤 → 앱에서는 IndexedDB 저장만 쓰도록 직접 초기화
export const auth = Capacitor.isNativePlatform() ? initializeAuth(app, { persistence: indexedDBLocalPersistence }) : getAuth(app);
