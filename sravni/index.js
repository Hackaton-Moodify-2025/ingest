const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const fs = require('fs').promises;

// Настройки для Chrome
const chromeOptions = new chrome.Options();
// Можно раскомментировать для headless режима
// chromeOptions.addArguments('--headless');
chromeOptions.addArguments('--no-sandbox');
chromeOptions.addArguments('--disable-dev-shm-usage');
chromeOptions.addArguments('--window-size=1920,1080');

// Маппинг русских месяцев в числа
const monthMap = {
    'января': '01', 'февраля': '02', 'марта': '03', 'апреля': '04',
    'мая': '05', 'июня': '06', 'июля': '07', 'августа': '08',
    'сентября': '09', 'октября': '10', 'ноября': '11', 'декабря': '12'
};

// Функция для парсинга даты
function parseDate(dateText) {
    try {
        // Убираем лишние пробелы
        const cleanDate = dateText.trim();

        // Проверяем формат "день месяц" или "день месяц год"
        const parts = cleanDate.split(' ');

        if (parts.length >= 2) {
            const day = parts[0].padStart(2, '0');
            const monthName = parts[1];
            const year = parts.length >= 3 ? parts[2] : '2025';

            const month = monthMap[monthName] || '01';
            return `${year}-${month}-${day}`;
        }

        return cleanDate; // Возвращаем как есть, если не удалось распарсить
    } catch (error) {
        console.warn('Ошибка парсинга даты:', dateText, error.message);
        return dateText;
    }
}

// Функция для парсинга рейтинга по звездочкам
async function parseRating(driver, reviewElement) {
    try {
        // Ищем контейнер с рейтингом
        const rateContainer = await reviewElement.findElement(By.css('[data-qa="Rate"]'));

        // Получаем все звездочки
        const stars = await rateContainer.findElements(By.css('div._1expmgd._4czyoq'));

        let filledStars = 0;

        for (let i = 0; i < stars.length; i++) {
            try {
                // Ищем SVG элемент внутри звездочки
                const svgElement = await stars[i].findElement(By.css('svg[data-qa="Star"]'));

                // Получаем вычисленные значения CSS переменных
                const cssVars = await driver.executeScript(`
                    const svgElement = arguments[0];
                    const computedStyle = window.getComputedStyle(svgElement);
                    
                    // Получаем значения CSS переменных
                    const filledStroke = computedStyle.getPropertyValue('--rate-filled-stroke');
                    const filledBgColor = computedStyle.getPropertyValue('--rate-filled-bgColor');
                    const filledColor = computedStyle.getPropertyValue('--rate-filled-color');
                    
                    const unfilledStroke = computedStyle.getPropertyValue('--rate-unfilled-light-stroke');
                    const unfilledBgColor = computedStyle.getPropertyValue('--rate-unfilled-light-bgColor');
                    const unfilledColor = computedStyle.getPropertyValue('--rate-unfilled-light-color');
                    
                    // Получаем реальные стили
                    const actualFill = computedStyle.fill;
                    const actualStroke = computedStyle.stroke;
                    const actualColor = computedStyle.color;
                    
                    return {
                        filled: { stroke: filledStroke, bgColor: filledBgColor, color: filledColor },
                        unfilled: { stroke: unfilledStroke, bgColor: unfilledBgColor, color: unfilledColor },
                        actual: { fill: actualFill, stroke: actualStroke, color: actualColor }
                    };
                `, svgElement);

                // Проверяем, соответствует ли цвет заливки цвету заполненной звездочки
                const filledColor = cssVars.filled.bgColor; // #e5a345
                const actualFill = cssVars.actual.fill;

                // Конвертируем hex в rgb для сравнения
                const isFilledColor = actualFill.includes('229, 163, 69') || // rgb(229, 163, 69) = #e5a345
                    actualFill.includes('#e5a345') ||
                    actualFill === filledColor;

                if (isFilledColor) {
                    filledStars++;
                }

            } catch (e) {
                console.warn(`   ⚠️  Не удалось обработать звездочку ${i + 1}:`, e.message);
            }
        }

        return filledStars;

    } catch (error) {
        console.warn('Не удалось определить рейтинг:', error.message);
        return null;
    }
}

// Функция для сохранения отзывов в JSON файл
async function saveReviewsToFile(reviews, filename = 'reviews.json') {
    try {
        await fs.writeFile(filename, JSON.stringify(reviews, null, 2), 'utf8');
        console.log(`💾 Отзывы сохранены в файл: ${filename}`);
        console.log(`📊 Сохранено отзывов: ${reviews.length}`);
    } catch (error) {
        console.error('❌ Ошибка при сохранении файла:', error.message);
    }
}

