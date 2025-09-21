const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const fs = require('fs').promises;

// Глобальные переменные для graceful shutdown
let driver = null;
let allReviews = [];
let isShuttingDown = false;
let processedCount = 0;

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
            await saveReviewsToFile(allReviews, 'otzovik_detailed_reviews_emergency.json');
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
async function saveReviewsToFile(reviews, filename = 'otzovik_detailed_reviews.json') {
    try {
        await fs.writeFile(filename, JSON.stringify(reviews, null, 2), 'utf8');
        console.log(`💾 Отзывы сохранены в файл: ${filename}`);
        console.log(`📊 Сохранено отзывов: ${reviews.length}`);
    } catch (error) {
        console.error('❌ Ошибка при сохранении файла:', error.message);
    }
}

// Функция для поиска последнего обработанного ID из файлов результатов
async function findLastProcessedId() {
    // Сначала проверяем emergency файл
    const emergencyFile = 'otzovik_detailed_reviews_emergency.json';
    try {
        const data = await fs.readFile(emergencyFile, 'utf8');
        const reviews = JSON.parse(data);
        
        if (reviews.length > 0) {
            const lastId = reviews[reviews.length - 1].id;
            console.log(`🔄 Найден emergency файл ${emergencyFile} с ${reviews.length} отзывами. Последний ID: ${lastId}`);
            return { lastId, existingReviews: reviews, filename: emergencyFile };
        }
    } catch (e) {
        // Emergency файл не существует или поврежден, продолжаем поиск
        console.log('📄 Emergency файл не найден, ищем промежуточные файлы...');
    }
    
    // Ищем файлы с промежуточными результатами (pattern: otzovik_detailed_reviews_NUMBER.json)
    // где NUMBER кратно 50 (50, 100, 150, 200, ...)
    try {
        const fsSync = require('fs');
        const files = fsSync.readdirSync('.');
        const intermediateFiles = files.filter(file => 
            file.match(/^otzovik_detailed_reviews_\d+\.json$/)
        ).sort((a, b) => {
            const numA = parseInt(a.match(/\d+/)[0]);
            const numB = parseInt(b.match(/\d+/)[0]);
            return numB - numA; // Сортируем по убыванию (самое большое число первым)
        });
        
        console.log(`📂 Найдено промежуточных файлов: ${intermediateFiles.length}`);
        if (intermediateFiles.length > 0) {
            console.log(`🔍 Проверяем файлы: ${intermediateFiles.slice(0, 3).join(', ')}${intermediateFiles.length > 3 ? '...' : ''}`);
        }
        
        // Проверяем файлы по порядку (от самого большого числа к меньшему)
        for (const filename of intermediateFiles) {
            try {
                const data = await fs.readFile(filename, 'utf8');
                const reviews = JSON.parse(data);
                
                if (reviews.length > 0) {
                    const lastId = reviews[reviews.length - 1].id;
                    console.log(`🔄 Найден файл ${filename} с ${reviews.length} отзывами. Последний ID: ${lastId}`);
                    return { lastId, existingReviews: reviews, filename };
                }
            } catch (e) {
                console.warn(`⚠️  Файл ${filename} поврежден или недоступен, пропускаем`);
                continue;
            }
        }
    } catch (e) {
        console.warn('⚠️  Ошибка при чтении директории:', e.message);
    }
    
    // Если ничего не найдено, проверяем основной файл результатов
    const mainFile = 'otzovik_detailed_reviews.json';
    try {
        const data = await fs.readFile(mainFile, 'utf8');
        const reviews = JSON.parse(data);
        
        if (reviews.length > 0) {
            const lastId = reviews[reviews.length - 1].id;
            console.log(`🔄 Найден основной файл ${mainFile} с ${reviews.length} отзывами. Последний ID: ${lastId}`);
            return { lastId, existingReviews: reviews, filename: mainFile };
        }
    } catch (e) {
        // Основной файл тоже не существует
    }
    
    console.log('🆕 Предыдущих результатов не найдено, начинаем с начала');
    return { lastId: null, existingReviews: [], filename: null };
}

// Функция для фильтрации исходных данных начиная с определенного ID
function filterSourceReviewsFromId(sourceReviews, lastProcessedId) {
    if (!lastProcessedId) {
        return sourceReviews;
    }
    
    const lastIndex = sourceReviews.findIndex(review => review.id === lastProcessedId);
    
    if (lastIndex === -1) {
        console.log(`⚠️  Последний обработанный ID ${lastProcessedId} не найден в исходных данных`);
        return sourceReviews;
    }
    
    const remainingReviews = sourceReviews.slice(lastIndex + 1);
    console.log(`➡️  Продолжаем с позиции ${lastIndex + 1}, осталось обработать: ${remainingReviews.length} отзывов`);
    
    return remainingReviews;
}

