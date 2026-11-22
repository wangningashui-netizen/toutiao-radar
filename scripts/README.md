# 每日更新怎么跑

在仓库根目录执行下面这些命令。时间按北京时间（Asia/Shanghai）计算，默认抓「今天」这一期，内容是最近 7 天的带图短配文微头条（普通榜 + 低粉榜），并自动跳过已经出现在以往 `data/YYYY-MM-DD.json` 里的帖子。

## 1. 环境（同一台机器只需做一次）

```bash
python3 -m pip install -r scripts/requirements.txt
python3 -m playwright install --with-deps chromium
```

依赖：`requests`、`playwright`、`Pillow`。采集时会打开无头 Chromium 访问头条原帖，并把图片下到仓库里（头条图需要 Referer，不能热链）。

## 2. 采集并写入当天数据

在仓库根目录：

```bash
python3 scripts/radar.py
```

常用参数：

```bash
# 指定日期（一般不用，默认就是当天）
python3 scripts/radar.py --date 2026-11-22

# 每个榜翻页数，每页 50 条，默认 10
python3 scripts/radar.py --pages 10

# 回溯天数，默认 7
python3 scripts/radar.py --days 7
```

脚本会做这些事：

1. 读取已有的 `data/index.json` 和 `data/20??-??-??.json`，记下已经发布过的帖子 id，当天不再收录。
2. 请求创作罐头接口，分别拉普通爆款榜和低粉爆款榜（作者粉丝少于 5 万）。
3. 只保留配文不超过 80 字、且正文能抓到图的帖子。
4. 下载图片后统一转成 JPEG：最宽 1080 像素，GIF 只留第一帧，单张超过 2MB 会继续压缩，压不下去就跳过。
5. 写出当天文件，并更新索引。

## 3. 输出位置（不要改页面代码）

| 路径 | 作用 |
| --- | --- |
| `data/YYYY-MM-DD.json` | 当天条目（含配文、阅读/评论/点赞/粉丝、分类、时间、`low_fans`、本地图片路径） |
| `images/YYYY-MM-DD/{id}_{n}.jpg` | 当天图片，`n` 从 1 起 |
| `data/index.json` | 日期目录，新的一天插在 `dates` 最前面 |

不要改 `index.html`、`styles.css`、`app.js`。头条图片必须用仓库里的本地文件，不要把 `toutiaoimg.com` 地址写进页面。

跑完后在仓库根目录预览确认：

```bash
python3 -m http.server 8080
```

打开 http://127.0.0.1:8080/ ，确认当天卡片、图片、筛选和复制配文都正常。

## 4. 发布到网站

首日建站时，把这些文件提交并推送到 `main`，GitHub Pages 会从仓库根目录发布。

之后的每日更新，按「如水如画」的习惯：在新分支上只提交 `data/` 和 `images/YYYY-MM-DD/`，开 Pull Request，等仓库主人合并后再上线。如果确认可以直接推 `main`，也可以把同一批文件直接推到 `main`。
