/*
 * =================================================================
 * Gorosso E-commerce System - Backend
 * =================================================================
 * * Этот файл содержит полный код для серверной части:
 * 1. Express API для выдачи каталога товаров.
 * 2. Telegram Bot для администрирования и обработки заказов.
 * * Для запуска:
 * 1. Создайте папку проекта.
 * 2. Сохраните этот код как `index.js`.
 * 3. В той же папке создайте файл `products.json` (его структура ниже).
 * 4. Установите зависимости: npm install express node-telegram-bot-api cors body-parser
 * 5. Запустите сервер: node index.js
 */

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

// --- КОНФИГУРАЦИЯ ---
const TOKEN = '8196897207:AAH49lwaEbtYG-lPH5X6tmDMPHm2p1KYZFw'; // <-- ВАЖНО: Замените на ваш токен
const ADMIN_CHAT_ID = 1056083125; // <-- ВАЖНО: Замените на ваш Telegram Chat ID
const WEB_APP_URL = 'https://cozn1l.github.io/gorosso/'; // <-- ВАЖНО: Замените на URL вашего фронтенда
const PAYMENTS_PROVIDER_TOKEN = '6395449203:TEST:f1ae3bd358fbed85786a'; // <-- ВАЖНО: Токен от провайдера платежей (Stripe, YooKassa и т.д.)

const PRODUCTS_DB_PATH = path.join(__dirname, 'products.json');

// --- ИНИЦИАЛИЗАЦИЯ ---
const app = express();
const bot = new TelegramBot(TOKEN, { polling: true });

app.use(cors());
app.use(bodyParser.json());

// --- УТИЛИТЫ ДЛЯ РАБОТЫ С "БАЗОЙ ДАННЫХ" (JSON) ---

// Чтение продуктов из файла
const readProducts = () => {
    try {
        const data = fs.readFileSync(PRODUCTS_DB_PATH, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error("Ошибка чтения файла products.json:", error);
        return [];
    }
};

// Запись продуктов в файл
const writeProducts = (products) => {
    try {
        fs.writeFileSync(PRODUCTS_DB_PATH, JSON.stringify(products, null, 2), 'utf8');
    } catch (error) {
        console.error("Ошибка записи в файл products.json:", error);
    }
};

// --- ПУБЛИЧНЫЙ API ДЛЯ ФРОНТЕНДА ---

// Endpoint для получения списка всех товаров
app.get('/api/products', (req, res) => {
    const products = readProducts();
    res.json(products);
});

// --- ЛОГИКА TELEGRAM БОТА ---

// Обработка команды /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 'Добро пожаловать в магазин Gorosso!', {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🛍️ Открыть магазин', web_app: { url: WEB_APP_URL } }]
            ]
        }
    });
});

// --- АДМИНСКИЕ КОМАНДЫ ---

// Проверка, является ли пользователь админом
const isAdmin = (chatId) => chatId === ADMIN_CHAT_ID;

// Команда для просмотра всех товаров (для админа)
bot.onText(/\/products/, (msg) => {
    const chatId = msg.chat.id;
    if (!isAdmin(chatId)) {
        return bot.sendMessage(chatId, "У вас нет прав для выполнения этой команды.");
    }

    const products = readProducts();
    if (products.length === 0) {
        return bot.sendMessage(chatId, "Каталог пуст.");
    }

    let response = "📋 Список товаров:\n\n";
    products.forEach(p => {
        response += `ID: ${p.id}\nНазвание: ${p.name}\nЦена: ${p.price} руб.\n\n`;
    });
    bot.sendMessage(chatId, response);
});

// Команда для добавления товара
// Формат: /addproduct Название;Цена;Описание;URL_картинки
bot.onText(/\/addproduct (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (!isAdmin(chatId)) {
        return bot.sendMessage(chatId, "У вас нет прав для выполнения этой команды.");
    }

    const params = match[1].split(';');
    if (params.length !== 4) {
        return bot.sendMessage(chatId, "Неверный формат. Используйте:\n/addproduct Название;Цена;Описание;URL_картинки");
    }

    const [name, price, description, imageUrl] = params;
    const products = readProducts();
    const newProduct = {
        id: Date.now(), // Простой способ генерации уникального ID
        name: name.trim(),
        price: parseInt(price.trim(), 10),
        description: description.trim(),
        imageUrl: imageUrl.trim()
    };

    products.push(newProduct);
    writeProducts(products);

    bot.sendMessage(chatId, `✅ Товар "${newProduct.name}" успешно добавлен!`);
});

