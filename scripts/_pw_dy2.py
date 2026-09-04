from playwright.sync_api import sync_playwright
import re

VIDEO_IDS = {
    "video1(柱子哥)": "7644347037009366326",
    "video2(Win先生°)": "7655159420665482538",
}

with open("/tmp/dy_cookie_raw.txt") as f:
    cookie_str = f.read().strip()

cookies = []
for part in cookie_str.split(";"):
    part = part.strip()
    if not part or "=" not in part:
        continue
    name, _, value = part.partition("=")
    if not name:
        continue
    cookies.append({"name": name, "value": value, "domain": ".douyin.com", "path": "/"})

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(
        viewport={"width": 480, "height": 900},
        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
        locale="zh-CN",
    )
    ctx.add_cookies(cookies)
    page = ctx.new_page()
    for name, vid in VIDEO_IDS.items():
        print(f"=== {name} ({vid}) ===")
        url = f"https://www.iesdouyin.com/share/video/{vid}/"
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=40000)
        except Exception as e:
            print("goto err:", e)
        for _ in range(4):
            page.wait_for_timeout(1500)
            page.mouse.wheel(0, 600)
        html = page.content()
        print("html len:", len(html))
        for pat, label in [
            (r'"sec_uid"\s*:\s*"([^"]+)"', "sec_uid"),
            (r'"uid"\s*:\s*"(\d+)"', "uid"),
            (r'"nickname"\s*:\s*"([^"]+)"', "nickname"),
            (r'"unique_id"\s*:\s*"([^"]+)"', "unique_id"),
            (r'"short_id"\s*:\s*"([^"]+)"', "short_id"),
        ]:
            m = re.findall(pat, html)
            print(label, ":", m[:5])
        print()
    browser.close()
