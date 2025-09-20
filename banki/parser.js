const fs = require("fs-extra");
const puppeteer = require("puppeteer");

const START_URL ="https://www.banki.ru/services/responses/bank/gazprombank/?is_countable=on";

const MAX_REVIEWS = 1000;            
const CLICK_MORE_TRIES = 200;       
const PAGE_TIMEOUT = 60000;      

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log("Запуск Puppeteer...");
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
  );

  console.log("Открываю:", START_URL);
  await page.goto(START_URL, { waitUntil: "domcontentloaded", timeout: 0 });

  console.log("Жду появления отзывов...");
  await page.waitForSelector("[data-test='responses__response']", {
    timeout: PAGE_TIMEOUT,
  });
  console.log("Отзывы найдены!");

  let tries = 0;
  while (true) {
    const count = await page.$$eval(
      "[data-test='responses__response']",
      (els) => els.length
    );
    console.log(`Сейчас карточек на странице: ${count}`);

    if (count >= MAX_REVIEWS) break;
    if (tries >= CLICK_MORE_TRIES) {
      console.log("Достигнут лимит нажатий 'Показать ещё'. Едем дальше.");
      break;
    }

    const moreBtn = await page.$("[data-test='responses__more-btn']");
    if (!moreBtn) {
      console.log("Кнопка 'Показать ещё' не найдена.");
      break;
    }

    tries++;
    console.log(`👉 [${tries}] Кликаю 'Показать ещё'...`);
    await moreBtn.click();
    await delay(2200);
    await page.evaluate(() =>
      window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" })
    );
    await delay(1200);
  }

  console.log("Собираю список ссылок с листинга...");
  const list = await page.$$eval("[data-test='responses__response']", (nodes) =>
    nodes.slice(0, 200).map((n) => {
      const a = n.querySelector("h3 a, [data-test='link-text']");
      const href = a?.getAttribute("href") || "";
      const link = href.startsWith("http")
        ? href
        : href
        ? `https://www.banki.ru${href}`
        : null;

      const idMatch = link?.match(/response\/(\d+)\/?/);
      const id = idMatch ? Number(idMatch[1]) : null;

      const title =
        n.querySelector("h3")?.textContent?.trim() ||
        n.querySelector("[data-test='link-text']")?.textContent?.trim() ||
        null;

      const dateRaw =
        n.querySelector(".Responsesstyled__StyledItemSmallText-sc-150koqm-4")?.textContent?.trim() ||
        n.textContent.match(/\d{2}\.\d{2}\.\d{4}/)?.[0] ||
        null;

      // yyyy-mm-dd
      let date = null;
      if (dateRaw) {
        const m = dateRaw.match(/(\d{2})\.(\d{2})\.(\d{4})/);
        if (m) date = `${m[3]}-${m[2]}-${m[1]}`;
      }

      const gradeAttr = n.getAttribute("data-test-grade");
      const rating = gradeAttr ? String(gradeAttr) : null;

      const teaser =
        n.querySelector(".Responsesstyled__StyledItemText-sc-150koqm-3 a")
          ?.textContent?.trim() || null;

      return { id, link, date, title, text: null, rating, teaser };
    })
  );

  const reviews = list.filter((r) => r.link && r.id).slice(0, MAX_REVIEWS);
  console.log(`🔗 Отобрано ссылок для глубокого парсинга: ${reviews.length}`);

  // Глубокий парсинг последовательно
  let done = 0;
  for (const r of reviews) {
    done++;
    console.log(`📖 [${done}/${reviews.length}] Открываю ${r.link}`);
    const sub = await browser.newPage();
    try {
      await sub.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
      );
      await sub.goto(r.link, { waitUntil: "domcontentloaded", timeout: 0 });

      const jsonLd = await sub
        .$eval('script[type="application/ld+json"]', (el) => el.textContent)
        .catch(() => null);

      let got = { title: null, text: null, rating: null, dateIso: null };

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
            return d.innerText.trim();
          }, reviewBodyHtml);

          const rating =
            (data.reviewRating &&
              (data.reviewRating.ratingValue ||
                data.reviewRating.value ||
                data.reviewRating)) ||
            null;

          const title =
            data.name ||
            (await sub.$eval("h1", (h) => h.textContent.trim()).catch(() => null));

          got.text = fullText || null;
          got.rating = rating ? String(rating) : r.rating || null;
          got.title = title || r.title || null;
        } catch {
          // падаем в фолбэки
        }
      }

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
              if (el) return el.innerText.trim();
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

      const dateRaw =
        (await sub
          .$eval("time", (t) => t.textContent.trim())
          .catch(() => null)) ||
        (await sub
          .$eval(".l51115aff .l10fac986", (el) => el.textContent.trim())
          .catch(() => null)) ||
        null;

      let dateIso = r.date || null;
      if (dateRaw) {
        const m = dateRaw.match(/(\d{2})\.(\d{2})\.(\d{4})/);
        if (m) dateIso = `${m[3]}-${m[2]}-${m[1]}`;
      }

      r.title = got.title || r.title || null;
      r.text = got.text || r.teaser || null;
      r.rating = got.rating || r.rating || null;
      r.date = dateIso;

      console.log(
        `   ok | id=${r.id} | rating=${r.rating || "-"} | date=${r.date || "-"} | title="${(r.title || "").slice(0, 60)}"`
      );
    } catch (e) {
      console.log(`    Ошибка на ${r.link}: ${e.message}`);
    } finally {
      await sub.close();
      await delay(800);
    }
  }

  const out = reviews.map((r) => ({ // немного не актуально, мы используем другой шаблон
    id: r.id,
    link: r.link,
    date: r.date || null,            
    title: r.title || null,
    text: r.text || null,            
    rating: r.rating || null,        
  }));

  console.log(`\n Итог: собрано ${out.length} отзывов`);
  await fs.writeJson("reviews.json", out, { spaces: 2 });
  console.log("Сохранено в reviews.json");
  await browser.close();
  console.log("🎉 Готово! 🎉");
})().catch((e) => {
  console.error("💥💥💥 Критическая ошибка:", e);
  process.exit(1);
});
