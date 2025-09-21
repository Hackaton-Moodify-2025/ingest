const fs = require("fs-extra");
const puppeteer = require("puppeteer");

const LINKS_FILE = "links.json";
const OUTPUT_FILE = "reviews.json";
const CHECKPOINT_FILE = "checkpoint_texts.json";
const SAVE_EVERY = 10;
const START_INDEX = 0;

const DATE_FROM = new Date("2024-01-01");
const DATE_TO = new Date("2025-05-31");

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
function parseDate(str) {
  const m = str.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

(async () => {
  console.log("🚀 parser_texts.js — глубокий парсинг отзывов");

  const links = await fs.readJson(LINKS_FILE);
  if (!links.length) {
    console.log("⚠️ Файл links.json пустой");
    return;
  }

  let checkpoint = { doneIds: [], reviews: [] };
  if (await fs.pathExists(CHECKPOINT_FILE)) {
    checkpoint = await fs.readJson(CHECKPOINT_FILE);
    console.log(`🔄 Чекпоинт: уже собрано ${checkpoint.reviews.length}`);
  }

  const doneIds = new Set(checkpoint.doneIds);
  const results = checkpoint.reviews;

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  let processed = 0;
  let skippedByDate = 0;

  for (let i = START_INDEX; i < links.length; i++) {
    const r = links[i];
    if (doneIds.has(r.id)) continue;
    const processed = i + 1;
    console.log(`📖 ${processed}/${links.length} — id=${r.id}`);

    const sub = await browser.newPage();
    try {
      await sub.goto(r.link, { waitUntil: "domcontentloaded", timeout: 0 });
      await delay(2500);
      await sub.waitForSelector("h1, [data-test='response-body']", { timeout: 15000 }).catch(() => null);

      let got = { title: null, text: null, rating: null, date: null };

      // === JSON-LD ===
      const jsonLd = await sub
        .$eval('script[type="application/ld+json"]', (el) => el.textContent)
        .catch(() => null);

      if (jsonLd) {
  try {
    const clean = jsonLd.replace(/[\u0000-\u001F]+/g, " ");
    const data = JSON.parse(clean);

    const reviewBodyHtml =
      data.reviewBody ||
      (data.author && (data.author.reviewBody || data.author.description)) ||
      data.description ||
      null;

    const stripHtml = (str) =>
      str
        .replace(/<[^>]*>/g, "") // убираем теги
        .replace(/\s+/g, " ")
        .trim();

    let fullText = null;
    if (reviewBodyHtml) {
      // декодируем html-сущности
      fullText = await sub.evaluate((raw) => {
        const txt = document.createElement("textarea");
        txt.innerHTML = raw;
        return txt.value;
      }, reviewBodyHtml);

      fullText = stripHtml(fullText);
    }

    const rating =
      (data.reviewRating &&
        (data.reviewRating.ratingValue ||
          data.reviewRating.value ||
          data.reviewRating)) ||
      null;

    got.text = fullText || null;
    got.rating = rating ? String(rating) : null;
    got.title = data.name || null;
  } catch (e) {
    console.log(`⚠️ JSON-LD parse error on id=${r.id}: ${e.message}`);
  }
}


      // === Фолбэки ===
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

      let city = null;
      try {
        city = await sub.$eval(".l3a372298", (el) => el.textContent.trim());
        if (city) {
          // убираем всё в скобках, оставляем только название города
          city = city.replace(/\s*\(.*?\)\s*$/, "").trim();
        }
      } catch {}

      // === Дата ===
      let date = null;
      const dateRaw =
        (await sub.$eval("time", (t) => t.textContent.trim()).catch(() => null)) ||
        (await sub.$eval(".l51115aff .l10fac986", (el) => el.textContent.trim()).catch(() => null));

      if (dateRaw) date = parseDate(dateRaw);
      if (!date && got.text) {
        const m = got.text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
        if (m) date = `${m[3]}-${m[2]}-${m[1]}`;
      }

      // фильтр по датам
      if (date) {
        const dObj = new Date(date);
        if (dObj < DATE_FROM || dObj > DATE_TO) {
          console.log(`⏭️ Пропущен вне диапазона: ${date}`);
          skippedByDate++;
          try {
            await sub.close();
          } catch {}
          continue;
        }
      }

      results.push({
        id: r.id,
        link: r.link,
        date: date,
        title: got.title || r.title,
        text: got.text,
        rating: got.rating,
        city: city,
      });
      doneIds.add(r.id);

      console.log(
        `   ✅ ok | id=${r.id} | date=${date || "-"} | rating=${got.rating || "-"} | title="${(got.title || "").slice(0, 60)}"`
      );

      if (results.length % SAVE_EVERY === 0) {
        await fs.writeJson(CHECKPOINT_FILE, { doneIds: [...doneIds], reviews: results }, { spaces: 2 });
        await fs.writeJson(OUTPUT_FILE, results, { spaces: 2 });
        console.log(`💾 Автосейв (${results.length} отзывов)`);
      }
    } catch (e) {
      console.log(`⚠️ Ошибка на ${r.link}: ${e.message}`);
    } finally {
      try {
        await sub.close();
      } catch (e) {
        console.log(`⚠️ Ошибка при закрытии вкладки (id=${r.id}): ${e.message}`);
      }
      await delay(1000);
    }
  }

  await fs.writeJson(CHECKPOINT_FILE, { doneIds: [...doneIds], reviews: results }, { spaces: 2 });
  await fs.writeJson(OUTPUT_FILE, results, { spaces: 2 });

  console.log(`\n🎉 Готово!`);
  console.log(`📊 Всего обработано: ${processed}`);
  console.log(`✅ Сохранено в диапазоне: ${results.length}`);
  console.log(`⏭️ Пропущено по датам: ${skippedByDate}`);

  await browser.close();
})();