from playwright.sync_api import sync_playwright
import re

VIDEO_IDS = {
    "video1(柱子哥)": "7644347037009366326",
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
    # Try direct douyin.com video page
    page.goto(f"https://www.douyin.com/video/{VIDEO_IDS['video1(柱子哥)']}", wait_until="domcontentloaded", timeout=40000)
    for _ in range(8):
        page.wait_for_timeout(2000)
        page.mouse.wheel(0, 600)
    html = page.content()
    print("html len:", len(html))
    for pat, label in [
        (r'"sec_uid"\s*:\s*"([^"]+)"', "sec_uid"),
        (r'"nickname"\s*:\s*"([^"]+)"', "nickname"),
        (r'"unique_id"\s*:\s*"([^"]+)"', "unique_id"),
        (r'author.*?sec_uid[^,]{0,80}', "author_sec_uid"),
        (r'"author"\s*:\s*{[^}]+}', "author_block"),
    ]:
        m = re.findall(pat, html)
        print(label, ":", m[:3])
    browser.close()