// Команда для удаления товара
bot.onText(/\/delproduct (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (!isAdmin(chatId)) {
        return bot.sendMessage(chatId, "У вас нет прав для выполнения этой команды.");
    }
    
    const idToDelete = parseInt(match[1].trim(), 10);
    let products = readProducts();
    const initialLength = products.length;

    products = products.filter(p => p.id !== idToDelete);

    if (products.length === initialLength) {
        return bot.sendMessage(chatId, `❌ Товар с ID ${idToDelete} не найден.`);
    }

    writeProducts(products);
    bot.sendMessage(chatId, `🗑️ Товар с ID ${idToDelete} успешно удален.`);
});


// --- ОБРАБОТКА ДАННЫХ ИЗ WEB APP (КОРЗИНА) ---

bot.on('web_app_data', (msg) => {
    try {
        const chatId = msg.chat.id;
        const data = JSON.parse(msg.web_app_data.data);
        
        if (!data || Object.keys(data).length === 0) {
            return bot.sendMessage(chatId, "Корзина пуста. Пожалуйста, добавьте товары.");
        }

        const allProducts = readProducts();
        let totalPrice = 0;
        const prices = [];
        let invoiceDescription = "Ваш заказ в Gorosso:\n";

        for (const itemId in data) {
            const product = allProducts.find(p => p.id == itemId);
            const quantity = data[itemId];
            if (product) {
                const itemPrice = product.price * quantity;
                totalPrice += itemPrice;
                prices.push({
                    label: `${product.name} x${quantity}`,
                    // Сумма в копейках
                    amount: itemPrice * 100 
                });
                invoiceDescription += `- ${product.name} x${quantity}\n`;
            }
        }
        
        if (totalPrice === 0) {
             return bot.sendMessage(chatId, "Не удалось обработать корзину. Попробуйте снова.");
        }

        // Создание счета на оплату
        bot.sendInvoice(
            chatId,
            'Оплата заказа Gorosso', // title
            invoiceDescription, // description
            `order_${Date.now()}`, // payload
            PAYMENTS_PROVIDER_TOKEN, // provider_token
            'RUB', // currency
            prices // prices
        ).then(() => {
            console.log(`Счет на ${totalPrice} руб. выставлен пользователю ${chatId}`);
        }).catch((error) => {
            console.error("Ошибка выставления счета:", error);
            bot.sendMessage(chatId, "Произошла ошибка при создании счета. Пожалуйста, попробуйте позже.");
        });

    } catch (error) {
        console.error('Ошибка обработки данных из Web App:', error);
        bot.sendMessage(msg.chat.id, "Произошла ошибка при обработке вашего заказа.");
    }
});

// Обработка успешного платежа
bot.on('pre_checkout_query', (query) => {
    bot.answerPreCheckoutQuery(query.id, true);
});

bot.on('successful_payment', (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `✅ Оплата прошла успешно! Спасибо за ваш заказ на сумму ${msg.successful_payment.total_amount / 100} ${msg.successful_payment.currency}.`);
    // Здесь можно добавить логику для отправки заказа админу
    if(isAdmin(ADMIN_CHAT_ID)) {
        bot.sendMessage(ADMIN_CHAT_ID, `🎉 Новый оплаченный заказ от пользователя ${msg.from.first_name} (@${msg.from.username}) на сумму ${msg.successful_payment.total_amount / 100} ${msg.successful_payment.currency}.`);
    }
});


// --- ЗАПУСК СЕРВЕРА ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});

/*
 * =================================================================
 * Пример файла `products.json`
 * =================================================================
 * * Создайте этот файл в той же директории, что и `index.js`.
 * [
  {
    "id": 1694535311181,
    "name": "Худи 'Urban Explorer'",
    "price": 4500,
    "description": "Классическое худи из плотного хлопка. Идеально для городских прогулок.",
    "imageUrl": "https://placehold.co/600x600/222/fff?text=Hoodie"
  },
  {
    "id": 1694535348879,
    "name": "Футболка 'Street Legacy'",
    "price": 2200,
    "description": "Футболка с минималистичным принтом. Свободный крой.",
    "imageUrl": "https://placehold.co/600x600/eee/000?text=T-Shirt"
  },
  {
    "id": 1694535384463,
    "name": "Брюки-карго 'Navigator'",
    "price": 5100,
    "description": "Прочные и удобные брюки с множеством карманов.",
    "imageUrl": "https://placehold.co/600x600/555/fff?text=Pants"
  }
]
 *
 */
