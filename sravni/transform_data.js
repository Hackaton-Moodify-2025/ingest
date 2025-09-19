const fs = require('fs');

function transformData() {
    console.log('Начинаем преобразование dataset.json...');
    
    // Читаем исходный файл
    const rawData = fs.readFileSync('dataset.json', 'utf8');
    const dataset = JSON.parse(rawData);
    
    console.log(`Найдено ${dataset.length} записей для обработки`);
    
    const transformedData = dataset.map((item, index) => {
        // Извлекаем title и text из content
        let title = '';
        let text = '';
        
        if (item.content) {
            // Ищем первые два переноса строки
            const doubleNewlineIndex = item.content.indexOf('\n\n');
            
            if (doubleNewlineIndex !== -1) {
                // Если нашли двойной перенос, берем все до него как title
                title = item.content.substring(0, doubleNewlineIndex).trim();
                // Остальное как text, убирая title из начала
                text = item.content.substring(doubleNewlineIndex + 2).trim();
            } else {
                // Если двойного переноса нет, ищем одинарный
                const singleNewlineIndex = item.content.indexOf('\n');
                if (singleNewlineIndex !== -1) {
                    title = item.content.substring(0, singleNewlineIndex).trim();
                    text = item.content.substring(singleNewlineIndex + 1).trim();
                } else {
                    // Если переносов вообще нет, весь content становится title
                    title = item.content.trim();
                    text = '';
                }
            }
        }
        
        // Преобразуем статус
        let status = '';
        if (item.status === 'ПРОВЕРЕН') {
            status = 'verified';
        } else if (item.status === 'ПРОБЛЕМА РЕШЕНА') {
            status = 'decided';
        } else {
            status = item.status ? item.status.toLowerCase() : '';
        }
        
        // Создаем новый объект с нужным порядком полей
        const transformedItem = {
            id: parseInt(item.id), // Преобразуем в число
            link: item.link || '',
            date: item.date || '',
            title: title,
            text: text,
            rating: item.rating ? item.rating.toString() : '', // Преобразуем в строку
            status: status,
            city: item.city || ''
        };
        
        // Добавляем product только если он есть
        if (item.product) {
            transformedItem.product = item.product;
        }
        
        // Логируем прогресс каждые 1000 записей
        if ((index + 1) % 1000 === 0) {
            console.log(`Обработано ${index + 1} записей...`);
        }
        
        return transformedItem;
    });
    
    // Записываем результат в новый файл
    fs.writeFileSync('data.json', JSON.stringify(transformedData, null, 2), 'utf8');
    
    console.log(`✅ Преобразование завершено! Создан файл data.json с ${transformedData.length} записями`);
    console.log('📊 Примеры преобразованных записей:');
    
    // Показываем несколько примеров
    for (let i = 0; i < Math.min(3, transformedData.length); i++) {
        console.log(`\nПример ${i + 1}:`);
        console.log('Title:', transformedData[i].title);
        console.log('Text preview:', transformedData[i].text.substring(0, 100) + (transformedData[i].text.length > 100 ? '...' : ''));
        console.log('Status:', transformedData[i].status);
        console.log('Rating type:', typeof transformedData[i].rating);
        console.log('ID type:', typeof transformedData[i].id);
    }
}

// Запускаем преобразование
try {
    transformData();
} catch (error) {
    console.error('❌ Ошибка при преобразовании данных:', error.message);
    process.exit(1);
}