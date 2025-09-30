# Ingest — Сервис сбора отзывов

Этот репозиторий содержит набор парсеров для сбора отзывов о банках с разных агрегаторов:  
- [banki.ru](https://www.banki.ru)  
- [otzovik.com](https://www.otzovik.com)  
- [sravni.ru](https://www.sravni.ru)  

## Возможности
- Сбор отзывов с трёх источников
- Поддержка статических и динамически загружаемых страниц
- Автоматизированные браузеры (Puppeteer, Selenium)
- Очистка и нормализация данных
- Экспорт в **JSON** с унифицированной структурой:
  ```json
  {
    "id": 3,
    "link": "https://otzovik.com/review_16271959.html",
    "date": "2024-06-30",
    "title": "Газпромбанк - Неожиданные сложности на пустом месте.",
    "text": "Достоинства: Бесплатная доставка карты...",
    "rating": "2",
    "status": null,
    "product": null,
    "city": "МОСКВА"
  }
  ```

## Структура
Каждый источник вынесен в отдельную подпапку со своим `package.json` и зависимостями:

| Источник  | Технологии | Особенности |
|-----------|------------|-------------|
| **banki** | axios, cheerio, puppeteer, p-limit | Гибридный парсер: HTML + fallback на браузер |
| **otzovik** | selenium-webdriver, chromedriver | Selenium для работы с динамикой и защитами |
| **sravni** | selenium-webdriver, chromedriver | Selenium-парсер для сложных страниц |

## Установка и запуск
1. Клонируйте репозиторий:
   ```bash
   git clone https://github.com/Hackaton-Moodify-2025/ingest.git
   cd ingest
   ```

2. Перейдите в нужный модуль (например, `banki`):
   ```bash
   cd banki
   npm install
   npm start
   ```

3. После завершения парсинга данные будут сохранены в `reviews.json`.

## Требования
- Node.js **>= 18**
- Установленный браузер Chrome (для Selenium и Puppeteer)
- npm или yarn
