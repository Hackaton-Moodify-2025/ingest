const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const fs = require('fs').promises;

// Глобальные переменные для graceful shutdown
let driver = null;
let allReviews = [];
let isShuttingDown = false;

// Настройки для Chrome
const chromeOptions = new chrome.Options();
// Можно раскомментировать для headless режима
// chromeOptions.addArguments('--headless');
chromeOptions.addArguments('--no-sandbox');
chromeOptions.addArguments('--disable-dev-shm-usage');
chromeOptions.addArguments('--window-size=1920,1080');

// Настройки для стабильной работы
chromeOptions.addArguments('--disable-web-security');
chromeOptions.addArguments('--disable-features=VizDisplayCompositor');
chromeOptions.addArguments('--disable-background-networking');
chromeOptions.addArguments('--disable-background-timer-throttling');
chromeOptions.addArguments('--disable-renderer-backgrounding');
chromeOptions.addArguments('--disable-backgrounding-occluded-windows');
chromeOptions.addArguments('--disable-client-side-phishing-detection');
chromeOptions.addArguments('--disable-sync');
chromeOptions.addArguments('--disable-default-apps');
chromeOptions.addArguments('--disable-extensions');
chromeOptions.addArguments('--disable-plugins');
chromeOptions.addArguments('--disable-popup-blocking');
chromeOptions.addArguments('--disable-translate');
chromeOptions.addArguments('--no-first-run');
chromeOptions.addArguments('--no-default-browser-check');
chromeOptions.addArguments('--disable-infobars');
chromeOptions.addArguments('--disable-notifications');
chromeOptions.addArguments('--disable-save-password-bubble');
chromeOptions.addArguments('--disable-blink-features=AutomationControlled');
chromeOptions.addArguments('--ignore-certificate-errors');
chromeOptions.addArguments('--ignore-ssl-errors');
chromeOptions.addArguments('--allow-running-insecure-content');

// Функция graceful shutdown
async function gracefulShutdown(signal) {
    if (isShuttingDown) {
        console.log('\n⏳ Уже в процессе завершения работы...');
        return;
    }

    isShuttingDown = true;
    console.log(`\n🛑 Получен сигнал ${signal}. Начинаем graceful shutdown...`);

    try {
        // Сохраняем все текущие данные
        if (allReviews.length > 0) {
            console.log('💾 Сохраняем собранные данные...');
            await saveReviewsToFile(allReviews, 'otzovik_reviews_emergency.json');
            console.log(`✅ Данные сохранены! Всего отзывов: ${allReviews.length}`);
        }

        // Закрываем браузер
        if (driver) {
            console.log('🔚 Закрываем браузер...');
            await driver.quit();
            console.log('✅ Браузер закрыт');
        }

        console.log('🏁 Graceful shutdown завершен');
        process.exit(0);

    } catch (error) {
        console.error('❌ Ошибка при graceful shutdown:', error.message);
        process.exit(1);
    }
}

// Настройка обработчиков сигналов
process.on('SIGINT', () => gracefulShutdown('SIGINT'));   // Ctrl+C
process.on('SIGTERM', () => gracefulShutdown('SIGTERM')); // Termination signal
process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));   // Hang up signal

// Функция для сохранения отзывов в JSON файл
async function saveReviewsToFile(reviews, filename = 'otzovik_reviews.json') {
    try {
        await fs.writeFile(filename, JSON.stringify(reviews, null, 2), 'utf8');
        console.log(`💾 Отзывы сохранены в файл: ${filename}`);
        console.log(`📊 Сохранено отзывов: ${reviews.length}`);
    } catch (error) {
        console.error('❌ Ошибка при сохранении файла:', error.message);
    }
}

// Функция для парсинга одного отзыва
async function parseReview(reviewElement) {
    try {
        // Извлекаем ID отзыва из meta тега с itemprop="url"
        const metaUrl = await reviewElement.findElement(By.css('meta[itemprop="url"]'));
        const reviewUrl = await metaUrl.getAttribute('content');

        // Извлекаем ID из URL (например, review_9803311.html -> 9803311)
        const idMatch = reviewUrl.match(/review_(\d+)\.html/);
        if (!idMatch) {
            console.warn('Не удалось извлечь ID из URL:', reviewUrl);
            return null;
        }

        const reviewId = parseInt(idMatch[1]);
        const reviewLink = reviewUrl;

        return {
            id: reviewId,
            link: reviewLink
        };

    } catch (error) {
        console.error('Ошибка при парсинге отзыва:', error.message);
        return null;
    }
}

