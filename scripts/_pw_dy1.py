from playwright.sync_api import sync_playwright
import re

URLS = {
    "video1(柱子哥)": "https://www.iesdouyin.com/share/video/7644347037009366326/?region=CN&mid=7644346938543967017",
}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(
        viewport={"width": 480, "height": 900},
        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
        locale="zh-CN",
    )
    page = ctx.new_page()
    for name, url in URLS.items():
        print(f"=== {name} ===")
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=40000)
        except Exception as e:
            print("goto err:", e)
        # wait for a bit and scroll
        for _ in range(5):
            page.wait_for_timeout(2000)
            page.mouse.wheel(0, 800)
        html = page.content()
        print("html len:", len(html))
        for pat, label in [
            (r'"sec_uid"\s*:\s*"([^"]+)"', "sec_uid"),
            (r'"uid"\s*:\s*"(\d+)"', "uid"),
            (r'"nickname"\s*:\s*"([^"]+)"', "nickname"),
            (r'"unique_id"\s*:\s*"([^"]+)"', "unique_id"),
            (r'sec_uid=([\w\.\-]+)', "sec_uid_url"),
        ]:
            m = re.findall(pat, html)
            print(label, ":", m[:5])
        # any author / signature markers
        print("has 作者:", "作者" in html, "| has anchor:", "href=\"//www.douyin.com/user/" in html or "www.douyin.com/user/" in html)
        print()
    browser.close()
