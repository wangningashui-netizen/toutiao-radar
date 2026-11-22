#!/usr/bin/env python3
"""拉取今日头条低粉/普通爆款带图微头条，写入仓库 data/ 与 images/。"""
from __future__ import annotations

import argparse
import datetime
import json
import time
from io import BytesIO
from pathlib import Path

import requests
from PIL import Image

# ---------- 默认配置 ----------
DAYS = 7
GENRE = "微头条"
CATEGORIES: list[str] = []
KEYWORD = ""
MIN_READ = 30000
PAGES = 10
MAX_TEXT = 80
MAX_IMGS = 4
MAX_WIDTH = 1080
MAX_BYTES = 2 * 1024 * 1024
LOW_FANS_THRESHOLD = 50000

API = "https://www.czgts.cn/muse/content/api/v1/hots/search?appVersion="
HEADERS = {
    "Content-Type": "application/json",
    "Origin": "https://www.czgts.cn",
    "Referer": "https://www.czgts.cn/v1/hots/popular",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
}

ROOT = Path(__file__).resolve().parent.parent


def today_shanghai() -> datetime.date:
    tz = datetime.timezone(datetime.timedelta(hours=8))
    return datetime.datetime.now(tz).date()


def now_shanghai_str() -> str:
    tz = datetime.timezone(datetime.timedelta(hours=8))
    return datetime.datetime.now(tz).strftime("%Y-%m-%d %H:%M:%S")


def num(x) -> int:
    return int(float(x or 0))


def pull(low_fans: bool, pages: int, days: int) -> list[dict]:
    """low_fans=False：按阅读排的普通爆款；True：低粉爆款（作者粉丝 < 5 万）。"""
    today = today_shanghai()
    body = {
        "limit": 50,
        "offset": 0,
        "postType": 3 if low_fans else 1,
        "platforms": ["今日头条"],
        "categories": CATEGORIES,
        "searchWord": KEYWORD,
        "sortBy": "readCnt",
        "articleGenres": [GENRE],
        "startTime": (today - datetime.timedelta(days=days)).strftime("%Y-%m-%d 00:00:00"),
        "endTime": today.strftime("%Y-%m-%d 23:59:59"),
        "searchId": "",
        "readLimits": "" if low_fans else f"{MIN_READ}_99999999",
        "fansLimits": "",
        "videoDurationLimits": "",
    }
    rows: list[dict] = []
    for page in range(pages):
        resp = requests.post(API, json=body, headers=HEADERS, timeout=30)
        try:
            data = resp.json()
        except Exception as exc:
            raise RuntimeError(
                f"创作罐头返回非 JSON，HTTP {resp.status_code}: {resp.text[:500]}"
            ) from exc
        if data.get("code") != 0:
            raise RuntimeError(f"创作罐头返回 code={data.get('code')}: {data.get('message')}")
        lst = data.get("list") or []
        rows.extend(lst)
        print(f"[pull low_fans={low_fans} page={page + 1}] {len(lst)} 条", flush=True)
        if len(lst) < 50:
            break
        body["offset"] += 50
        body["searchId"] = data.get("searchId") or ""
        time.sleep(2)
    return rows


def load_published_ids(root: Path) -> set[str]:
    ids: set[str] = set()
    index_path = root / "data" / "index.json"
    files: list[Path] = []
    if index_path.exists():
        try:
            index = json.loads(index_path.read_text(encoding="utf-8"))
            for item in index.get("dates") or []:
                rel = item.get("file") or ""
                if rel and not rel.startswith("/") and ".." not in rel:
                    files.append(root / rel)
        except json.JSONDecodeError:
            pass
    files.extend(sorted((root / "data").glob("20??-??-??.json")))
    for path in files:
        if not path.is_file():
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        for entry in payload.get("entries") or []:
            eid = entry.get("id")
            if eid:
                ids.add(str(eid))
    return ids


