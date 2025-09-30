const fs = require("fs-extra");
const puppeteer = require("puppeteer");

const START_URL =
  "https://www.banki.ru/services/responses/bank/gazprombank/?is_countable=on";

// === Настройки ===
const DATE_FROM = new Date("2024-01-01");
const DATE_TO = new Date("2025-05-31");
const MAX_REVIEWS = 5000;           // общий лимит
const CLICK_MORE_TRIES = 1000;      // максимум кликов "Показать ещё"
const SAVE_EVERY = 50;              // автосейв каждые N отзывов
const PAGE_TIMEOUT = 60000;
const CHECKPOINT_FILE = "checkpoint.json";
const OUTPUT_FILE = "reviews_full.json";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function parseDate(str) {
  const m = str.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

(async () => {
  console.log("🚀 Запуск Puppeteer...");
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

  console.log("⏳ Жду появления отзывов...");
  await page.waitForSelector("[data-test='responses__response']", { timeout: PAGE_TIMEOUT });
  console.log("✅ Отзывы найдены!");

  // Загружаем чекпоинт
  let checkpoint = { done: [] };
  if (await fs.pathExists(CHECKPOINT_FILE)) {
    checkpoint = await fs.readJson(CHECKPOINT_FILE);
    console.log(`🔄 Загружен чекпоинт, уже собрано: ${checkpoint.done.length}`);
  }

  const results = checkpoint.done || [];
  let processedTotal = results.length;
  let addedTotal = results.length;

  // Жмём "Показать ещё"
  let tries = 0;
  while (true) {
    const count = await page.$$eval("[data-test='responses__response']", els => els.length);
    console.log(`📊 Сейчас карточек на странице: ${count}`);

    if (count >= MAX_REVIEWS) break;
    if (tries >= CLICK_MORE_TRIES) {
      console.log("⚠️ Достигнут лимит нажатий 'Показать ещё'.");
      break;
    }

    const moreBtn = await page.$("[data-test='responses__more-btn']");
    if (!moreBtn) {
      console.log("ℹ️ Кнопка 'Показать ещё' не найдена.");
      break;
    }

    tries++;
    console.log(`👉 [${tries}] Кликаю 'Показать ещё'...`);
    await moreBtn.click();
    await delay(2500);
    await page.evaluate(() =>
      window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" })
    );
    await delay(1500);
  }

  console.log("📦 Собираю список ссылок с листинга...");
  const list = await page.$$eval("[data-test='responses__response']", (nodes) =>
    nodes.map((n) => {
      const a = n.querySelector("h3 a, [data-test='link-text']");
      const href = a?.getAttribute("href") || "";
      const link = href.startsWith("http") ? href : href ? `https://www.banki.ru${href}` : null;

      const idMatch = link?.match(/response\/(\d+)\/?/);
      const id = idMatch ? Number(idMatch[1]) : null;

      const title =
        n.querySelector("h3")?.textContent?.trim() ||
        n.querySelector("[data-test='link-text']")?.textContent?.trim() ||
        null;

      return { id, link, title, date: null, text: null, rating: null };
    })
  );

  const reviews = list.filter((r) => r.link && r.id).slice(0, MAX_REVIEWS);
  console.log(`🔗 Отобрано ссылок для глубокого парсинга: ${reviews.length}`);

  // Глубокий парсинг
  let done = 0;
  for (const r of reviews) {
    if (results.find((x) => x.id === r.id)) continue; // уже собрано в чекпоинте
    done++;
    processedTotal++;

    console.log(`📖 [${done}/${reviews.length}] Открываю ${r.link}`);

    const sub = await browser.newPage();
    try {
      await sub.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
      );
      await sub.goto(r.link, { waitUntil: "domcontentloaded", timeout: 0 });
      await sub.waitForSelector("h1", { timeout: 10000 }).catch(() => null);

      let got = { title: null, text: null, rating: null, dateIso: null };

      // JSON-LD
      const jsonLd = await sub
        .$eval('script[type="application/ld+json"]', (el) => el.textContent)
        .catch(() => null);

      if (jsonLd) {
        try {
          const data = JSON.parse(jsonLd);
          const reviewBodyHtml =
            data.reviewBody ||
            (data.author && (data.author.reviewBody || data.author.description)) ||
            data.description ||
            null;

          const fullText = await sub.evaluate((html) => {
            if (!html) return null;
            const d = document.createElement("div");
            d.innerHTML = html;
            return d.innerText.replace(/\s+/g, " ").trim();
          }, reviewBodyHtml);

          const rating =
            (data.reviewRating &&
              (data.reviewRating.ratingValue ||
                data.reviewRating.value ||
                data.reviewRating)) ||
            null;

          const title = data.name || null;

          got.text = fullText || null;
          got.rating = rating ? String(rating) : null;
          got.title = title || null;
        } catch {}
      }

      // Фолбэки
      if (!got.text) {
        got.text = await sub
          .evaluate(() => {
            const sels = [
              "[data-test='response-body']",
              ".responses__text",
              "article",
              ".page-container__body [itemprop='reviewBody']",
            ];
            for (const sel of sels) {
              const el = document.querySelector(sel);
              if (el) return el.innerText.replace(/\s+/g, " ").trim();
            }
            return null;
          })
          .catch(() => null);
      }

      if (!got.title) {
        got.title = await sub.$eval("h1", (h) => h.textContent.trim()).catch(() => r.title || null);
      }

      if (!got.rating) {
        got.rating = await sub
          .evaluate(() => {
            const gradeDigit = document.querySelector("[data-test='grade']")?.textContent?.trim();
            if (gradeDigit && /^\d$/.test(gradeDigit)) return gradeDigit;
            const divWithValue = Array.from(document.querySelectorAll("div[value]")).find((d) =>
              /^\d$/.test(d.getAttribute("value") || "")
            );
            return divWithValue?.getAttribute("value") || null;
          })
          .catch(() => null);
      }

      // Дата
      let dateIso = null;
      const dateRaw = await sub.$eval("time", (t) => t.textContent.trim()).catch(() => null);
      if (dateRaw) {
        const d = parseDate(dateRaw);
        if (d) dateIso = d;
      }
      if (!dateIso && got.text) {
        const m = got.text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
        if (m) dateIso = `${m[3]}-${m[2]}-${m[1]}`;
      }

      r.title = got.title || r.title || null;
      r.text = got.text || null;
      r.rating = got.rating || null;
      r.date = dateIso;

      // Фильтр по датам
      if (r.date) {
        const dObj = new Date(r.date);
        if (dObj < DATE_FROM || dObj > DATE_TO) {
          console.log(`⏭️ Вне диапазона: ${r.date}`);
          await sub.close();
          continue;
        }
      }

      results.push({
        id: r.id,
        link: r.link,
        date: r.date || null,
        title: r.title || null,
        text: r.text || null,
        rating: r.rating || null,
      });
      addedTotal++;

      console.log(
        `   ✅ ok | id=${r.id} | rating=${r.rating || "-"} | date=${r.date || "-"} | title="${(r.title || "").slice(0, 60)}"`
      );

      if (results.length % SAVE_EVERY === 0) {
        await fs.writeJson(CHECKPOINT_FILE, { done: results }, { spaces: 2 });
        console.log(`💾 Промежуточный сейв (${results.length} отзывов)`);
      }
    } catch (e) {
      console.log(`   ⚠️ Ошибка на ${r.link}: ${e.message}`);
    } finally {
      await sub.close();
      await delay(800);
    }
  }

  // Сохраняем результат
  await fs.writeJson(CHECKPOINT_FILE, { done: results }, { spaces: 2 });
  await fs.writeJson(OUTPUT_FILE, results, { spaces: 2 });

  console.log(
    `🎉 Готово! Пройдено всего: ${processedTotal}, собрано по диапазону: ${addedTotal}`
  );
  await browser.close();
})();