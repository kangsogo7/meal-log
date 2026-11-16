"""빌드 서버가 클라우드 서명 때 만든 개발용 인증서("Created via API")를 폐기.

GitHub의 맥은 매번 새 컴퓨터라 빌드할 때마다 개발용 인증서가 하나씩 새로 생기고,
애플 계정 한도가 차면 빌드가 실패함. 배포(TestFlight) 서명은 애플이 관리하는 인증서라 영향 없음.
사람이 Xcode에서 만든 인증서(이름이 다름)와 배포용 인증서는 건드리지 않음.

사용: python clean_dev_certs.py <p8 경로> <key id> <issuer id>
"""
import json
import sys
import time
import urllib.request

import jwt  # pyjwt[crypto]

API = "https://api.appstoreconnect.apple.com/v1"
DEV_TYPES = {"DEVELOPMENT", "IOS_DEVELOPMENT"}
MARK = "Created via API"


def token(key_path: str, key_id: str, issuer: str) -> str:
    with open(key_path) as f:
        key = f.read()
    now = int(time.time())
    return jwt.encode(
        {"iss": issuer, "iat": now, "exp": now + 600, "aud": "appstoreconnect-v1"},
        key,
        algorithm="ES256",
        headers={"kid": key_id, "typ": "JWT"},
    )


def call(method: str, url: str, tok: str):
    req = urllib.request.Request(url, method=method, headers={"Authorization": f"Bearer {tok}"})
    with urllib.request.urlopen(req) as res:
        body = res.read()
        return json.loads(body) if body else None


def main():
    tok = token(*sys.argv[1:4])
    certs = call("GET", f"{API}/certificates?limit=200", tok)["data"]
    print(f"인증서 {len(certs)}개")
    removed = 0
    for c in certs:
        a = c["attributes"]
        label = f'{a.get("certificateType")} | {a.get("name")} | {a.get("displayName")} | 만료 {a.get("expirationDate")}'
        is_ci = a.get("certificateType") in DEV_TYPES and (MARK in (a.get("name") or "") or MARK in (a.get("displayName") or ""))
        if is_ci:
            call("DELETE", f'{API}/certificates/{c["id"]}', tok)
            removed += 1
            print(f"  폐기: {label}")
        else:
            print(f"  유지: {label}")
    print(f"폐기한 개발용 인증서 {removed}개")


if __name__ == "__main__":
    main()
