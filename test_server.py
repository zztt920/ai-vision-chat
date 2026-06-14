import urllib.request, json, sys

def test(name, data_dict):
    data = json.dumps(data_dict).encode('utf-8')
    req = urllib.request.Request("http://localhost:3000/api/chat", data=data, headers={"Content-Type": "application/json"})
    try:
        resp = urllib.request.urlopen(req)
        print(f"[{name}] Status: {resp.status}")
        body = resp.read().decode('utf-8')
        print(f"  Body: {body[:200]}")
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8')
        print(f"[{name}] HTTP {e.code}: {body[:200]}")

test("空文本", {"text": "", "image": None, "history": []})
test("正常文本", {"text": "Hello World", "image": None, "history": []})
test("仅图片(无text)", {"text": "", "image": "/9j/4AAQSkZJRg==", "history": []})

# CORS test
req3 = urllib.request.Request("http://localhost:3000/api/chat", method="OPTIONS")
req3.add_header("Origin", "https://evil-site.com")
req3.add_header("Access-Control-Request-Method", "POST")
try:
    resp3 = urllib.request.urlopen(req3)
    print(f"[CORS] Status: {resp3.status}")
    print(f"  ACAO: {resp3.headers.get('Access-Control-Allow-Origin')}")
except Exception as e:
    print(f"[CORS] Error: {e}")

# Check X-Powered-By
try:
    req4 = urllib.request.Request("http://localhost:3000/api/chat", data=json.dumps({"text":"test","image":None,"history":[]}).encode('utf-8'), headers={"Content-Type": "application/json"})
    resp4 = urllib.request.urlopen(req4)
    print(f"[X-Powered-By] {resp4.headers.get('X-Powered-By', '(not set)')}")
except urllib.error.HTTPError as e:
    print(f"[X-Powered-By] {e.headers.get('X-Powered-By', '(not set)')}")

# Check Security headers
req5 = urllib.request.Request("http://localhost:3000/")
try:
    resp5 = urllib.request.urlopen(req5)
    for h in ['X-Frame-Options', 'X-Content-Type-Options', 'Content-Security-Policy', 'Strict-Transport-Security']:
        val = resp5.headers.get(h, '(not set)')
        print(f"[Security Header] {h}: {val}")
except Exception as e:
    print(f"[Root] GET / Error: {e}")

print("=== 测试完成 ===")