def process_image(raw: bytes, dest_stem: Path) -> tuple[Path, int, int] | None:
    """缩放、转 JPEG，GIF 只留第一帧；超过 2MB 则继续压缩，仍超则放弃。"""
    try:
        image = Image.open(BytesIO(raw))
        image.load()
        if getattr(image, "n_frames", 1) > 1:
            image.seek(0)
        if image.mode in ("RGBA", "LA", "P"):
            rgba = image.convert("RGBA")
            bg = Image.new("RGB", rgba.size, (255, 255, 255))
            bg.paste(rgba, mask=rgba.split()[-1])
            image = bg
        else:
            image = image.convert("RGB")
    except Exception as exc:
        print(f"  无法解码图片: {exc}")
        return None

    width, height = image.size
    if width > MAX_WIDTH:
        height = max(1, round(height * MAX_WIDTH / width))
        width = MAX_WIDTH
        image = image.resize((width, height), Image.Resampling.LANCZOS)

    data = None
    for quality in (85, 75, 65, 55, 45):
        buf = BytesIO()
        image.save(buf, format="JPEG", quality=quality, optimize=True, progressive=True)
        data = buf.getvalue()
        if len(data) <= MAX_BYTES:
            break
        # 再缩小一截
        width = max(320, int(width * 0.8))
        height = max(1, int(height * 0.8))
        image = image.resize((width, height), Image.Resampling.LANCZOS)

    if data is None or len(data) > MAX_BYTES:
        print(f"  压缩后仍超过 {MAX_BYTES} 字节，跳过")
        return None

    dest = dest_stem.with_suffix(".jpg")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    with Image.open(dest) as saved:
        width, height = saved.size
    return dest, width, height


def grab_images(gids: list[str], out_dir: Path, root: Path, max_imgs: int = MAX_IMGS) -> dict[str, list[dict]]:
    """打开头条桌面版帖子页，下载正文大图并压缩入库。"""
    from playwright.sync_api import sync_playwright

    js = r"""() => {
      const big = im => { const r = im.getBoundingClientRect(); return r.width >= 160 && r.height >= 120; };
      const bad = im => im.closest('[class*=feed-card],[class*=comment],[class*=avatar],[class*=recommend],[class*=related]');
      const srcs = list => [...new Set(list.filter(im => big(im) && !bad(im))
                              .map(im => im.currentSrc || im.src || '').filter(s => s.startsWith('http')))];
      let out = srcs([...document.querySelectorAll('.wtt-content img, [class*=weitoutiao-img] img, article img')]);
      if (!out.length) out = srcs([...document.querySelectorAll('img')].filter(im => im.getBoundingClientRect().left < 760));
      return out;
    }"""

    found: dict[str, list[dict]] = {}
    out_dir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        ctx = browser.new_context(
            viewport={"width": 1100, "height": 1100},
            locale="zh-CN",
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
            ),
        )
        page = ctx.new_page()
        for i, gid in enumerate(gids, start=1):
            print(f"[grab {i}/{len(gids)} gid={gid}]", flush=True)
            try:
                page.goto(
                    f"https://www.toutiao.com/article/{gid}/",
                    wait_until="networkidle",
                    timeout=30000,
                )
            except Exception as exc:
                print(f"  goto: {type(exc).__name__}: {exc}")
            page.wait_for_timeout(2500)
            page.mouse.wheel(0, 1500)
            page.wait_for_timeout(1200)
            try:
                srcs = page.evaluate(js)[:max_imgs]
            except Exception as exc:
                print(f"  evaluate: {type(exc).__name__}: {exc}")
                srcs = []
            images: list[dict] = []
            for src in srcs:
                try:
                    resp = ctx.request.get(
                        src,
                        headers={"Referer": "https://www.toutiao.com/"},
                        timeout=20000,
                    )
                    if not resp.ok or len(resp.body()) <= 8000:
                        continue
                    stem = out_dir / f"{gid}_{len(images) + 1}"
                    processed = process_image(resp.body(), stem)
                    if not processed:
                        continue
                    dest, width, height = processed
                    rel = dest.resolve().relative_to(root).as_posix()
                    images.append({"local": rel, "width": width, "height": height})
                except Exception as exc:
                    print(f"  download: {type(exc).__name__}: {exc}")
            found[gid] = images
            print(f"  saved {len(images)} images", flush=True)
            time.sleep(1)
        browser.close()
    return found


