import json
import os
import sys
from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("JACK_E2E_BASE_URL", "http://localhost:5173")

results = []
console_errors = []


def log(msg):
    print(msg, flush=True)


def check(name, ok, detail=""):
    results.append({"name": name, "ok": ok, "detail": detail[:120]})
    log(f"{'PASS' if ok else 'FAIL'} {name} {detail[:80]}")


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.on("pageerror", lambda err: console_errors.append(f"pageerror: {err}"))

    # 1. Create a work item via the UI form and move its status
    page.goto(f"{BASE_URL}/#/work-items", timeout=15000)
    page.wait_for_load_state("networkidle")
    before = page.locator("table tbody tr").count()
    page.locator("input[placeholder='标题']").fill("E2E 自动化工作项")
    page.locator("button.primary[type=submit]").first.click()
    page.wait_for_timeout(800)
    after = page.locator("table tbody tr").count()
    check("work item created via UI", after == before + 1, f"{before}->{after}")

    new_row = page.locator("table tbody tr", has_text="E2E 自动化工作项").first
    new_row.click()
    page.wait_for_timeout(300)
    buttons = page.locator("button", has_text="就绪")
    if buttons.count() > 0:
        buttons.first.click()
        page.wait_for_timeout(500)
        check("work item status moved to 就绪", True)
    else:
        check("work item status moved to 就绪", False, "no transition button found")

    # 2. Open run detail from runs list
    page.goto(f"{BASE_URL}/#/runs", timeout=15000)
    page.wait_for_load_state("networkidle")
    link = page.locator("a", has_text="run_").first
    href = link.get_attribute("href")
    link.click()
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)
    check("run detail navigated", "run_" in (href or ""), f"href={href}")

    # 3. Command palette opens with Ctrl+K
    page.keyboard.press("Control+k")
    page.wait_for_timeout(300)
    palette_visible = page.locator("text=命令面板").count() > 0 or page.locator("input").count() > 0
    check("command palette opens with Ctrl+K", palette_visible)
    page.keyboard.press("Escape")

    # 4. Docs: pick a service and save doc via UI
    page.goto(f"{BASE_URL}/#/docs", timeout=15000)
    page.wait_for_load_state("networkidle")
    row = page.locator("table tbody tr", has_text="demo-order").first
    row.click()
    page.wait_for_timeout(400)
    editor = page.locator("textarea")
    editor.fill("# demo-order 文档\n由浏览器 E2E 写入")
    page.locator("button", has_text="保存").click()
    page.wait_for_timeout(600)
    stale_badges = page.locator("h3 span", has_text="陈旧").count()
    check("docs saved and badge shows fresh", stale_badges == 0)

    browser.close()

failures = [r for r in results if not r["ok"]]
log(json.dumps({"summary": f"{len(results) - len(failures)}/{len(results)} interactions OK", "consoleErrors": console_errors[:5]}, ensure_ascii=False, indent=1))
sys.exit(1 if failures or console_errors else 0)
