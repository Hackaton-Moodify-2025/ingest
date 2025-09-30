const fs = require("fs-extra");
const puppeteer = require("puppeteer");

const START_URL = "https://www.banki.ru/services/responses/bank/gazprombank/?is_countable=on";

// 🔧 настройки
const SAVE_EVERY_ITEMS = 200;          // автосейв каждые N новых ссылок
const SAVE_EVERY_MS = 30_000;          // автосейв раз в N мс
const CHECKPOINT_FILE = "links.json";

const CLICK_MORE_TRIES = 5000;
const WAIT_AFTER_CLICK_MS = 2500;
const SCROLL_AFTER_CLICK_MS = 1500;

// 🔧 фильтр по датам
const DATE_FROM = new Date("2024-01-01");
const DATE_TO = new Date("2025-05-31");

const EARLY_STOP_ON_OLD = true;
const OLD_BATCH_STREAK_TO_STOP = 3;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const parseDateIso = (str) => {
  const m = (str || "").match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const inRange = (iso) => {
  if (!iso) return true;
  const d = new Date(iso);
  return d >= DATE_FROM && d <= DATE_TO;
};

(async () => {
  console.log("🚀 parser_links.js — сбор ссылок c фильтром по датам на листинге");

  // 1) Загружаем чекпоинт
  let items = [];
  if (await fs.pathExists(CHECKPOINT_FILE)) {
    try {
      items = await fs.readJson(CHECKPOINT_FILE);
      console.log(`🔄 Найдено в чекпоинте: ${items.length} записей`);
    } catch {
      console.log("⚠️ Чекпоинт повреждён — начнём заново");
      items = [];
    }
  }
  const ids = new Set(items.map((x) => x.id));

  // автосейв
  let lastSavedAt = Date.now();
  let addedSinceLastSave = 0;
  const saveNow = async (reason = "manual") => {
    try {
      await fs.writeJson(CHECKPOINT_FILE, items, { spaces: 2 });
      lastSavedAt = Date.now();
      addedSinceLastSave = 0;
      console.log(`💾 Сохранено (${reason}): всего ${items.length}`);
    } catch (e) {
      console.error("⚠️ Ошибка при сохранении:", e.message);
    }
  };

  // страховочные обработчики
  const emergencySave = async (msg) => {
    console.log(`\n🛑 ${msg} — экстренное сохранение ${items.length} элементов`);
    await saveNow("emergency");
    process.exit(1);
  };
  process.on("SIGINT", async () => { await emergencySave("SIGINT"); });
  process.on("uncaughtException", async (e) => { console.error("💥 uncaughtException:", e); await emergencySave("uncaughtException"); });
  process.on("unhandledRejection", async (e) => { console.error("💥 unhandledRejection:", e); await emergencySave("unhandledRejection"); });

  // 2) браузер
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
  );

  console.log("🌐 Открываю:", START_URL);
  await page.goto(START_URL, { waitUntil: "domcontentloaded", timeout: 0 });
  await page.waitForSelector("[data-test='responses__response']", { timeout: 60_000 });
  console.log("✅ Стартовая партия карточек прогружена");

  let tries = 0;
  let oldBatchStreak = 0;

  while (tries < CLICK_MORE_TRIES) {
    tries++;

    const batch = await page.$$eval("[data-test='responses__response']", (nodes) =>
      nodes.map((n) => {
        const a = n.querySelector("h3 a, [data-test='link-text']");
        const href = a?.getAttribute("href") || "";
        const link = href ? (href.startsWith("http") ? href : `https://www.banki.ru${href}`) : null;
        const idMatch = link?.match(/response\/(\d+)/);
        const id = idMatch ? Number(idMatch[1]) : null;
        const title =
          n.querySelector("h3")?.textContent?.trim() ||
          n.querySelector("[data-test='link-text']")?.textContent?.trim() ||
          null;
        const dateRaw = n.querySelector(".Responsesstyled__StyledItemSmallText-sc-150koqm-4")?.textContent?.trim() || null;
        return { id, link, title, dateRaw };
      })
    );

    let added = 0, skipped = 0, dups = 0;
    let batchAllOld = true;

    for (const b of batch) {
      if (!b?.id || !b?.link) continue;
      const dateIso = parseDateIso(b.dateRaw);
      if (dateIso && new Date(dateIso) >= DATE_FROM) batchAllOld = false;
      if (!inRange(dateIso)) { skipped++; continue; }
      if (ids.has(b.id)) { dups++; continue; }

      ids.add(b.id);
      items.push({ id: b.id, link: b.link, title: b.title || null, date: dateIso });
      added++;
      addedSinceLastSave++;
    }

    console.log(
      `📦 Батч#${tries}: карточек=${batch.length} | +${added} новых | 🔁 дубликатов ${dups} | ⏭️ вне диапазона ${skipped} | всего=${items.length}`
    );

    // ранняя остановка
    if (EARLY_STOP_ON_OLD) {
      if (batch.length > 0 && batchAllOld && added === 0) {
        oldBatchStreak++;
        console.log(`⏳ Пошли только старые даты (стрик=${oldBatchStreak}/${OLD_BATCH_STREAK_TO_STOP})`);
      } else {
        oldBatchStreak = 0;
      }
      if (oldBatchStreak >= OLD_BATCH_STREAK_TO_STOP) {
        console.log("🛑 Дальше только старые даты — стоп.");
        break;
      }
    }

    // автосейвы
    if (addedSinceLastSave >= SAVE_EVERY_ITEMS) await saveNow(`items>=${SAVE_EVERY_ITEMS}`);
    if (Date.now() - lastSavedAt >= SAVE_EVERY_MS) await saveNow(`timer>=${SAVE_EVERY_MS}ms`);

    // клик
    const moreBtn = await page.$("[data-test='responses__more-btn']");
    if (!moreBtn) {
      console.log("❌ Кнопка 'Показать ещё' не найдена — стоп.");
      break;
    }
    console.log(`👉 [${tries}] Кликаю «Показать ещё»…`);
    await moreBtn.click();
    await delay(WAIT_AFTER_CLICK_MS);
    await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
    await delay(SCROLL_AFTER_CLICK_MS);
  }

  await saveNow("final");
  console.log("🎉 Готово. Всего собрано:", items.length);

  const inRangeCount = items.filter((x) => inRange(x.date)).length;
  console.log(`📊 Итог: в диапазоне=${inRangeCount}, всего=${items.length}`);
  await browser.close();
})();