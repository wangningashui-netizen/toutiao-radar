(() => {
  const els = {
    date: document.querySelector("#date"),
    q: document.querySelector("#q"),
    clear: document.querySelector("#clear"),
    chips: document.querySelector("#chips"),
    fanChips: document.querySelector("#fan-chips"),
    result: document.querySelector("#result"),
    gallery: document.querySelector("#gallery"),
    empty: document.querySelector("#empty"),
    status: document.querySelector("#status"),
    more: document.querySelector("#more"),
    toast: document.querySelector("#toast"),
    toTop: document.querySelector("#to-top"),
    lbPhoto: document.querySelector("#lb-photo"),
    lightbox: document.querySelector("#lightbox"),
    lbCaption: document.querySelector("#lb-caption"),
    lbClose: document.querySelector("#lb-close"),
    lbPrev: document.querySelector("#lb-prev"),
    lbNext: document.querySelector("#lb-next"),
    lbImg: document.querySelector("#lb-img"),
    lbCounter: document.querySelector("#lb-counter"),
    lbThumbs: document.querySelector("#lb-thumbs"),
    lbStage: document.querySelector("#lb-stage"),
  };

  const state = {
    index: null,
    days: [],
    keys: new Map(),
    group: "全部",
    fan: "低粉",
    sort: "read",
    query: "",
    cursor: 0,
    flight: null,
    lb: null,
    lastFocus: null,
    toastTimer: 0,
    zoom: {
      scale: 1,
      x: 0,
      y: 0,
      pointers: new Map(),
      startDist: 0,
      startScale: 1,
      pan: null,
      swipe: null,
      lastTap: 0,
    },
  };

  const NS = "http://www.w3.org/2000/svg";

  function formatDay(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!match) return iso || "";
    return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`;
  }

  function formatDayShort(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!match) return iso || "";
    return `${Number(match[2])}月${Number(match[3])}日`;
  }

  function parsePostTime(entry, dayIso) {
    const full = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(entry.time || "");
    if (full) {
      const iso = `${full[1]}-${full[2]}-${full[3]}T${full[4]}:${full[5]}:${full[6] || "00"}+08:00`;
      const ms = Date.parse(iso);
      return {
        ms: Number.isNaN(ms) ? 0 : ms,
        label: `${Number(full[2])}月${Number(full[3])}日 ${full[4]}:${full[5]}`,
        iso,
      };
    }
    const match = /^(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(entry.time || "");
    const yearMatch = /^(\d{4})-(\d{2})-/.exec(dayIso || "");
    if (!match || !yearMatch) {
      return { ms: 0, label: entry.time || "", iso: "" };
    }
    let year = Number(yearMatch[1]);
    const digestMonth = Number(yearMatch[2]);
    const month = Number(match[1]);
    if (month > digestMonth) year -= 1;
    const iso = `${year}-${match[1]}-${match[2]}T${match[3]}:${match[4]}:00+08:00`;
    const ms = Date.parse(iso);
    return {
      ms: Number.isNaN(ms) ? 0 : ms,
      label: `${month}月${Number(match[2])}日 ${match[3]}:${match[4]}`,
      iso,
    };
  }

  function metric(entry, sort) {
    if (sort === "comment") return Number(entry.comment) || 0;
    if (sort === "like") return Number(entry.like) || 0;
    if (sort === "rate") return Number(entry.comments_per_1k_reads) || 0;
    return Number(entry.read) || 0;
  }

  function captionOf(entry) {
    return entry.text || entry.title || "";
  }

  function norm(value) {
    return String(value || "").toLowerCase().normalize("NFKC");
  }

  function num(value) {
    return (Number(value) || 0).toLocaleString("zh-CN");
  }

  function safeLocal(path) {
    if (typeof path !== "string") return "";
    const trimmed = path.trim();
    if (!trimmed || trimmed.startsWith("/") || trimmed.includes("..") || trimmed.includes("\\") || trimmed.includes("://")) {
      return "";
    }
    return trimmed.split("/").map(encodeURIComponent).join("/");
  }

  function safeRemote(url) {
    if (typeof url !== "string" || !url.trim()) return "";
    try {
      const parsed = new URL(url.trim());
      if (parsed.protocol !== "https:") return "";
      return parsed.href;
    } catch {
      return "";
    }
  }

  function sourcesOf(entry) {
    return (entry.images || []).map((image) => {
      const local = safeLocal(image.local);
      const width = Number(image.width) || 0;
      const height = Number(image.height) || 0;
      return {
        src: local,
        fallback: "",
        width: width > 0 ? width : 0,
        height: height > 0 ? height : 0,
      };
    }).filter((item) => item.src);
  }

  function handle(entry) {
    return /^[A-Za-z0-9_]{1,30}$/.test(entry.author || "") ? entry.author : "";
  }

  function postUrl(entry) {
    const author = handle(entry);
    if (!author || !/^\d+$/.test(entry.id || "")) return "";
    return `https://x.com/${author}/status/${entry.id}`;
  }

  function profileUrl(entry) {
    const author = handle(entry);
    return author ? `https://x.com/${author}` : "";
  }

  function icon(path) {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("ico");
    const shape = document.createElementNS(NS, "path");
    shape.setAttribute("fill", "currentColor");
    shape.setAttribute("d", path);
    svg.appendChild(shape);
    return svg;
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("on");
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => els.toast.classList.remove("on"), 1800);
  }

  function fallbackCopy(text) {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.focus();
    area.select();
    area.setSelectionRange(0, text.length);
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }

  async function copyPrompt(entry, button) {
    const text = captionOf(entry);
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) ok = fallbackCopy(text);
    toast(ok ? "已复制" : "复制失败，请展开后手动选择");
    if (ok && button) {
      button.textContent = "已复制";
      button.classList.add("is-done");
      window.setTimeout(() => {
        button.textContent = "复制配文";
        button.classList.remove("is-done");
      }, 1600);
    }
  }

  function attachImage(img, source) {
    img.referrerPolicy = "no-referrer";
    img.decoding = "async";
    img.alt = img.alt || "";
    if (source.width > 0 && source.height > 0) {
      img.width = source.width;
      img.height = source.height;
    }
    if (source.fallback) img.dataset.fallback = source.fallback;
    img.addEventListener("error", () => {
      if (img.dataset.fallback && !img.dataset.fellback) {
        img.dataset.fellback = "1";
        img.removeAttribute("srcset");
        img.src = img.dataset.fallback;
        return;
      }
      const fail = document.createElement("span");
      fail.className = "img-fail";
      fail.textContent = "图片未能加载";
      img.replaceWith(fail);
    });
    img.src = source.src;
  }

  function syncExpand(card) {
    const text = card.querySelector(".prompt-text");
    const button = card.querySelector(".expand");
    if (!text || !button) return;
    const open = card.classList.contains("is-open");
    button.textContent = open ? "收起" : "展开";
    button.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      button.hidden = false;
      return;
    }
    if (card.hidden || text.clientHeight === 0) return;
    button.hidden = text.scrollHeight <= text.clientHeight + 2;
  }

  function syncVisibleExpands() {
    els.gallery.querySelectorAll(".card").forEach(syncExpand);
  }

  function buildCard(entry, dayDate, eager) {
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.key = `${dayDate}:${entry.id}`;

    const sources = sourcesOf(entry);
    const caption = captionOf(entry);
    if (sources.length) {
      const shot = document.createElement("button");
      shot.type = "button";
      shot.className = "shot";
      shot.setAttribute("aria-label", sources.length > 1 ? `查看图片，共 ${sources.length} 张` : "查看图片");
      const img = document.createElement("img");
      img.alt = caption || "配图";
      if (eager) {
        img.loading = "eager";
        img.fetchPriority = "high";
      } else {
        img.loading = "lazy";
      }
      attachImage(img, sources[0]);
      shot.appendChild(img);
      if (sources.length > 1) {
        const pill = document.createElement("span");
        pill.className = "count-pill";
        pill.textContent = `${sources.length} 张`;
        shot.appendChild(pill);
      }
      card.appendChild(shot);
    } else {
      const fail = document.createElement("div");
      fail.className = "img-fail";
      fail.textContent = "暂无配图";
      card.appendChild(fail);
    }

    const body = document.createElement("div");
    body.className = "body";

    const title = document.createElement("h3");
    title.textContent = caption || "无配文";
    body.appendChild(title);

    const badges = document.createElement("div");
    badges.className = "badges";
    const fan = document.createElement("span");
    fan.className = "badge";
    fan.dataset.fan = entry.low_fans ? "low" : "normal";
    fan.textContent = entry.low_fans ? "低粉" : "普通";
    badges.appendChild(fan);
    if (entry.category) {
      const cat = document.createElement("span");
      cat.className = "badge";
      cat.textContent = entry.category;
      badges.appendChild(cat);
    }
    body.appendChild(badges);

    const stats = document.createElement("div");
    stats.className = "stats";
    const bits = [
      ["阅读", entry.read],
      ["评论", entry.comment],
      ["点赞", entry.like],
      ["粉丝", entry.fans],
    ];
    bits.forEach(([label, value]) => {
      const span = document.createElement("span");
      span.className = "stat";
      span.append(document.createTextNode(label));
      const b = document.createElement("b");
      b.textContent = num(value);
      span.appendChild(b);
      stats.appendChild(span);
    });
    const when = parsePostTime(entry, dayDate);
    const time = document.createElement("time");
    if (when.iso) time.dateTime = when.iso;
    time.textContent = when.label;
    stats.appendChild(time);
    body.appendChild(stats);

    if (entry.author) {
      const meta = document.createElement("div");
      meta.className = "meta";
      const author = document.createElement("span");
      author.className = "author";
      author.textContent = entry.author;
      meta.appendChild(author);
      body.appendChild(meta);
    }

    const actions = document.createElement("div");
    actions.className = "actions";
    if (caption.trim()) {
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "btn btn-primary copy";
      copy.textContent = "复制配文";
      actions.appendChild(copy);
    }
    const href = entry.url || postUrl(entry);
    if (href) {
      const origin = document.createElement("a");
      origin.className = "btn origin";
      origin.href = href;
      origin.target = "_blank";
      origin.rel = "noopener noreferrer";
      origin.textContent = "看原帖";
      origin.setAttribute("aria-label", "打开今日头条原帖");
      actions.appendChild(origin);
    }
    body.appendChild(actions);

    card.appendChild(body);
    return card;
  }

  function allEntries() {
    return state.days.flatMap((day) => day.entries);
  }

  function groupsOf(entries) {
    const counts = new Map();
    entries.forEach((entry) => {
      const name = entry.category || "未分类";
      counts.set(name, (counts.get(name) || 0) + 1);
    });
    const names = [...counts.keys()].sort((a, b) => {
      if (a === "未分类") return 1;
      if (b === "未分类") return -1;
      return counts.get(b) - counts.get(a) || a.localeCompare(b, "zh");
    });
    return names.map((name) => ({ name, count: counts.get(name) }));
  }

  function fanOf(entry) {
    return entry.low_fans ? "低粉" : "普通";
  }

  function renderFanChips() {
    const entries = allEntries();
    const counts = { 全部: entries.length, 低粉: 0, 普通: 0 };
    entries.forEach((entry) => { counts[fanOf(entry)] += 1; });
    if (!els.fanChips) return;
    els.fanChips.replaceChildren();
    ["全部", "低粉", "普通"].forEach((name) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      button.dataset.fan = name;
      button.setAttribute("aria-pressed", name === state.fan ? "true" : "false");
      button.append(document.createTextNode(name));
      const count = document.createElement("span");
      count.className = "chip-count";
      count.textContent = String(counts[name] || 0);
      button.appendChild(count);
      els.fanChips.appendChild(button);
    });
  }

  function renderChips() {
    renderFanChips();
    const entries = allEntries();
    els.chips.replaceChildren();
    const items = [{ name: "全部", count: entries.length }, ...groupsOf(entries)];
    if (!items.some((item) => item.name === state.group)) state.group = "全部";
    items.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      button.dataset.group = item.name;
      button.setAttribute("aria-pressed", item.name === state.group ? "true" : "false");
      button.append(document.createTextNode(item.name));
      const count = document.createElement("span");
      count.className = "chip-count";
      count.textContent = String(item.count);
      button.appendChild(count);
      els.chips.appendChild(button);
    });
  }

  function sortEntries(entries, dayIso) {
    return entries.map((entry, index) => ({ entry, index })).sort((a, b) => {
      if (state.sort === "time") {
        const delta = parsePostTime(b.entry, dayIso).ms - parsePostTime(a.entry, dayIso).ms;
        if (delta) return delta;
      } else {
        const deltaMetric = metric(b.entry, state.sort) - metric(a.entry, state.sort);
        if (deltaMetric) return deltaMetric;
      }
      return a.index - b.index;
    });
  }

  function applyView() {
    const query = norm(state.query.trim());
    let shown = 0;
    state.days.forEach((day) => {
      const section = document.getElementById(`day-${day.date}`);
      if (!section) return;
      const gallery = section.querySelector(".gallery");
      let visible = 0;
      sortEntries(day.entries, day.date).forEach(({ entry }) => {
        const key = `${day.date}:${entry.id}`;
        const card = gallery.querySelector(`[data-key="${CSS.escape(key)}"]`);
        if (!card) return;
        gallery.appendChild(card);
        const groupOk = state.group === "全部" || (entry.category || "未分类") === state.group;
        const fanOk = state.fan === "全部" || fanOf(entry) === state.fan;
        const textOk = !query || norm(captionOf(entry)).includes(query) || norm(entry.author).includes(query);
        const ok = groupOk && fanOk && textOk;
        card.hidden = !ok;
        if (ok) visible += 1;
      });
      section.hidden = visible === 0;
      shown += visible;
    });

    const loaded = allEntries().length;
    const total = (state.index?.dates || []).reduce((sum, day) => sum + (Number(day.count) || 0), 0);
    const sortNames = { read: "按阅读", comment: "按评论", like: "按点赞", rate: "按评论率", time: "按时间" };
    const sortLabel = sortNames[state.sort] || "按阅读";
    const more = state.cursor < (state.index?.dates.length || 0);
    els.result.textContent = loaded
      ? `显示 ${shown} / ${loaded} 条${more ? ` · 共 ${total} 条` : ""} · ${sortLabel}`
      : "";
    const finished = state.index && state.cursor >= state.index.dates.length && !state.flight;
    els.empty.hidden = shown !== 0 || !finished;
    els.empty.textContent = query || state.group !== "全部" || state.fan !== "全部" ? "没有匹配的微头条" : "还没有微头条";
    chromeUi.setFiltered(Boolean(state.query.trim()) || state.group !== "全部" || state.fan !== "低粉" || state.sort !== "read");
    requestAnimationFrame(syncVisibleExpands);
  }

  function appendDay(day, item) {
    const date = day.date || item.date;
    const section = document.createElement("section");
    section.className = "day";
    section.id = `day-${date}`;
    const heading = document.createElement("h2");
    heading.className = "day-head";
    heading.textContent = `${formatDayShort(date)} · ${day.entries.length}条`;
    const gallery = document.createElement("div");
    gallery.className = "gallery";
    const eagerBase = state.days.length === 0;
    sortEntries(day.entries, date).forEach(({ entry }, index) => {
      const card = buildCard(entry, date, eagerBase && index < 3);
      state.keys.set(card.dataset.key, { entry, date });
      gallery.appendChild(card);
    });
    section.append(heading, gallery);
    els.gallery.appendChild(section);
    state.days.push({ date, entries: day.entries });
  }

  function readUrl() {
    const params = new URLSearchParams(location.search);
    const allowed = new Set(["read", "comment", "like", "rate", "time"]);
    const fan = params.get("f");
    return {
      date: params.get("date") || "",
      q: params.get("q") || "",
      g: params.get("g") || "全部",
      f: fan === "全部" || fan === "普通" || fan === "低粉" ? fan : "低粉",
      sort: allowed.has(params.get("sort")) ? params.get("sort") : "read",
    };
  }

  function writeUrl() {
    const params = new URLSearchParams();
    if (state.query.trim()) params.set("q", state.query.trim());
    if (state.group && state.group !== "全部") params.set("g", state.group);
    if (state.fan && state.fan !== "低粉") params.set("f", state.fan);
    if (state.sort && state.sort !== "read") params.set("sort", state.sort);
    const query = params.toString();
    const hash = location.hash || "";
    history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${hash}`);
  }

  function syncSortButtons() {
    document.querySelectorAll(".sort button").forEach((button) => {
      button.setAttribute("aria-checked", button.dataset.sort === state.sort ? "true" : "false");
    });
  }

  async function loadJson(url) {
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) throw new Error(String(response.status));
    return response.json();
  }

  function setMoreLabel() {
    if (!state.index) return;
    if (state.cursor >= state.index.dates.length) {
      els.more.textContent = state.days.length ? "已经是最早的一天" : "";
    } else if (state.days.length) {
      els.more.textContent = "继续下拉，查看更早的日期";
    } else {
      els.more.textContent = "";
    }
  }

  function maybeFill() {
    if (state.flight || !state.index || state.cursor >= state.index.dates.length) return;
    const rect = els.more.getBoundingClientRect();
    if (rect.top < window.innerHeight + 700) loadNextDay();
  }

  async function loadNextDay() {
    if (state.flight) return state.flight;
    if (!state.index || state.cursor >= state.index.dates.length) return;
    const run = async () => {
      const item = state.index.dates[state.cursor];
      const first = state.days.length === 0;
      if (first) {
        els.status.hidden = false;
        els.status.textContent = "正在加载…";
      } else {
        els.more.textContent = "正在加载更早的日期…";
      }
      const day = await loadJson(item.file);
      if (!day || !Array.isArray(day.entries)) throw new Error("schema");
      if (!day.date) day.date = item.date;
      state.cursor += 1;
      appendDay(day, item);
      if (first) {
        els.status.hidden = true;
        document.title = "如水爆款 · 低粉带图微头条";
      }
      setMoreLabel();
      renderChips();
      applyView();
    };
    state.flight = run().finally(() => {
      state.flight = null;
    });
    try {
      await state.flight;
    } catch {
      if (state.days.length === 0) {
        els.status.hidden = false;
        els.status.textContent = "这一天的数据加载失败，请刷新重试。";
      } else {
        els.more.textContent = "更早的日期加载失败，继续下拉重试";
      }
      return;
    }
    maybeFill();
  }

  async function jumpTo(date) {
    if (!state.index.dates.some((day) => day.date === date)) return;
    let guard = 0;
    while (!state.days.some((day) => day.date === date) && guard < state.index.dates.length) {
      const before = state.cursor;
      await loadNextDay();
      guard += 1;
      if (state.cursor === before) break;
    }
    const section = document.getElementById(`day-${date}`);
    if (!section) {
      toast("这一天加载失败");
      return;
    }
    if (section.hidden) {
      toast("这一天没有符合当前筛选的微头条");
      return;
    }
    if (document.activeElement === els.date) els.date.blur();
    chromeUi.collapseForNav();
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function entryFromCard(card) {
    return state.keys.get(card.dataset.key) || null;
  }

  function applyZoom() {
    const { scale, x, y } = state.zoom;
    els.lbImg.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  }

  function resetZoom() {
    const zoom = state.zoom;
    zoom.scale = 1;
    zoom.x = 0;
    zoom.y = 0;
    zoom.pointers.clear();
    zoom.pan = null;
    zoom.swipe = null;
    if (els.lbImg) applyZoom();
  }

  function closeLightbox() {
    if (!state.lb) return;
    state.lb = null;
    els.lightbox.hidden = true;
    document.documentElement.style.overflow = "";
    resetZoom();
    els.lbImg.removeAttribute("src");
    if (state.lastFocus && typeof state.lastFocus.focus === "function") state.lastFocus.focus();
  }

  function renderLightbox() {
    const found = state.keys.get(state.lb.key);
    const entry = found?.entry;
    const sources = entry ? sourcesOf(entry) : [];
    if (!entry || !sources.length) {
      closeLightbox();
      return;
    }
    state.lb.index = (state.lb.index + sources.length) % sources.length;
    const source = sources[state.lb.index];
    els.lbCaption.textContent = captionOf(entry);
    els.lbCounter.textContent = sources.length > 1 ? `${state.lb.index + 1} / ${sources.length}` : "";
    els.lbCounter.hidden = sources.length < 2;
    const single = sources.length < 2;
    els.lbPrev.classList.toggle("is-dim", single);
    els.lbNext.classList.toggle("is-dim", single);
    els.lbPrev.disabled = single;
    els.lbNext.disabled = single;
    els.lbThumbs.hidden = single;
    const img = document.createElement("img");
    img.id = "lb-img";
    img.alt = captionOf(entry) || "配图";
    attachImage(img, source);
    els.lbImg.replaceWith(img);
    els.lbImg = img;
    resetZoom();

    els.lbThumbs.replaceChildren();
    sources.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", `第 ${index + 1} 张`);
      button.setAttribute("aria-current", index === state.lb.index ? "true" : "false");
      const thumb = document.createElement("img");
      thumb.alt = "";
      attachImage(thumb, item);
      button.appendChild(thumb);
      button.addEventListener("click", () => {
        state.lb.index = index;
        renderLightbox();
      });
      els.lbThumbs.appendChild(button);
    });
  }

  function openLightbox(entry, key) {
    const sources = sourcesOf(entry);
    if (!sources.length) return;
    state.lastFocus = document.activeElement;
    state.lb = { key, index: 0 };
    els.lightbox.hidden = false;
    document.documentElement.style.overflow = "hidden";
    renderLightbox();
    els.lbClose.focus();
  }

  function stepLightbox(delta) {
    if (!state.lb) return;
    state.lb.index += delta;
    renderLightbox();
  }

  function onGalleryClick(event) {
    const card = event.target.closest(".card");
    if (!card) return;
    const found = entryFromCard(card);
    if (!found) return;
    if (event.target.closest(".shot")) {
      openLightbox(found.entry, card.dataset.key);
      return;
    }
    const copy = event.target.closest(".copy");
    if (copy) {
      copyPrompt(found.entry, copy);
      return;
    }
    const expand = event.target.closest(".expand");
    if (expand) {
      card.classList.toggle("is-open");
      syncExpand(card);
    }
  }

  function trapTab(event) {
    if (event.key !== "Tab" || els.lightbox.hidden) return;
    const nodes = [...els.lightbox.querySelectorAll("button, a, input")].filter((node) => !node.hidden && node.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function fillDateSelect() {
    els.date.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "选择日期";
    els.date.appendChild(placeholder);
    state.index.dates.forEach((day) => {
      const option = document.createElement("option");
      option.value = day.date;
      option.textContent = `${formatDay(day.date)} · ${day.count} 条`;
      els.date.appendChild(option);
    });
    els.date.value = "";
  }

  const chromeUi = {
    collapseForNav() {},
    close() {},
    expand() {},
    setFiltered() {},
  };

  function installChrome(startOpen) {
    const chrome = document.querySelector("#chrome");
    const toggle = document.querySelector("#filter-toggle");
    const mast = document.querySelector(".mast");
    const mastSide = document.querySelector("#mast-side");
    if (!chrome || !toggle || !mast || !mastSide) return;

    const mq = window.matchMedia("(max-width: 680px)");
    let open = !!startOpen;
    let floatLatch = false;
    let lastY = window.scrollY || 0;
    let lastScrollAt = 0;
    let drift = 0;
    let guardUntil = 0;
    let suspendUntil = 0;
    let touchingChrome = false;
    let applied = "";

    function editingField() {
      const el = document.activeElement;
      return !!(el && chrome.contains(el) && el.matches("input, textarea"));
    }

    function render(force) {
      const mobileNow = mq.matches;
      const y = Math.max(0, window.scrollY || 0);
      if (!mobileNow || !open) floatLatch = false;
      else if (y <= 8) floatLatch = false;
      else if (y > 24) floatLatch = true;
      const float = mobileNow && open && floatLatch;
      const key = `${mobileNow ? 1 : 0}${open ? 1 : 0}${float ? 1 : 0}`;
      if (!force && key === applied) return;
      applied = key;

      toggle.hidden = !mobileNow;
      chrome.classList.toggle("is-collapsed", mobileNow && !open);
      chrome.classList.toggle("is-open", mobileNow && open);
      chrome.classList.toggle("is-float", float);
      toggle.setAttribute("aria-expanded", mobileNow && open ? "true" : "false");
      const label = mobileNow && open ? "收起" : "筛选";
      if (toggle.textContent !== label) toggle.textContent = label;

      if (float) {
        const dateH = Math.ceil(mastSide.getBoundingClientRect().height);
        if (dateH) chrome.style.setProperty("--date-h", `${dateH}px`);
      }
      if (!mobileNow || !open || float) {
        const bar = Math.ceil(chrome.getBoundingClientRect().height);
        if (bar) document.documentElement.style.setProperty("--chrome-bar", `${bar}px`);
      }
    }

    function setOpen(next) {
      const mobileNow = mq.matches;
      const resolved = mobileNow ? !!next : false;
      if (resolved === open && mobileNow) {
        render();
        return;
      }
      open = resolved;
      guardUntil = performance.now() + 320;
      render(true);
      lastY = Math.max(0, window.scrollY || 0);
    }

    toggle.addEventListener("click", () => {
      if (!mq.matches) return;
      setOpen(!open);
    });
    mast.addEventListener("click", (event) => {
      if (!mq.matches) return;
      if (event.target.closest("select, label, .filter-toggle, input, button, a")) return;
      setOpen(!open);
    });
    document.addEventListener("click", (event) => {
      if (!mq.matches || !open || chrome.contains(event.target)) return;
      setOpen(false);
    });
    chrome.addEventListener("touchstart", () => { touchingChrome = true; }, { passive: true });
    chrome.addEventListener("touchend", () => { touchingChrome = false; }, { passive: true });
    chrome.addEventListener("touchcancel", () => { touchingChrome = false; }, { passive: true });

    window.addEventListener("scroll", () => {
      const y = Math.max(0, window.scrollY || 0);
      const dy = y - lastY;
      lastY = y;
      if (!mq.matches || !els.lightbox.hidden) return;
      const now = performance.now();
      if (now < suspendUntil || touchingChrome || editingField() || now < guardUntil) {
        drift = 0;
        lastScrollAt = now;
        render();
        return;
      }
      if (now - lastScrollAt > 180) drift = 0;
      lastScrollAt = now;
      if ((dy > 0 && drift < 0) || (dy < 0 && drift > 0)) drift = 0;
      drift += dy;
      // Phone scroll events often arrive in small steps. Add them up so a
      // deliberate swipe still opens or closes, without reacting to a nudge.
      if (drift >= 40 && open) {
        drift = 0;
        setOpen(false);
      } else if (drift <= -40 && !open) {
        drift = 0;
        setOpen(true);
      } else render();
    }, { passive: true });

    mq.addEventListener("change", () => {
      if (!mq.matches) open = false;
      floatLatch = false;
      lastY = Math.max(0, window.scrollY || 0);
      render(true);
    });
    window.visualViewport?.addEventListener("resize", () => render(true), { passive: true });
    render(true);

    chromeUi.collapseForNav = () => {
      suspendUntil = performance.now() + 2200;
      drift = 0;
      setOpen(false);
      const release = () => { suspendUntil = 0; };
      window.setTimeout(() => {
        if (!suspendUntil) return;
        window.addEventListener("scrollend", release, { once: true });
      }, 80);
      window.setTimeout(release, 2200);
    };
    chromeUi.close = () => setOpen(false);
    chromeUi.expand = () => {
      if (!mq.matches) return;
      suspendUntil = 0;
      setOpen(true);
    };
    chromeUi.setFiltered = (on) => {
      toggle.classList.toggle("is-filtered", !!on);
    };
  }

  async function init() {
    const urlState = readUrl();
    state.query = urlState.q;
    state.group = urlState.g || "全部";
    state.fan = urlState.f || "低粉";
    state.sort = urlState.sort;
    els.q.value = state.query;
    els.clear.hidden = !state.query;
    syncSortButtons();
    installChrome(Boolean(urlState.q) || (Boolean(urlState.g) && urlState.g !== "全部") || urlState.f !== "低粉" || urlState.sort !== "read");
    chromeUi.setFiltered(Boolean(state.query.trim()) || state.group !== "全部" || state.fan !== "低粉" || state.sort !== "read");

    els.date.addEventListener("change", () => {
      const value = els.date.value;
      els.date.value = "";
      if (value) jumpTo(value);
    });
    els.q.addEventListener("input", () => {
      state.query = els.q.value;
      els.clear.hidden = !state.query;
      if (state.days.length) {
        applyView();
        writeUrl();
        maybeFill();
      }
    });
    els.clear.addEventListener("click", () => {
      els.q.value = "";
      state.query = "";
      els.clear.hidden = true;
      els.q.focus();
      if (state.days.length) {
        applyView();
        writeUrl();
        maybeFill();
      }
    });
    document.querySelector(".sort").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-sort]");
      if (!button || button.dataset.sort === state.sort) return;
      state.sort = button.dataset.sort;
      syncSortButtons();
      if (state.days.length) {
        applyView();
        writeUrl();
      }
    });
    if (els.fanChips) {
      els.fanChips.addEventListener("click", (event) => {
        const chip = event.target.closest(".chip");
        if (!chip) return;
        state.fan = chip.dataset.fan || "全部";
        els.fanChips.querySelectorAll(".chip").forEach((item) => {
          item.setAttribute("aria-pressed", item === chip ? "true" : "false");
        });
        applyView();
        writeUrl();
        maybeFill();
      });
    }
    els.chips.addEventListener("click", (event) => {
      const button = event.target.closest(".chip");
      if (!button) return;
      state.group = button.dataset.group;
      els.chips.querySelectorAll(".chip").forEach((chip) => {
        chip.setAttribute("aria-pressed", chip === button ? "true" : "false");
      });
      applyView();
      writeUrl();
      maybeFill();
    });
    els.gallery.addEventListener("click", onGalleryClick);
    els.lbClose.addEventListener("click", closeLightbox);
    els.lbPrev.addEventListener("click", () => stepLightbox(-1));
    els.lbNext.addEventListener("click", () => stepLightbox(1));
    els.lightbox.addEventListener("click", (event) => {
      const target = event.target;
      if (target === els.lightbox || target === els.lbStage || target.classList?.contains("lb-figure")) {
        closeLightbox();
      }
    });
    document.addEventListener("keydown", (event) => {
      trapTab(event);
      if (event.key === "Escape" && state.lb) closeLightbox();
      else if (event.key === "Escape") chromeUi.close();
      if (state.lb && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        stepLightbox(event.key === "ArrowRight" ? 1 : -1);
      }
      const typing = event.target.closest("input, textarea, select");
      if (event.key === "/" && !typing && !state.lb && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        chromeUi.expand();
        els.q.focus();
      }
    });

    const photo = els.lbPhoto;
    const zoom = state.zoom;
    photo.addEventListener("pointerdown", (event) => {
      try { photo.setPointerCapture(event.pointerId); } catch { /* synthetic events */ }
      zoom.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (zoom.pointers.size === 1) {
        zoom.swipe = { x: event.clientX, y: event.clientY };
        zoom.pan = { x: zoom.x, y: zoom.y, px: event.clientX, py: event.clientY };
      } else if (zoom.pointers.size === 2) {
        const [a, b] = [...zoom.pointers.values()];
        zoom.startDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        zoom.startScale = zoom.scale;
      }
    });
    photo.addEventListener("pointermove", (event) => {
      if (!zoom.pointers.has(event.pointerId)) return;
      zoom.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (zoom.pointers.size >= 2) {
        const [a, b] = [...zoom.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        zoom.scale = Math.min(4, Math.max(1, zoom.startScale * (dist / zoom.startDist)));
        if (zoom.scale === 1) {
          zoom.x = 0;
          zoom.y = 0;
        }
        applyZoom();
        return;
      }
      if (zoom.scale > 1.02 && zoom.pan) {
        zoom.x = zoom.pan.x + (event.clientX - zoom.pan.px);
        zoom.y = zoom.pan.y + (event.clientY - zoom.pan.py);
        applyZoom();
      }
    });
    photo.addEventListener("pointerup", (event) => {
      const start = zoom.swipe;
      const hadPinch = zoom.pointers.size >= 2;
      zoom.pointers.delete(event.pointerId);
      if (!hadPinch && start && zoom.scale <= 1.02) {
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        const moved = Math.hypot(dx, dy);
        if (moved < 12) {
          const now = Date.now();
          if (now - zoom.lastTap < 280) {
            zoom.scale = zoom.scale > 1.05 ? 1 : 2.4;
            zoom.x = 0;
            zoom.y = 0;
            applyZoom();
            zoom.lastTap = 0;
          } else {
            zoom.lastTap = now;
          }
        } else if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.2) {
          stepLightbox(dx > 0 ? -1 : 1);
        }
      }
      if (zoom.pointers.size === 1) {
        const left = [...zoom.pointers.values()][0];
        zoom.pan = { x: zoom.x, y: zoom.y, px: left.x, py: left.y };
        zoom.swipe = null;
      }
    });
    photo.addEventListener("pointercancel", (event) => {
      zoom.pointers.delete(event.pointerId);
    });

    function syncToTop() {
      const on = window.scrollY > 420;
      els.toTop.classList.toggle("is-on", on);
      els.toTop.setAttribute("aria-hidden", on ? "false" : "true");
      els.toTop.tabIndex = on ? 0 : -1;
    }
    window.addEventListener("scroll", syncToTop, { passive: true });
    syncToTop();
    els.toTop.addEventListener("click", () => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    });

    let resizeTimer = 0;
    window.addEventListener("resize", () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(syncVisibleExpands, 120);
    });
    document.fonts?.ready?.then(syncVisibleExpands);

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadNextDay();
    }, { rootMargin: "700px 0px" });
    observer.observe(els.more);

    try {
      state.index = await loadJson("data/index.json");
      if (!state.index?.dates?.length) throw new Error("empty");
      state.index.dates = state.index.dates
        .filter((day) => day && typeof day.date === "string" && typeof day.file === "string")
        .sort((a, b) => b.date.localeCompare(a.date));
      if (!state.index.dates.length) throw new Error("empty");
      fillDateSelect();
      await loadNextDay();
      if (urlState.date && urlState.date !== state.index.dates[0].date) jumpTo(urlState.date);
    } catch {
      els.status.hidden = false;
      els.status.textContent = "日期索引加载失败，请刷新重试。";
    }
  }

  init();
})();