// Функция для парсинга одного отзыва
async function parseReview(driver, reviewElement) {
    try {
        // Получаем ID отзыва из data-id атрибута
        const reviewId = await reviewElement.getAttribute('data-id');

        // Ищем ссылку на отзыв
        const linkElement = await reviewElement.findElement(By.css('a[class*="review-card_link"]'));
        const reviewLink = await linkElement.getAttribute('href');
        const fullLink = reviewLink.startsWith('/') ? `https://www.sravni.ru${reviewLink}` : reviewLink;

        // Парсим дату
        let reviewDate = '';
        try {
            // Ищем контейнер с датой более точно
            const dateContainer = await reviewElement.findElement(By.css('.h-ml-12._10cf6rv._19sgipd'));
            const dateElement = await dateContainer.findElement(By.css('.h-color-D30._1aja02n._1w66l1f'));
            const dateText = await dateElement.getText();
            reviewDate = parseDate(dateText);
        } catch (e) {
            console.warn('Не удалось найти дату для отзыва', reviewId);
        }

        // Парсим рейтинг
        const rating = await parseRating(driver, reviewElement);

        // Парсим заголовок
        let title = '';
        try {
            const titleElement = await reviewElement.findElement(By.css('[class*="review-card_title"]'));
            title = await titleElement.getText();
        } catch (e) {
            console.warn('Не удалось найти заголовок для отзыва', reviewId);
        }

        // Нажимаем кнопку "Читать" если она есть
        try {
            const readButton = await reviewElement.findElement(By.css('a._i91ye._qagut5'));
            await driver.executeScript("arguments[0].click();", readButton);
            await driver.sleep(1000); // Даем время на загрузку полного текста
        } catch (e) {
            console.log('Кнопка "Читать" не найдена или уже развернут текст для отзыва', reviewId);
        }

        // Парсим текст отзыва
        let reviewText = '';
        try {
            const textElement = await reviewElement.findElement(By.css('[class*="review-card_text"] span'));
            reviewText = await textElement.getText();
        } catch (e) {
            console.warn('Не удалось найти текст для отзыва', reviewId);
        }

        // Объединяем заголовок и текст
        const fullContent = title && reviewText ? `${title}\n\n${reviewText}` : title || reviewText;

        return {
            id: reviewId,
            link: fullLink,
            date: reviewDate,
            rating: rating,
            content: fullContent.trim()
        };

    } catch (error) {
        console.error('Ошибка при парсинге отзыва:', error.message);
        return null;
    }
}

