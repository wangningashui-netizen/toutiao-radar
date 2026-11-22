# 如水爆款

每日整理今日头条上的**低粉爆款带图微头条**，做成方便手机打开的网页。

- 网站：https://wangningashui-netizen.github.io/toutiao-radar/
- 页面按日期从新到旧排列，可搜索配文、按分类或低粉/普通筛选，按阅读、评论、点赞、评论率或时间排序。点图片可放大，配文可一键复制，也可跳到头条原帖。

这是静态网站，托管在 GitHub Pages：从 `main` 分支根目录直接发布，打开时不需要构建。界面为简体中文，深浅色跟随系统。

日常更新只改数据，不要改 `index.html`、`styles.css`、`app.js`：

1. 把当天的 JPEG 放进 `images/YYYY-MM-DD/`。
2. 新建 `data/YYYY-MM-DD.json`。
3. 在 `data/index.json` 的 `dates` 最前面插入这一天。

完整采集步骤见 [`scripts/README.md`](scripts/README.md)。本地预览不要用 `file://` 打开（浏览器会拦截 `fetch`）：

```bash
python3 -m http.server 8080
```

然后访问 http://127.0.0.1:8080/ 。