// Функция для загрузки исходных данных с ID и ссылками
async function loadSourceReviews(filename = 'otzovik_reviews_filtered_2024-2025.json') {
    try {
        const data = await fs.readFile(filename, 'utf8');
        const reviews = JSON.parse(data);
        console.log(`📄 Загружено ${reviews.length} отзывов для обработки`);
        return reviews;
    } catch (error) {
        console.error('❌ Ошибка при загрузке исходного файла:', error.message);
        throw error;
    }
}

// Функция для очистки текста от лишних символов
function cleanText(text) {
    if (!text) return null;
    return text.replace(/\s+/g, ' ').trim() || null;
}

// Функция для извлечения города из location строки
function extractCity(locationText) {
    if (!locationText) return null;

    // Ищем паттерн "Россия, Город" или просто "Город"
    const cityMatch = locationText.match(/(?:Россия,\s*)?(.+?)$/);
    if (cityMatch && cityMatch[1]) {
        return cleanText(cityMatch[1].toUpperCase());
    }

    return null;
}

// Функция для парсинга детальной информации отзыва
async function parseDetailedReview(driverInstance, reviewData) {
    try {
        console.log(`   📄 Парсим отзыв ${reviewData.id}...`);

        await driverInstance.get(reviewData.link);

        // Ждем загрузки основного контейнера отзыва
        let reviewContainer;
        try {
            reviewContainer = await driverInstance.wait(
                until.elementLocated(By.css('.review-contents[itemprop="review"]')),
                15000
            );
        } catch (e) {
            console.warn(`   ⚠️  Контейнер отзыва не найден для ID ${reviewData.id}`);
            return null;
        }

        // Инициализируем объект отзыва с базовыми данными
        const review = {
            id: reviewData.id,
            link: reviewData.link,
            date: null,
            title: null,
            text: null,
            rating: null,
            status: null,
            product: null,
            city: null
        };

        // Извлекаем дату публикации
        try {
            const dateElement = await reviewContainer.findElement(By.css('meta[itemprop="datePublished"]'));
            review.date = await dateElement.getAttribute('content');
        } catch (e) {
            console.warn(`   ⚠️  Дата не найдена для отзыва ${reviewData.id}`);
        }

        // Извлекаем заголовок отзыва (тег h1)
        try {
            const titleElement = await reviewContainer.findElement(By.css('h1'));
            const titleText = await titleElement.getText();
            // Убираем префикс "Отзыв: " если есть
            review.title = cleanText(titleText.replace(/^Отзыв:\s*/, ''));
        } catch (e) {
            console.warn(`   ⚠️  Заголовок не найден для отзыва ${reviewData.id}`);
        }

        // Извлекаем полный текст отзыва (достоинства, недостатки и основной текст)
        try {
            let textParts = [];

            // Достоинства (review-plus)
            try {
                const plusElement = await reviewContainer.findElement(By.css('.review-plus'));
                const plusText = await plusElement.getText();
                if (plusText) {
                    textParts.push(cleanText(plusText));
                }
            } catch (e) {
                // Достоинства не обязательны
            }

            // Недостатки (review-minus)
            try {
                const minusElement = await reviewContainer.findElement(By.css('.review-minus'));
                const minusText = await minusElement.getText();
                if (minusText) {
                    textParts.push(cleanText(minusText));
                }
            } catch (e) {
                // Недостатки не обязательны
            }

            // Основной текст отзыва (review-body description)
            try {
                const bodyElement = await reviewContainer.findElement(By.css('.review-body.description[itemprop="description"]'));
                const bodyText = await bodyElement.getText();
                if (bodyText) {
                    textParts.push(cleanText(bodyText));
                }
            } catch (e) {
                // Основной текст не обязателен
            }

            // Объединяем все части через перевод строки
            review.text = textParts.length > 0 ? textParts.join('\n\n') : null;

        } catch (e) {
            console.warn(`   ⚠️  Текст отзыва не найден для ID ${reviewData.id}`);
        }

        // Извлекаем рейтинг
        try {
            const ratingElement = await reviewContainer.findElement(By.css('meta[itemprop="ratingValue"]'));
            const ratingValue = await ratingElement.getAttribute('content');
            review.rating = ratingValue;
        } catch (e) {
            // Пробуем альтернативный способ через span в rating-score
            try {
                const ratingSpan = await reviewContainer.findElement(By.css('.rating-score span'));
                const ratingText = await ratingSpan.getText();
                review.rating = ratingText;
            } catch (e2) {
                console.warn(`   ⚠️  Рейтинг не найден для отзыва ${reviewData.id}`);
            }
        }

        // Извлекаем город пользователя
        try {
            const locationElement = await reviewContainer.findElement(By.css('.user-location'));
            const locationText = await locationElement.getText();
            review.city = extractCity(locationText);
        } catch (e) {
            console.warn(`   ⚠️  Город не найден для отзыва ${reviewData.id}`);
        }

        // Статус отзыва - у отзовика нет явного статуса verified/decided, ставим null
        review.status = null;

        // Продукт - в отзовике нет отдельного поля продукта, ставим null
        review.product = null;

        console.log(`   ✅ Отзыв ${reviewData.id} успешно обработан`);
        return review;

    } catch (error) {
        console.error(`   ❌ Ошибка при парсинге отзыва ${reviewData.id}:`, error.message);
        return null;
    }
}