// Главная функция парсера
async function parseSravniGazprombank() {
    let driver;

    try {
        console.log('🚀 Запуск парсера Sravni.ru для Газпромбанка...');

        // Создание драйвера Chrome
        driver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(chromeOptions)
            .build();

        console.log('✅ Chrome драйвер запущен');

        // Переходим на страницу отзывов Газпромбанка
        const url = 'https://www.sravni.ru/bank/gazprombank/otzyvy/';
        console.log(`🔗 Переходим на: ${url}`);

        await driver.get(url);

        // Ждем загрузки страницы
        await driver.wait(until.titleContains('Газпромбанк'), 10000);

        console.log('📄 Страница загружена успешно');

        // Получаем заголовок страницы для проверки
        const title = await driver.getTitle();
        console.log(`📝 Заголовок страницы: ${title}`);

        // Пауза для визуального контроля (можно убрать в продакшене)
        console.log('⏳ Ждем 5 секунд для визуальной проверки...');
        await driver.sleep(5000);

        console.log('✅ Парсер успешно подключился к сайту!');

        // Ждем загрузки основного контейнера с отзывами
        console.log('🔍 Ищем контейнер с отзывами...');
        await driver.wait(until.elementLocated(By.css('.page_mainColumn__oogxd')), 15000);

        // Находим основной контейнер
        const mainContainer = await driver.findElement(By.css('.page_mainColumn__oogxd'));

        // Ищем wrapper с отзывами
        const reviewsWrapper = await mainContainer.findElement(By.css('.styles_wrapper___EM4q'));

        // Получаем все дивы с отзывами (у них есть data-id атрибут)
        const reviewElements = await reviewsWrapper.findElements(By.css('div[data-id]'));

        console.log(`📋 Найдено отзывов: ${reviewElements.length}`);

        // Парсим до 50 отзывов с динамической подгрузкой
        const targetReviews = 200;
        const reviews = [];
        let parsedIds = new Set(); // Для избежания дубликатов
        let reviewQueue = []; // Очередь отзывов для обработки

        console.log(`🎯 Цель: спарсить ${targetReviews} отзывов`);

        // Фоновый скролл к последнему отзыву в очереди
        let keepScrolling = true;
        const startBackgroundScroll = async () => {
            while (keepScrolling) {
                if (reviewQueue.length > 0) {
                    // Скроллим к последнему отзыву в очереди как к якорю
                    const lastReviewId = reviewQueue[reviewQueue.length - 1];
                    try {
                        const lastElement = await driver.findElement(By.css(`div[data-id="${lastReviewId}"]`));
                        await driver.executeScript("arguments[0].scrollIntoView({behavior: 'smooth', block: 'center'});", lastElement);
                        console.log(`🎯 Скроллим к якорю - последнему отзыву в очереди: ${lastReviewId}`);
                    } catch (e) {
                        // Если элемент не найден, делаем обычный скролл
                        await driver.executeScript('window.scrollBy(0, 300);');
                    }
                } else {
                    // Если очередь пуста, продолжаем скроллить вниз для поиска новых отзывов
                    await driver.executeScript('window.scrollBy(0, 300);');
                }
                await driver.sleep(2000); // Скроллим каждые 2 секунды
            }
        };

        // Функция для пересканирования страницы и полного обновления очереди
        const updateReviewQueue = async () => {
            console.log(`🔍 Пересканируем страницу для поиска новых отзывов...`);

            // Получаем все текущие элементы отзывов на странице
            const currentReviewElements = await driver.findElements(By.css('.page_mainColumn__oogxd .styles_wrapper___EM4q div[data-id]'));

            console.log(`� Найдено ${currentReviewElements.length} отзывов на странице`);

            // Очищаем старую очередь (элементы могли устареть после скролла)
            reviewQueue = [];

            let newReviewsFound = 0;
            let duplicatesSkipped = 0;

            // Проходим по всем найденным отзывам и добавляем необработанные в очередь
            for (let reviewElement of currentReviewElements) {
                try {
                    const reviewId = await reviewElement.getAttribute('data-id');

                    // Проверяем, что отзыв еще не был обработан
                    if (parsedIds.has(reviewId)) {
                        duplicatesSkipped++;
                        continue;
                    }

                    // Добавляем только ID отзыва в очередь (НЕ сам элемент!)
                    reviewQueue.push(reviewId);
                    newReviewsFound++;

                } catch (e) {
                    console.warn(`⚠️ Не удалось получить ID отзыва:`, e.message);
                }
            }

            console.log(`📈 Добавлено в очередь: ${newReviewsFound} новых отзывов`);

            if (duplicatesSkipped > 0) {
                console.log(`⚠️ Пропущено ${duplicatesSkipped} уже обработанных отзывов`);
            }

            console.log(`📊 Текущая очередь: ${reviewQueue.length} отзывов`);
            console.log(`📊 Уже обработано: ${parsedIds.size} отзывов`);
            console.log(`📊 Всего на странице: ${currentReviewElements.length} отзывов`);

            if (newReviewsFound > 0) {
                console.log(`🆔 Новые ID в очереди:`, reviewQueue.slice(0, 3), reviewQueue.length > 3 ? `... и еще ${reviewQueue.length - 3}` : '');
            }

            return newReviewsFound;
        };        // Начальное сканирование
        console.log(`\n🔍 Выполняем начальное сканирование страницы...`);
        const initialNewReviews = await updateReviewQueue();
        console.log(`📋 Начальная очередь: ${reviewQueue.length} отзывов`);

        if (reviewQueue.length === 0) {
            console.log(`❌ ОШИБКА: Не найдено ни одного отзыва для парсинга!`);
            console.log(`🔍 Проверьте селекторы или структуру страницы.`);
            return;
        }

        // Функция для проверки уникальности отзывов в финальном списке
        const validateUniqueReviews = (reviewsList) => {
            const seenIds = new Set();
            const duplicates = [];

            for (let review of reviewsList) {
                if (seenIds.has(review.id)) {
                    duplicates.push(review.id);
                } else {
                    seenIds.add(review.id);
                }
            }

            if (duplicates.length > 0) {
                console.warn(`⚠️ Обнаружены дубликаты в финальном списке: ${duplicates.join(', ')}`);
                return false;
            } else {
                console.log(`✅ Проверка уникальности пройдена: все ${reviewsList.length} отзывов уникальны`);
                return true;
            }
        };

        // Запускаем фоновый плавный скролл
        const scrollPromise = startBackgroundScroll();

        while (reviews.length < targetReviews && reviewQueue.length > 0) {
            // Берем первый ID отзыва из очереди
            const currentReviewId = reviewQueue.shift();

            console.log(`\n📝 Парсим отзыв ${reviews.length + 1} из ${targetReviews} (ID: ${currentReviewId})...`);
            console.log(`📊 Осталось в очереди: ${reviewQueue.length} отзывов`);

            // Находим элемент по ID заново (чтобы избежать stale element)
            let currentReviewElement;
            try {
                currentReviewElement = await driver.findElement(By.css(`div[data-id="${currentReviewId}"]`));
            } catch (e) {
                console.warn(`❌ Не удалось найти элемент отзыва с ID ${currentReviewId}, возможно элемент устарел`);
                continue;
            }

            const review = await parseReview(driver, currentReviewElement);
            if (review) {
                reviews.push(review);
                parsedIds.add(currentReviewId);

                console.log(`✅ Отзыв ${review.id} успешно спарсен`);
                console.log(`   📅 Дата: ${review.date}`);
                console.log(`   ⭐ Рейтинг: ${review.rating}/5`);
                console.log(`   🔗 Ссылка: ${review.link}`);
                console.log(`   📄 Контент: ${review.content.substring(0, 100)}...`);

                // Ждем немного для подгрузки новых отзывов
                await driver.sleep(1500);

                // ОБЯЗАТЕЛЬНО пересканируем страницу в поисках новых отзывов после каждого спарсенного отзыва
                console.log(`🔄 Пересканируем страницу после парсинга отзыва ${review.id}...`);
                const foundNewReviews = await updateReviewQueue();

                if (foundNewReviews > 0) {
                    console.log(`🎉 Отлично! После скролла найдено ${foundNewReviews} новых отзывов!`);
                } else {
                    console.log(`ℹ️ Новых отзывов после скролла не найдено`);
                }

            } else {
                console.warn(`❌ Не удалось спарсить отзыв ${currentReviewId}`);
            }

            // Небольшая пауза между парсингом отзывов
            await driver.sleep(500);

            // Если очередь пуста, но цель не достигнута, просто ждем и пересканируем
            if (reviewQueue.length === 0 && reviews.length < targetReviews) {
                console.log(`\n⬇️ Очередь пуста, ждем 5 секунд и пересканируем страницу...`);
                await driver.sleep(5000);
                const newReviewsFound = await updateReviewQueue();
                if (reviewQueue.length === 0) {
                    console.log(`\n🏁 Больше отзывов не найдено. Возможно, это все доступные отзывы. Итого спарсено: ${reviews.length} отзывов`);
                    break;
                }
            }
        }

        // Останавливаем фоновый скролл
        keepScrolling = false;
        await scrollPromise;
        console.log('🔍 Выполняем финальную проверку на дубликаты...');
        validateUniqueReviews(reviews);

        // Выводим результаты
        console.log('🎯 РЕЗУЛЬТАТЫ ПАРСИНГА:');
        console.log('========================');
        reviews.forEach((review, index) => {
            console.log(`Отзыв ${index + 1}:`);
            console.log(`  ID: ${review.id}`);
            console.log(`  Дата: ${review.date}`);
            console.log(`  Рейтинг: ${review.rating}/5`);
            console.log(`  Ссылка: ${review.link}`);
            console.log(`  Контент: ${review.content}`);
            console.log('------------------------');
        });

        console.log(`✅ Успешно спарсено ${reviews.length} отзывов из ${targetReviews} запрошенных`);

        // Сохраняем отзывы в JSON файл
        await saveReviewsToFile(reviews);

    } catch (error) {
        console.error('❌ Ошибка при работе парсера:', error.message);
    } finally {
        if (driver) {
            console.log('🔄 Парсинг завершен, браузер остается открытым для изучения...');
            // await driver.quit(); // Закомментировано - браузер остается открытым
            console.log('✅ Браузер остается доступным');
        }
    }
}

// Запуск парсера
if (require.main === module) {
    parseSravniGazprombank()
        .then(() => {
            console.log('🎉 Парсер завершил работу');
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 Критическая ошибка:', error);
            process.exit(1);
        });
}

// Экспорт для использования в других модулях
module.exports = {
    parseSravniGazprombank
};
