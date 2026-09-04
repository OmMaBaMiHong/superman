from playwright.sync_api import sync_playwright

URLS = {
    "video1(柱子哥)": "https://www.iesdouyin.com/share/video/7644347037009366326/?region=CN&mid=7644346938543967017",
    "video2": "https://www.iesdouyin.com/share/video/7655159420665482538/?region=CN&mid=7655159331352005395",
}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(
        viewport={"width": 480, "height": 900},
        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
    )
    page = ctx.new_page()
    for name, url in URLS.items():
        print(f"=== {name} ===")
        try:
            page.goto(url, wait_until="networkidle", timeout=30000)
        except Exception as e:
            print("goto err:", e)
        page.wait_for_timeout(2000)
        html = page.content()
        import re
        sec = re.findall(r'"sec_uid"\s*:\s*"([^"]+)"', html)
        print("sec_uid:", sec[:5])
        uid = re.findall(r'"uid"\s*:\s*"(\d+)"', html)
        print("uid:", uid[:5])
        nick = re.findall(r'"nickname"\s*:\s*"([^"]+)"', html)
        print("nickname:", nick[:5])
        unique = re.findall(r'"unique_id"\s*:\s*"([^"]+)"', html)
        print("unique_id:", unique[:5])
        # also check window._ROUTER_DATA
        rd = re.findall(r'window\._ROUTER_DATA\s*=\s*(\{.*?\});', html, re.DOTALL)
        print("router_data found:", bool(rd))
        print()
    browser.close()
