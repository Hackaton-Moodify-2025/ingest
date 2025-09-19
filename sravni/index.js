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
        const targetReviews = 50;
        const reviews = [];
        let parsedIds = new Set(); // Для избежания дубликатов

        console.log(`🎯 Цель: спарсить ${targetReviews} отзывов`);

        while (reviews.length < targetReviews) {
            // Ищем все отзывы на текущей странице
            const reviewElements = await driver.findElements(By.css('.page_mainColumn__oogxd .styles_wrapper___EM4q div[data-id]'));

            console.log(`📋 Найдено отзывов на странице: ${reviewElements.length}`);
            console.log(`📊 Уже спарсено: ${reviews.length} из ${targetReviews}`);

            // Парсим новые отзывы
            let newReviewsCount = 0;
            for (let i = 0; i < reviewElements.length && reviews.length < targetReviews; i++) {
                const reviewId = await reviewElements[i].getAttribute('data-id');

                // Проверяем, не парсили ли мы уже этот отзыв
                if (parsedIds.has(reviewId)) {
                    continue;
                }

                console.log(`📝 Парсим отзыв ${reviews.length + 1} из ${targetReviews} (ID: ${reviewId})...`);

                const review = await parseReview(driver, reviewElements[i]);
                if (review) {
                    reviews.push(review);
                    parsedIds.add(reviewId);
                    newReviewsCount++;

                    console.log(`✅ Отзыв ${review.id} успешно спарсен`);
                    console.log(`   📅 Дата: ${review.date}`);
                    console.log(`   ⭐ Рейтинг: ${review.rating}/5`);
                    console.log(`   🔗 Ссылка: ${review.link}`);
                    console.log(`   📄 Контент: ${review.content.substring(0, 100)}...`);

                    // Скроллим на 300 пикселей вниз после каждого спарсенного отзыва
                    const currentScrollY = await driver.executeScript("return window.pageYOffset;");
                    const newScrollY = currentScrollY + 300;
                    await driver.executeScript(`window.scrollTo(0, ${newScrollY});`);
                    console.log(`   📍 Скролл: ${currentScrollY}px → ${newScrollY}px`);

                    // Ждем немного для подгрузки новых отзывов
                    await driver.sleep(1000);
                    console.log('');
                } else {
                    console.warn(`❌ Не удалось спарсить отзыв ${reviewId}`);
                }

                // Небольшая пауза между парсингом отзывов
                await driver.sleep(500);
            }

            // Если достигли цели, выходим
            if (reviews.length >= targetReviews) {
                console.log(`🎉 Достигнута цель: спарсено ${reviews.length} отзывов!`);
                break;
            }

            // Если новых отзывов не появилось, нужно скроллить
            if (newReviewsCount === 0) {
                console.log(`⬇️ Скроллим вниз для загрузки новых отзывов...`);

                // Получаем текущую позицию скролла
                const currentScrollY = await driver.executeScript("return window.pageYOffset;");
                console.log(`📍 Текущая позиция скролла: ${currentScrollY}px`);

                // Плавно скроллим на 300 пикселей вниз
                const newScrollY = currentScrollY + 300;
                await driver.executeScript(`window.scrollTo(0, ${newScrollY});`);
                console.log(`📍 Новая позиция скролла: ${newScrollY}px`);

                // Ждем загрузки новых отзывов
                await driver.sleep(2000);

                // Проверяем, появились ли новые отзывы
                const newReviewElements = await driver.findElements(By.css('.page_mainColumn__oogxd .styles_wrapper___EM4q div[data-id]'));

                if (newReviewElements.length === reviewElements.length) {
                    console.log(`⚠️ Новые отзывы не загрузились после скролла на 300px`);

                    // Попробуем еще раз скроллить немного больше
                    const finalScrollY = newScrollY + 500;
                    await driver.executeScript(`window.scrollTo(0, ${finalScrollY});`);
                    console.log(`📍 Финальный скролл до: ${finalScrollY}px`);
                    await driver.sleep(3000);

                    // Последняя проверка
                    const finalReviewElements = await driver.findElements(By.css('.page_mainColumn__oogxd .styles_wrapper___EM4q div[data-id]'));

                    if (finalReviewElements.length === reviewElements.length) {
                        console.log(`⚠️ Новые отзывы так и не загрузились. Возможно, это все доступные отзывы.`);
                        console.log(`📊 Итого спарсено: ${reviews.length} отзывов`);
                        break;
                    } else {
                        console.log(`📈 Загружено новых отзывов после дополнительного скролла: ${finalReviewElements.length - reviewElements.length}`);
                    }
                } else {
                    console.log(`📈 Загружено новых отзывов: ${newReviewElements.length - reviewElements.length}`);
                }
            }
        }        // Выводим результаты
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