def update_index(root: Path, date: str, count: int) -> None:
    index_path = root / "data" / "index.json"
    if index_path.exists():
        try:
            index = json.loads(index_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            index = {"schemaVersion": 1, "dates": []}
    else:
        index = {"schemaVersion": 1, "dates": []}
    index["schemaVersion"] = 1
    dates = [item for item in (index.get("dates") or []) if item.get("date") != date]
    dates.insert(0, {"date": date, "file": f"data/{date}.json", "count": count})
    dates.sort(key=lambda item: item.get("date") or "", reverse=True)
    index["dates"] = dates
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="抓取带图微头条爆款并写入仓库数据目录")
    parser.add_argument("--date", default="", help="数据日期 YYYY-MM-DD，默认今天（北京时间）")
    parser.add_argument("--pages", type=int, default=PAGES, help="每个榜最多翻几页，每页 50 条")
    parser.add_argument("--days", type=int, default=DAYS, help="回溯最近几天")
    parser.add_argument("--root", default=str(ROOT), help="仓库根目录")
    parser.add_argument("--max-text", type=int, default=MAX_TEXT, help="配文最长字数")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    date = args.date or today_shanghai().isoformat()
    img_dir = root / "images" / date
    data_dir = root / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    published = load_published_ids(root)
    print(f"已发布 {len(published)} 条，将跳过重复 id", flush=True)

    seen: dict[str, dict] = {}
    low_gids: set[str] = set()
    normal_gids: set[str] = set()
    for low in (False, True):
        rows = pull(low, pages=args.pages, days=args.days)
        print(f"pull(low_fans={low}) {len(rows)} 条", flush=True)
        for row in rows:
            gid = str(row.get("gid") or "")
            if not gid:
                continue
            if low:
                low_gids.add(gid)
            else:
                normal_gids.add(gid)
            seen.setdefault(gid, row)

    cands = []
    for row in seen.values():
        title = (row.get("title") or "").strip()
        gid = str(row["gid"])
        if len(title) > args.max_text:
            continue
        if gid in published:
            continue
        cands.append(row)
    cands.sort(key=lambda row: -num(row.get("readCnt")))
    print(
        f"列表 {len(seen)} → 短配文且未发布 {len(cands)} "
        f"（低粉榜 {sum(1 for r in cands if str(r['gid']) in low_gids)}）",
        flush=True,
    )

    images = grab_images([str(row["gid"]) for row in cands], img_dir, root) if cands else {}
    entries = []
    for row in cands:
        gid = str(row["gid"])
        files = images.get(gid) or []
        if not files:
            continue
        read = num(row.get("readCnt"))
        comment = num(row.get("commentCnt"))
        like = num(row.get("diggCnt"))
        fans = num(row.get("fans"))
        entries.append({
            "id": gid,
            "text": (row.get("title") or "").strip(),
            "url": row.get("url") or f"https://www.toutiao.com/article/{gid}/",
            "author": row.get("authorName") or "",
            "read": read,
            "comment": comment,
            "like": like,
            "fans": fans,
            "category": row.get("category") or "未分类",
            "time": row.get("publishTime") or "",
            "comments_per_1k_reads": round(comment / max(read, 1) * 1000, 2),
            "low_fans": gid in low_gids or fans < LOW_FANS_THRESHOLD,
            "images": files,
        })

    payload = {
        "schemaVersion": 1,
        "date": date,
        "timezone": "Asia/Shanghai",
        "generatedAt": now_shanghai_str(),
        "entries": entries,
    }
    out = data_dir / f"{date}.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    update_index(root, date, len(entries))
    low_n = sum(1 for item in entries if item["low_fans"])
    print(
        f"写入 {out} ：带图 {len(entries)} 条（低粉 {low_n}），图片目录 {img_dir}",
        flush=True,
    )


if __name__ == "__main__":
    main()
