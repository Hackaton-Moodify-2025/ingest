const fs = require('fs');
const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');

// Настройки для Chrome
const chromeOptions = new chrome.Options();
// chromeOptions.addArguments('--headless'); // Закомментировано для визуального режима
chromeOptions.addArguments('--no-sandbox');
chromeOptions.addArguments('--disable-dev-shm-usage');
chromeOptions.addArguments('--disable-gpu');
chromeOptions.addArguments('--window-size=1920,1080');
chromeOptions.addArguments('--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

// Дополнительные настройки безопасности
chromeOptions.addArguments('--disable-blink-features=AutomationControlled');
chromeOptions.addArguments('--disable-web-security');
chromeOptions.addArguments('--ignore-certificate-errors');
chromeOptions.addArguments('--ignore-ssl-errors');
chromeOptions.addArguments('--allow-running-insecure-content');

// Конфигурация
const CONFIG = {
    startDate: new Date('2024-01-01'),
    endDate: new Date('2025-05-31')
    // Убрали фиксированную задержку
};

// Функция для загрузки данных из reviews.json
function loadReviews() {
    try {
        const data = fs.readFileSync('./reviews.json', 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('❌ Ошибка при загрузке reviews.json:', error.message);
        return [];
    }
}

// Функция для фильтрации по датам
function filterByDate(reviews) {
    return reviews.filter(review => {
        const reviewDate = new Date(review.date);
        return reviewDate >= CONFIG.startDate && reviewDate <= CONFIG.endDate;
    });
}

// Функция для парсинга города и продукта со страницы
async function parsePageData(driver, url) {
    try {
        console.log(`  📄 Открываем страницу: ${url}`);
        await driver.get(url);

        // Ждем загрузки хотя бы одного из элементов (продукт или город)
        try {
            await driver.wait(until.elementLocated(By.css('body')), 10000);
            // Даем небольшое время на полную загрузку DOM
            await driver.sleep(100);
        } catch (e) {
            console.log('    ⚠️  Страница не загрузилась полностью');
        }

        let product = null;
        let city = null;
        let status = null; // Добавляем переменную для статуса проблемы

        // Поиск продукта по классу h-color-D30 h-mr-16 _1w66l1f
        try {
            // Ждем появления элемента продукта
            await driver.wait(until.elementLocated(By.css('.h-color-D30.h-mr-16._1w66l1f')), 3000);
            const productElement = await driver.findElement(By.css('.h-color-D30.h-mr-16._1w66l1f'));
            product = await productElement.getText();
            product = product.trim();
        } catch (e) {
            // Пробуем найти альтернативными селекторами
            try {
                await driver.wait(until.elementLocated(By.css('[class*="h-color-D30"]')), 2000);
                const productElement = await driver.findElement(By.css('[class*="h-color-D30"]'));
                product = await productElement.getText();
                product = product.trim();
            } catch (e2) {
                console.log('    ⚠️  Продукт не найден');
            }
        }

        // Поиск статуса проблемы и города по классу _1vfu01w _1mxed63 _8km2y3
        try {
            // Ждем появления элементов
            await driver.wait(until.elementsLocated(By.css('._1vfu01w._1mxed63._8km2y3')), 3000);
            const statusElements = await driver.findElements(By.css('._1vfu01w._1mxed63._8km2y3'));

            if (statusElements.length >= 1) {
                // Первый элемент - статус проблемы
                status = await statusElements[0].getText();
                status = status.trim();
            }

            if (statusElements.length >= 2) {
                // Второй элемент - город
                city = await statusElements[1].getText();
                city = city.trim();
            } else if (statusElements.length === 1) {
                // Если есть только один элемент, пробуем найти альтернативно город
                console.log('    ⚠️  Найден только статус, ищем город альтернативно');
            }
        } catch (e) {
            // Пробуем найти альтернативными селекторами
            try {
                await driver.wait(until.elementsLocated(By.css('[class*="_1vfu01w"]')), 2000);
                const statusElements = await driver.findElements(By.css('[class*="_1vfu01w"]'));

                if (statusElements.length >= 1) {
                    status = await statusElements[0].getText();
                    status = status.trim();
                }

                if (statusElements.length >= 2) {
                    city = await statusElements[1].getText();
                    city = city.trim();
                } else if (statusElements.length === 1) {
                    console.log('    ⚠️  Найден только статус альтернативно');
                }
            } catch (e2) {
                console.log('    ⚠️  Статус и город не найдены');
            }
        }

        return { product, city, status };
    } catch (error) {
        console.error('❌ Ошибка при парсинге страницы:', error.message);
        return { product: null, city: null, status: null };
    }
}

// Функция для обработки одного отзыва
async function processReview(driver, review, index) {
    try {
        console.log(`\n🔍 Обрабатываем отзыв ${index + 1}: ${review.id}`);

        const { product, city, status } = await parsePageData(driver, review.link);

        console.log(`  📦 Продукт: ${product || 'не найден'}`);
        console.log(`  🏙️  Город: ${city || 'не найден'}`);
        console.log(`  📋 Статус: ${status || 'не найден'}`);

        // Возвращаем дополненный отзыв
        return {
            ...review,
            product: product,
            city: city,
            status: status
        };
    } catch (error) {
        console.error(`❌ Ошибка при обработке отзыва ${review.id}:`, error.message);
        return {
            ...review,
            product: null,
            city: null,
            status: null
        };
    }
}

// Функция для сохранения результатов в dataset.json
function saveDataset(data) {
    try {
        const json = JSON.stringify(data, null, 2);
        fs.writeFileSync('./dataset.json', json, 'utf8');
        console.log(`\n💾 Данные сохранены в dataset.json`);
        console.log(`📊 Сохранено записей: ${data.length}`);
    } catch (error) {
        console.error('❌ Ошибка при сохранении dataset.json:', error.message);
    }
}

// Основная функция парсера
async function parseReviewsData() {
    let driver = null;

    try {
        console.log('🚀 Инициализируем WebDriver...');
        driver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(chromeOptions)
            .build();

        console.log('✅ WebDriver инициализирован');

        console.log('\n📖 Загружаем данные из reviews.json...');
        const allReviews = loadReviews();
        console.log(`📋 Всего отзывов: ${allReviews.length}`);

        console.log('\n🔍 Фильтруем по датам (01.01.2024 - 31.05.2025)...');
        const filteredReviews = filterByDate(allReviews);
        console.log(`✅ Отзывов после фильтрации: ${filteredReviews.length}`);

        if (filteredReviews.length === 0) {
            console.log('⚠️  Нет отзывов в указанном диапазоне дат');
            return [];
        }

        // Парсим все подходящие отзывы
        const reviewsToProcess = filteredReviews;
        console.log(`\n🧪 Обрабатываем все ${reviewsToProcess.length} подходящих отзывов...`);

        const processedReviews = [];

        for (let i = 0; i < reviewsToProcess.length; i++) {
            const review = reviewsToProcess[i];
            const processedReview = await processReview(driver, review, i);
            processedReviews.push(processedReview);
            // Убрали задержку - переходим к следующему отзыву сразу после обработки текущего
        }

        // Сохраняем результаты
        saveDataset(processedReviews);

        console.log('\n🎉 Обработка завершена успешно!');
        return processedReviews;

    } catch (error) {
        console.error('❌ Ошибка при выполнении:', error.message);
        return [];
    } finally {
        if (driver) {
            await driver.quit();
            console.log('🔚 WebDriver закрыт');
        }
    }
}

// Запуск парсера, если файл запущен напрямую
if (require.main === module) {
    parseReviewsData();
}

module.exports = {
    parseReviewsData,
    loadReviews,
    filterByDate,
    saveDataset
};