// Главная функция парсера детальной информации
async function parseDetailedReviews(sourceFilename = 'otzovik_reviews_filtered_2024-2025.json') {
    try {
        console.log('🚀 Запуск парсера детальной информации отзывов Otzovik...');
        console.log('💡 Для остановки используйте Ctrl+C (данные будут сохранены)');

        // Проверяем, есть ли предыдущие результаты для восстановления
        const { lastId, existingReviews, filename: existingFile } = await findLastProcessedId();
        
        // Загружаем все существующие результаты в массив
        allReviews.push(...existingReviews);
        
        // Загружаем исходные данные
        const allSourceReviews = await loadSourceReviews(sourceFilename);
        
        // Фильтруем исходные данные начиная с последнего обработанного ID
        const sourceReviews = filterSourceReviewsFromId(allSourceReviews, lastId);
        
        if (sourceReviews.length === 0) {
            console.log('✅ Все отзывы уже обработаны!');
            return allReviews;
        }

        // Создание драйвера Chrome
        driver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(chromeOptions)
            .build();

        console.log('✅ Chrome драйвер запущен');

        const totalReviews = sourceReviews.length;
        const alreadyProcessed = allReviews.length;
        console.log(`📊 Уже обработано: ${alreadyProcessed} отзывов`);
        console.log(`📊 Осталось обработать: ${totalReviews} отзывов`);
        console.log(`📊 Общий прогресс: ${alreadyProcessed}/${allSourceReviews.length} (${((alreadyProcessed / allSourceReviews.length) * 100).toFixed(1)}%)`);

        // Обрабатываем каждый отзыв
        for (let i = 0; i < sourceReviews.length; i++) {
            // Проверка на graceful shutdown
            if (isShuttingDown) {
                console.log('🛑 Прерывание парсинга из-за shutdown');
                break;
            }

            const reviewData = sourceReviews[i];
            processedCount = alreadyProcessed + i + 1;
            const currentInBatch = i + 1;

            console.log(`\n📄 Обрабатываем отзыв ${currentInBatch}/${totalReviews} | Общий: ${processedCount}/${allSourceReviews.length} (ID: ${reviewData.id})`);

            try {
                const detailedReview = await parseDetailedReview(driver, reviewData);

                if (detailedReview) {
                    allReviews.push(detailedReview);
                    console.log(`   📊 Успешно: ${allReviews.length} | В батче: ${currentInBatch}/${totalReviews}`);
                } else {
                    console.log(`   ⚠️  Отзыв ${reviewData.id} пропущен из-за ошибок`);
                }

                // Сохраняем промежуточные результаты каждые 50 отзывов
                if (processedCount % 50 === 0) {
                    console.log(`\n💾 Промежуточное сохранение после ${processedCount} отзывов...`);
                    await saveReviewsToFile(allReviews, `otzovik_detailed_reviews_${processedCount}.json`);
                }

                // Небольшая пауза между запросами чтобы не нагружать сервер
                await driver.sleep(500);

            } catch (error) {
                console.error(`❌ Критическая ошибка при обработке отзыва ${reviewData.id}:`, error.message);
                continue; // Продолжаем со следующего отзыва
            }
        }

        if (!isShuttingDown) {
            console.log('\n🎉 Парсинг детальной информации завершен!');
            console.log(`📊 Общее количество успешно обработанных отзывов: ${allReviews.length}`);
            console.log(`📊 Общее количество просмотренных отзывов: ${processedCount}`);

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
    parseDetailedReviews()
        .then(reviews => {
            if (!isShuttingDown) {
                console.log('✅ Парсер детальной информации успешно завершен');
                console.log(`📈 Итоговый результат: ${reviews.length} детальных отзывов`);
            }
        })
        .catch(error => {
            if (!isShuttingDown) {
                console.error('💥 Парсер завершен с ошибкой:', error.message);
                process.exit(1);
            }
        });
}

module.exports = { parseDetailedReviews };