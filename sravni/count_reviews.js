const fs = require('fs');

// Читаем файл reviews.json
const reviews = JSON.parse(fs.readFileSync('reviews.json', 'utf8'));

// Определяем временной промежуток
const startDate = new Date('2024-01-01');
const endDate = new Date('2025-05-31');

// Считаем элементы в указанном промежутке
let count = 0;
let totalReviews = reviews.length;

reviews.forEach(review => {
    const reviewDate = new Date(review.date);

    if (reviewDate >= startDate && reviewDate <= endDate) {
        count++;
    }
});

console.log(`Всего отзывов в файле: ${totalReviews}`);
console.log(`Отзывов в промежутке 01.01.2024 - 31.05.2025: ${count}`);
console.log(`Процент от общего количества: ${((count / totalReviews) * 100).toFixed(2)}%`);