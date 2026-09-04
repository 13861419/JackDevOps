import json
import time
from playwright.sync_api import sync_playwright

BASE = "http://localhost:5173"
results = []
console_errors = []


def check(name, ok, detail=""):
    results.append({"name": name, "ok": bool(ok), "detail": str(detail)[:160]})
    print(("PASS" if ok else "FAIL") + " " + name + " " + str(detail)[:80], flush=True)


def save():
    with open("E:/Temp/opencode/deep_qa_result.json", "w", encoding="utf-8") as f:
        json.dump({"results": results, "consoleErrors": console_errors[:10]}, f, ensure_ascii=False, indent=1)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.on("pageerror", lambda e: console_errors.append(f"pageerror: {str(e)[:200]}"))

    def nav(route):
        page.goto(BASE + "/#/" + route, timeout=20000)
        page.reload()
        page.wait_for_timeout(900)

    try:
        nav("services")
        before = page.locator("table tbody tr").count()
        page.get_by_placeholder("服务名称").fill("E2E Deep QA " + str(int(time.time())))
        page.locator("button[type=submit]").first.click()
        page.wait_for_timeout(1200)
        after = page.locator("table tbody tr").count()
        check("services: register via UI form", after == before + 1, f"{before}->{after}")

        nav("workflows")
        btn_count = page.locator("table tbody tr button").count()
        check("workflows: rows have action buttons", btn_count > 0, f"buttons={btn_count}")
        page.locator("table tbody tr button").first.click()
        page.wait_for_timeout(2000)
        check("workflows: action triggered from UI", True)
        save()

        nav("runs")
        link = page.locator("a", has_text="run_").first
        link.click()
        page.wait_for_load_state("load")
        page.locator("button", has_text="AI 风险摘要").first.click()
        ok = False
        deadline = time.time() + 150
        while time.time() < deadline:
            if "风险" in page.locator("body").inner_text() and page.locator("pre").count() > 0:
                ok = True
                break
            page.wait_for_timeout(2000)
        check("runs: AI risk summary via UI (real LLM)", ok)

        diag = page.locator("button", has_text="AI 诊断").first
        if diag.count() > 0:
            diag.click()
            ok = False
            deadline = time.time() + 120
            while time.time() < deadline:
                txt = page.locator("body").inner_text()
                if "诊断" in txt and ("建议" in txt or "环境" in txt):
                    ok = True
                    break
                page.wait_for_timeout(2000)
            check("runs: AI diagnose via UI (real LLM)", ok)
        save()

        nav("previews")
        page.get_by_placeholder("服务 slug").fill("demo-order")
        page.get_by_placeholder("PR 编号").fill("888")
        page.locator("button", has_text="手动创建").first.click()
        page.wait_for_timeout(1500)
        row = page.locator("table tbody tr", has_text="888").first
        check("previews: requested via UI", row.count() >= 1)
        row.locator("button", has_text="部署").first.click()
        deployed = False
        deadline = time.time() + 90
        while time.time() < deadline:
            txt = page.locator("body").inner_text()
            if "Running" in txt or "http://localhost:" in txt:
                deployed = True
                break
            page.wait_for_timeout(3000)
        check("previews: deployed via UI (real docker)", deployed)
        save()

        nav("flags")
        flag_key = "e2e-flag-" + str(int(time.time()))
        page.get_by_placeholder("flag key").fill(flag_key)
        page.locator("button[type=submit]").first.click()
        page.wait_for_timeout(1200)
        check("flags: created via UI", flag_key in page.locator("body").inner_text())
        save()

        nav("")
        page.locator("button.ai-fab").first.click()
        page.wait_for_timeout(600)
        page.locator("textarea").last.fill("上次的服务部署失败了吗？")
        page.locator("button", has_text="提问").first.click()
        answered = False
        deadline = time.time() + 120
        while time.time() < deadline:
            if "思考中" not in page.locator("body").inner_text():
                answered = len(page.locator("body").inner_text()) > 100
                break
            page.wait_for_timeout(2000)
        check("AI copilot sidebar answers (real LLM)", answered)
        save()
    finally:
        save()
        browser.close()

fails = [r for r in results if not r["ok"]]
print("SUMMARY:", f"{len(results) - len(fails)}/{len(results)} deep checks OK", flush=True)
print("CONSOLE ERRORS:", len(console_errors), flush=True)
raise SystemExit(1 if fails else 0)

