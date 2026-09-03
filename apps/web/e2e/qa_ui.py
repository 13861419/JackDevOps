import json
import os
import sys
from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("JACK_E2E_BASE_URL", "http://localhost:5173")
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "screenshots")

ROUTES = [
    ("#/", "工作台"),
    ("#/onboarding", "上手向导"),
    ("#/services", "服务目录"),
    ("#/work-items", "需求与任务"),
    ("#/workflows", "流水线"),
    ("#/runs", "运行记录"),
    ("#/tests", "测试管理"),
    ("#/flags", "特性开关"),
    ("#/previews", "预览环境"),
    ("#/docs", "文档"),
    ("#/drift", "配置漂移"),
    ("#/audit", "审计"),
]


def log(msg):
    print(msg, flush=True)


results = []
console_errors = []
os.makedirs(SHOTS, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.on("console", lambda msg: console_errors.append(f"[{msg.type}] {msg.text[:150]}") if msg.type == "error" else None)
    page.on("pageerror", lambda err: console_errors.append(f"pageerror: {err}"))

    for hash_route, name in ROUTES:
        entry = {"route": hash_route, "name": name}
        try:
            page.goto(f"{BASE_URL}/{hash_route}", timeout=15000)
            page.wait_for_load_state("load", timeout=10000)
            page.wait_for_timeout(1200)
            entry["h1"] = page.locator("h1").first.inner_text(timeout=3000)
            entry["tableRows"] = page.locator("table tbody tr").count()
            shot = os.path.join(SHOTS, f"{hash_route.replace('#/', '').replace('/', '_') or 'dashboard'}.png")
            page.screenshot(path=shot, full_page=True)
            entry["ok"] = True
        except Exception as e:
            entry["ok"] = False
            entry["error"] = str(e)[:150]
        results.append(entry)
        log(f"{'PASS' if entry['ok'] else 'FAIL'} {hash_route} {entry.get('h1', '')} rows={entry.get('tableRows', '-')}")

    browser.close()

failures = [r for r in results if not r.get("ok")]
log(json.dumps({"summary": f"{len(results) - len(failures)}/{len(results)} pages OK", "consoleErrors": console_errors[:10]}, ensure_ascii=False, indent=1))
sys.exit(1 if failures else 0)
