"""评论/指标统一归一模型（P3a 爬虫服务）。

字段归一参考 huangque-main-site/server/tikhub.py 的实测字段路径（用户自有项目），
但实现独立：这里只定义目标 schema，各 provider 自行适配。
"""


def normalize_comment(
    *,
    cid,
    text,
    user,
    likes,
    time_value,
    reply_count,
    platform,
    post_id,
    ip_location=None,
):
    """归一评论结构：{cid, text, user, likes, time, reply_count, platform, post_id, ip_location?}"""
    return {
        "cid": str(cid) if cid is not None else "",
        "text": str(text or ""),
        "user": str(user or ""),
        "likes": int(likes or 0),
        "time": str(time_value or ""),
        "reply_count": int(reply_count or 0),
        "platform": platform,
        "post_id": str(post_id),
        "ip_location": ip_location,
    }


def normalize_stats(*, views=None, likes=None, comments=None, shares=None,
                    favorites=None, coins=None, platform, post_id):
    return {
        "views": views,
        "likes": likes,
        "comments": comments,
        "shares": shares,
        "favorites": favorites,
        "coins": coins,
        "platform": platform,
        "post_id": str(post_id),
    }