// Функция для парсинга одной страницы с умным ожиданием
async function parsePage(driverInstance, pageNum) {
    try {
        // Проверка на graceful shutdown
        if (isShuttingDown) {
            console.log('🛑 Прерывание парсинга из-за shutdown');
            return [];
        }

        const url = `https://otzovik.com/reviews/bank_gazprombank_russia/${pageNum}`;
        console.log(`📄 Обрабатываем страницу ${pageNum}: ${url}`);

        await driverInstance.get(url);

        // Умное ожидание контейнера с отзывами - ждем до появления
        console.log(`   ⏳ Ожидаем загрузки контейнера с отзывами...`);
        let reviewContainer;
        try {
            // Ждем до 15 секунд появления контейнера
            reviewContainer = await driverInstance.wait(
                until.elementLocated(By.css('.review-list-2.review-list-chunk')),
                15000
            );
            console.log(`   ✅ Контейнер найден`);
        } catch (e) {
            console.warn(`   ⚠️  Контейнер с отзывами не найден на странице ${pageNum} (timeout)`);
            return [];
        }

        // Дополнительное ожидание полной загрузки отзывов
        console.log(`   ⏳ Ожидаем загрузки отзывов...`);
        try {
            // Ждем появления хотя бы одного отзыва
            await driverInstance.wait(
                until.elementLocated(By.css('.review-list-2.review-list-chunk .item[itemprop="review"]')),
                10000
            );

            // Дополнительно ждем стабилизации DOM (когда количество отзывов перестает изменяться)
            let previousCount = 0;
            let stableCount = 0;
            const maxStableChecks = 1;

            while (stableCount < maxStableChecks) {
              //  await driverInstance.sleep(500); // Небольшая пауза между проверками

                const currentElements = await driverInstance.findElements(
                    By.css('.review-list-2.review-list-chunk .item[itemprop="review"]')
                );
                const currentCount = currentElements.length;

                if (currentCount === previousCount && currentCount > 0) {
                    stableCount++;
                    console.log(`   � DOM стабилен: ${currentCount} отзывов (проверка ${stableCount}/${maxStableChecks})`);
                } else {
                    stableCount = 0;
                    console.log(`   📊 Загружается: ${currentCount} отзывов`);
                }

                previousCount = currentCount;

                // Проверка на shutdown
                if (isShuttingDown) {
                    console.log('🛑 Прерывание ожидания из-за shutdown');
                    return [];
                }
            }

        } catch (e) {
            console.warn(`   ⚠️  Отзывы не загрузились на странице ${pageNum}`);
            return [];
        }

        // Теперь парсим все найденные отзывы
        const reviewElements = await driverInstance.findElements(
            By.css('.review-list-2.review-list-chunk .item[itemprop="review"]')
        );
        console.log(`   📝 Финальное количество отзывов: ${reviewElements.length}`);

        const pageReviews = [];

        for (let i = 0; i < reviewElements.length; i++) {
            // Проверка на shutdown
            if (isShuttingDown) {
                console.log('🛑 Прерывание парсинга отзывов из-за shutdown');
                break;
            }

            try {
                const review = await parseReview(reviewElements[i]);
                if (review) {
                    pageReviews.push(review);
                    console.log(`   ✅ Отзыв ${review.id} успешно обработан`);
                }
            } catch (error) {
                console.warn(`   ⚠️  Ошибка при обработке отзыва ${i + 1}:`, error.message);
            }
        }

        console.log(`   🎯 Страница ${pageNum} завершена: собрано ${pageReviews.length} отзывов`);
        return pageReviews;

    } catch (error) {
        console.error(`❌ Ошибка при обработке страницы ${pageNum}:`, error.message);
        return [];
    }
}

// Главная функция парсера
async function parseOtzovikGazprombank() {
    try {
        console.log('🚀 Запуск парсера Otzovik.com для Газпромбанка...');
        console.log('💡 Для остановки используйте Ctrl+C (данные будут сохранены)');

        // Создание драйвера Chrome
        driver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(chromeOptions)
            .build();

        console.log('✅ Chrome драйвер запущен');

        const startPage = 1;
        const endPage = 48;

        // Парсим страницы с 1 по 48
        for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
            // Проверка на graceful shutdown
            if (isShuttingDown) {
                console.log('🛑 Прерывание парсинга из-за shutdown');
                break;
            }

            try {
                const pageReviews = await parsePage(driver, pageNum);
                allReviews.push(...pageReviews);

                console.log(`📊 Страница ${pageNum}/${endPage} завершена. Всего отзывов: ${allReviews.length}`);

                // Сохраняем промежуточные результаты каждые 10 страниц
                if (pageNum % 10 === 0) {
                    console.log(`💾 Промежуточное сохранение после ${pageNum} страниц...`);
                    await saveReviewsToFile(allReviews, `otzovik_reviews_page_${pageNum}.json`);
                }

            } catch (error) {
                console.error(`❌ Критическая ошибка на странице ${pageNum}:`, error.message);
                continue; // Продолжаем со следующей страницы
            }
        }

        if (!isShuttingDown) {
            console.log('\n🎉 Парсинг завершен!');
            console.log(`📊 Общее количество найденных отзывов: ${allReviews.length}`);

            // Сохраняем финальный результат
            await saveReviewsToFile(allReviews);
        }

        return allReviews;

    } catch (error) {
        console.error('❌ Критическая ошибка парсера:', error.message);
        throw error;
    } finally {
        if (driver && !isShuttingDown) {
            console.log('🔚 Закрытие браузера...');
            await driver.quit();
            driver = null;
        }
    }
}

// Запуск парсера
if (require.main === module) {
    parseOtzovikGazprombank()
        .then(reviews => {
            if (!isShuttingDown) {
                console.log('✅ Парсер успешно завершен');
                console.log(`📈 Итоговый результат: ${reviews.length} отзывов`);
            }
        })
        .catch(error => {
            if (!isShuttingDown) {
                console.error('💥 Парсер завершен с ошибкой:', error.message);
                process.exit(1);
            }
        });
}

module.exports = { parseOtzovikGazprombank };