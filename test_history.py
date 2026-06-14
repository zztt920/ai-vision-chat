import urllib.request, json

BASE = "http://localhost:3000/api/chat"

def chat(text, history):
    data = json.dumps({"text": text, "image": None, "history": history}).encode('utf-8')
    req = urllib.request.Request(BASE, data=data, headers={"Content-Type": "application/json"})
    try:
        resp = urllib.request.urlopen(req)
        result = json.loads(resp.read())
        return result['reply']
    except urllib.error.HTTPError as e:
        return f"[ERROR {e.code}] {e.read().decode()[:200]}"

# 第一轮
print("=== 第1轮 ===")
r1 = chat("你好，我叫小明，我是一个学生", [])
print(f"AI: {r1[:150]}\n")

# 第二轮：问名字（测试记忆）
history1 = [
    {"role": "user", "parts": [{"text": "你好，我叫小明，我是一个学生"}]},
    {"role": "assistant", "parts": [{"text": r1}]}
]
print("=== 第2轮（测试记忆）===")
r2 = chat("我刚才告诉你我叫什么名字？", history1)
print(f"AI: {r2[:150]}\n")

# 第三轮：继续追问
history2 = history1 + [
    {"role": "user", "parts": [{"text": "我刚才告诉你我叫什么名字？"}]},
    {"role": "assistant", "parts": [{"text": r2}]}
]
print("=== 第3轮（继续测试上下文）===")
r3 = chat("那我是做什么的？", history2)
print(f"AI: {r3[:150]}\n")

# 第四轮：确认连续对话长度
history3 = history2 + [
    {"role": "user", "parts": [{"text": "那我是做什么的？"}]},
    {"role": "assistant", "parts": [{"text": r3}]}
]
print("=== 第4轮（深层上下文）===")
r4 = chat("总结一下我们刚才聊了什么", history3)
print(f"AI: {r4[:200]}\n")

print("=== 历史记录测试完成 ===")
print(f"总消息数: {len(history3) + 1} (加上当前)")